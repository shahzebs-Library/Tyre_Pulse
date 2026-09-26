/**
 * TyreSizeAnalysis (route /tyre-size-analysis) - Tyre Size & Specification
 * Optimizer. Size mix, CPK by size, size x brand matrix, position-size
 * compliance, a 12-month size-brand CPK trend and consolidation opportunities.
 *
 * All maths lives in the pure `src/lib/tyreSizeAnalytics.js`. Per-tyre CPK uses
 * tyre_records (the per-km measure); the fleet tyre SPEND tile reads the
 * classified expense grid (loadGovernedCostSplit) and is never a sum of
 * cost_per_tyre. Anything unmeasurable renders N/A.
 */
import { useState, useEffect, useMemo, useCallback } from 'react'
import { supabase } from '../lib/supabase'
import { fetchAllPages } from '../lib/fetchAll'
import { normalizePosition } from '../lib/tyrePositions'
import { useSettings } from '../contexts/SettingsContext'
import { useTenant } from '../contexts/TenantContext'
import { useLanguage } from '../contexts/LanguageContext'
import { resolvePdfBrand, pdfHeader, pdfFooter, pdfEmptyState, pdfTableTheme, reportFileName } from '../lib/exportUtils'
import {
  Layers, FileText, AlertTriangle, CheckCircle, TrendingUp, RefreshCw, Target,
  BarChart3, Loader2, FileSpreadsheet, Package, Award, ShieldAlert, Lightbulb,
  DollarSign, Activity, X, Calendar, Globe, MapPin, CircleDot, Info,
} from 'lucide-react'
import {
  Chart as ChartJS,
  CategoryScale, LinearScale, BarElement, LineElement, PointElement,
  ArcElement, Title, Tooltip, Legend, Filler,
} from 'chart.js'
import { Bar, Line, Doughnut } from 'react-chartjs-2'
import PageHeader from '../components/ui/PageHeader'
import EnterpriseTable from '../components/ui/EnterpriseTable'
import { toUserMessage } from '../lib/safeError'
import useLatestRequest from '../lib/useLatestRequest'
import { loadAutoTable } from '../lib/pdfEngine'
import { loadGovernedCostSplit } from '../lib/api/governedCost'
import { colorAt, withAlpha } from '../lib/reportColors'
import {
  BENCHMARK_GOOD, BENCHMARK_AVG, MIN_RECORDS_CPK, UNKNOWN_SIZE,
  cpkBand, makeSizeLabeller, filterSizeRecords, filterOptionsFor, datePresetRange,
  sizeMetrics as buildSizeMetrics, bySizeCount, sizeKpis, sizeBrandMatrix,
  brandBreakdown, positionCompliance, comboTrend, consolidationOps as buildConsolidationOps,
} from '../lib/tyreSizeAnalytics'

ChartJS.register(
  CategoryScale, LinearScale, BarElement, LineElement, PointElement,
  ArcElement, Title, Tooltip, Legend, Filler,
)

const ROW_CAP = 50000

const DATE_PRESETS = [
  { label: '30d', days: 30 },
  { label: '90d', days: 90 },
  { label: '6mo', days: 180 },
  { label: '1yr', days: 365 },
  { label: 'All', days: null },
]

// Theme tokens resolved on the canvas by chartVarPlugin (light and dark mode).
const CHART_BASE = {
  responsive: true,
  maintainAspectRatio: false,
  plugins: {
    legend: { labels: { color: 'var(--text-muted)', font: { size: 11 } } },
    tooltip: {
      backgroundColor: 'var(--surface-raised)',
      titleColor: 'var(--text-primary)',
      bodyColor: 'var(--text-secondary)',
      borderColor: 'var(--border-bright)',
      borderWidth: 1,
    },
  },
  scales: {
    x: { ticks: { color: 'var(--text-muted)', font: { size: 11 } }, grid: { color: 'var(--panel-2)' } },
    y: { ticks: { color: 'var(--text-muted)', font: { size: 11 } }, grid: { color: 'var(--panel-2)' } },
  },
}

// Semantic CPK bands (meaning, not decoration) keep fixed colours + a text label.
const BAND_META = {
  good: { text: 'text-green-400', cell: 'bg-green-900/30', label: 'Good', fill: 'rgba(16,185,129,0.8)' },
  avg: { text: 'text-yellow-400', cell: 'bg-yellow-900/30', label: 'Average', fill: 'rgba(245,158,11,0.8)' },
  poor: { text: 'text-red-400', cell: 'bg-red-900/30', label: 'Poor', fill: 'rgba(239,68,68,0.8)' },
}

function fmtCpk(v, currency) {
  if (v == null || !Number.isFinite(v)) return 'N/A'
  return `${currency} ${v.toFixed(4)}/km`
}
function fmtKm(v) {
  if (v == null || !Number.isFinite(v) || v === 0) return 'N/A'
  if (v >= 1000) return `${(v / 1000).toFixed(0)}k km`
  return `${Math.round(v)} km`
}
function fmtPct(v) {
  if (v == null || !Number.isFinite(v)) return 'N/A'
  return `${v.toFixed(1)}%`
}
function fmtMoney(v, currency) {
  if (v == null || !Number.isFinite(v)) return 'N/A'
  return `${currency} ${Math.round(v).toLocaleString()}`
}

function stdFlagColor(flag) {
  if (flag === 'Standard') return 'text-green-400 bg-green-900/20 border border-green-800/60'
  if (flag === 'Low Volume') return 'text-yellow-400 bg-yellow-900/20 border border-yellow-800/60'
  return 'text-red-400 bg-red-900/20 border border-red-800/60'
}

function CpkCell({ value, currency, digits = 4 }) {
  const band = cpkBand(value)
  if (!band) return <span className="text-[var(--text-muted)]">N/A</span>
  const meta = BAND_META[band]
  return (
    <span className={`font-mono tabular-nums ${meta.text}`} title={`${meta.label} CPK`}>
      {currency ? `${currency} ` : ''}{value.toFixed(digits)}
    </span>
  )
}

