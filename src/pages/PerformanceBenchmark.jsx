// ─────────────────────────────────────────────────────────────────────────────
// PerformanceBenchmark.jsx - Fleet vs static industry reference · /benchmark
//
// Every measured value comes from the central kpiEngine through the pure
// performanceBenchmarkAnalytics engine (so it agrees with Engineering KPI).
// Honest nulls: a metric with no measurable data reads "Not measured" and is
// left out of the overall score; money metrics are withheld when the scope
// spans more than one country's currency.
// ─────────────────────────────────────────────────────────────────────────────
import { useState, useEffect, useMemo, useCallback } from 'react'
import {
  Chart as ChartJS,
  CategoryScale, LinearScale, BarElement,
  LineElement, PointElement,
  RadialLinearScale,
  Title, Tooltip, Legend, Filler,
} from 'chart.js'
import { Bar, Radar } from 'react-chartjs-2'
import {
  Target, Award, Minus, RefreshCw, FileSpreadsheet, FileText,
  AlertTriangle, CheckCircle, Info, ArrowUpRight, ArrowDownRight, Gauge, Layers,
} from 'lucide-react'
import * as analytics from '../lib/api/analyticsReads'
import { toUserMessage } from '../lib/safeError'
import useLatestRequest from '../lib/useLatestRequest'
import { useSettings } from '../contexts/SettingsContext'
import { useTenant } from '../contexts/TenantContext'
import {
  resolvePdfBrand, pdfHeader, pdfFooter, pdfEmptyState, pdfTableTheme,
  exportSheetsToExcel, reportFileName, reportDateLabel,
} from '../lib/exportUtils'
import PageHeader from '../components/ui/PageHeader'
import EnterpriseTable from '../components/ui/EnterpriseTable'
import { loadAutoTable } from '../lib/pdfEngine'
import { colorAt, withAlpha } from '../lib/reportColors'
import { compareValues } from '../lib/consoleTable'
import {
  BENCHMARKS, formatBenchmark, scopeInspections, measureFleet,
  benchmarkRows, overallScore as computeOverall, brandBenchmarks, RECOMMENDATIONS,
  improvementTargets,
} from '../lib/performanceBenchmarkAnalytics'

ChartJS.register(
  CategoryScale, LinearScale, BarElement,
  LineElement, PointElement,
  RadialLinearScale,
  Title, Tooltip, Legend, Filler,
)

// chart.js colours as CSS tokens: chartVarPlugin resolves them per theme.
const CHART_OPTS = {
  responsive: true,
  maintainAspectRatio: false,
  plugins: {
    legend: { labels: { color: 'var(--text-secondary)', boxWidth: 12, font: { size: 11 } } },
    tooltip: { backgroundColor: 'var(--panel)', borderColor: 'var(--hairline)', borderWidth: 1, titleColor: 'var(--text-primary)', bodyColor: 'var(--text-secondary)' },
  },
  scales: {
    x: { ticks: { color: 'var(--text-muted)', font: { size: 11 } }, grid: { color: 'var(--panel-2)' } },
    y: { ticks: { color: 'var(--text-muted)', font: { size: 11 } }, grid: { color: 'var(--panel-2)' } },
  },
}

// Semantic rating colours (meaning, not decoration) - kept as fixed hues.
const TONE_TEXT = {
  good: 'text-green-500', info: 'text-blue-500', watch: 'text-yellow-600 dark:text-yellow-400',
  warn: 'text-orange-500', risk: 'text-red-500', none: 'text-[var(--text-muted)]',
}
const TONE_BAR = { good: 'bg-green-500', info: 'bg-blue-500', watch: 'bg-yellow-500', warn: 'bg-orange-500', risk: 'bg-red-500', none: 'bg-[var(--input-border)]' }
const TONE_CHIP = {
  good: 'bg-green-500/10 text-green-600 dark:text-green-400 border-green-500/40',
  info: 'bg-blue-500/10 text-blue-600 dark:text-blue-400 border-blue-500/40',
  watch: 'bg-yellow-500/10 text-yellow-700 dark:text-yellow-400 border-yellow-500/40',
  warn: 'bg-orange-500/10 text-orange-600 dark:text-orange-400 border-orange-500/40',
  risk: 'bg-red-500/10 text-red-600 dark:text-red-400 border-red-500/40',
  none: 'bg-[var(--input-bg)] text-[var(--text-muted)] border-[var(--input-border)]',
}
const scoreTone = (s) => (s == null ? 'none' : s >= 80 ? 'good' : s >= 60 ? 'info' : s >= 40 ? 'watch' : s >= 20 ? 'warn' : 'risk')

