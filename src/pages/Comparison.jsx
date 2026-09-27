import { useState, useMemo, useEffect } from 'react'
import { useLanguage } from '../contexts/LanguageContext'
import { useSettings } from '../contexts/SettingsContext'
import { supabase } from '../lib/supabase'
import { Bar } from 'react-chartjs-2'
import {
  Chart as ChartJS, CategoryScale, LinearScale, BarElement,
  Title, Tooltip, Legend,
} from 'chart.js'
import { exportToPdf, exportToExcel, reportFileName, reportDateLabel } from '../lib/exportUtils'
import { formatCurrencyCompact } from '../lib/formatters'
import { fetchAllPages } from '../lib/fetchAll'
import { toUserMessage } from '../lib/safeError'
import { colorAt, withAlpha } from '../lib/reportColors'
import {
  MONTHS, MOVEMENTS, buildComparison, filterRows, formatPct, periodText, comparisonExportRows,
} from '../lib/comparisonAnalytics'
import {
  GitCompare, Download, FileText, TrendingUp, TrendingDown,
  ArrowUpRight, ArrowDownRight, BarChart2, RefreshCw, AlertTriangle, Search, X, Info,
} from 'lucide-react'
import PageHeader from '../components/ui/PageHeader'
import SegmentedControl from '../components/ui/SegmentedControl'
import EnterpriseTable from '../components/ui/EnterpriseTable'
import { useReportMeta } from '../hooks/useReportMeta'

ChartJS.register(CategoryScale, LinearScale, BarElement, Title, Tooltip, Legend)

// ── Constants ──────────────────────────────────────────────────────────────────
const now    = new Date()
const YEARS  = Array.from({ length: 6 }, (_, i) => now.getFullYear() - i)
const ROW_CAP = 50000

const CHART_OPTS = {
  responsive: true,
  maintainAspectRatio: false,
  plugins: {
    legend: { labels: { color: 'var(--text-muted)', boxWidth: 10, padding: 12 } },
    tooltip: { backgroundColor: 'var(--panel-2)', titleColor:'var(--panel-ink)', bodyColor: 'var(--text-muted)', borderColor: 'var(--hairline)', borderWidth: 1, padding: 10 },
  },
  scales: {
    x: { ticks: { color: 'var(--text-muted)', font: { size: 11 } }, grid: { color: 'var(--panel-2)' } },
    y: { ticks: { color: 'var(--text-muted)', font: { size: 11 } }, grid: { color: 'var(--panel-2)' } },
  },
}

const DIMENSION_OPTS = [
  { value: 'overall',  label: 'Overall'    },
  { value: 'site',     label: 'By Site'    },
  { value: 'brand',    label: 'By Brand'   },
]

const MOVEMENT_TONE = {
  Up: 'text-red-400',
  Down: 'text-green-400',
  New: 'text-amber-400',
  Stopped: 'text-sky-400',
  Flat: 'text-[var(--text-muted)]',
}

// ── Helpers ────────────────────────────────────────────────────────────────────
function DeltaBadge({ diff, pct, move, isGoodWhenDown = true }) {
  if (diff === 0) return <span className="text-[var(--text-muted)] font-medium">No change</span>
  if (pct == null) return <span className={`font-semibold text-xs ${MOVEMENT_TONE[move] || ''}`}>{move}</span>
  const improve = isGoodWhenDown ? diff < 0 : diff > 0
  const Icon = diff > 0 ? ArrowUpRight : ArrowDownRight
  return (
    <span className={`inline-flex items-center gap-0.5 font-semibold text-xs ${improve ? 'text-green-400' : 'text-red-400'}`}>
      <Icon size={12} aria-hidden="true" />
      {formatPct(pct)}
    </span>
  )
}