function Panel({ icon: Icon, title, hint, children, right }) {
  return (
    <section className="bg-[var(--surface-1)] border border-[var(--input-border)] rounded-xl">
      <div className="p-4 border-b border-[var(--input-border)] flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-semibold text-[var(--text-secondary)] flex items-center gap-2">
          <Icon className="w-4 h-4 text-[var(--accent)]" aria-hidden="true" />
          {title}
        </h2>
        {right || (hint && <span className="text-xs text-[var(--text-muted)]">{hint}</span>)}
      </div>
      {children}
    </section>
  )
}

function opTitle(op) {
  if (op.type === 'eliminate') return `Eliminate size ${op.size}`
  if (op.type === 'standardize') return `Standardize ${op.size} on ${op.best.brand}`
  return `Review specification for ${op.size}`
}
function opDesc(op, currency) {
  if (op.type === 'eliminate') return `Used by only 1 vehicle (${op.vehicle || 'unknown'}). Consider eliminating it to reduce procurement complexity.`
  if (op.type === 'standardize') {
    return `${op.best.brand} CPK ${currency} ${op.best.avgCpk.toFixed(4)} vs ${op.worst.brand} CPK ${currency} ${op.worst.avgCpk.toFixed(4)}. Switch ${op.worst.count} tyres to ${op.best.brand}.`
  }
  return `Average CPK of ${currency} ${op.avgCpk.toFixed(4)}/km is over twice the fleet average. Investigate the root cause and consider an alternative specification.`
}

