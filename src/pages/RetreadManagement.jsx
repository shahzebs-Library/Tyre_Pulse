import { useState, useEffect, useMemo, useCallback } from 'react'
import { Link } from 'react-router-dom'
import { AnimatePresence, motion } from 'framer-motion'
import {
  Chart as ChartJS,
  CategoryScale, LinearScale, BarElement, LineElement,
  PointElement, ArcElement, Title, Tooltip, Legend,
} from 'chart.js'
import { Bar, Line, Doughnut } from 'react-chartjs-2'
import {
  RefreshCw, FileText, FileSpreadsheet, Search, Filter,
  Loader2, AlertTriangle, CheckCircle, TrendingDown,
  BarChart3, X, ChevronRight, Activity, Building2, Tag, Layers, Info, Star,
  Recycle, CircleDollarSign, Target, Zap, Lock, Award, RotateCcw, Plus,
} from 'lucide-react'
import { supabase } from '../lib/supabase'
import EntityApprovalPanel from '../components/workflow/EntityApprovalPanel'
import { fetchAllPages } from '../lib/fetchAll'
import { useSettings } from '../contexts/SettingsContext'
import { useTenant } from '../contexts/TenantContext'
import {
  exportToExcel, exportToPdf, resolvePdfBrand, pdfHeader, pdfFooter, pdfTableTheme,
  reportFileName, reportDateLabel,
} from '../lib/exportUtils'
import { formatMonthYear } from '../lib/formatters'
import { toUserMessage } from '../lib/safeError'
import { colorAt, withAlpha } from '../lib/reportColors'
import { Tabs } from '../components/commandCenter/kit'
import TyreKpiTile from '../components/tyre/TyreKpiTile'
import RetreadJobsSection from '../components/tyre/RetreadJobsSection'
import { moneyScope } from '../lib/tyreScrapView'
import './RetreadManagement.css'
import Modal from '../components/ui/Modal'
import NotInUseNotice from '../components/ui/NotInUseNotice'
import EnterpriseTable from '../components/ui/EnterpriseTable'
import EmailPdfButton from '../components/EmailPdfButton'
import { loadAutoTable } from '../lib/pdfEngine'
import {
  splitRecords, retreadKpis, filterRetreads, optionsFor, brandSummary as buildBrandSummary,
  vendorScorecard, monthlyFitments, vendorCpkTrend, bestSize, cycleDistribution,
  retreadInsights, roiProjection, RISK_OPTIONS, DEFAULT_ANNUAL_KM,
} from '../lib/retreadManagementAnalytics'

ChartJS.register(
  CategoryScale, LinearScale, BarElement, LineElement,
  PointElement, ArcElement, Title, Tooltip, Legend,
)

// ── Constants ──────────────────────────────────────────────────────────────────

const TABS = ['Overview', 'Vendor Analysis', 'Lifecycle', 'ROI Calculator']

// Theme tokens resolve per light/dark via the global chartVarPlugin.
const TOOLTIP = {
  backgroundColor: 'var(--panel)',
  borderColor: 'var(--hairline)',
  borderWidth: 1,
  titleColor: 'var(--text-primary)',
  bodyColor: 'var(--text-secondary)',
}
const CHART_OPTS = {
  responsive: true,
  maintainAspectRatio: false,
  plugins: {
    legend: { labels: { color: 'var(--text-muted)', boxWidth: 12, font: { size: 11 } } },
    tooltip: TOOLTIP,
  },
  scales: {
    x: { ticks: { color: 'var(--text-muted)', font: { size: 11 } }, grid: { color: 'var(--panel-2)' } },
    y: { ticks: { color: 'var(--text-muted)', font: { size: 11 } }, grid: { color: 'var(--panel-2)' } },
  },
}
const DOUGHNUT_OPTS = {
  responsive: true,
  maintainAspectRatio: false,
  plugins: {
    legend: { position: 'bottom', labels: { color: 'var(--text-muted)', boxWidth: 12, font: { size: 11 }, padding: 12 } },
    tooltip: TOOLTIP,
  },
}

const EXPORT_COLS = [
  'serial_number', 'brand', 'size', 'position', 'asset_no', 'site',
  'issue_date', 'km_at_fitment', 'km_at_removal', 'km_life', 'cost_per_tyre',
  'cpk', 'retread_cycle', 'category', 'risk_level', 'status',
]
const EXPORT_HEADERS = [
  'Serial', 'Brand', 'Size', 'Position', 'Asset No', 'Site',
  'Issue Date', 'km at Fitment', 'km at Removal', 'km Life', 'Cost',
  'CPK', 'Retread Cycle', 'Category', 'Risk Level', 'Status',
]

const BTN = 'inline-flex items-center justify-center gap-1.5 min-h-[44px] px-3 py-2 bg-[var(--input-bg)] hover:bg-[var(--input-bg-hover)] border border-[var(--input-border)] rounded-lg text-sm text-[var(--text-secondary)] transition disabled:opacity-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]'
const SELECT = 'min-h-[44px] px-3 py-2 bg-[var(--input-bg)] border border-[var(--input-border)] rounded-lg text-sm text-[var(--text-secondary)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]'

// ── Formatting (honest: null is N/A, never 0) ─────────────────────────────────

function fmtCpk(val, currency) {
  if (val == null || !Number.isFinite(val)) return 'N/A'
  return `${currency} ${val.toFixed(4)}`
}
function fmtCurrency(val, currency) {
  if (val == null || !Number.isFinite(val)) return 'N/A'
  return `${currency} ${Number(val).toLocaleString(undefined, { maximumFractionDigits: 0 })}`
}
const fmtNum = (v) => (v == null || !Number.isFinite(Number(v)) ? 'N/A' : Number(v).toLocaleString())
const fmtPct = (v, d = 0) => (v == null || !Number.isFinite(v) ? 'N/A' : `${v.toFixed(d)}%`)
const monthLabel = (m) => {
  const [yr, mo] = m.split('-')
  return formatMonthYear(new Date(Number(yr), Number(mo) - 1, 1))
}

// ── Sub-components ─────────────────────────────────────────────────────────────