const PERIODS = [
  { value: '90d', label: 'Last 90 days', days: 90 },
  { value: '6m', label: 'Last 6 months', days: 180 },
  { value: '1yr', label: 'Last year', days: 365 },
  { value: '2yr', label: 'Last 2 years', days: 730 },
]

const valueSort = (a, b, id) => compareValues(a.getValue(id), b.getValue(id))

function DeltaBadge({ row }) {
  if (row.better == null) return <span className="inline-flex items-center gap-0.5 text-sm text-[var(--text-muted)]"><Minus size={14} aria-hidden="true" /> No comparison</span>
  const Icon = row.better ? ArrowUpRight : ArrowDownRight
  return (
    <span className={`inline-flex items-center gap-0.5 text-sm ${row.better ? 'text-green-500' : 'text-red-500'}`}>
      <Icon size={14} aria-hidden="true" />
      {Math.abs(row.deltaPct).toFixed(1)}% {row.better ? 'better' : 'worse'} than Good
    </span>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
export default function PerformanceBenchmark() {
  const { activeCountry, activeCurrency, appSettings } = useSettings()
  const { branding } = useTenant()
  const [records, setRecords] = useState([])
  const [inspections, setInspections] = useState([])
  const [loaded, setLoaded] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [period, setPeriod] = useState('1yr')
  const [site, setSite] = useState('All')

  // Switching the period starts a second load over the first. If the earlier one
  // finishes last the benchmark compares the PREVIOUS period's records while the
  // control says otherwise, so the ranking is wrong with nothing to flag it.
  const latestLoad = useLatestRequest()

  const load = useCallback(async () => {
    const stale = latestLoad.begin()
    setLoading(true); setError(null)
    try {
      const country = activeCountry !== 'All' ? activeCountry : null
      const daysBack = PERIODS.find((p) => p.value === period)?.days ?? 365
      const cutoff = new Date(); cutoff.setDate(cutoff.getDate() - daysBack)
      const from = cutoff.toISOString()

      const [tr, insp] = await Promise.all([
        analytics.listTyreRecordsSince({ country, since: from }),
        analytics.listInspectionsSince({ since: from.slice(0, 10) }),
      ])
      if (stale()) return
      if (tr?.error) throw tr.error
      if (insp?.error) throw insp.error
      setRecords(tr.data || [])
      setInspections(insp.data || [])
      setLoaded(true)
    } catch (e) {
      // A superseded load must not raise a banner over data that loaded fine.
      if (!stale()) setError(toUserMessage(e, 'Could not load benchmark data.'))
    } finally {
      // Clearing this from a stale load would make the newer one look finished.
      if (!stale()) setLoading(false)
    }
  }, [activeCountry, period, latestLoad])

  useEffect(() => { load() }, [load])

  const sites = useMemo(() => ['All', ...[...new Set(records.map((r) => r.site).filter(Boolean))].sort()], [records])

  const filtered = useMemo(() => (site === 'All' ? records : records.filter((r) => r.site === site)), [records, site])
  // Inspections are read fleet-wide; scope them here to the same country and site.
  const scopedInspections = useMemo(
    () => scopeInspections(inspections, { country: activeCountry, site }),
    [inspections, activeCountry, site],
  )

  const measured = useMemo(() => (filtered.length ? measureFleet(filtered, scopedInspections) : null), [filtered, scopedInspections])
  const benchmarked = useMemo(() => (measured ? benchmarkRows(measured.values, measured.basis) : []), [measured])
  const overallScore = useMemo(() => computeOverall(benchmarked), [benchmarked])
  const measuredCount = benchmarked.filter((m) => m.rating.score != null).length
  const brandBench = useMemo(
    () => brandBenchmarks(filtered, { mixedCurrency: !!measured?.mixedCurrency }),
    [filtered, measured],
  )
  const targets = useMemo(() => improvementTargets(benchmarked), [benchmarked])
  const fmt = useCallback((key, v) => formatBenchmark(key, v, activeCurrency), [activeCurrency])

  // ── Charts ────────────────────────────────────────────────────────────────
  const radarData = useMemo(() => {
    if (!measuredCount) return null
    const measuredRows = benchmarked.filter((m) => m.rating.score != null)
    const fleetColor = colorAt(0)
    return {
      labels: measuredRows.map((m) => m.label.replace(' (CPK)', '')),
      datasets: [
        { label: 'Your fleet', data: measuredRows.map((m) => m.rating.score), borderColor: fleetColor, backgroundColor: withAlpha(fleetColor, 0.15), pointBackgroundColor: fleetColor, borderWidth: 2 },
        { label: 'Industry average', data: measuredRows.map(() => 50), borderColor: '#94a3b8', backgroundColor: 'rgba(148,163,184,0.05)', pointBackgroundColor: '#94a3b8', borderWidth: 1, borderDash: [4, 4] },
        { label: 'World class', data: measuredRows.map(() => 100), borderColor: '#10b981', backgroundColor: 'rgba(16,185,129,0.05)', pointBackgroundColor: '#10b981', borderWidth: 1, borderDash: [4, 4] },
      ],
    }
  }, [benchmarked, measuredCount])

  const cpkValue = measured?.values?.cpk ?? null
  const cpkBarData = useMemo(() => {
    if (cpkValue == null) return null
    return {
      labels: ['Your fleet', 'World class', 'Good', 'Average', 'Poor'],
      datasets: [{
        label: `CPK (${activeCurrency}/km)`,
        data: [cpkValue, BENCHMARKS.cpk.world_class, BENCHMARKS.cpk.good, BENCHMARKS.cpk.average, BENCHMARKS.cpk.poor],
        backgroundColor: [colorAt(0), '#10b981', '#06b6d4', '#f59e0b', '#ef4444'],
      }],
    }
  }, [cpkValue, activeCurrency])

  const brandCpkData = useMemo(() => {
    if (!brandBench.length) return null
    const top10 = brandBench.slice(0, 10)
    const good = BENCHMARKS.cpk.good
    return {
      labels: top10.map((b) => b.brand),
      datasets: [
        { label: 'Brand CPK', data: top10.map((b) => b.avgCpk), backgroundColor: top10.map((b) => (b.avgCpk <= good ? '#10b981' : b.avgCpk <= BENCHMARKS.cpk.average ? '#f59e0b' : '#ef4444')) },
        { label: 'Good benchmark', data: top10.map(() => good), type: 'line', borderColor: colorAt(0), borderWidth: 2, borderDash: [4, 4], pointRadius: 0, fill: false },
      ],
    }
  }, [brandBench])

  // ── Tables ───────────────────────────────────────────────────────────────
  const kpiColumns = useMemo(() => [
    { id: 'label', header: 'KPI', accessorFn: (m) => m.label, size: 200, sortingFn: valueSort, cell: ({ getValue }) => <span className="font-medium text-[var(--text-primary)]">{getValue()}</span> },
    { id: 'value', header: 'Your fleet', accessorFn: (m) => m.value ?? undefined, size: 130, sortingFn: valueSort, sortUndefined: 'last',
      cell: ({ row }) => <span className={`font-semibold tabular-nums ${TONE_TEXT[row.original.rating.tone]}`}>{fmt(row.original.key, row.original.value)}</span>,
      meta: { align: 'right', exportValue: (m) => fmt(m.key, m.value) } },
    { id: 'world_class', header: 'World class', accessorFn: (m) => m.world_class, size: 120, enableSorting: false, cell: ({ row }) => fmt(row.original.key, row.original.world_class), meta: { align: 'right', exportValue: (m) => fmt(m.key, m.world_class) } },
    { id: 'good', header: 'Good', accessorFn: (m) => m.good, size: 110, enableSorting: false, cell: ({ row }) => fmt(row.original.key, row.original.good), meta: { align: 'right', exportValue: (m) => fmt(m.key, m.good) } },
    { id: 'average', header: 'Average', accessorFn: (m) => m.average, size: 110, enableSorting: false, cell: ({ row }) => fmt(row.original.key, row.original.average), meta: { align: 'right', exportValue: (m) => fmt(m.key, m.average) } },
    { id: 'rating', header: 'Rating', accessorFn: (m) => m.rating.score ?? undefined, size: 140, sortingFn: valueSort, sortUndefined: 'last',
      cell: ({ row }) => <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium border ${TONE_CHIP[row.original.rating.tone]}`}>{row.original.rating.rating}</span>,
      meta: { exportValue: (m) => m.rating.rating } },
    { id: 'basis', header: 'Based on', accessorFn: (m) => m.basis, size: 280, enableSorting: false, cell: ({ getValue }) => <span className="text-xs text-[var(--text-muted)]">{getValue()}</span> },
  ], [fmt])

  const brandColumns = useMemo(() => [
    { id: 'rank', header: 'Rank', accessorFn: (b) => b.rank, size: 70, sortingFn: valueSort,
      cell: ({ getValue }) => {
        const r = getValue()
        if (r <= 3) return <span className="inline-flex items-center gap-1"><Award size={16} className={r === 1 ? 'text-yellow-500' : r === 2 ? 'text-[var(--text-secondary)]' : 'text-amber-600'} aria-hidden="true" /><span className="sr-only">Rank </span>{r}</span>
        return <span className="text-[var(--text-muted)] text-xs">#{r}</span>
      } },
    { id: 'brand', header: 'Brand', accessorFn: (b) => b.brand, size: 160, sortingFn: valueSort, cell: ({ getValue }) => <span className="font-medium text-[var(--text-primary)]">{getValue()}</span> },
    { id: 'count', header: 'Tyres', accessorFn: (b) => b.count, size: 80, sortingFn: valueSort, meta: { align: 'right' } },
    { id: 'avgCpk', header: 'Avg CPK', accessorFn: (b) => b.avgCpk, size: 120, sortingFn: valueSort,
      cell: ({ row }) => <span className={`font-medium tabular-nums ${TONE_TEXT[row.original.rating.tone]}`}>{fmt('cpk', row.original.avgCpk)}</span>,
      meta: { align: 'right', exportValue: (b) => fmt('cpk', b.avgCpk) } },
    { id: 'rating', header: 'Rating', accessorFn: (b) => b.rating.score, size: 130, sortingFn: valueSort,
      cell: ({ row }) => <span className={`text-xs font-medium ${TONE_TEXT[row.original.rating.tone]}`}>{row.original.rating.rating}</span>,
      meta: { exportValue: (b) => b.rating.rating } },
  ], [fmt])

  // ── Export ───────────────────────────────────────────────────────────────
  const scopeLabel = `${activeCountry && activeCountry !== 'All' ? activeCountry : 'All countries'} | ${site === 'All' ? 'All sites' : site} | ${PERIODS.find((p) => p.value === period)?.label}`

  async function exportPdf() {
    try {
      const { default: jsPDF } = await import('jspdf')
      const autoTable = await loadAutoTable()
      const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' })
      const brand = await resolvePdfBrand(branding)
      const company = branding?.legal_name || branding?.display_name || appSettings?.company_name || 'TyrePulse'
      const filename = `${reportFileName(company, 'Performance Benchmark', reportDateLabel())}.pdf`

      pdfHeader(doc, 'Fleet Performance Benchmarking Report',
        `${scopeLabel} | Overall score: ${overallScore == null ? 'Not measured' : `${overallScore.toFixed(0)}/100`}`, company, brand)

      if (!benchmarked.length) {
        pdfEmptyState(doc, 'No benchmark data for the selected period',
          'Widen the period or change the site filter and export again.')
        pdfFooter(doc, 1, 1, company, brand)
        doc.save(filename)
        return
      }

      autoTable(doc, {
        ...pdfTableTheme(brand.accent),
        startY: 30,
        head: [['KPI', 'Your fleet', 'World class', 'Good', 'Average', 'Rating', 'Based on']],
        body: benchmarked.map((m) => [m.label, fmt(m.key, m.value), fmt(m.key, m.world_class), fmt(m.key, m.good), fmt(m.key, m.average), m.rating.rating, m.basis]),
        margin: { left: 14, right: 14 },
      })
      if (brandBench.length) {
        autoTable(doc, {
          ...pdfTableTheme(brand.accent),
          startY: (doc.lastAutoTable?.finalY || 30) + 8,
          head: [['Rank', 'Brand', 'Tyres', 'Avg CPK', 'Rating']],
          body: brandBench.map((b) => [b.rank, b.brand, b.count, fmt('cpk', b.avgCpk), b.rating.rating]),
          margin: { left: 14, right: 14 },
        })
      }
      const totalPages = doc.internal.getNumberOfPages()
      for (let p = 1; p <= totalPages; p++) { doc.setPage(p); pdfFooter(doc, p, totalPages, company, brand) }
      doc.save(filename)
    } catch (e) {
      setError(toUserMessage(e, 'Export failed. Please try again.'))
    }
  }

  async function exportExcel() {
    if (!benchmarked.length) return
    try {
      const company = appSettings?.company_name || 'TyrePulse'
      await exportSheetsToExcel([
        {
          name: 'Benchmarks',
          columns: ['kpi', 'fleet', 'world_class', 'good', 'average', 'poor', 'rating', 'score', 'basis'],
          headers: ['KPI', 'Your fleet', 'World class', 'Good', 'Average', 'Poor', 'Rating', 'Score', 'Based on'],
          rows: benchmarked.map((m) => ({
            kpi: m.label, fleet: fmt(m.key, m.value), world_class: fmt(m.key, m.world_class), good: fmt(m.key, m.good),
            average: fmt(m.key, m.average), poor: fmt(m.key, m.poor), rating: m.rating.rating, score: m.rating.score ?? 'N/A', basis: m.basis,
          })),
        },
        {
          name: 'Brand Benchmarks',
          columns: ['rank', 'brand', 'count', 'avg_cpk', 'rating'],
          headers: ['Rank', 'Brand', 'Tyres', 'Avg CPK', 'Rating'],
          rows: brandBench.map((b) => ({ rank: b.rank, brand: b.brand, count: b.count, avg_cpk: b.avgCpk?.toFixed(4), rating: b.rating.rating })),
          emptyNote: measured?.mixedCurrency ? 'Brand CPK is withheld while more than one currency is in scope.' : 'No brand has three or more costed tyres in scope.',
        },
      ], reportFileName(company, 'Performance Benchmark', reportDateLabel()), { title: 'Fleet Performance Benchmarking', company, dateRange: scopeLabel })
    } catch (e) {
      setError(toUserMessage(e, 'Export failed. Please try again.'))
    }
  }

  const overallTone = scoreTone(overallScore)
  const hasData = !!measured
  const failedFirstLoad = !!error && !loaded

  // ─────────────────────────────────────────────────────────────────────────
  return (
    <div className="space-y-6">
      <PageHeader
        title="Performance Benchmarking"
        subtitle={loaded ? `Fleet performance against a static industry reference | ${filtered.length.toLocaleString()} tyre records in scope` : 'Fleet performance against a static industry reference'}
        icon={Target}
        actions={(
          <div className="flex flex-wrap items-center gap-2">
            <label>
              <span className="sr-only">Period</span>
              <select value={period} onChange={(e) => setPeriod(e.target.value)} className="input min-h-[44px] text-sm" aria-label="Period">
                {PERIODS.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
              </select>
            </label>
            <label>
              <span className="sr-only">Site</span>
              <select value={site} onChange={(e) => setSite(e.target.value)} className="input min-h-[44px] text-sm" aria-label="Site">
                {sites.map((s) => <option key={s} value={s}>{s === 'All' ? 'All sites' : s}</option>)}
              </select>
            </label>
            <button type="button" onClick={load} disabled={loading} aria-label="Refresh benchmark data"
              className="btn-secondary min-h-[44px] min-w-[44px] inline-flex items-center justify-center disabled:opacity-50">
              <RefreshCw size={16} className={loading ? 'animate-spin' : ''} aria-hidden="true" />
            </button>
            <button type="button" onClick={exportPdf} disabled={loading || !hasData} className="btn-secondary min-h-[44px] text-sm inline-flex items-center gap-2 disabled:opacity-50"><FileText size={16} aria-hidden="true" />PDF</button>
            <button type="button" onClick={exportExcel} disabled={loading || !hasData} className="btn-secondary min-h-[44px] text-sm inline-flex items-center gap-2 disabled:opacity-50"><FileSpreadsheet size={16} aria-hidden="true" />Excel</button>
          </div>
        )}
      />

      {error && (
        <div role="alert" className="card border border-red-700/50 flex items-start gap-3">
          <AlertTriangle size={18} className="text-red-500 mt-0.5 shrink-0" aria-hidden="true" />
          <div className="flex-1">
            <p className="text-sm font-medium text-[var(--text-primary)]">{failedFirstLoad ? 'Benchmark data could not be loaded.' : 'Something went wrong.'}</p>
            <p className="text-sm text-[var(--text-muted)] mt-1">{error}{!failedFirstLoad ? ' The figures below are from the last successful load.' : ''}</p>
          </div>
          <button type="button" onClick={load} className="btn-secondary min-h-[44px] text-sm inline-flex items-center gap-1.5"><RefreshCw size={14} aria-hidden="true" /> Retry</button>
        </div>
      )}

      {/* Static-reference disclosure */}
      <div className="card border border-amber-500/40 flex items-start gap-3">
        <Info size={18} className="mt-0.5 shrink-0 text-amber-500" aria-hidden="true" />
        <p className="text-sm text-[var(--text-secondary)] leading-relaxed">
          <span className="font-semibold text-[var(--text-primary)]">Benchmarks are a static industry reference, not live data.</span>{' '}
          The world class, good, average and poor thresholds are fixed heavy-fleet standards used to rate your
          fleet&apos;s measured KPIs. The radar&apos;s other rings are those reference targets, not measured competitors.
          A KPI with no measurable data reads Not measured and is left out of the overall score.
        </p>
      </div>

      {measured?.mixedCurrency && (
        <div className="card border border-amber-500/40 flex items-start gap-3" role="status">
          <AlertTriangle size={18} className="mt-0.5 shrink-0 text-amber-500" aria-hidden="true" />
          <p className="text-sm text-[var(--text-secondary)]">
            The records in scope span more than one country, and each country reports cost in its own currency.
            CPK and brand CPK are withheld. Pick one country to benchmark cost.
          </p>
        </div>
      )}

      {loading && !loaded && (
        <div className="space-y-4" role="status" aria-label="Loading benchmark data">
          <div className="card h-32 animate-pulse" />
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">{[0, 1, 2].map((i) => <div key={i} className="card h-40 animate-pulse" />)}</div>
        </div>
      )}

      {loaded && !hasData && !failedFirstLoad && (
        <div className="card text-center py-16">
          <Target size={40} className="mx-auto text-[var(--text-muted)] mb-3" aria-hidden="true" />
          <p className="text-[var(--text-primary)] font-medium">No tyre records in the selected period and site.</p>
          <p className="text-sm text-[var(--text-muted)] mt-1">Widen the period or choose another site.</p>
        </div>
      )}

      {hasData && (
        <>
          {/* Overall score + KPI strip */}
          <div className="card">
            <div className="flex flex-col lg:flex-row items-start lg:items-center gap-6">
              <div className="text-center min-w-40">
                <div className={`text-5xl font-bold tabular-nums ${TONE_TEXT[overallTone]}`}>
                  {overallScore == null ? 'N/A' : overallScore.toFixed(0)}{overallScore != null && <span className="text-2xl">/100</span>}
                </div>
                <div className="text-[var(--text-muted)] text-sm mt-1">Overall score</div>
                <div className="text-[11px] text-[var(--text-muted)]">{measuredCount} of {benchmarked.length} KPIs measured</div>
                <div className="mt-3 h-3 bg-[var(--input-bg)] rounded-full overflow-hidden w-36 mx-auto" aria-hidden="true">
                  <div className={`h-full rounded-full transition-all duration-700 ${TONE_BAR[overallTone]}`} style={{ width: `${overallScore ?? 0}%` }} />
                </div>
              </div>
              <div className="flex-1 w-full grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
                {benchmarked.map((m) => (
                  <div key={m.key} className="rounded-xl p-3 text-center bg-[var(--input-bg)] border border-[var(--input-border)]" title={m.basis}>
                    <div className="text-xs text-[var(--text-muted)] mb-1 truncate">{m.label.replace('Average ', 'Avg ')}</div>
                    <div className={`text-lg font-bold tabular-nums ${TONE_TEXT[m.rating.tone]}`}>{fmt(m.key, m.value)}</div>
                    <div className={`text-xs mt-1 ${TONE_TEXT[m.rating.tone]}`}>{m.rating.rating}</div>
                    <div className="mt-1.5 h-1 bg-[var(--input-border)] rounded-full overflow-hidden" aria-hidden="true">
                      <div className={`h-full ${TONE_BAR[scoreTone(m.rating.score)]}`} style={{ width: `${m.rating.score ?? 0}%` }} />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Detailed benchmark cards */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {benchmarked.map((m) => (
              <div key={m.key} className="card">
                <div className="flex items-start justify-between gap-2 mb-3">
                  <div>
                    <h3 className="text-[var(--text-primary)] font-semibold text-sm">{m.label}</h3>
                    <p className="text-[var(--text-muted)] text-xs mt-0.5">{m.description}</p>
                  </div>
                  <span className={`inline-block shrink-0 px-2 py-1 rounded-full text-xs font-medium border ${TONE_CHIP[m.rating.tone]}`}>{m.rating.rating}</span>
                </div>
                <div className="flex flex-wrap items-end gap-2 mb-1">
                  <span className={`text-3xl font-bold tabular-nums ${TONE_TEXT[m.rating.tone]}`}>{fmt(m.key, m.value)}</span>
                  <DeltaBadge row={m} />
                </div>
                <p className="text-[11px] text-[var(--text-muted)] mb-3">Based on {m.basis}</p>
                <dl className="space-y-1.5 text-xs">
                  {[
                    ['World class', m.world_class, 'text-green-500'],
                    ['Good', m.good, 'text-blue-500'],
                    ['Average', m.average, 'text-yellow-600 dark:text-yellow-400'],
                    ['Poor', m.poor, 'text-red-500'],
                  ].map(([label, value, color]) => (
                    <div key={label} className="flex justify-between">
                      <dt className="text-[var(--text-muted)]">{label}</dt>
                      <dd className={color}>{fmt(m.key, value)}</dd>
                    </div>
                  ))}
                </dl>
              </div>
            ))}
          </div>

          {/* Benchmark table */}
          <section className="space-y-2">
            <h2 className="text-sm font-semibold text-[var(--text-primary)] flex items-center gap-2"><Gauge size={15} aria-hidden="true" /> Benchmark table</h2>
            <EnterpriseTable
              columns={kpiColumns}
              data={benchmarked}
              getRowId={(m) => m.key}
              enableGlobalFilter={false}
              enableColumnFilters={false}
              initialPageSize={25}
              pageSizeOptions={[25]}
              exportFileName={reportFileName('Performance Benchmark KPIs', reportDateLabel())}
              reportMeta={{ title: 'Fleet performance benchmarks', company: appSettings?.company_name, currency: activeCurrency, dateRange: scopeLabel }}
              emptyMessage="No KPI could be measured for this scope."
            />
          </section>

          {/* Charts */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <div className="card">
              <h3 className="text-[var(--text-primary)] font-semibold mb-4">Fleet against the reference (score out of 100)</h3>
              <div className="h-72" role="img" aria-label={`Radar of ${measuredCount} measured KPI scores against the industry average and world class rings`}>
                {radarData ? (
                  <Radar data={radarData} options={{
                    responsive: true, maintainAspectRatio: false,
                    plugins: { legend: { labels: { color: 'var(--text-secondary)', boxWidth: 10, font: { size: 10 } } }, tooltip: CHART_OPTS.plugins.tooltip },
                    scales: { r: { ticks: { color: 'var(--text-muted)', backdropColor: 'transparent', font: { size: 9 } }, grid: { color: 'var(--panel-2)' }, pointLabels: { color: 'var(--text-secondary)', font: { size: 10 } }, suggestedMin: 0, suggestedMax: 100 } },
                  }} />
                ) : <p className="h-full flex items-center justify-center text-sm text-[var(--text-muted)]">No KPI could be measured for this scope.</p>}
              </div>
            </div>
            <div className="card">
              <h3 className="text-[var(--text-primary)] font-semibold mb-4">CPK against the reference</h3>
              <div className="h-72" role="img" aria-label="CPK of your fleet against the world class, good, average and poor thresholds">
                {cpkBarData
                  ? <Bar data={cpkBarData} options={{ ...CHART_OPTS, plugins: { ...CHART_OPTS.plugins, legend: { display: false } } }} />
                  : <p className="h-full flex items-center justify-center text-sm text-[var(--text-muted)] text-center px-6">{measured.mixedCurrency ? 'CPK is withheld while more than one currency is in scope.' : 'Not measured: no tyre carries both a cost and a distance.'}</p>}
              </div>
            </div>
          </div>

          {/* Brand benchmarking */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <div className="card">
              <h3 className="text-[var(--text-primary)] font-semibold mb-4">Brand CPK against the Good benchmark</h3>
              <div className="h-64" role="img" aria-label="Brand CPK bars against the Good benchmark line">
                {brandCpkData
                  ? <Bar data={brandCpkData} options={{ ...CHART_OPTS, plugins: { ...CHART_OPTS.plugins, legend: { labels: { color: 'var(--text-secondary)', boxWidth: 10, font: { size: 10 } } } } }} />
                  : <p className="h-full flex items-center justify-center text-sm text-[var(--text-muted)] text-center px-6">{measured.mixedCurrency ? 'Brand CPK is withheld while more than one currency is in scope.' : 'No brand has three or more tyres with cost and distance.'}</p>}
              </div>
            </div>
            <section className="space-y-2">
              <h3 className="text-[var(--text-primary)] font-semibold flex items-center gap-2"><Layers size={15} aria-hidden="true" /> Brand scorecard</h3>
              <EnterpriseTable
                columns={brandColumns}
                data={brandBench}
                getRowId={(b) => b.brand}
                enableColumnFilters={false}
                searchPlaceholder="Search brand"
                initialPageSize={25}
                exportFileName={reportFileName('Brand CPK Scorecard', reportDateLabel())}
                reportMeta={{ title: 'Brand CPK scorecard', company: appSettings?.company_name, currency: activeCurrency, dateRange: scopeLabel }}
                emptyMessage={measured.mixedCurrency ? 'Brand CPK is withheld while more than one currency is in scope.' : 'No brand has three or more tyres with cost and distance.'}
              />
            </section>
          </div>

          {/* Improvement recommendations */}
          <div className="card">
            <h3 className="text-[var(--text-primary)] font-semibold mb-4">Improvement recommendations</h3>
            {targets.length === 0 ? (
              <div className="text-center py-8">
                <CheckCircle size={32} className="mx-auto text-green-500 mb-2" aria-hidden="true" />
                <p className="text-green-600 dark:text-green-400 font-medium">
                  {measuredCount ? 'Every measured KPI is at or above the Good benchmark.' : 'No KPI could be measured, so there is nothing to recommend yet.'}
                </p>
                {measuredCount > 0 && <p className="text-[var(--text-muted)] text-sm mt-1">Keep current standards and aim for World class.</p>}
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {targets.map((m) => (
                  <div key={m.key} className="rounded-xl p-4 border border-[var(--input-border)] border-l-4 border-l-orange-500 bg-[var(--input-bg)]">
                    <div className="flex items-start gap-2 mb-2">
                      <AlertTriangle size={16} className="text-orange-500 flex-shrink-0 mt-0.5" aria-hidden="true" />
                      <div>
                        <p className="text-[var(--text-primary)] text-sm font-medium">{m.label} <span className="text-xs text-[var(--text-muted)]">({m.rating.rating})</span></p>
                        <p className="text-[var(--text-muted)] text-xs mt-0.5">Current {fmt(m.key, m.value)}, target {fmt(m.key, m.good)}</p>
                      </div>
                    </div>
                    <p className="text-[var(--text-secondary)] text-xs leading-relaxed">{RECOMMENDATIONS[m.key]}</p>
                  </div>
                ))}
              </div>
            )}
            {benchmarked.some((m) => m.rating.score == null) && (
              <p className="text-[11px] text-[var(--text-muted)] mt-3">
                Not measured: {benchmarked.filter((m) => m.rating.score == null).map((m) => m.label).join(', ')}. Capture the underlying data to benchmark these.
              </p>
            )}
          </div>
        </>
      )}
    </div>
  )
}