function Kpi({ label, value, sub, tone }) {
  return (
    <div className="card !p-4 min-w-0">
      <p className="text-[11px] text-[var(--text-muted)] font-semibold uppercase tracking-wider truncate">{label}</p>
      <p className={`text-2xl font-bold mt-1 tabular-nums truncate ${tone || 'text-[var(--text-primary)]'}`}>{value}</p>
      {sub && <p className="text-xs text-[var(--text-muted)] mt-0.5 truncate" title={sub}>{sub}</p>}
    </div>
  )
}

// ── Period Picker ──────────────────────────────────────────────────────────────
function PeriodPicker({ label, period, setPeriod, accentBg, accentText, accentBorder }) {
  const { t } = useLanguage()
  function toggleMonth(m) {
    setPeriod(p => ({
      ...p,
      months: p.months.includes(m)
        ? p.months.filter(x => x !== m)
        : [...p.months, m].sort((a, b) => a - b),
    }))
  }

  return (
    <div className={`card border ${accentBorder}`}>
      <div className="flex items-center justify-between mb-3">
        <span className={`font-semibold text-sm ${accentText}`}>{label}</span>
        <select
          className="input w-24 text-sm min-h-[40px]"
          value={period.year}
          aria-label={`${label} year`}
          onChange={e => setPeriod(p => ({ ...p, year: parseInt(e.target.value, 10) }))}
        >
          {YEARS.map(y => <option key={y} value={y}>{y}</option>)}
        </select>
      </div>

      <div className="grid grid-cols-3 sm:grid-cols-4 gap-1.5" role="group" aria-label={`${label} months`}>
        {MONTHS.map((m, i) => (
          <button key={m}
            type="button"
            onClick={() => toggleMonth(i)}
            aria-pressed={period.months.includes(i)}
            className={`min-h-[40px] rounded-md text-xs font-medium border transition-all ${
              period.months.includes(i)
                ? `${accentBg} ${accentText} ${accentBorder}`
                : 'bg-[var(--input-bg)] text-[var(--text-muted)] border-[var(--input-border)] hover:text-[var(--text-primary)]'
            }`}
          >{m}</button>
        ))}
      </div>

      <div className="flex items-center justify-between mt-2 gap-2">
        <p className="text-xs text-[var(--text-muted)]">
          {period.months.length > 0
            ? period.months.map(m => MONTHS[m]).join(', ') + ' ' + period.year
            : t('comparison.noMonthsSelected')}
        </p>
        <div className="flex gap-1">
          <button type="button" onClick={() => setPeriod(p => ({ ...p, months: [0,1,2,3,4,5,6,7,8,9,10,11] }))}
            className="text-xs text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors min-h-[36px] px-2">{t('comparison.all')}</button>
          <button type="button" onClick={() => setPeriod(p => ({ ...p, months: [] }))}
            className="text-xs text-[var(--text-muted)] hover:text-red-400 transition-colors min-h-[36px] px-2">{t('comparison.clear')}</button>
        </div>
      </div>
    </div>
  )
}