const BADGE = {
  success: 'bg-green-900/40 text-green-400 border-green-700/50',
  warning: 'bg-yellow-900/40 text-yellow-400 border-yellow-700/50',
  danger: 'bg-red-900/40 text-red-400 border-red-700/50',
  info: 'bg-blue-900/40 text-blue-400 border-blue-700/50',
  neutral: 'bg-[var(--input-bg)] text-[var(--text-muted)] border-[var(--input-border)]',
}
function Badge({ label, tone }) {
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full border text-[11px] font-semibold ${BADGE[tone] ?? BADGE.neutral}`}>
      {label}
    </span>
  )
}
const riskBadge = (level) => (
  <Badge label={level ?? 'N/A'} tone={{ Critical: 'danger', High: 'warning', Medium: 'info', Low: 'success' }[level] ?? 'neutral'} />
)
const statusBadge = (status) => <Badge label={status} tone={status === 'Active' ? 'success' : 'neutral'} />
function ScoreBadge({ score }) {
  const tone = score >= 75 ? 'success' : score >= 50 ? 'warning' : 'danger'
  const word = score >= 75 ? 'Good' : score >= 50 ? 'Fair' : 'Poor'
  return <Badge label={`${score} ${word}`} tone={tone} />
}
const rateTone = (v, good = 80, fair = 60) => (v == null ? 'text-[var(--text-dim)]' : v >= good ? 'text-green-400' : v >= fair ? 'text-yellow-400' : 'text-red-400')

function EmptyBlock({ icon: Icon = Recycle, title, sub }) {
  return (
    <div className="flex flex-col items-center justify-center py-16 text-center gap-3 bg-[var(--surface-1)] border border-[var(--input-border)] rounded-xl">
      <Icon className="text-[var(--text-dim)]" size={40} aria-hidden="true" />
      <p className="text-[var(--text-secondary)] font-medium">{title}</p>
      {sub && <p className="text-[var(--text-muted)] text-sm max-w-md">{sub}</p>}
    </div>
  )
}

function Panel({ icon: Icon, title, right, children, footer }) {
  return (
    <section className="bg-[var(--surface-1)] border border-[var(--input-border)] rounded-xl overflow-hidden">
      <div className="px-4 py-3 border-b border-[var(--input-border)] flex flex-wrap items-center gap-2">
        {Icon && <Icon className="text-[var(--text-muted)]" size={16} aria-hidden="true" />}
        <h2 className="font-semibold text-[var(--text-secondary)] text-sm">{title}</h2>
        {right && <div className="ml-auto text-[var(--text-dim)] text-xs">{right}</div>}
      </div>
      <div className="p-3">{children}</div>
      {footer && <div className="px-4 py-2 border-t border-[var(--input-border)] text-xs text-[var(--text-muted)]">{footer}</div>}
    </section>
  )
}

// ── Main Component ─────────────────────────────────────────────────────────────

export default function RetreadManagement() {
  const { appSettings, activeCurrency, activeCountry } = useSettings()
  const { branding } = useTenant()
  const company = branding?.legal_name || branding?.display_name || appSettings?.company_name || 'TyrePulse'

  const [records, setRecords] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [truncated, setTruncated] = useState(false)
  const [activeTab, setActiveTab] = useState('Overview')

  const [filterSite, setFilterSite] = useState('All')
  const [filterBrand, setFilterBrand] = useState('All')
  const [filterRisk, setFilterRisk] = useState('All')
  const [filterStatus, setFilterStatus] = useState('All')
  const [search, setSearch] = useState('')

  const [drawer, setDrawer] = useState(null)
  const [newSignal, setNewSignal] = useState(0)

  // Approval & Workflow Engine gate: while the open casing's workflow is active
  // or locked, its per-record export is disabled. Resets per record.
  const [wfLocked, setWfLocked] = useState(false)
  useEffect(() => { setWfLocked(false) }, [drawer?.id])

  useEffect(() => {
    if (!drawer) return undefined
    const onKey = (e) => { if (e.key === 'Escape') setDrawer(null) }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [drawer])

  const [roi, setRoi] = useState({
    newCost: 1200,
    retreadCost: 480,
    retreadLifeKm: 80000,
    newLifeKm: 100000,
    fleetSize: 50,
    annualKm: DEFAULT_ANNUAL_KM,
  })

  // ── Data loading ───────────────────────────────────────────────────────────
  const loadData = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      // Bounded, country-scoped, id-tiebroken read. `serial_number` is the dead
      // legacy column (empty on every row); the real serial is `serial_no`,
      // served under the name this page reads.
      const { data, error: err, truncated: tr } = await fetchAllPages((from, to) => {
        let query = supabase
          .from('tyre_records')
          .select('id, asset_no, serial_number:serial_no, brand, size, position, site, country, risk_level, tread_depth, cost_per_tyre, km_at_fitment, km_at_removal, issue_date, removal_date, qty, category')
        if (activeCountry && activeCountry !== 'All') {
          query = query.eq('country', activeCountry)
        }
        return query.order('id').range(from, to)
      }, { max: 50000 })
      if (err) throw err
      setRecords(data ?? [])
      setTruncated(!!tr)
    } catch (e) {
      setError(toUserMessage(e, 'Failed to load retread data'))
    } finally {
      setLoading(false)
    }
  }, [activeCountry])

  useEffect(() => { loadData() }, [loadData])

  // ── Derived datasets (single engine) ───────────────────────────────────────
  const { retreads: enriched, newTyres: newRecords } = useMemo(() => splitRecords(records), [records])
  const kpis = useMemo(() => retreadKpis(enriched, newRecords), [enriched, newRecords])

  const siteOptions = useMemo(() => ['All', ...optionsFor(enriched, 'site')], [enriched])
  const brandOptions = useMemo(() => ['All', ...optionsFor(enriched, 'brand')], [enriched])
  const riskOptions = ['All', ...RISK_OPTIONS]

  const filtered = useMemo(
    () => filterRetreads(enriched, { site: filterSite, brand: filterBrand, risk: filterRisk, status: filterStatus, search }),
    [enriched, filterSite, filterBrand, filterRisk, filterStatus, search],
  )
  const filtersActive = filterSite !== 'All' || filterBrand !== 'All' || filterRisk !== 'All' || filterStatus !== 'All' || !!search.trim()
  const clearFilters = () => { setFilterSite('All'); setFilterBrand('All'); setFilterRisk('All'); setFilterStatus('All'); setSearch('') }

  const brandSummary = useMemo(() => buildBrandSummary(enriched), [enriched])
  const vendors = useMemo(() => vendorScorecard(brandSummary, kpis.newCpk), [brandSummary, kpis.newCpk])
  const topSize = useMemo(() => bestSize(enriched), [enriched])
  const topBrand = useMemo(
    () => [...brandSummary].filter((b) => b.successRate != null).sort((a, b) => b.successRate - a.successRate)[0] ?? null,
    [brandSummary],
  )

  const insights = useMemo(() => retreadInsights({ retreads: enriched, kpis, brands: brandSummary }, {
    cpk: (v) => fmtCpk(v, activeCurrency),
    money: (v) => fmtCurrency(v, activeCurrency),
  }), [enriched, kpis, brandSummary, activeCurrency])

  // ── Charts ─────────────────────────────────────────────────────────────────
  const charts = useMemo(() => {
    const monthly = monthlyFitments(enriched)
    const cycles = cycleDistribution(enriched)
    const trend = vendorCpkTrend(enriched, vendors.slice(0, 3).map((v) => v.brand))
    return {
      monthlyBar: {
        labels: monthly.map((m) => monthLabel(m.month)),
        datasets: [{
          label: 'Retreads fitted',
          data: monthly.map((m) => m.count),
          backgroundColor: withAlpha(colorAt(0), 0.75),
          borderColor: colorAt(0),
          borderWidth: 1,
          borderRadius: 4,
        }],
      },
      retreadVsNew: {
        labels: ['Retread', 'New'],
        datasets: [{
          data: [enriched.length, newRecords.length],
          backgroundColor: [colorAt(0), colorAt(1)],
          borderWidth: 1,
        }],
      },
      cycleBar: {
        labels: cycles.map((c) => `Cycle ${c.cycle}`),
        datasets: [{
          label: 'Casings',
          data: cycles.map((c) => c.count),
          backgroundColor: cycles.map((_, i) => withAlpha(colorAt(i + 2), 0.8)),
          borderRadius: 4,
        }],
      },
      trendChart: {
        labels: trend.months.map(monthLabel),
        datasets: trend.series.map((s, i) => ({
          label: s.brand,
          data: s.data,
          borderColor: colorAt(i),
          backgroundColor: withAlpha(colorAt(i), 0.15),
          fill: false,
          tension: 0.35,
          spanGaps: true,
        })),
      },
    }
  }, [enriched, newRecords.length, vendors])

  const roiCalc = useMemo(() => roiProjection(roi), [roi])
  const roiChart = useMemo(() => ({
    labels: ['New tyre', 'Retread'],
    datasets: [
      { label: 'Initial cost', data: [Number(roi.newCost) || null, Number(roi.retreadCost) || null], backgroundColor: [withAlpha(colorAt(1), 0.85), withAlpha(colorAt(0), 0.85)], borderRadius: 4 },
      { label: 'Cost per 100,000 km', data: [roiCalc.per100k.newTyre, roiCalc.per100k.retread], backgroundColor: [withAlpha(colorAt(1), 0.4), withAlpha(colorAt(0), 0.4)], borderRadius: 4 },
    ],
  }), [roi, roiCalc])

  // ── Export handlers (always the FILTERED set the lifecycle table shows) ──────
  const fileBase = reportFileName('TyrePulse Retread Management', activeCountry !== 'All' ? activeCountry : null, reportDateLabel())

  const handleExportExcel = useCallback(() => {
    const rows = filtered.map(t => ({
      serial_number: t.serial_number,
      brand: t.brand,
      size: t.size,
      position: t.position,
      asset_no: t.asset_no,
      site: t.site,
      issue_date: t.issue_date,
      km_at_fitment: t.km_at_fitment,
      km_at_removal: t.km_at_removal,
      km_life: t.km_life ?? 'N/A',
      cost_per_tyre: t.cost_per_tyre ?? 'N/A',
      cpk: t.cpk != null ? t.cpk.toFixed(6) : 'N/A',
      retread_cycle: t.retread_cycle ?? 'N/A',
      category: t.category,
      risk_level: t.risk_level ?? 'N/A',
      status: t.status,
    }))
    return exportToExcel(rows, EXPORT_COLS, EXPORT_HEADERS, fileBase, 'Retread Records', { currency: activeCurrency })
  }, [filtered, fileBase, activeCurrency])

  const handleExportPdf = useCallback((opts = {}) => (
    exportToPdf(
      filtered.map(t => ({
        serial_number: t.serial_number,
        brand: t.brand,
        size: t.size,
        position: t.position,
        asset_no: t.asset_no,
        site: t.site,
        issue_date: t.issue_date,
        km_life: t.km_life ?? 'N/A',
        cost_per_tyre: t.cost_per_tyre ?? 'N/A',
        cpk: t.cpk != null ? t.cpk.toFixed(6) : 'N/A',
        category: t.category,
        risk_level: t.risk_level ?? 'N/A',
        status: t.status,
      })),
      [
        { key: 'serial_number', header: 'Serial' },
        { key: 'brand', header: 'Brand' },
        { key: 'size', header: 'Size' },
        { key: 'position', header: 'Position' },
        { key: 'asset_no', header: 'Asset' },
        { key: 'site', header: 'Site' },
        { key: 'issue_date', header: 'Issue Date' },
        { key: 'km_life', header: 'km Life' },
        { key: 'cost_per_tyre', header: 'Cost' },
        { key: 'cpk', header: 'CPK' },
        { key: 'risk_level', header: 'Risk Level' },
        { key: 'status', header: 'Status' },
      ],
      'Retread Management Report',
      fileBase,
      'landscape',
      company,
      {
        ...opts,
        subtitleNote: filtered.length < enriched.length
          ? `${filtered.length.toLocaleString()} of ${enriched.length.toLocaleString()} retread records, filtered`
          : opts.subtitleNote,
      },
    )
  ), [filtered, enriched, fileBase, company])

  const handleExportRoiPdf = useCallback(async () => {
    const { default: jsPDF } = await import('jspdf')
    const autoTable = await loadAutoTable()
    const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' })
    const brand = await resolvePdfBrand(branding)
    pdfHeader(doc, 'Retread ROI Analysis', `Fleet size: ${roi.fleetSize} tyres`, company, brand)

    doc.setFontSize(12)
    doc.setFont('helvetica', 'bold')
    doc.setTextColor(30, 41, 59)
    doc.text('Input Parameters', 14, 32)
    autoTable(doc, {
      ...pdfTableTheme(brand.accent),
      startY: 36,
      head: [['Parameter', 'Value']],
      body: [
        ['New Tyre Cost', fmtCurrency(Number(roi.newCost), activeCurrency)],
        ['Retread Cost', fmtCurrency(Number(roi.retreadCost), activeCurrency)],
        ['Expected New Tyre Life', `${fmtNum(roi.newLifeKm)} km`],
        ['Expected Retread Life', `${fmtNum(roi.retreadLifeKm)} km`],
        ['Fleet Size', `${fmtNum(roi.fleetSize)} tyres`],
        ['Annual distance per tyre', `${fmtNum(roi.annualKm)} km`],
      ],
      margin: { left: 14, right: 14 },
    })

    const y1 = doc.lastAutoTable.finalY + 10
    doc.setFontSize(12)
    doc.setFont('helvetica', 'bold')
    doc.setTextColor(30, 41, 59)
    doc.text('ROI Results', 14, y1)
    autoTable(doc, {
      ...pdfTableTheme(brand.accent),
      startY: y1 + 4,
      head: [['Metric', 'Value']],
      body: [
        ['New Tyre CPK', roiCalc.newCpkVal != null ? `${activeCurrency} ${roiCalc.newCpkVal.toFixed(6)}` : 'N/A'],
        ['Retread CPK', roiCalc.rCpkVal != null ? `${activeCurrency} ${roiCalc.rCpkVal.toFixed(6)}` : 'N/A'],
        ['CPK Improvement', fmtPct(roiCalc.cpkImprovement, 1)],
        ['Savings per Tyre', fmtCurrency(roiCalc.savingsPerTyre, activeCurrency)],
        ['Break-even at', roiCalc.breakEvenKm != null ? `${Math.round(roiCalc.breakEvenKm).toLocaleString()} km` : 'N/A'],
        ['Projected Annual Fleet Savings', fmtCurrency(roiCalc.annualSavings, activeCurrency)],
      ],
      margin: { left: 14, right: 14 },
    })

    const totalPages = doc.internal.getNumberOfPages()
    for (let p = 1; p <= totalPages; p++) { doc.setPage(p); pdfFooter(doc, p, totalPages, company, brand) }
    doc.save(`${reportFileName('TyrePulse Retread ROI Analysis', reportDateLabel())}.pdf`)
  }, [roi, roiCalc, activeCurrency, branding, company])

  // Per-record casing export, gated by the approval workflow.
  const handleExportCasing = useCallback(async (rec) => {
    if (!rec || wfLocked) return
    exportToPdf(
      [{
        serial_number: rec.serial_number,
        brand: rec.brand,
        size: rec.size,
        position: rec.position,
        asset_no: rec.asset_no,
        site: rec.site,
        issue_date: rec.issue_date,
        km_life: rec.km_life ?? 'N/A',
        cost_per_tyre: rec.cost_per_tyre ?? 'N/A',
        cpk: rec.cpk != null ? rec.cpk.toFixed(6) : 'N/A',
        risk_level: rec.risk_level ?? 'N/A',
        status: rec.status,
      }],
      [
        { key: 'serial_number', header: 'Serial' },
        { key: 'brand', header: 'Brand' },
        { key: 'size', header: 'Size' },
        { key: 'position', header: 'Position' },
        { key: 'asset_no', header: 'Asset' },
        { key: 'site', header: 'Site' },
        { key: 'issue_date', header: 'Issue Date' },
        { key: 'km_life', header: 'km Life' },
        { key: 'cost_per_tyre', header: 'Cost' },
        { key: 'cpk', header: 'CPK' },
        { key: 'risk_level', header: 'Risk Level' },
        { key: 'status', header: 'Status' },
      ],
      `Retread Casing ${rec.serial_number ?? rec.asset_no ?? rec.id}`,
      reportFileName('TyrePulse Retread Casing', rec.serial_number ?? rec.id),
      'landscape',
      company,
    )
  }, [wfLocked, company])

  // ── Table columns ──────────────────────────────────────────────────────────
  const brandColumns = useMemo(() => [
    { id: 'brand', header: 'Brand', accessorFn: (r) => r.brand, size: 180 },
    { id: 'count', header: 'Casings', accessorFn: (r) => r.count, meta: { align: 'right' }, cell: ({ getValue }) => <span className="tabular-nums">{fmtNum(getValue())}</span> },
    {
      id: 'avgCpk', header: 'Avg CPK', accessorFn: (r) => r.avgCpk ?? Infinity, meta: { align: 'right', exportValue: (r) => fmtCpk(r.avgCpk, activeCurrency) },
      cell: ({ row }) => <span className="tabular-nums font-mono text-xs">{fmtCpk(row.original.avgCpk, activeCurrency)}</span>,
    },
    { id: 'avgLife', header: 'Avg life (km)', accessorFn: (r) => r.avgLife ?? -1, meta: { align: 'right', exportValue: (r) => fmtNum(r.avgLife) }, cell: ({ row }) => <span className="tabular-nums">{fmtNum(row.original.avgLife)}</span> },
    {
      id: 'successRate', header: 'Success rate', accessorFn: (r) => r.successRate ?? -1, meta: { align: 'right', exportValue: (r) => fmtPct(r.successRate) },
      cell: ({ row }) => <span className={`tabular-nums font-semibold ${rateTone(row.original.successRate)}`}>{fmtPct(row.original.successRate)}</span>,
    },
    {
      id: 'view', header: '', enableSorting: false, size: 110, meta: { export: false },
      cell: ({ row }) => (
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); setFilterBrand(row.original.brand === 'Unknown' ? 'All' : row.original.brand); setActiveTab('Lifecycle') }}
          className="inline-flex items-center gap-1 min-h-[36px] px-2 py-1 rounded-lg border border-[var(--input-border)] text-xs text-[var(--text-secondary)] hover:bg-[var(--input-bg-hover)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
        >
          View casings <ChevronRight size={12} aria-hidden="true" />
        </button>
      ),
    },
  ], [activeCurrency])

  const vendorColumns = useMemo(() => [
    {
      id: 'brand', header: 'Vendor / brand', accessorFn: (r) => r.brand, size: 180,
      cell: ({ row }) => (
        <span className="inline-flex items-center gap-1.5 font-medium text-[var(--text-secondary)]">
          {row.original.score < 40 && <AlertTriangle className="text-red-400" size={12} aria-label="Flagged: score below 40" />}
          {row.original.brand}
        </span>
      ),
    },
    { id: 'count', header: 'Retreads', accessorFn: (r) => r.count, meta: { align: 'right' }, cell: ({ getValue }) => <span className="tabular-nums">{fmtNum(getValue())}</span> },
    { id: 'avgCpk', header: 'Avg CPK', accessorFn: (r) => r.avgCpk ?? Infinity, meta: { align: 'right', exportValue: (r) => fmtCpk(r.avgCpk, activeCurrency) }, cell: ({ row }) => <span className="tabular-nums font-mono text-xs">{fmtCpk(row.original.avgCpk, activeCurrency)}</span> },
    { id: 'avgLife', header: 'Avg life (km)', accessorFn: (r) => r.avgLife ?? -1, meta: { align: 'right', exportValue: (r) => fmtNum(r.avgLife) }, cell: ({ row }) => <span className="tabular-nums">{fmtNum(row.original.avgLife)}</span> },
    { id: 'successRate', header: 'Success', accessorFn: (r) => r.successRate ?? -1, meta: { align: 'right', exportValue: (r) => fmtPct(r.successRate) }, cell: ({ row }) => <span className={`tabular-nums font-semibold ${rateTone(row.original.successRate)}`}>{fmtPct(row.original.successRate)}</span> },
    {
      id: 'failureRate', header: 'Failure', accessorFn: (r) => r.failureRate ?? -1, meta: { align: 'right', exportValue: (r) => fmtPct(r.failureRate) },
      cell: ({ row }) => {
        const v = row.original.failureRate
        const tone = v == null ? 'text-[var(--text-dim)]' : v > 30 ? 'text-red-400' : v > 15 ? 'text-yellow-400' : 'text-green-400'
        return <span className={`tabular-nums font-semibold ${tone}`}>{fmtPct(v)}</span>
      },
    },
    {
      id: 'savingsVsNew', header: 'Savings vs new', accessorFn: (r) => r.savingsVsNew ?? -Infinity, meta: { align: 'right', exportValue: (r) => fmtCurrency(r.savingsVsNew, activeCurrency) },
      cell: ({ row }) => {
        const v = row.original.savingsVsNew
        return <span className={`tabular-nums text-xs font-semibold ${v == null ? 'text-[var(--text-dim)]' : v > 0 ? 'text-green-400' : 'text-red-400'}`}>{v != null && v > 0 ? '+' : ''}{fmtCurrency(v, activeCurrency)}</span>
      },
    },
    { id: 'score', header: 'Score', accessorFn: (r) => r.score, meta: { align: 'right' }, cell: ({ row }) => <ScoreBadge score={row.original.score} /> },
  ], [activeCurrency])

  const lifecycleColumns = useMemo(() => [
    { id: 'serial', header: 'Serial', accessorFn: (r) => r.serial_number ?? '', cell: ({ row }) => <span className="font-mono text-xs">{row.original.serial_number || 'N/A'}</span> },
    { id: 'brand', header: 'Brand', accessorFn: (r) => r.brand ?? '' },
    { id: 'size', header: 'Size', accessorFn: (r) => r.size ?? '', cell: ({ getValue }) => <span className="font-mono text-xs">{getValue() || 'N/A'}</span> },
    { id: 'position', header: 'Position', accessorFn: (r) => r.position ?? '' },
    { id: 'asset', header: 'Asset', accessorFn: (r) => r.asset_no ?? '' },
    { id: 'site', header: 'Site', accessorFn: (r) => r.site ?? '' },
    {
      id: 'cycle', header: 'Cycle', accessorFn: (r) => r.retread_cycle ?? -1, meta: { align: 'right', exportValue: (r) => r.retread_cycle ?? 'N/A' },
      cell: ({ row }) => {
        const c = row.original.retread_cycle
        if (c == null) return <span className="text-[var(--text-dim)]">N/A</span>
        return <span className={`tabular-nums font-semibold ${c >= 3 ? 'text-red-400' : c === 2 ? 'text-yellow-400' : ''}`}>{c}x{c >= 3 ? ' deep' : ''}</span>
      },
    },
    { id: 'km_life', header: 'km life', accessorFn: (r) => r.km_life ?? -1, meta: { align: 'right', exportValue: (r) => fmtNum(r.km_life) }, cell: ({ row }) => <span className="tabular-nums">{fmtNum(row.original.km_life)}</span> },
    { id: 'cpk', header: 'CPK', accessorFn: (r) => r.cpk ?? Infinity, meta: { align: 'right', exportValue: (r) => fmtCpk(r.cpk, activeCurrency) }, cell: ({ row }) => <span className="tabular-nums font-mono text-xs">{fmtCpk(row.original.cpk, activeCurrency)}</span> },
    { id: 'risk', header: 'Risk', accessorFn: (r) => r.risk_level ?? '', cell: ({ row }) => riskBadge(row.original.risk_level) },
    { id: 'status', header: 'Status', accessorFn: (r) => r.status, cell: ({ row }) => statusBadge(row.original.status) },
    { id: 'days', header: 'Days', accessorFn: (r) => r.days_in_service ?? -1, meta: { align: 'right', exportValue: (r) => r.days_in_service ?? 'N/A' }, cell: ({ row }) => <span className="tabular-nums">{row.original.days_in_service != null ? `${row.original.days_in_service}d` : 'N/A'}</span> },
  ], [activeCurrency])

  const reportMeta = useMemo(() => ({ company, currency: activeCurrency, branding }), [company, activeCurrency, branding])

  // ── Render ─────────────────────────────────────────────────────────────────
  // Money is shown only in one currency: under All countries the records may
  // mix SAR, AED and EGP, and their sum is not an amount of anything.
  const money = useMemo(() => moneyScope(records, activeCountry, activeCurrency), [records, activeCountry, activeCurrency])
  const headerSites = siteOptions
  const openNewRetread = () => { setActiveTab('Overview'); setNewSignal(n => n + 1) }
  const moneyOk = money.ok
  const moneyTitle = moneyOk ? undefined : 'Costs are in different currencies across countries. Pick one country to see money figures.'
  const kpiLoading = loading
  const kv = (v) => (error ? null : v)

  return (
    <div className="cc rtm-page">
      <header className="rtm-head">
        <div className="rtm-head-copy">
          <nav className="rtm-crumbs" aria-label="Breadcrumb">
            <Link to="/tyre-records">Tyre management</Link>
            <ChevronRight size={13} aria-hidden="true" />
            <span aria-current="page">Retread management</span>
          </nav>
          <h1>Retread Management</h1>
          <p>Manage retread casings, vendor performance and retread economics against buying new.</p>
        </div>
        <div className="rtm-head-actions">
          <label className="rtm-ctl">
            <Building2 size={14} aria-hidden="true" />
            <span className="sr-only">Site</span>
            <select className="cc-select" value={filterSite} onChange={e => setFilterSite(e.target.value)}>
              {headerSites.map(o => <option key={o} value={o}>{o === 'All' ? 'All sites' : o}</option>)}
            </select>
          </label>
          <button type="button" className="cc-btn-ghost" onClick={loadData} disabled={loading} aria-label="Refresh">
            <RefreshCw size={14} className={loading ? 'animate-spin' : ''} aria-hidden="true" />
          </button>
          <button type="button" className="cc-btn-ghost" onClick={handleExportExcel} disabled={loading || !!error || filtered.length === 0}>
            <FileSpreadsheet size={14} aria-hidden="true" /> Excel
          </button>
          <button type="button" className="cc-btn-ghost" onClick={() => handleExportPdf()} disabled={loading || !!error || filtered.length === 0}>
            <FileText size={14} aria-hidden="true" /> PDF
          </button>
          <EmailPdfButton
            className="cc-btn-ghost"
            getPdf={async () => ({
              base64: await handleExportPdf({ returnBase64: true }),
              filename: `${fileBase}.pdf`,
              subject: 'Retread Management',
              bodyHtml: '<p>Attached is the Retread Management report.</p>',
            })}
          />
          <button type="button" className="cc-btn-primary rtm-primary" onClick={openNewRetread}>
            <Plus size={16} aria-hidden="true" /> New retread
          </button>
        </div>
      </header>

      <NotInUseNotice count={loading || error ? null : enriched.length} label="retread records"
        hint="Records appear once a tyre record is categorised as a retread." />

      {truncated && (
        <div role="status" className="cc-card rtm-banner warn">
          <Info size={16} aria-hidden="true" />
          <p>Capped view: showing the first 50,000 tyre records. Narrow the country for the full set.</p>
        </div>
      )}
      {error && (
        <div role="alert" className="cc-card rtm-banner bad">
          <AlertTriangle size={18} aria-hidden="true" />
          <p>{error}</p>
          <button type="button" className="cc-btn" onClick={loadData}>Retry</button>
        </div>
      )}

      <div className="tk-row" aria-label="Retread indicators">
        <TyreKpiTile
          icon={Recycle} tone="t-blue" label="Retread casings" loading={kpiLoading}
          display={fmtNum(kv(kpis.totalRetreads))}
          sub={error ? 'Could not load' : `${fmtNum(kpis.activeCount)} active, ${fmtPct(kpis.retreadShare, 1)} of fleet`}
        />
        <TyreKpiTile
          icon={TrendingDown} tone="t-green" label="Retread CPK" loading={kpiLoading}
          display={moneyOk ? fmtCpk(kv(kpis.retreadCpk), money.currency) : 'N/A'} title={moneyTitle}
          sub={moneyOk
            ? (kpis.newCpk != null ? `vs ${fmtCpk(kpis.newCpk, money.currency)} new` : 'No new-tyre baseline')
            : 'Pick one country'}
        />
        <TyreKpiTile
          icon={CircleDollarSign} tone="t-green" label="Savings vs new" loading={kpiLoading}
          display={moneyOk ? fmtCurrency(kv(kpis.savings), money.currency) : 'N/A'} title={moneyTitle}
          sub={moneyOk ? 'Realised on measurable casings' : 'Pick one country'}
        />
        <TyreKpiTile
          icon={CheckCircle} tone="t-amber" label="Success rate" loading={kpiLoading}
          display={fmtPct(kv(kpis.successRate), 1)} sub="Not high risk at removal"
        />
        <TyreKpiTile
          icon={Layers} tone="t-purple" label="Avg cycle depth" loading={kpiLoading}
          display={kv(kpis.avgCycle) != null ? kpis.avgCycle.toFixed(1) : 'N/A'}
          sub={kpis.maxCycle != null ? `Cycles per casing, deepest ${kpis.maxCycle}` : 'No retread cycles recorded'}
        />
      </div>

      <Tabs label="Retread views" variant="line" value={activeTab} onChange={setActiveTab} tabs={TABS.map(t => ({ key: t, label: t }))} />

      {activeTab === 'Overview' && (
        <RetreadJobsSection
          activeCountry={activeCountry}
          site={filterSite}
          roi={roiCalc}
          roiInputs={{ currency: activeCurrency }}
          onOpenRoi={() => setActiveTab('ROI Calculator')}
          openNewSignal={newSignal}
        />
      )}

      {activeTab !== 'ROI Calculator' && (
        <>
      {/* Filters: drive the KPI-adjacent lifecycle table and every export */}
      <div className="bg-[var(--surface-1)] border border-[var(--input-border)] rounded-xl px-4 py-3 space-y-3">
        <div className="flex items-center gap-2 text-[var(--text-muted)] text-xs">
          <Filter size={14} aria-hidden="true" /> Tyre register filters
          <span className="ml-auto text-[var(--text-dim)]" aria-live="polite">
            {filtered.length.toLocaleString()} of {enriched.length.toLocaleString()} retread casings shown
          </span>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-6 gap-2">
          <label className="relative lg:col-span-2">
            <span className="sr-only">Search retread casings</span>
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" size={14} aria-hidden="true" />
            <input
              type="search"
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search serial, brand, asset, size, site"
              className={`${SELECT} w-full pl-8`}
            />
          </label>
          <label className="flex flex-col"><span className="sr-only">Site</span>
            <select aria-label="Filter by site" value={filterSite} onChange={e => setFilterSite(e.target.value)} className={SELECT}>
              {siteOptions.map(o => <option key={o} value={o}>{o === 'All' ? 'All sites' : o}</option>)}
            </select>
          </label>
          <label className="flex flex-col"><span className="sr-only">Brand</span>
            <select aria-label="Filter by brand" value={filterBrand} onChange={e => setFilterBrand(e.target.value)} className={SELECT}>
              {brandOptions.map(o => <option key={o} value={o}>{o === 'All' ? 'All brands' : o}</option>)}
            </select>
          </label>
          <label className="flex flex-col"><span className="sr-only">Risk</span>
            <select aria-label="Filter by risk level" value={filterRisk} onChange={e => setFilterRisk(e.target.value)} className={SELECT}>
              {riskOptions.map(o => <option key={o} value={o}>{o === 'All' ? 'All risk levels' : o}</option>)}
            </select>
          </label>
          <label className="flex flex-col"><span className="sr-only">Status</span>
            <select aria-label="Filter by status" value={filterStatus} onChange={e => setFilterStatus(e.target.value)} className={SELECT}>
              <option value="All">Active and removed</option>
              <option value="Active">Active only</option>
              <option value="Removed">Removed only</option>
            </select>
          </label>
        </div>
        {filtersActive && (
          <button type="button" onClick={clearFilters} className={`${BTN} text-xs`}>
            <RotateCcw size={12} aria-hidden="true" /> Clear filters
          </button>
        )}
      </div>
        </>
      )}

      {loading && (
        <div className="cc-card rtm-loading" role="status">
          <Loader2 className="animate-spin" size={22} aria-hidden="true" />
          <span>Loading retread data</span>
        </div>
      )}

      {!loading && !error && (
        <>
          {activeTab === 'Overview' && <h2 className="rtm-section-title">Retreads in the tyre register</h2>}
          {activeTab === 'Overview' && (
            <div className="space-y-5">
              {enriched.length === 0 ? (
                <EmptyBlock title="No retread tyres recorded" sub="Retread casings are tyre records whose category mentions a retread. None exist for this country yet." />
              ) : (
                <>
                  {insights.length > 0 && (
                    <Panel icon={Zap} title="Retread engineering findings" right={`${insights.length} finding${insights.length === 1 ? '' : 's'}`}>
                      <ul className="divide-y divide-[var(--input-border)]">
                        {insights.map((ins, i) => {
                          const tone = {
                            success: { Icon: CheckCircle, ic: 'text-green-400', word: 'Good' },
                            warning: { Icon: AlertTriangle, ic: 'text-yellow-400', word: 'Watch' },
                            danger: { Icon: AlertTriangle, ic: 'text-red-400', word: 'Act' },
                          }[ins.tone] ?? { Icon: Info, ic: 'text-blue-400', word: 'Note' }
                          const { Icon } = tone
                          return (
                            <li key={i} className="flex gap-3 px-1 py-3">
                              <Icon className={`${tone.ic} shrink-0 mt-0.5`} size={16} aria-hidden="true" />
                              <div className="min-w-0">
                                <p className="text-[var(--text-secondary)] text-sm font-semibold"><span className="sr-only">{tone.word}: </span>{ins.title}</p>
                                <p className="text-[var(--text-muted)] text-xs mt-0.5 leading-relaxed">{ins.body}</p>
                              </div>
                            </li>
                          )
                        })}
                      </ul>
                    </Panel>
                  )}

                  <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
                    <div className="lg:col-span-2">
                      <Panel icon={BarChart3} title="Retread fitments, last 12 months">
                        <div className="h-56" role="img" aria-label={`Retread fitments per month. ${charts.monthlyBar.datasets[0].data.reduce((s, v) => s + v, 0)} in the last 12 months.`}>
                          <Bar data={charts.monthlyBar} options={{ ...CHART_OPTS, plugins: { ...CHART_OPTS.plugins, legend: { display: false } } }} />
                        </div>
                      </Panel>
                    </div>
                    <Panel icon={Layers} title="Retread and new tyres">
                      <div className="h-56" role="img" aria-label={`${enriched.length} retread and ${newRecords.length} new tyres`}>
                        <Doughnut data={charts.retreadVsNew} options={DOUGHNUT_OPTS} />
                      </div>
                    </Panel>
                  </div>

                  {charts.cycleBar.labels.length > 0 && (
                    <Panel icon={Layers} title="Casings by retread cycle depth" right="cycle 3 or deeper carries more blow-out risk">
                      <div className="h-48" role="img" aria-label="Casings by retread cycle depth">
                        <Bar data={charts.cycleBar} options={{ ...CHART_OPTS, plugins: { ...CHART_OPTS.plugins, legend: { display: false } } }} />
                      </div>
                    </Panel>
                  )}

                  <Panel
                    icon={Award}
                    title="Retread performance by brand"
                    right={`${brandSummary.length} brands`}
                    footer={(topBrand || topSize) && (
                      <span className="flex flex-wrap gap-4">
                        {topBrand && <span>Top retread brand: <strong className="text-[var(--text-secondary)]">{topBrand.brand}</strong> ({topBrand.successRate}% success)</span>}
                        {topSize && <span>Longest-lived size: <strong className="text-[var(--text-secondary)] font-mono">{topSize}</strong></span>}
                      </span>
                    )}
                  >
                    <EnterpriseTable
                      columns={brandColumns}
                      data={brandSummary}
                      getRowId={(r) => r.brand}
                      enableColumnFilters={false}
                      searchPlaceholder="Search brands"
                      exportFileName={reportFileName('TyrePulse Retread Brands', reportDateLabel())}
                      reportMeta={{ ...reportMeta, title: 'Retread performance by brand' }}
                      initialPageSize={25}
                      emptyMessage="No brand data available"
                    />
                  </Panel>
                </>
              )}
            </div>
          )}

          {activeTab === 'Vendor Analysis' && (
            <div className="space-y-5">
              {vendors.length === 0 ? (
                <EmptyBlock icon={Building2} title="No vendor data available" sub="Vendor analysis needs retread records that carry a brand." />
              ) : (
                <>
                  <Panel
                    icon={Star}
                    title="Retread vendor and brand scorecard"
                    footer="Score = CPK efficiency (40%) + success rate (40%) + average life (20%), scaled against this fleet. Below 40 is flagged. A missing metric scores a neutral 50."
                  >
                    <EnterpriseTable
                      columns={vendorColumns}
                      data={vendors}
                      getRowId={(r) => r.brand}
                      enableColumnFilters={false}
                      searchPlaceholder="Search vendors"
                      exportFileName={reportFileName('TyrePulse Retread Vendor Scorecard', reportDateLabel())}
                      reportMeta={{ ...reportMeta, title: 'Retread vendor scorecard' }}
                      emptyMessage="No vendor data available"
                    />
                  </Panel>

                  {charts.trendChart.datasets.length > 0 && (
                    <Panel icon={Activity} title="CPK trend, top 3 vendors, last 12 months" right="months with no measurable casing are gaps, not zero">
                      <div className="h-64" role="img" aria-label="Monthly average CPK for the top three retread vendors">
                        <Line data={charts.trendChart} options={CHART_OPTS} />
                      </div>
                    </Panel>
                  )}
                </>
              )}
            </div>
          )}

          {activeTab === 'Lifecycle' && (
            <Panel icon={Recycle} title="Retread casing lifecycle" right={`${filtered.length.toLocaleString()} of ${enriched.length.toLocaleString()} casings`}>
              {enriched.length === 0 ? (
                <EmptyBlock title="No retread casings recorded" />
              ) : (
                <EnterpriseTable
                  columns={lifecycleColumns}
                  data={filtered}
                  getRowId={(r) => String(r.id)}
                  enableGlobalFilter={false}
                  enableColumnFilters={false}
                  enableExport={false}
                  viewKey="retread-lifecycle"
                  onRowClick={(r) => setDrawer(r)}
                  emptyMessage={filtersActive ? 'No retread casings match the current filters' : 'No retread casings recorded'}
                />
              )}
              <p className="text-xs text-[var(--text-dim)] mt-2">Select a row to open the casing detail and its approval. The PDF and Excel buttons export exactly these filtered casings.</p>
            </Panel>
          )}

          {activeTab === 'ROI Calculator' && (
            <div className="space-y-5">
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
                <Panel icon={Target} title="ROI inputs">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 p-1">
                    {[
                      { label: `Cost of new tyre (${activeCurrency})`, key: 'newCost', help: 'Average purchase price per new tyre' },
                      { label: `Cost of retread (${activeCurrency})`, key: 'retreadCost', help: 'Average retread cost per casing' },
                      { label: 'Expected retread life (km)', key: 'retreadLifeKm', help: 'Typical km a retread runs' },
                      { label: 'Expected new tyre life (km)', key: 'newLifeKm', help: 'Typical km a new tyre runs' },
                      { label: 'Fleet size (tyre positions)', key: 'fleetSize', help: 'Positions running retreads' },
                      { label: 'Annual km per position', key: 'annualKm', help: 'Distance each position runs per year' },
                    ].map(({ label, key, help }) => (
                      <div key={key}>
                        <label htmlFor={`roi-${key}`} className="block text-xs text-[var(--text-muted)] mb-1">{label}</label>
                        <input
                          id={`roi-${key}`}
                          type="number"
                          inputMode="decimal"
                          min={0}
                          value={roi[key]}
                          onChange={e => setRoi(r => ({ ...r, [key]: e.target.value }))}
                          aria-describedby={`roi-${key}-help`}
                          className={`${SELECT} w-full`}
                        />
                        <p id={`roi-${key}-help`} className="text-[var(--text-dim)] text-xs mt-0.5">{help}</p>
                      </div>
                    ))}
                  </div>
                  {kpis.retreadCpk != null && (
                    <p className="text-xs text-[var(--text-muted)] mt-3 px-1">
                      For reference, this fleet measures retread CPK {fmtCpk(kpis.retreadCpk, activeCurrency)} and new-tyre CPK {fmtCpk(kpis.newCpk, activeCurrency)}.
                    </p>
                  )}
                </Panel>

                <div className="space-y-4">
                  <Panel icon={Zap} title="Results">
                    <dl className="space-y-1 p-1">
                      {[
                        { label: 'New tyre CPK', value: fmtCpk(roiCalc.newCpkVal, activeCurrency) },
                        { label: 'Retread CPK', value: fmtCpk(roiCalc.rCpkVal, activeCurrency) },
                        { label: 'CPK improvement', value: fmtPct(roiCalc.cpkImprovement, 1), tone: roiCalc.cpkImprovement == null ? '' : roiCalc.cpkImprovement > 0 ? 'text-green-400' : 'text-red-400' },
                        { label: 'Savings per retread', value: fmtCurrency(roiCalc.savingsPerTyre, activeCurrency), tone: roiCalc.savingsPerTyre == null ? '' : roiCalc.savingsPerTyre > 0 ? 'text-green-400' : 'text-red-400' },
                        { label: 'Break-even distance', value: roiCalc.breakEvenKm != null ? `${Math.round(roiCalc.breakEvenKm).toLocaleString()} km` : 'N/A' },
                        { label: 'Projected annual fleet savings', value: fmtCurrency(roiCalc.annualSavings, activeCurrency), tone: roiCalc.annualSavings == null ? '' : roiCalc.annualSavings > 0 ? 'text-green-400' : 'text-red-400', large: true },
                      ].map(({ label, value, tone, large }) => (
                        <div key={label} className={`flex items-center justify-between gap-3 py-2 border-b border-[var(--input-border)] last:border-0 ${large ? 'bg-[var(--input-bg)] px-3 rounded-lg' : ''}`}>
                          <dt className="text-[var(--text-muted)] text-sm">{label}</dt>
                          <dd className={`font-bold tabular-nums ${large ? 'text-lg' : 'text-sm'} ${tone || 'text-[var(--text-secondary)]'}`}>{value}</dd>
                        </div>
                      ))}
                    </dl>
                  </Panel>

                  <div className="bg-[var(--input-bg)] border border-[var(--input-border)] rounded-xl p-4 flex gap-3">
                    <Info className="text-[var(--text-muted)] shrink-0 mt-0.5" size={16} aria-hidden="true" />
                    <p className="text-[var(--text-muted)] text-xs leading-relaxed">
                      The annual projection uses the annual km per position you enter. Break-even is the distance a retread must run for its cost to be recovered at the new-tyre cost per km. A missing or zero input shows N/A rather than a guessed figure.
                    </p>
                  </div>

                  <button
                    type="button"
                    onClick={handleExportRoiPdf}
                    className="w-full inline-flex items-center justify-center gap-2 min-h-[44px] py-2.5 bg-[var(--accent)] hover:opacity-90 rounded-lg text-sm font-semibold text-white transition focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:ring-offset-2"
                  >
                    <FileText size={15} aria-hidden="true" /> Export ROI analysis PDF
                  </button>
                </div>
              </div>

              <Panel icon={BarChart3} title="Cost of ownership comparison">
                <div className="h-64" role="img" aria-label="Initial cost and cost per 100,000 km for new and retread tyres">
                  <Bar data={roiChart} options={CHART_OPTS} />
                </div>
              </Panel>
            </div>
          )}
        </>
      )}

      {/* ── Detail dialog ── */}
      <Modal
        open={!!drawer}
        onClose={() => setDrawer(null)}
        size="lg"
        title={drawer ? (
          <span className="flex items-center gap-2 flex-wrap">
            <Recycle className="text-[var(--text-muted)]" size={16} aria-hidden="true" />
            <span className="font-mono text-sm">{drawer.serial_number || 'No serial recorded'}</span>
            {riskBadge(drawer.risk_level)}
            {statusBadge(drawer.status)}
          </span>
        ) : null}
        subtitle={drawer ? ([drawer.brand, drawer.size].filter(Boolean).join(', ') || 'N/A') : null}
        footer={drawer ? (
          <>
                <button
                  type="button"
                  onClick={() => handleExportCasing(drawer)}
                  disabled={wfLocked}
                  title={wfLocked ? 'Locked, in approval' : 'Export casing record'}
                  className="inline-flex items-center gap-1.5 min-h-[44px] px-4 py-2 bg-[var(--accent)] hover:opacity-90 rounded-lg text-sm font-semibold text-white transition disabled:opacity-40 disabled:cursor-not-allowed focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:ring-offset-2"
                >
                  {wfLocked ? <Lock size={14} aria-hidden="true" /> : <FileText size={14} aria-hidden="true" />} Export Casing
                </button>
                <button type="button" onClick={() => setDrawer(null)} className={BTN}>Close</button>
              
          </>
        ) : null}
      >
        {drawer && (
              <div className="space-y-4">
                <div className="bg-[var(--input-bg)] rounded-xl p-4">
                  <p className="text-xs text-[var(--text-muted)] mb-3 font-semibold uppercase tracking-wider">Tyre information</p>
                  <dl className="grid grid-cols-2 gap-3 text-sm">
                    {[
                      ['Brand', drawer.brand], ['Size', drawer.size], ['Position', drawer.position],
                      ['Asset no', drawer.asset_no], ['Site', drawer.site], ['Country', drawer.country],
                      ['Category', drawer.category],
                      ['Retread cycle', drawer.retread_cycle != null ? `${drawer.retread_cycle}x` : null],
                      ['Tread depth', drawer.tread_depth != null ? `${drawer.tread_depth} mm` : null],
                    ].map(([label, value]) => (
                      <div key={label}>
                        <dt className="text-[var(--text-muted)] text-xs">{label}</dt>
                        <dd className="text-[var(--text-secondary)] font-medium text-sm mt-0.5">{value ?? 'N/A'}</dd>
                      </div>
                    ))}
                  </dl>
                </div>

                <div className="bg-[var(--input-bg)] rounded-xl p-4">
                  <p className="text-xs text-[var(--text-muted)] mb-3 font-semibold uppercase tracking-wider">Lifecycle and cost</p>
                  <dl className="grid grid-cols-2 gap-3 text-sm">
                    {[
                      ['Issue date', drawer.issue_date],
                      ['Removal date', drawer.removal_date ?? (drawer.status === 'Removed' ? 'Not recorded' : 'Still fitted')],
                      ['km at fitment', drawer.km_at_fitment != null ? Number(drawer.km_at_fitment).toLocaleString() : null],
                      ['km at removal', drawer.km_at_removal != null ? Number(drawer.km_at_removal).toLocaleString() : null],
                      ['km life', drawer.km_life != null ? `${drawer.km_life.toLocaleString()} km` : null],
                      ['Days in service', drawer.days_in_service != null ? `${drawer.days_in_service} days` : null],
                      ['Cost per tyre', drawer.cost_per_tyre != null ? fmtCurrency(Number(drawer.cost_per_tyre), activeCurrency) : null],
                      ['CPK', fmtCpk(drawer.cpk, activeCurrency)],
                    ].map(([label, value]) => (
                      <div key={label}>
                        <dt className="text-[var(--text-muted)] text-xs">{label}</dt>
                        <dd className="text-[var(--text-secondary)] font-medium text-sm mt-0.5 tabular-nums">{value ?? 'N/A'}</dd>
                      </div>
                    ))}
                  </dl>
                </div>

                {kpis.newCpk != null && drawer.cpk != null && (
                  <div className="bg-[var(--input-bg)] border border-[var(--input-border)] rounded-xl p-4">
                    <p className="text-xs text-[var(--text-muted)] mb-3 font-semibold uppercase tracking-wider">Against the fleet new-tyre average</p>
                    <dl className="space-y-2 text-sm">
                      <div className="flex justify-between"><dt className="text-[var(--text-muted)]">This retread CPK</dt><dd className="font-bold tabular-nums">{fmtCpk(drawer.cpk, activeCurrency)}</dd></div>
                      <div className="flex justify-between"><dt className="text-[var(--text-muted)]">Fleet new-tyre CPK</dt><dd className="font-bold tabular-nums">{fmtCpk(kpis.newCpk, activeCurrency)}</dd></div>
                      <div className="flex justify-between">
                        <dt className="text-[var(--text-muted)]">Difference</dt>
                        <dd className={`font-bold tabular-nums ${drawer.cpk < kpis.newCpk ? 'text-green-400' : 'text-red-400'}`}>
                          {drawer.cpk < kpis.newCpk
                            ? `${fmtCpk(kpis.newCpk - drawer.cpk, activeCurrency)} cheaper`
                            : `${fmtCpk(drawer.cpk - kpis.newCpk, activeCurrency)} dearer`}
                        </dd>
                      </div>
                    </dl>
                  </div>
                )}

                <EntityApprovalPanel
                  entityType="retread"
                  entityId={drawer.id}
                  entityLabel={drawer.serial_number || drawer.asset_no || drawer.id}
                  context={{
                    retread_cost: drawer.cost_per_tyre,
                    vendor: drawer.brand,
                    serial_no: drawer.serial_number,
                    casing_condition: drawer.risk_level,
                    site: drawer.site,
                  }}
                  onStateChange={(s) => setWfLocked(!!(s?.isActive || s?.isLocked))}
                  title="Retread Approval"
                />

                {wfLocked && (
                  <div role="status" className="flex items-center gap-1.5 text-xs text-[var(--accent)] bg-[var(--input-bg)] border border-[var(--input-border)] rounded-lg px-3 py-2">
                    <Lock size={12} aria-hidden="true" />
                    Locked, in approval. This casing's export is disabled until the workflow completes.
                  </div>
                )}
              </div>
        )}
      </Modal>
    </div>
  )
}