export default function TyreSizeAnalysis() {
  const { activeCountry, activeCurrency, appSettings } = useSettings()
  const { branding } = useTenant()
  const { t } = useLanguage()
  const [records, setRecords] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [truncated, setTruncated] = useState(false)
  const [refreshKey, setRefreshKey] = useState(0)
  const [exportError, setExportError] = useState('')

  // Filters
  const [filterCountry, setFilterCountry] = useState('All')
  const [filterSite, setFilterSite] = useState('All')
  const [filterBrand, setFilterBrand] = useState('All')
  const [filterPosition, setFilterPosition] = useState('All')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [activeDatePreset, setActiveDatePreset] = useState('All')

  // UI state
  const [selectedSize, setSelectedSize] = useState(null)
  const [exporting, setExporting] = useState(false)
  const [fleetCost, setFleetCost] = useState({ loading: true, tyre: null, blended: false, failed: false })

  // A newer date range must never be overwritten by an older, slower read.
  const latestLoad = useLatestRequest()

  // ── Fetch (paged, bounded, country + date scoped server-side) ────────────────
  useEffect(() => {
    const stale = latestLoad.begin()
    setLoading(true)
    setError(null)
    fetchAllPages((from, to) => {
      let q = supabase
        .from('tyre_records')
        .select('id,asset_no,serial_number:serial_no,size,brand,position,cost_per_tyre,km_at_fitment,km_at_removal,risk_level,site,country,tread_depth,issue_date')
        .order('id')
      if (activeCountry !== 'All') q = q.eq('country', activeCountry)
      // Mirror the client filter exactly (rows with no issue_date are kept).
      if (dateFrom) q = q.or(`issue_date.is.null,issue_date.gte.${dateFrom}`)
      if (dateTo) q = q.or(`issue_date.is.null,issue_date.lte.${dateTo}`)
      return q.range(from, to)
    }, { max: ROW_CAP }).then(({ data, error: err, truncated: trunc }) => {
      if (stale()) return
      if (err) { setError(toUserMessage(err, 'Could not load tyre data.')); setLoading(false); return }
      setRecords(data || [])
      setTruncated(!!trunc)
      setLoading(false)
    })
  }, [activeCountry, dateFrom, dateTo, refreshKey, latestLoad])

  // ── Fleet tyre spend from the expense grid (never a cost_per_tyre sum) ───────
  useEffect(() => {
    let alive = true
    setFleetCost((c) => ({ ...c, loading: true, failed: false }))
    const win = dateFrom && dateTo ? { from: dateFrom, to: dateTo } : {}
    loadGovernedCostSplit({ country: activeCountry, ...win })
      .then((r) => { if (alive) setFleetCost({ loading: false, tyre: r?.tyre ?? null, blended: Boolean(r?.blended), failed: false }) })
      .catch(() => { if (alive) setFleetCost({ loading: false, tyre: null, blended: false, failed: true }) })
    return () => { alive = false }
  }, [activeCountry, dateFrom, dateTo, refreshKey])

  const reload = useCallback(() => setRefreshKey((k) => k + 1), [])

  // ── Derived (all via the pure engine) ───────────────────────────────────────
  const label = useMemo(() => makeSizeLabeller(records), [records])
  const filterOptions = useMemo(() => filterOptionsFor(records), [records])

  const filtered = useMemo(() => filterSizeRecords(records, {
    country: filterCountry, site: filterSite, brand: filterBrand, position: filterPosition, from: dateFrom, to: dateTo,
  }, normalizePosition), [records, filterCountry, filterSite, filterBrand, filterPosition, dateFrom, dateTo])

  const sizeMetrics = useMemo(() => buildSizeMetrics(filtered, label), [filtered, label])
  const sortedSizeMetrics = useMemo(() => bySizeCount(sizeMetrics), [sizeMetrics])
  const kpis = useMemo(() => sizeKpis(filtered, sizeMetrics), [filtered, sizeMetrics])
  const matrixData = useMemo(() => sizeBrandMatrix(filtered, sizeMetrics, label), [filtered, sizeMetrics, label])
  const posCompliance = useMemo(() => positionCompliance(filtered, label, normalizePosition), [filtered, label])
  const trend = useMemo(() => comboTrend(filtered, label, new Date()), [filtered, label])
  const consolidationOps = useMemo(
    () => buildConsolidationOps(filtered, sizeMetrics, label, kpis.fleetAvgCpk),
    [filtered, sizeMetrics, label, kpis.fleetAvgCpk],
  )
  const breakdown = useMemo(
    () => (selectedSize ? brandBreakdown(filtered, selectedSize, label) : []),
    [filtered, selectedSize, label],
  )

  // Drop a selection the current filters no longer contain.
  useEffect(() => {
    if (selectedSize && !sizeMetrics.some((m) => m.size === selectedSize)) setSelectedSize(null)
  }, [selectedSize, sizeMetrics])

  const hasActiveFilter = filterCountry !== 'All' || filterSite !== 'All' || filterBrand !== 'All' ||
    filterPosition !== 'All' || dateFrom !== '' || dateTo !== ''

  function applyDatePreset(presetLabel, days) {
    setActiveDatePreset(presetLabel)
    const r = datePresetRange(days, new Date())
    setDateFrom(r.from); setDateTo(r.to)
  }

  function clearFilters() {
    setFilterCountry('All'); setFilterSite('All')
    setFilterBrand('All'); setFilterPosition('All')
    setDateFrom(''); setDateTo(''); setActiveDatePreset('All')
  }

  // ── Charts ───────────────────────────────────────────────────────────────────
  const doughnutData = useMemo(() => {
    const top8 = sortedSizeMetrics.slice(0, 8)
    const restCount = sortedSizeMetrics.slice(8).reduce((s, m) => s + m.count, 0)
    const labels = [...top8.map((m) => m.size), ...(restCount > 0 ? ['Other'] : [])]
    const data = [...top8.map((m) => m.count), ...(restCount > 0 ? [restCount] : [])]
    return {
      labels,
      datasets: [{
        data,
        backgroundColor: [...top8.map((_, i) => colorAt(i)), ...(restCount > 0 ? ['var(--text-muted)'] : [])],
        borderColor: 'var(--surface-1)',
        borderWidth: 2,
      }],
    }
  }, [sortedSizeMetrics])

  const doughnutOpts = useMemo(() => ({
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: { position: 'bottom', labels: { color: 'var(--text-muted)', font: { size: 11 }, padding: 10, boxWidth: 12 } },
      tooltip: {
        ...CHART_BASE.plugins.tooltip,
        callbacks: {
          label: (ctx) => {
            const val = ctx.parsed
            const total = ctx.dataset.data.reduce((s, v) => s + v, 0)
            const pct = total > 0 ? ((val / total) * 100).toFixed(1) : 0
            return ` ${t('tyresize.charts.doughnutTooltip', { count: val, pct })}`
          },
        },
      },
    },
  }), [t])

  const cpkBarData = useMemo(() => {
    const withCpk = sizeMetrics.filter((m) => m.avgCpk != null).sort((a, b) => a.avgCpk - b.avgCpk).slice(0, 15)
    return {
      labels: withCpk.map((m) => m.size),
      datasets: [{
        label: t('tyresize.charts.avgCpkSeries'),
        data: withCpk.map((m) => m.avgCpk),
        backgroundColor: withCpk.map((m) => BAND_META[cpkBand(m.avgCpk)].fill),
        borderRadius: 3,
      }],
    }
  }, [sizeMetrics, t])

  const cpkBarOpts = useMemo(() => ({
    ...CHART_BASE,
    indexAxis: 'y',
    plugins: {
      ...CHART_BASE.plugins,
      legend: { display: false },
      tooltip: {
        ...CHART_BASE.plugins.tooltip,
        callbacks: { label: (ctx) => ` ${activeCurrency} ${ctx.parsed.x.toFixed(4)}/km` },
      },
    },
    scales: {
      x: { ...CHART_BASE.scales.x, title: { display: true, text: `CPK (${activeCurrency}/km)`, color: 'var(--text-muted)' } },
      y: { ...CHART_BASE.scales.y },
    },
  }), [activeCurrency])

  const trendData = useMemo(() => ({
    labels: trend.labels,
    datasets: trend.series.map((s, i) => ({
      label: s.label,
      data: s.data,
      borderColor: colorAt(i),
      backgroundColor: withAlpha(colorAt(i), 0.13),
      tension: 0.3,
      fill: false,
      spanGaps: true,
      pointRadius: 3,
      borderDash: i === 1 ? [6, 4] : i === 2 ? [2, 3] : undefined,
    })),
  }), [trend])

  const trendOpts = useMemo(() => ({
    ...CHART_BASE,
    plugins: {
      ...CHART_BASE.plugins,
      tooltip: {
        ...CHART_BASE.plugins.tooltip,
        callbacks: { label: (ctx) => (ctx.parsed.y == null ? ' No measured CPK' : ` ${activeCurrency} ${ctx.parsed.y.toFixed(4)}/km`) },
      },
    },
    scales: {
      x: { ...CHART_BASE.scales.x, ticks: { ...CHART_BASE.scales.x.ticks, autoSkip: true, maxRotation: 0 } },
      y: { ...CHART_BASE.scales.y, title: { display: true, text: `CPK (${activeCurrency}/km)`, color: 'var(--text-muted)' } },
    },
  }), [activeCurrency])

  // ── Table columns ────────────────────────────────────────────────────────────
  const sizeColumns = useMemo(() => [
    { id: 'size', header: 'Size', accessorFn: (m) => m.size,
      cell: ({ row }) => <span className="font-mono text-[var(--text-primary)] font-medium whitespace-nowrap">{row.original.size}</span> },
    { id: 'count', header: 'Count', accessorFn: (m) => m.count, meta: { align: 'right' },
      cell: ({ row }) => row.original.count.toLocaleString() },
    { id: 'pct', header: '% Fleet', accessorFn: (m) => m.pct, meta: { align: 'right', exportValue: (m) => fmtPct(m.pct) },
      cell: ({ row }) => fmtPct(row.original.pct) },
    { id: 'avgCpk', header: `Avg CPK (${activeCurrency}/km)`, accessorFn: (m) => m.avgCpk ?? -1, meta: { align: 'right', exportValue: (m) => (m.avgCpk != null ? m.avgCpk.toFixed(4) : '') },
      cell: ({ row }) => <CpkCell value={row.original.avgCpk} /> },
    { id: 'avgLife', header: 'Avg Life', accessorFn: (m) => m.avgLife ?? -1, meta: { align: 'right', exportValue: (m) => (m.avgLife != null ? Math.round(m.avgLife) : '') },
      cell: ({ row }) => fmtKm(row.original.avgLife) },
    { id: 'failRate', header: 'Fail Rate', accessorFn: (m) => m.failRate ?? -1, meta: { align: 'right', exportValue: (m) => fmtPct(m.failRate) },
      cell: ({ row }) => {
        const m = row.original
        if (m.failRate == null) return <span className="text-[var(--text-muted)]" title="No tyre of this size carries a risk rating">N/A</span>
        return <span className={m.failRate > 20 ? 'text-red-400' : m.failRate > 10 ? 'text-yellow-400' : 'text-[var(--text-secondary)]'} title={`Over ${m.ratedCount} rated tyres`}>{fmtPct(m.failRate)}</span>
      } },
    { id: 'brands', header: 'Brands', accessorFn: (m) => m.brands.join(', '), enableSorting: false,
      cell: ({ row }) => {
        const b = row.original.brands
        return <span className="text-[var(--text-muted)]" title={b.join(', ')}>{b.slice(0, 3).join(', ')}{b.length > 3 ? ` +${b.length - 3}` : ''}{b.length === 0 ? 'N/A' : ''}</span>
      } },
    { id: 'sites', header: 'Sites', accessorFn: (m) => m.sites.join(', '), enableSorting: false,
      cell: ({ row }) => {
        const s = row.original.sites
        return <span className="text-[var(--text-muted)]" title={s.join(', ')}>{s.slice(0, 2).join(', ')}{s.length > 2 ? ` +${s.length - 2}` : ''}{s.length === 0 ? 'N/A' : ''}</span>
      } },
    { id: 'flag', header: 'Flag', accessorFn: (m) => m.flag,
      cell: ({ row }) => <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium ${stdFlagColor(row.original.flag)}`}>{row.original.flag}</span> },
  ], [activeCurrency])

  const breakdownColumns = useMemo(() => [
    { id: 'brand', header: 'Brand', accessorFn: (b) => b.brand, cell: ({ row }) => <span className="font-medium text-[var(--text-primary)]">{row.original.brand}</span> },
    { id: 'count', header: 'Count', accessorFn: (b) => b.count, meta: { align: 'right' } },
    { id: 'avgCpk', header: `Avg CPK (${activeCurrency}/km)`, accessorFn: (b) => b.avgCpk ?? -1, meta: { align: 'right' }, cell: ({ row }) => <CpkCell value={row.original.avgCpk} /> },
    { id: 'avgLife', header: 'Avg Life', accessorFn: (b) => b.avgLife ?? -1, meta: { align: 'right' }, cell: ({ row }) => fmtKm(row.original.avgLife) },
  ], [activeCurrency])

  const matrixRows = useMemo(
    () => matrixData.sizes.map((sz) => ({ size: sz, ...Object.fromEntries(matrixData.brands.map((br) => [`b:${br}`, matrixData.matrix[sz]?.[br] ?? null])) })),
    [matrixData],
  )
  const matrixColumns = useMemo(() => [
    { id: 'size', header: 'Size / Brand', accessorFn: (r) => r.size, cell: ({ row }) => <span className="font-mono text-[var(--text-primary)] whitespace-nowrap">{row.original.size}</span> },
    ...matrixData.brands.map((br) => ({
      id: `b:${br}`,
      header: br,
      accessorFn: (r) => r[`b:${br}`] ?? -1,
      meta: { align: 'center' },
      cell: ({ row }) => {
        const v = row.original[`b:${br}`]
        const band = cpkBand(v)
        if (!band) return <span className="text-[var(--text-muted)]">N/A</span>
        return (
          <span className={`inline-flex items-center gap-1 rounded px-2 py-0.5 font-mono ${BAND_META[band].cell} ${BAND_META[band].text}`}>
            {v.toFixed(3)} <span className="sr-only">{BAND_META[band].label}</span>
          </span>
        )
      },
    })),
  ], [matrixData])

  const posColumns = useMemo(() => [
    { id: 'pos', header: 'Position', accessorFn: (p) => p.pos, cell: ({ row }) => <span className="font-medium text-[var(--text-primary)]">{row.original.pos}</span> },
    { id: 'required', header: 'Required sizes', accessorFn: (p) => p.required.join(', '), enableSorting: false,
      cell: ({ row }) => <span className="font-mono text-xs text-[var(--text-muted)]">{row.original.required.join(', ') || 'N/A'}</span> },
    { id: 'nonStd', header: 'Non-std', accessorFn: (p) => p.nonStd, meta: { align: 'right' },
      cell: ({ row }) => <span className={row.original.nonStd > 0 ? 'text-red-400' : 'text-[var(--text-muted)]'}>{row.original.nonStd}</span> },
    { id: 'compliance', header: 'Compliance', accessorFn: (p) => p.compliance ?? -1, meta: { align: 'right' },
      cell: ({ row }) => {
        const c = row.original.compliance
        if (c == null) return 'N/A'
        const tone = c >= 90 ? 'text-green-400' : c >= 70 ? 'text-yellow-400' : 'text-red-400'
        const bar = c >= 90 ? 'bg-green-500' : c >= 70 ? 'bg-yellow-500' : 'bg-red-500'
        return (
          <div className="flex items-center justify-end gap-2">
            <span className={`font-medium tabular-nums ${tone}`}>{fmtPct(c)}</span>
            <div className="w-16 bg-[var(--input-bg)] rounded-full h-1.5" aria-hidden="true"><div className={`h-1.5 rounded-full ${bar}`} style={{ width: `${c}%` }} /></div>
          </div>
        )
      } },
  ], [])

  // ── Exports ──────────────────────────────────────────────────────────────────
  const company = branding?.legal_name || branding?.display_name || appSettings?.company_name || 'TyrePulse'
  const fileBase = reportFileName('Tyre Size Analysis')

  async function exportPDF() {
    setExporting(true); setExportError('')
    try {
      const { default: jsPDF } = await import('jspdf')
      const autoTable = await loadAutoTable()
      const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' })
      const brand = await resolvePdfBrand(branding)
      const filename = `${fileBase}.pdf`

      pdfHeader(doc, 'Tyre Size and Specification Optimizer',
        `Fleet: ${kpis.total} tyres, ${kpis.uniqueSz} unique sizes`, company, brand)

      if (sortedSizeMetrics.length === 0) {
        pdfEmptyState(doc, 'No tyre size records for the selected filters',
          'Adjust the date range, country or brand filter and export again.')
        pdfFooter(doc, 1, 1, company, brand)
        doc.save(filename)
        return
      }

      let y = 28
      doc.setFontSize(11); doc.setTextColor(22, 163, 74); doc.setFont('helvetica', 'bold')
      doc.text('Size Distribution Analysis', 14, y); y += 4

      autoTable(doc, {
        ...pdfTableTheme(brand.accent),
        startY: y,
        head: [['Size', 'Count', '% Fleet', 'Avg CPK', 'Avg Life', 'Fail Rate', 'Brands', 'Flag']],
        body: sortedSizeMetrics.map((m) => [
          m.size, m.count, fmtPct(m.pct),
          m.avgCpk != null ? `${activeCurrency} ${m.avgCpk.toFixed(4)}` : 'N/A',
          fmtKm(m.avgLife), fmtPct(m.failRate),
          m.brands.slice(0, 3).join(', ') || 'N/A', m.flag,
        ]),
        margin: { left: 14, right: 14 },
      })

      y = doc.lastAutoTable.finalY + 8
      if (y > 170) { doc.addPage(); y = 14 }

      doc.setFontSize(11); doc.setTextColor(22, 163, 74); doc.setFont('helvetica', 'bold')
      doc.text('Consolidation Recommendations', 14, y); y += 4

      autoTable(doc, {
        ...pdfTableTheme(brand.accent),
        startY: y,
        head: [['Size', 'Type', 'Recommendation', 'Impact', 'Est. Saving (one tyre life)']],
        body: consolidationOps.map((op) => [
          op.size, op.type === 'eliminate' ? 'Eliminate' : op.type === 'standardize' ? 'Standardize' : 'Review',
          opDesc(op, activeCurrency).slice(0, 110),
          op.impact,
          fmtMoney(op.savings, activeCurrency),
        ]),
        margin: { left: 14, right: 14 },
      })

      const totalPages = doc.internal.getNumberOfPages()
      for (let p = 1; p <= totalPages; p++) { doc.setPage(p); pdfFooter(doc, p, totalPages, company, brand) }
      doc.save(filename)
    } catch (e) {
      setExportError(toUserMessage(e, 'Could not export the PDF. Try again.'))
    } finally {
      setExporting(false)
    }
  }

  async function exportExcel() {
    setExporting(true); setExportError('')
    try {
      const XLSX = await import('xlsx')
      const wb = XLSX.utils.book_new()
      const sizeRows = sortedSizeMetrics.map((m) => ({
        Size: m.size,
        Count: m.count,
        'Fleet %': fmtPct(m.pct),
        [`Avg CPK (${activeCurrency}/km)`]: m.avgCpk != null ? parseFloat(m.avgCpk.toFixed(4)) : null,
        'Avg Life (km)': m.avgLife != null ? Math.round(m.avgLife) : null,
        'Failure Rate %': m.failRate != null ? parseFloat(m.failRate.toFixed(1)) : null,
        'Rated tyres': m.ratedCount,
        Brands: m.brands.join(', '),
        Sites: m.sites.join(', '),
        'Standardization Flag': m.flag,
      }))
      XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(sizeRows), 'Size Distribution')

      const matRows = matrixData.sizes.flatMap((sz) => matrixData.brands.map((br) => ({
        Size: sz, Brand: br,
        [`Avg CPK (${activeCurrency}/km)`]: matrixData.matrix[sz]?.[br] != null ? parseFloat(matrixData.matrix[sz][br].toFixed(4)) : null,
      })))
      XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(matRows), 'Size-Brand Matrix')

      const posRows = posCompliance.map((p) => ({
        Position: p.pos,
        'Total Tyres': p.total,
        'Required Sizes': p.required.join(', '),
        'Non-Standard Count': p.nonStd,
        'Compliance %': p.compliance != null ? parseFloat(p.compliance.toFixed(1)) : null,
      }))
      XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(posRows), 'Position Compliance')

      const conRows = consolidationOps.map((op) => ({
        Size: op.size,
        Type: op.type,
        Recommendation: opDesc(op, activeCurrency),
        Impact: op.impact,
        'Est. Saving (one tyre life)': op.savings != null ? Math.round(op.savings) : null,
      }))
      XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(conRows), 'Consolidation Ops')

      XLSX.writeFile(wb, `${fileBase}.xlsx`)
    } catch (e) {
      setExportError(toUserMessage(e, 'Could not export the workbook. Try again.'))
    } finally {
      setExporting(false)
    }
  }

  // ── Render ───────────────────────────────────────────────────────────────────
  const fleetSpendValue = fleetCost.loading ? 'Loading' : (fleetCost.blended || fleetCost.failed) ? 'N/A' : fmtMoney(fleetCost.tyre, activeCurrency)
  const fleetSpendSub = fleetCost.blended
    ? 'Pick one country: currencies differ'
    : fleetCost.failed ? 'Expense grid unavailable'
      : dateFrom && dateTo ? 'Expense grid, selected dates' : 'Expense grid, last 12 months'

  const kpiTiles = [
    { label: 'Unique sizes', value: loading ? 'N/A' : kpis.uniqueSz.toLocaleString(), sub: `across ${kpis.total.toLocaleString()} tyres`, icon: Layers },
    { label: 'Most common size', value: kpis.mostCommon?.size ?? 'N/A', sub: kpis.mostCommon ? `${fmtPct(kpis.mostCommon.pct)} of fleet (${kpis.mostCommon.count} tyres)` : 'No sizes yet', icon: Award },
    { label: 'Best performing size', value: kpis.bestPerf?.size ?? 'N/A', sub: kpis.bestPerf ? `CPK ${fmtCpk(kpis.bestPerf.avgCpk, activeCurrency)}` : `Min ${MIN_RECORDS_CPK} measured tyres needed`, icon: Target },
    {
      label: 'Standardization score',
      value: kpis.stdScore == null ? 'N/A' : `${kpis.stdScore.toFixed(0)}%`,
      sub: kpis.stdScore == null ? 'No tyres in scope' : kpis.stdScore >= 70 ? 'Well standardized' : kpis.stdScore >= 40 ? 'Moderate fragmentation' : 'High fragmentation',
      icon: Activity,
    },
    { label: 'Fleet avg CPK', value: fmtCpk(kpis.fleetAvgCpk, activeCurrency), sub: kpis.fleetAvgCpk == null ? 'No priced tyre with measured km' : 'Per tyre with cost and km', icon: BarChart3 },
    { label: 'Fleet tyre spend', value: fleetSpendValue, sub: fleetSpendSub, icon: DollarSign },
  ]

  const inputCls = 'input text-xs min-h-[44px]'

  return (
    <div className="space-y-6">
      <PageHeader
        title="Tyre Size and Specification Optimizer"
        subtitle="Analyze size mix, consolidation opportunities and procurement optimization"
        icon={Layers}
        actions={
          <div className="flex items-center gap-2 flex-wrap">
            <button
              type="button"
              onClick={reload}
              aria-label="Refresh tyre size data"
              className="btn-secondary min-h-[44px] min-w-[44px] inline-flex items-center justify-center"
            >
              <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} aria-hidden="true" />
            </button>
            <button type="button" onClick={exportPDF} disabled={exporting || loading || !!error} className="btn-secondary min-h-[44px] inline-flex items-center gap-2 px-3 text-sm disabled:opacity-50">
              {exporting ? <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" /> : <FileText className="w-4 h-4" aria-hidden="true" />}
              PDF
            </button>
            <button type="button" onClick={exportExcel} disabled={exporting || loading || !!error} className="btn-secondary min-h-[44px] inline-flex items-center gap-2 px-3 text-sm disabled:opacity-50">
              {exporting ? <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" /> : <FileSpreadsheet className="w-4 h-4" aria-hidden="true" />}
              Excel
            </button>
          </div>
        }
      />

      {/* ── Filters ─────────────────────────────────────────────────────────── */}
      <div className="bg-[var(--surface-1)] border border-[var(--input-border)] rounded-xl p-4">
        <div className="flex flex-wrap gap-3 items-end">
          <div className="flex flex-wrap gap-1" role="group" aria-label="Date range presets">
            {DATE_PRESETS.map((p) => (
              <button
                type="button"
                key={p.label}
                onClick={() => applyDatePreset(p.label, p.days)}
                aria-pressed={activeDatePreset === p.label}
                className={`px-3 min-h-[44px] text-xs rounded-lg border transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--accent)] ${
                  activeDatePreset === p.label
                    ? 'border-[var(--accent)] text-[var(--text-primary)] bg-[var(--input-bg)] font-semibold'
                    : 'bg-[var(--input-bg)] border-[var(--input-border)] text-[var(--text-muted)] hover:text-[var(--text-primary)]'
                }`}
              >{p.label}</button>
            ))}
          </div>

          <div className="flex gap-2 flex-wrap">
            <div className="flex items-center gap-1.5">
              <Calendar className="w-3.5 h-3.5 text-[var(--text-muted)]" aria-hidden="true" />
              <label htmlFor="tsa-from" className="sr-only">From date</label>
              <input id="tsa-from" type="date" value={dateFrom} onChange={(e) => { setDateFrom(e.target.value); setActiveDatePreset('') }} className={inputCls} />
              <span className="text-[var(--text-muted)] text-xs">to</span>
              <label htmlFor="tsa-to" className="sr-only">To date</label>
              <input id="tsa-to" type="date" value={dateTo} onChange={(e) => { setDateTo(e.target.value); setActiveDatePreset('') }} className={inputCls} />
            </div>

            {[
              { label: 'Country', value: filterCountry, setter: setFilterCountry, opts: filterOptions.countries, icon: Globe },
              { label: 'Site', value: filterSite, setter: setFilterSite, opts: filterOptions.sites, icon: MapPin },
              { label: 'Brand', value: filterBrand, setter: setFilterBrand, opts: filterOptions.brands, icon: Package },
              { label: 'Position', value: filterPosition, setter: setFilterPosition, opts: filterOptions.positions, icon: CircleDot },
            ].map(({ label: fl, value, setter, opts, icon: Icon }) => (
              <div key={fl} className="flex items-center gap-1.5">
                <Icon className="w-3.5 h-3.5 text-[var(--text-muted)]" aria-hidden="true" />
                <select value={value} onChange={(e) => setter(e.target.value)} aria-label={fl} className={inputCls}>
                  {opts.map((o) => <option key={o} value={o}>{o === 'All' ? `All ${fl.toLowerCase()}s` : o}</option>)}
                </select>
              </div>
            ))}

            {hasActiveFilter && (
              <button type="button" onClick={clearFilters} className="btn-secondary min-h-[44px] inline-flex items-center gap-1 px-3 text-xs">
                <X className="w-3 h-3" aria-hidden="true" /> Clear
              </button>
            )}
          </div>

          <div className="ml-auto text-xs text-[var(--text-muted)]" aria-live="polite">
            {filtered.length.toLocaleString()} tyres, {kpis.uniqueSz} sizes
          </div>
        </div>
      </div>

      {truncated && (
        <div className="flex items-start gap-2 rounded-lg border border-yellow-800/60 bg-yellow-900/10 px-4 py-2.5 text-xs text-[var(--text-primary)]">
          <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5 text-yellow-500" aria-hidden="true" />
          <span>
            Capped view: showing the first {ROW_CAP.toLocaleString()} records for the selected country and
            date window. Narrow the date range or country to see the full detail.
          </span>
        </div>
      )}

      {exportError && (
        <div role="alert" className="flex items-start gap-2 rounded-lg border border-red-800/60 bg-red-900/10 px-4 py-2.5 text-xs text-[var(--text-primary)]">
          <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5 text-red-400" aria-hidden="true" /> {exportError}
        </div>
      )}

      {error ? (
        <div role="alert" className="bg-[var(--surface-1)] border border-red-800/60 rounded-xl p-6 flex flex-wrap items-center gap-3">
          <AlertTriangle className="w-6 h-6 text-red-400" aria-hidden="true" />
          <div className="flex-1 min-w-[200px]">
            <p className="text-sm font-medium text-[var(--text-primary)]">Could not load tyre data.</p>
            <p className="text-sm text-[var(--text-muted)]">{error}</p>
          </div>
          <button type="button" onClick={reload} className="btn-secondary min-h-[44px] inline-flex items-center gap-1.5 px-4 text-sm">
            <RefreshCw className="w-4 h-4" aria-hidden="true" /> Retry
          </button>
        </div>
      ) : loading ? (
        <div role="status" aria-live="polite" className="space-y-4">
          <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-6 gap-4">
            {[0, 1, 2, 3, 4, 5].map((i) => <div key={i} className="h-24 rounded-xl bg-[var(--input-bg)] animate-pulse" />)}
          </div>
          <div className="h-64 rounded-xl bg-[var(--input-bg)] animate-pulse" />
          <span className="sr-only">Loading tyre size data</span>
        </div>
      ) : (
      <>
      {/* ── KPI strip ───────────────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-6 gap-4">
        {kpiTiles.map(({ label: kl, value, sub, icon: Icon }) => (
          <div key={kl} className="bg-[var(--surface-1)] border border-[var(--input-border)] rounded-xl p-4">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0 flex-1">
                <p className="text-xs text-[var(--text-muted)] mb-1">{kl}</p>
                <p className="text-lg font-bold text-[var(--text-primary)] truncate tabular-nums" title={value}>{value}</p>
                <p className="text-xs text-[var(--text-muted)] mt-1 truncate" title={sub}>{sub}</p>
              </div>
              <Icon className="w-5 h-5 text-[var(--text-muted)] shrink-0" aria-hidden="true" />
            </div>
          </div>
        ))}
      </div>
      {kpis.total > 0 && kpis.rated === 0 && (
        <p className="text-xs text-[var(--text-muted)] flex items-start gap-1.5 -mt-2">
          <Info className="w-3.5 h-3.5 mt-0.5 shrink-0" aria-hidden="true" />
          No tyre in scope carries a risk rating, so failure rates read N/A rather than 0%.
        </p>
      )}

      {filtered.length === 0 ? (
        <div className="bg-[var(--surface-1)] border border-[var(--input-border)] rounded-xl py-14 flex flex-col items-center gap-3 text-center">
          <Layers className="w-10 h-10 text-[var(--text-muted)]" aria-hidden="true" />
          <p className="text-sm font-medium text-[var(--text-primary)]">{records.length === 0 ? 'No tyre records yet' : 'No tyres match these filters'}</p>
          <p className="text-xs text-[var(--text-muted)]">{records.length === 0 ? 'Tyre records appear here once they are imported.' : 'Widen the dates or clear a filter.'}</p>
          {hasActiveFilter && <button type="button" onClick={clearFilters} className="btn-secondary min-h-[44px] px-4 text-sm">Clear filters</button>}
        </div>
      ) : (
      <>
      {/* ── Charts row 1 ────────────────────────────────────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Panel icon={BarChart3} title="Size mix distribution">
          <div className="p-4">
            {doughnutData.labels.length === 0 ? (
              <div className="flex items-center justify-center h-56 text-[var(--text-muted)] text-sm">No sizes in scope</div>
            ) : (
              <div className="h-64" role="img" aria-label={`Size mix: ${sortedSizeMetrics.slice(0, 3).map((m) => `${m.size} ${fmtPct(m.pct)}`).join(', ')}`}>
                <Doughnut data={doughnutData} options={doughnutOpts} />
              </div>
            )}
          </div>
        </Panel>

        <Panel
          icon={DollarSign}
          title="CPK by size (ranked)"
          right={(
            <div className="flex flex-wrap gap-3 text-xs text-[var(--text-muted)]">
              <span className="flex items-center gap-1"><span className="w-3 h-2 rounded bg-green-500 inline-block" aria-hidden="true" /> Good, up to {BENCHMARK_GOOD}</span>
              <span className="flex items-center gap-1"><span className="w-3 h-2 rounded bg-yellow-500 inline-block" aria-hidden="true" /> Average, up to {BENCHMARK_AVG}</span>
              <span className="flex items-center gap-1"><span className="w-3 h-2 rounded bg-red-500 inline-block" aria-hidden="true" /> Poor, over {BENCHMARK_AVG}</span>
            </div>
          )}
        >
          <div className="p-4">
            {cpkBarData.labels.length === 0 ? (
              <div className="flex items-center justify-center h-56 text-[var(--text-muted)] text-sm text-center px-4">
                No size has {MIN_RECORDS_CPK}+ tyres with both a price and measured km yet.
              </div>
            ) : (
              <div style={{ height: Math.max(200, cpkBarData.labels.length * 26) }} role="img" aria-label="Average cost per km by tyre size, lowest first">
                <Bar data={cpkBarData} options={cpkBarOpts} />
              </div>
            )}
          </div>
        </Panel>
      </div>

      {/* ── Size distribution table + selected-size brand breakdown ─────────── */}
      <Panel icon={Layers} title="Size distribution detail" hint={`${sortedSizeMetrics.length} sizes. Select a row for its brand breakdown.`}>
        <div className="p-3">
          <EnterpriseTable
            columns={sizeColumns}
            data={sortedSizeMetrics}
            getRowId={(m) => m.size}
            onRowClick={(m) => setSelectedSize(selectedSize === m.size ? null : m.size)}
            enableColumnFilters={false}
            searchPlaceholder="Search sizes"
            exportFileName={reportFileName('Tyre Size Distribution')}
            initialPageSize={25}
            viewKey="tyre-size-distribution"
            emptyMessage="No tyre records found"
          />
        </div>
        {selectedSize && (
          <div className="border-t border-[var(--input-border)] p-4 space-y-2" aria-live="polite">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-sm font-semibold text-[var(--text-primary)]">Brand breakdown for <span className="font-mono">{selectedSize}</span></p>
              <button type="button" onClick={() => setSelectedSize(null)} className="btn-secondary min-h-[44px] inline-flex items-center gap-1 px-3 text-xs">
                <X className="w-3 h-3" aria-hidden="true" /> Close
              </button>
            </div>
            <EnterpriseTable
              columns={breakdownColumns}
              data={breakdown}
              getRowId={(b) => b.brand}
              enableGlobalFilter={false}
              enableColumnFilters={false}
              enableColumnVisibility={false}
              enableExport={false}
              initialPageSize={25}
              emptyMessage="No brands recorded for this size."
            />
          </div>
        )}
      </Panel>

      {/* ── Size x brand matrix ─────────────────────────────────────────────── */}
      <Panel
        icon={BarChart3}
        title="Size x brand CPK performance matrix"
        hint={`Average CPK in ${activeCurrency}/km. Needs 2+ measured tyres per cell.`}
      >
        <div className="p-3">
          {matrixData.sizes.length === 0 || matrixData.brands.length === 0 ? (
            <div className="flex items-center justify-center h-32 text-[var(--text-muted)] text-sm">Not enough sizes and brands for a matrix</div>
          ) : (
            <EnterpriseTable
              columns={matrixColumns}
              data={matrixRows}
              getRowId={(r) => r.size}
              enableGlobalFilter={false}
              enableColumnFilters={false}
              enableExport={false}
              initialPageSize={25}
              emptyMessage="Not enough data for a matrix"
            />
          )}
        </div>
      </Panel>

      {/* ── Charts row 2 ────────────────────────────────────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Panel icon={CheckCircle} title="Position-size compliance" hint="Required = the two most used sizes at each position">
          <div className="p-3">
            <EnterpriseTable
              columns={posColumns}
              data={posCompliance}
              getRowId={(p) => p.pos}
              enableGlobalFilter={false}
              enableColumnFilters={false}
              enableExport={false}
              initialPageSize={25}
              emptyMessage="No position data"
            />
          </div>
        </Panel>

        <Panel icon={TrendingUp} title="Top size-brand combos: CPK trend (12 months)">
          <div className="p-4">
            {trendData.datasets.length === 0 ? (
              <div className="flex items-center justify-center h-56 text-[var(--text-muted)] text-sm text-center px-4">No size-brand combination has a measured CPK in the last 12 months.</div>
            ) : (
              <div className="h-64" role="img" aria-label={`Monthly CPK trend for ${trend.series.map((s) => s.label).join(', ')}`}>
                <Line data={trendData} options={trendOpts} />
              </div>
            )}
          </div>
        </Panel>
      </div>

      {/* ── Consolidation opportunities ─────────────────────────────────────── */}
      <Panel icon={Lightbulb} title="Consolidation opportunities" hint={`${consolidationOps.length} recommendation${consolidationOps.length === 1 ? '' : 's'}`}>
        {consolidationOps.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 gap-3 text-[var(--text-muted)] text-center px-4">
            <CheckCircle className="w-10 h-10 text-green-600" aria-hidden="true" />
            <p className="text-sm">No consolidation opportunities detected. The size mix is well optimized.</p>
          </div>
        ) : (
          <ul className="p-4 grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
            {consolidationOps.map((op, i) => {
              const impactStyle = {
                Critical: 'border-red-800/60 bg-red-900/10',
                High: 'border-orange-800/60 bg-orange-900/10',
                Low: 'border-[var(--input-border)] bg-[var(--input-bg)]',
              }
              const impactBadge = {
                Critical: 'text-red-400 border border-red-800/60',
                High: 'text-orange-400 border border-orange-800/60',
                Low: 'text-[var(--text-muted)] border border-[var(--input-border)]',
              }
              const typeIcon = {
                eliminate: <X className="w-4 h-4 text-red-400 shrink-0" aria-hidden="true" />,
                standardize: <CheckCircle className="w-4 h-4 text-blue-400 shrink-0" aria-hidden="true" />,
                review: <ShieldAlert className="w-4 h-4 text-yellow-500 shrink-0" aria-hidden="true" />,
              }
              return (
                <li key={`${op.type}-${op.size}-${i}`} className={`rounded-xl border p-4 ${impactStyle[op.impact] || impactStyle.Low}`}>
                  <div className="flex items-start gap-2 mb-2">
                    {typeIcon[op.type]}
                    <p className="flex-1 min-w-0 text-sm font-semibold text-[var(--text-primary)] leading-tight">{opTitle(op)}</p>
                    <span className={`text-xs px-1.5 py-0.5 rounded-full font-medium whitespace-nowrap ${impactBadge[op.impact]}`}>{op.impact}</span>
                  </div>
                  <p className="text-xs text-[var(--text-muted)] leading-relaxed">{opDesc(op, activeCurrency)}</p>
                  {op.type !== 'eliminate' && (
                    <div className="mt-3 flex items-center gap-1.5 text-xs text-[var(--text-secondary)]">
                      <DollarSign className="w-3.5 h-3.5 text-green-500" aria-hidden="true" />
                      {op.savings != null
                        ? <span>Est. saving over one tyre life: <span className="font-semibold text-[var(--text-primary)]">{fmtMoney(op.savings, activeCurrency)}</span></span>
                        : <span>Saving not estimated: no measured tyre life for {op.size === UNKNOWN_SIZE ? 'this size' : op.size}.</span>}
                    </div>
                  )}
                </li>
              )
            })}
          </ul>
        )}
      </Panel>
      </>
      )}
      </>
      )}
    </div>
  )
}