// ── Main ───────────────────────────────────────────────────────────────────────
export default function Comparison() {
  const reportMeta = useReportMeta('Comparison')
  const { t } = useLanguage()
  const { activeCountry, activeCurrency } = useSettings()

  const [periodA, setPeriodA] = useState({ months: [0,1,2,3,4,5,6,7,8,9,10,11], year: now.getFullYear() - 1 })
  const [periodB, setPeriodB] = useState({ months: [0,1,2,3,4,5,6,7,8,9,10,11], year: now.getFullYear() })
  const [metric, setMetric]   = useState('count')
  const [dimension, setDimension] = useState('overall')
  const [records, setRecords] = useState([])
  const [loading, setLoading] = useState(false)
  const [ran, setRan]         = useState(false)
  const [error, setError]     = useState(null)
  const [capped, setCapped]   = useState(false)
  const [search, setSearch]   = useState('')
  const [moveFilter, setMoveFilter] = useState('all')

  // The fetched dataset is scoped to activeCountry at query time. If the admin
  // switches active country after running, the on-screen comparison no longer
  // matches the selected scope — reset to the configure state so the user re-runs
  // against the correct country rather than reading stale, mis-scoped figures.
  useEffect(() => {
    setRan(false)
    setRecords([])
    setError(null)
    setCapped(false)
  }, [activeCountry])

  async function runComparison() {
    if (periodA.months.length === 0 || periodB.months.length === 0) return
    setLoading(true)
    setError(null)
    const minYear = Math.min(periodA.year, periodB.year)
    const maxYear = Math.max(periodA.year, periodB.year)
    // Fetch qty so cost math matches recordCost() (cost_per_tyre × qty) used
    // across the rest of the app; scope by activeCountry to stay consistent with
    // Country/Brand/Site pages and respect the admin's active-country filter.
    const { data, error: fetchErr, truncated } = await fetchAllPages((from, to) => {
      let q = supabase
        .from('tyre_records')
        .select('issue_date, cost_per_tyre, qty, site, brand')
        .gte('issue_date', `${minYear}-01-01`)
        .lte('issue_date', `${maxYear}-12-31`)
        .order('issue_date', { ascending: false })
        .order('id', { ascending: false })
      if (activeCountry !== 'All') q = q.eq('country', activeCountry)
      return q.range(from, to)
    }, { max: ROW_CAP })
    if (fetchErr) {
      setError(toUserMessage(fetchErr, 'Failed to load comparison data.'))
      setRecords([])
      setCapped(false)
      setRan(true)
      setLoading(false)
      return
    }
    setRecords(data ?? [])
    setCapped(Boolean(truncated))
    setRan(true)
    setLoading(false)
  }

  // ── Computed ───────────────────────────────────────────────────────────────────
  const report = useMemo(
    () => (ran ? buildComparison(records, { periodA, periodB, metric, dimension }) : null),
    [ran, records, periodA, periodB, metric, dimension],
  )
  const visibleRows = useMemo(
    () => (report ? filterRows(report.rows, { search, movement: moveFilter }) : []),
    [report, search, moveFilter],
  )
  const fmtVal = (v) => (metric === 'cost' ? formatCurrencyCompact(v, activeCurrency) : Number(v).toLocaleString())
  const labelHeader = dimension === 'overall' ? t('comparison.table.month') : dimension === 'site' ? t('comparison.table.site') : t('comparison.table.brand')
  const filtersActive = Boolean(search) || moveFilter !== 'all'

  const chartData = useMemo(() => {
    if (!report || !report.rows.length) return null
    const rows = visibleRows.slice(0, dimension === 'overall' ? 12 : 15)
    const ca = colorAt(0)
    const cb = colorAt(1)
    return {
      labels: rows.map(r => r.label),
      datasets: [
        { label: `Period A - ${periodA.year}`, data: rows.map(r => r.a), backgroundColor: withAlpha(ca, 0.7), borderColor: ca, borderWidth: 1, borderRadius: 4 },
        { label: `Period B - ${periodB.year}`, data: rows.map(r => r.b), backgroundColor: withAlpha(cb, 0.7), borderColor: cb, borderWidth: 1, borderRadius: 4 },
      ],
    }
  }, [report, visibleRows, dimension, periodA.year, periodB.year])

  const insight = useMemo(() => {
    if (!report || report.totals.a === 0) return ''
    const { totals } = report
    if (dimension === 'overall') {
      const label = metric === 'count' ? t('comparison.summary.replacements') : t('comparison.insight.spend')
      return t('comparison.insight.overall', {
        pct: Math.abs(totals.pct ?? 0),
        direction: totals.diff >= 0 ? t('comparison.insight.more') : t('comparison.insight.less'),
        label,
        sign: totals.diff >= 0 ? '+' : '',
        amount: fmtVal(totals.diff),
        arrow: totals.diff >= 0 ? '▲' : '▼',
      })
    }
    return t('comparison.insight.byDimension', {
      count: report.rows.length,
      dimLabel: dimension === 'site' ? t('comparison.insight.sites') : t('comparison.insight.brands'),
      pct: Math.abs(totals.pct ?? 0),
      direction: totals.diff >= 0 ? t('comparison.insight.increase') : t('comparison.insight.decrease'),
    })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [report, dimension, metric, t, activeCurrency])

  // ── Exports ────────────────────────────────────────────────────────────────────
  const fileBase = reportFileName('TyrePulse Comparison', periodA.year, 'vs', periodB.year, reportDateLabel())
  const scopeNote = `A: ${periodText(periodA)} | B: ${periodText(periodB)} | ${metric === 'cost' ? `Cost (${activeCurrency})` : 'Replacements'}${activeCountry !== 'All' ? ` | ${activeCountry}` : ''}${filtersActive ? ' | filtered' : ''}`

  function doExcelExport() {
    exportToExcel(
      comparisonExportRows(visibleRows),
      ['label','period_a','period_b','difference','pct_change','movement'],
      [labelHeader, `Period A (${periodA.year})`, `Period B (${periodB.year})`, 'Difference', '% Change', 'Movement'],
      fileBase
    )
  }

  function doPdfExport() {
    exportToPdf(
      comparisonExportRows(visibleRows),
      [
        { key: 'label',      header: labelHeader },
        { key: 'period_a',   header: `Period A (${periodA.year})` },
        { key: 'period_b',   header: `Period B (${periodB.year})` },
        { key: 'difference', header: 'Difference' },
        { key: 'pct_change', header: '% Change' },
        { key: 'movement',   header: 'Movement' },
      ],
      'Period Comparison Report',
      fileBase,
      'landscape',
      '',
      { subtitleNote: scopeNote }
    )
  }

  const compColumns = useMemo(() => [
    {
      id: 'label', header: labelHeader, accessorFn: r => (dimension === 'overall' ? r.order : r.label), size: 160,
      cell: ({ row }) => <span className="font-medium text-[var(--text-primary)]">{row.original.label}</span>,
    },
    {
      id: 'a', header: t('comparison.periodAYear', { year: periodA.year }), accessorFn: r => r.a, size: 120, meta: { align: 'right' },
      cell: ({ row }) => <span className="text-[var(--text-secondary)] tabular-nums">{fmtVal(row.original.a)}</span>,
    },
    {
      id: 'b', header: t('comparison.periodBYear', { year: periodB.year }), accessorFn: r => r.b, size: 120, meta: { align: 'right' },
      cell: ({ row }) => <span className="text-[var(--text-secondary)] tabular-nums">{fmtVal(row.original.b)}</span>,
    },
    {
      id: 'diff', header: t('comparison.table.difference'), accessorFn: r => r.diff, size: 120, meta: { align: 'right' },
      cell: ({ getValue }) => {
        const val = getValue()
        const color = val > 0 ? 'text-red-400' : val < 0 ? 'text-green-400' : 'text-[var(--text-muted)]'
        return <span className={`font-semibold tabular-nums ${color}`}>{val > 0 ? '+' : ''}{fmtVal(val)}</span>
      },
    },
    {
      id: 'pct', header: t('comparison.table.pctChange'), accessorFn: r => r.pct ?? Number.NEGATIVE_INFINITY, size: 110,
      cell: ({ row }) => <DeltaBadge diff={row.original.diff} pct={row.original.pct} move={row.original.movement} />,
    },
    {
      id: 'movement', header: 'Movement', accessorFn: r => r.movement, size: 100,
      cell: ({ getValue }) => <span className={`text-xs font-semibold ${MOVEMENT_TONE[getValue()] || ''}`}>{getValue()}</span>,
    },
    {
      id: 'share', header: 'Share of B', accessorFn: r => r.shareB ?? -1, size: 100, meta: { align: 'right' },
      cell: ({ row }) => (row.original.shareB == null ? 'N/A' : `${row.original.shareB.toFixed(1)}%`),
    },
  // eslint-disable-next-line react-hooks/exhaustive-deps
  ], [labelHeader, dimension, periodA.year, periodB.year, metric, activeCurrency, t])

  const canRun = periodA.months.length > 0 && periodB.months.length > 0
  const totals = report?.totals

  return (
    <div className="space-y-5">
      <PageHeader
        title={t('comparison.title')}
        subtitle={t('comparison.subtitle')}
        icon={GitCompare}
        actions={report && report.rows.length > 0 ? (
          <div className="flex gap-2 flex-wrap">
            <button type="button" onClick={doExcelExport} disabled={!visibleRows.length} className="btn-secondary flex items-center gap-1.5 text-sm px-3 min-h-[44px] disabled:opacity-40">
              <Download size={14} aria-hidden="true" /> {t('comparison.actions.excel')}
            </button>
            <button type="button" onClick={doPdfExport} disabled={!visibleRows.length} className="btn-secondary flex items-center gap-1.5 text-sm px-3 min-h-[44px] disabled:opacity-40">
              <FileText size={14} aria-hidden="true" /> {t('comparison.actions.pdf')}
            </button>
          </div>
        ) : null}
      />

      {/* Period selectors */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <PeriodPicker
          label={t('comparison.periodA')}
          period={periodA} setPeriod={setPeriodA}
          accentBg="bg-green-900/40" accentText="text-green-400" accentBorder="border-green-700/50"
        />
        <PeriodPicker
          label={t('comparison.periodB')}
          period={periodB} setPeriod={setPeriodB}
          accentBg="bg-blue-900/40" accentText="text-blue-400" accentBorder="border-blue-700/50"
        />
      </div>

      {/* Options + run */}
      <div className="flex items-center gap-3 flex-wrap">
        <SegmentedControl
          ariaLabel={t('comparison.metric.ariaLabel')}
          size="sm"
          value={metric}
          onChange={setMetric}
          options={[
            { value: 'count', label: t('comparison.metric.replacements') },
            { value: 'cost', label: t('comparison.metric.cost', { currency: activeCurrency }) },
          ]}
        />
        <SegmentedControl
          ariaLabel={t('comparison.dimension.ariaLabel')}
          size="sm"
          value={dimension}
          onChange={(v) => { setDimension(v); setSearch(''); setMoveFilter('all') }}
          options={DIMENSION_OPTS.map(o => ({ ...o, label: t(`comparison.dimension.${o.value}`) }))}
        />
        <button
          type="button"
          onClick={runComparison}
          disabled={loading || !canRun}
          className="btn-primary px-6 min-h-[44px] flex items-center gap-2 disabled:opacity-50"
        >
          <RefreshCw size={14} className={loading ? 'animate-spin' : ''} aria-hidden="true" />
          {loading ? t('comparison.run.running') : ran ? t('comparison.run.rerun') : t('comparison.run.run')}
        </button>
        {!canRun && (
          <p className="text-xs text-amber-500" role="status">{t('comparison.run.selectMonthWarning')}</p>
        )}
      </div>

      {loading && !ran && (
        <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3" aria-busy="true">
          {Array.from({ length: 6 }).map((_, i) => <div key={i} className="h-[88px] rounded-xl bg-[var(--input-bg)] animate-pulse" />)}
        </div>
      )}

      {ran && error && (
        <div role="alert" className="card flex flex-col items-center justify-center py-14 text-center">
          <AlertTriangle size={36} className="text-red-400 mb-3" aria-hidden="true" />
          <p className="text-[var(--text-primary)] font-medium">Comparison data could not be loaded</p>
          <p className="text-[var(--text-muted)] text-sm mt-1">{error}</p>
          <button
            type="button"
            onClick={runComparison}
            disabled={loading || !canRun}
            className="btn-secondary mt-4 inline-flex items-center gap-2 px-4 min-h-[44px] text-sm disabled:opacity-50"
          >
            <RefreshCw size={16} className={loading ? 'animate-spin' : ''} aria-hidden="true" /> Retry
          </button>
        </div>
      )}

      {ran && !error && report && report.rows.length > 0 && (
        <>
          {capped && (
            <div role="status" className="card border border-amber-700/40 py-3 px-4 flex items-center gap-3">
              <AlertTriangle size={16} className="text-amber-400 flex-shrink-0" aria-hidden="true" />
              <p className="text-sm text-amber-400">
                Capped view: showing the most recent {ROW_CAP.toLocaleString('en-US')} tyre records in this range. Narrow the years or country for a complete comparison.
              </p>
            </div>
          )}

          <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
            <Kpi label={t('comparison.periodALabel', { year: periodA.year })} value={fmtVal(totals.a)} sub={`${report.recordsA.toLocaleString()} tyre records`} />
            <Kpi label={t('comparison.periodBLabel', { year: periodB.year })} value={fmtVal(totals.b)} sub={`${report.recordsB.toLocaleString()} tyre records`} />
            <Kpi
              label={t('comparison.summary.change')}
              value={`${totals.diff > 0 ? '+' : ''}${fmtVal(totals.diff)}`}
              sub={totals.pct == null ? 'No Period A base to compare' : `${formatPct(totals.pct)} vs Period A`}
              tone={totals.diff === 0 ? 'text-[var(--text-muted)]' : totals.diff > 0 ? 'text-red-400' : 'text-green-400'}
            />
            <Kpi
              label={dimension === 'overall' ? 'Months up / down' : `${dimension === 'site' ? 'Sites' : 'Brands'} up / down`}
              value={`${report.up} / ${report.down}`}
              sub={`${report.added} new, ${report.stopped} stopped`}
            />
            <Kpi
              label="Biggest rise"
              value={report.biggestRiser ? report.biggestRiser.label : 'None'}
              sub={report.biggestRiser ? `+${fmtVal(report.biggestRiser.diff)}` : 'Nothing grew'}
            />
            <Kpi
              label="Biggest fall"
              value={report.biggestFaller ? report.biggestFaller.label : 'None'}
              sub={report.biggestFaller ? fmtVal(report.biggestFaller.diff) : 'Nothing fell'}
            />
          </div>

          {metric === 'cost' && (
            <p className="text-xs text-[var(--text-muted)] flex items-start gap-1.5">
              <Info size={12} className="mt-0.5 shrink-0" aria-hidden="true" />
              <span>
                Priced records: Period A {report.pricedPctA == null ? 'N/A' : `${report.pricedPctA}%`}, Period B {report.pricedPctB == null ? 'N/A' : `${report.pricedPctB}%`}.
                Average price per priced tyre: A {report.avgCostA == null ? 'N/A' : formatCurrencyCompact(report.avgCostA, activeCurrency)}, B {report.avgCostB == null ? 'N/A' : formatCurrencyCompact(report.avgCostB, activeCurrency)}.
                An unpriced tyre adds no money, so a low figure can mean missing prices rather than low spend.
              </span>
            </p>
          )}

          {insight && (
            <div className="card py-3 px-4 flex items-center gap-3">
              {totals?.diff < 0 ? <TrendingDown size={16} className="text-green-400 flex-shrink-0" aria-hidden="true" /> : <TrendingUp size={16} className="text-red-400 flex-shrink-0" aria-hidden="true" />}
              <p className="text-sm text-[var(--text-secondary)]">{insight}</p>
            </div>
          )}

          {chartData && (
            <div className="card">
              <div className="flex items-center gap-2 mb-4">
                <BarChart2 size={15} className="text-[var(--text-muted)]" aria-hidden="true" />
                <h3 className="text-base font-semibold text-[var(--text-primary)]">
                  {metric === 'count' ? t('comparison.chart.replacements') : t('comparison.chart.cost', { currency: activeCurrency })}
                  {dimension !== 'overall' ? (dimension === 'site' ? t('comparison.chart.bySite') : t('comparison.chart.byBrand')) : t('comparison.chart.byMonth')}
                </h3>
              </div>
              <div style={{ height: 300 }} role="img" aria-label={`Period A ${fmtVal(totals.a)} vs Period B ${fmtVal(totals.b)}`}>
                <Bar data={chartData} options={CHART_OPTS} />
              </div>
              {dimension !== 'overall' && report.rows.length > 15 && (
                <p className="text-[11px] text-[var(--text-muted)] mt-2">The chart shows the 15 largest movements; the table below lists all {report.rows.length}.</p>
              )}
            </div>
          )}

          <div className="card space-y-3">
            <div className="flex flex-wrap items-center gap-2">
              <div className="relative flex-1 min-w-[200px] max-w-xs">
                <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" aria-hidden="true" />
                <input className="input pl-8 text-sm min-h-[44px]" placeholder={`Search ${labelHeader.toLowerCase()}`} value={search}
                  onChange={e => setSearch(e.target.value)} aria-label={`Search ${labelHeader}`} />
              </div>
              <select className="input text-sm w-auto min-h-[44px]" value={moveFilter} onChange={e => setMoveFilter(e.target.value)} aria-label="Filter by movement">
                <option value="all">All movements</option>
                {MOVEMENTS.map(m => <option key={m} value={m}>{m}</option>)}
              </select>
              {filtersActive && (
                <button type="button" onClick={() => { setSearch(''); setMoveFilter('all') }} className="text-xs text-[var(--text-secondary)] hover:text-[var(--text-primary)] inline-flex items-center gap-1 min-h-[44px] px-2">
                  <X size={12} aria-hidden="true" /> Clear
                </button>
              )}
              <span className="ml-auto text-xs text-[var(--text-muted)]">{visibleRows.length} of {report.rows.length} rows</span>
            </div>
            <EnterpriseTable
              reportMeta={reportMeta}
              columns={compColumns}
              data={visibleRows}
              getRowId={r => String(r.label)}
              enableGlobalFilter={false}
              enableColumnFilters={false}
              enableSorting={true}
              enableExport={false}
              initialPageSize={25}
              resetPageKey={`${search}|${moveFilter}|${dimension}|${metric}`}
              emptyMessage="No rows match these filters."
            />
            <p className="text-xs text-[var(--text-muted)]">
              Totals: Period A {fmtVal(totals.a)}, Period B {fmtVal(totals.b)}, change {totals.diff > 0 ? '+' : ''}{fmtVal(totals.diff)} ({formatPct(totals.pct)}).
              A % change from a zero base is shown as New rather than a made-up percentage.
            </p>
          </div>
        </>
      )}

      {ran && !error && report && report.rows.length === 0 && (
        <div className="card text-center py-14">
          <GitCompare size={36} className="text-[var(--text-dim)] mx-auto mb-3" aria-hidden="true" />
          <p className="text-[var(--text-secondary)] font-medium">{t('comparison.empty.noData')}</p>
          <p className="text-[var(--text-muted)] text-sm mt-1">{t('comparison.empty.noDataHint')}</p>
        </div>
      )}

      {!ran && !loading && (
        <div className="card text-center py-14">
          <GitCompare size={36} className="text-[var(--text-dim)] mx-auto mb-3" aria-hidden="true" />
          <p className="text-[var(--text-secondary)] font-medium">{t('comparison.empty.configureTitle')}</p>
          <p className="text-[var(--text-muted)] text-sm mt-1">{t('comparison.empty.configureHint')}</p>
        </div>
      )}
    </div>
  )
}
