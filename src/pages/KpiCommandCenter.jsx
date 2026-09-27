import { useState, useEffect, useMemo, useCallback } from 'react'
import useLatestRequest from '../lib/useLatestRequest'
import { motion } from 'framer-motion'
import {
  Command, TrendingUp, TrendingDown, AlertTriangle, CheckCircle, Target,
  RefreshCw, FileText, Download, Trophy, Gauge, BarChart3, Layers, Calendar,
  MapPin, AlertOctagon, ArrowUpRight, ArrowDownRight, Truck, Info,
} from 'lucide-react'
import { Bar, Line, Radar } from 'react-chartjs-2'
import {
  Chart as ChartJS, CategoryScale, LinearScale, BarElement, LineElement, PointElement,
  ArcElement, RadialLinearScale, Title, Tooltip, Legend, Filler,
} from 'chart.js'
import { useLanguage } from '../contexts/LanguageContext'
import { supabase } from '../lib/supabase'
import { fetchAllPages } from '../lib/fetchAll'
import { toUserMessage } from '../lib/safeError'
import { useSettings, COUNTRIES } from '../contexts/SettingsContext'
import { useTenant } from '../contexts/TenantContext'
import { formatDate, formatMonthYear } from '../lib/formatters'
import { resolvePdfBrand, pdfHeader, pdfFooter, pdfTableTheme, reportFileName } from '../lib/exportUtils'
import { listFilterOptions } from '../lib/api/tyreRecords'
import { compareValues } from '../lib/consoleTable'
import { colorAt, withAlpha } from '../lib/reportColors'
import PageHeader from '../components/ui/PageHeader'
import DateField from '../components/ui/DateField'
import SectionTabs, { KPI_TABS } from '../components/ui/SectionTabs'
import SegmentedControl from '../components/ui/SegmentedControl'
import EnterpriseTable from '../components/ui/EnterpriseTable'
import Modal from '../components/ui/Modal'
import { loadAutoTable } from '../lib/pdfEngine'
import {
  makeBenchmarks, KPI_KEYS, PERIOD_PRESETS, periodDates, prevPeriodDates, isoDay,
  kpiScore, ratingKey, RATING_LABEL, overallScore, extractKpiValues, pctChange,
  isImprovement, deltaVsGood, targetStatus, monthlyMatrix, siteKpiRows, vehicleRows,
  kpiAlerts, kpiSummaryExportRows, isMeasured,
} from '../lib/kpiCommandCenterAnalytics'

ChartJS.register(
  CategoryScale, LinearScale, BarElement, LineElement, PointElement, ArcElement,
  RadialLinearScale, Title, Tooltip, Legend, Filler,
)

const ICONS = {
  cpk: Gauge, tyre_life: TrendingUp, failure_rate: AlertTriangle,
  scrap_rate: AlertOctagon, pressure_compliance: CheckCircle, inspection_compliance: BarChart3,
}

// Hard ceiling on every paged tyre_records / inspections read. The per-row
// engineering KPIs have no server aggregate, so rows are read and computed
// client-side over a SERVER-SIDE country + period window plus this ceiling. A
// truncated read is surfaced as a capped-view note.
const ROW_CAP = 50000
const TOUCH = 'min-h-[44px]'

const RATING_STYLE = {
  worldClass:  { color: 'text-emerald-400', bg: 'bg-emerald-900/30 border-emerald-700', dot: 'bg-emerald-400' },
  good:        { color: 'text-blue-400', bg: 'bg-blue-900/30 border-blue-700', dot: 'bg-blue-400' },
  average:     { color: 'text-yellow-400', bg: 'bg-yellow-900/30 border-yellow-700', dot: 'bg-yellow-400' },
  poor:        { color: 'text-orange-400', bg: 'bg-orange-900/30 border-orange-700', dot: 'bg-orange-400' },
  critical:    { color: 'text-red-400', bg: 'bg-red-900/30 border-red-700', dot: 'bg-red-400' },
  notMeasured: { color: 'text-[var(--text-muted)]', bg: 'bg-[var(--surface-2)] border-[var(--border-bright)]', dot: 'bg-[var(--text-muted)]' },
}

const CELL_BG = {
  worldClass: 'bg-emerald-900/40 text-emerald-300',
  good: 'bg-blue-900/40 text-blue-300',
  average: 'bg-yellow-900/40 text-yellow-300',
  poor: 'bg-orange-900/40 text-orange-300',
  critical: 'bg-red-900/40 text-red-300',
  notMeasured: 'text-[var(--text-muted)]',
}

function scoreColor(score) {
  if (score == null) return '#94a3b8'
  if (score >= 75) return '#10b981'
  if (score >= 50) return '#f59e0b'
  if (score >= 25) return '#f97316'
  return '#ef4444'
}

function scoreTextColor(score) {
  if (score == null) return 'text-[var(--text-muted)]'
  if (score >= 75) return 'text-emerald-400'
  if (score >= 50) return 'text-yellow-400'
  if (score >= 25) return 'text-orange-400'
  return 'text-red-400'
}

function monthLabel(key) {
  if (!key) return ''
  const [y, m] = key.split('-')
  return formatMonthYear(new Date(+y, +m - 1, 1))
}

function sortNullLast(rowA, rowB, id) {
  const a = rowA.getValue(id)
  const b = rowB.getValue(id)
  const ba = a == null || a === ''
  const bb = b == null || b === ''
  if (ba && bb) return 0
  if (ba) return 1
  if (bb) return -1
  return compareValues(a, b)
}

const CHART_BASE = {
  responsive: true,
  maintainAspectRatio: false,
  plugins: {
    legend: { labels: { color: 'var(--text-secondary)', boxWidth: 10, font: { size: 10 } } },
    tooltip: {
      backgroundColor: 'var(--panel)', borderColor: 'var(--hairline)', borderWidth: 1,
      titleColor: 'var(--text-primary)', bodyColor: 'var(--text-secondary)',
    },
  },
  scales: {
    x: { ticks: { color: 'var(--text-muted)', font: { size: 10 } }, grid: { color: 'var(--panel-2)' } },
    y: { ticks: { color: 'var(--text-muted)', font: { size: 10 } }, grid: { color: 'var(--panel-2)' } },
  },
}

// ── Circular Score Gauge ──────────────────────────────────────────────────────
function FleetScoreGauge({ score, measured, total }) {
  const { t } = useLanguage()
  const r = 64
  const circ = 2 * Math.PI * r
  const arc = circ * 0.75
  const pct = score == null ? 0 : Math.min(score, 100)
  const offset = arc - (arc * pct) / 100
  const label = score == null ? 'NOT MEASURED'
    : score >= 75 ? t('kpicommand.gauge.strong') : score >= 50 ? t('kpicommand.gauge.fair')
    : score >= 25 ? t('kpicommand.gauge.weak') : t('kpicommand.gauge.critical')
  return (
    <div className="relative flex items-center justify-center" style={{ width: 180, height: 180 }}
      role="img" aria-label={score == null ? 'Overall fleet score not measured' : `Overall fleet score ${score.toFixed(0)} of 100, ${label}`}>
      <svg width="180" height="180" viewBox="0 0 180 180" className="absolute inset-0 -rotate-[135deg]" aria-hidden="true">
        <circle cx="90" cy="90" r={r} fill="none" style={{ stroke: 'var(--surface-2)' }} strokeWidth="12"
          strokeDasharray={`${arc} ${circ - arc}`} strokeLinecap="round" />
        {score != null && (
          <circle cx="90" cy="90" r={r} fill="none" stroke={scoreColor(score)} strokeWidth="12"
            strokeDasharray={`${arc - offset} ${circ - (arc - offset)}`} strokeLinecap="round"
            style={{ transition: 'stroke-dasharray 1.2s cubic-bezier(.4,0,.2,1)' }} />
        )}
      </svg>
      <div className="text-center z-10">
        <div className={`text-4xl font-bold leading-none tabular-nums ${scoreTextColor(score)}`}>
          {score == null ? 'N/A' : score.toFixed(0)}
        </div>
        <div className="text-[var(--text-muted)] text-xs mt-1">/ 100</div>
        <div className={`text-xs font-semibold mt-1 ${scoreTextColor(score)}`}>{label}</div>
        <div className="text-[10px] text-[var(--text-muted)] mt-0.5">{measured} of {total} KPIs measured</div>
      </div>
    </div>
  )
}

function Sparkline({ data, positive = true, height = 32, width = 100 }) {
  const pts0 = (data || []).filter(isMeasured)
  if (pts0.length < 2) return <div style={{ width, height }} className="opacity-30 bg-[var(--input-bg)] rounded" aria-hidden="true" />
  const min = Math.min(...pts0)
  const max = Math.max(...pts0)
  const range = max - min || 1
  const pts = pts0.map((v, i) => `${(i / (pts0.length - 1)) * width},${height - ((v - min) / range) * (height - 4) - 2}`).join(' ')
  const improving = positive ? pts0[pts0.length - 1] >= pts0[0] : pts0[pts0.length - 1] <= pts0[0]
  return (
    <svg width={width} height={height} className="overflow-visible" aria-hidden="true">
      <polyline points={pts} fill="none" stroke={improving ? '#10b981' : '#ef4444'} strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  )
}

function RatingPill({ rk }) {
  const { t } = useLanguage()
  const s = RATING_STYLE[rk]
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium border ${s.bg} ${s.color}`}>
      <span className={`w-1.5 h-1.5 rounded-full ${s.dot}`} aria-hidden="true" />
      {rk === 'notMeasured' ? RATING_LABEL.notMeasured : t(`kpicommand.ratings.${rk}`)}
    </span>
  )
}

// ── KPI Card ──────────────────────────────────────────────────────────────────
function KpiCard({ kpiKey, benchmark, value, prevValue, sparkData, target, onOpen }) {
  const { t } = useLanguage()
  const b = benchmark
  const score = kpiScore(kpiKey, value)
  const rk = ratingKey(score)
  const style = RATING_STYLE[rk]
  const Icon = ICONS[kpiKey]
  const change = pctChange(value, prevValue)
  const improving = isImprovement(kpiKey, change)
  const vsGood = deltaVsGood(kpiKey, value)
  const measured = isMeasured(value)
  const progressPct = !measured ? null : b.higherIsBetter
    ? Math.min(100, (value / b.world_class) * 100)
    : Math.min(100, (b.world_class / Math.max(value, 0.001)) * 100)
  const poorPct = b.higherIsBetter ? (b.poor / b.world_class) * 100 : (b.world_class / b.poor) * 100
  const goodPct = b.higherIsBetter ? (b.good / b.world_class) * 100 : (b.world_class / b.good) * 100

  return (
    <motion.button
      type="button"
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      onClick={onOpen}
      aria-label={`${t(`kpicommand.benchmarks.${kpiKey}.label`)}: ${b.format(value)}. Open monthly trend`}
      className="card text-left w-full hover:border-[var(--input-border)] transition-colors group focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-500"
    >
      <div className="flex items-start justify-between gap-2 mb-3">
        <div className="flex items-center gap-2 min-w-0">
          <div className={`w-8 h-8 rounded-lg flex items-center justify-center border shrink-0 ${style.bg}`}>
            <Icon size={15} className={style.color} aria-hidden="true" />
          </div>
          <div className="min-w-0">
            <p className="text-xs text-[var(--text-secondary)] leading-tight">{t(`kpicommand.benchmarks.${kpiKey}.label`)}</p>
            <p className="text-xs text-[var(--text-muted)]">{b.description}</p>
          </div>
        </div>
        <RatingPill rk={rk} />
      </div>

      <div className="flex items-end justify-between mb-3">
        <div>
          <div className={`text-3xl font-bold tabular-nums ${style.color}`}>{b.format(value)}</div>
          {change != null && (
            <div className={`flex items-center gap-1 text-xs mt-1 ${improving ? 'text-emerald-400' : 'text-red-400'}`}>
              {improving ? <ArrowUpRight size={12} aria-hidden="true" /> : <ArrowDownRight size={12} aria-hidden="true" />}
              {t('kpicommand.card.vsPrevPeriod', { pct: Math.abs(change).toFixed(1) })} {improving ? '(better)' : '(worse)'}
            </div>
          )}
        </div>
        <Sparkline data={sparkData} positive={b.higherIsBetter} />
      </div>

      <div className="space-y-1.5 mb-3">
        <div className="flex justify-between text-xs text-[var(--text-muted)]">
          <span>{t('kpicommand.bands.poor')}</span>
          <span>{t('kpicommand.bands.worldClass')}</span>
        </div>
        <div className="relative h-2 bg-[var(--input-bg)] rounded-full overflow-hidden" aria-hidden="true">
          <div className="absolute inset-0 flex">
            <div className="h-full bg-red-900/60" style={{ width: `${poorPct}%` }} />
            <div className="h-full bg-yellow-900/40" style={{ width: `${goodPct - poorPct}%` }} />
            <div className="h-full bg-emerald-900/40" style={{ flex: 1 }} />
          </div>
          {progressPct != null && (
            <div className="absolute top-0 h-full w-1 rounded-full" style={{ left: `${Math.min(progressPct, 99)}%`, backgroundColor: scoreColor(score) }} />
          )}
        </div>
        <div className="flex justify-between text-xs text-[var(--text-muted)]">
          <span>{b.format(b.poor)}</span>
          <span>{t('kpicommand.card.target', { value: b.format(target ?? b.good) })}</span>
          <span>{b.format(b.world_class)}</span>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-1 text-xs">
        <div className="bg-[var(--input-bg)] rounded-lg p-1.5 text-center">
          <div className="text-[var(--text-muted)]">{t('kpicommand.bands.good')}</div>
          <div className="text-blue-400">{b.format(b.good)}</div>
        </div>
        <div className="bg-[var(--input-bg)] rounded-lg p-1.5 text-center">
          <div className="text-[var(--text-muted)]">{t('kpicommand.bands.avg')}</div>
          <div className="text-yellow-400">{b.format(b.average)}</div>
        </div>
        <div className="bg-[var(--input-bg)] rounded-lg p-1.5 text-center">
          <div className="text-[var(--text-muted)]">{t('kpicommand.bands.vsGood')}</div>
          <div className="text-[var(--text-primary)] tabular-nums">{vsGood == null ? 'N/A' : `${vsGood > 0 ? '+' : ''}${vsGood.toFixed(1)}%`}</div>
        </div>
      </div>
      <div className="mt-3 text-xs text-[var(--text-muted)] text-center">{t('kpicommand.card.clickDrillDown')}</div>
    </motion.button>
  )
}

// ── Drill-down ────────────────────────────────────────────────────────────────
function DrillDown({ kpiKey, benchmark, matrix, onClose }) {
  const { t } = useLanguage()
  const b = benchmark
  const labels = matrix.map(d => monthLabel(d.month))
  const values = matrix.map(d => (isMeasured(d[kpiKey]) ? d[kpiKey] : null))
  const hasData = values.some(v => v != null)
  const chartData = {
    labels,
    datasets: [
      {
        label: t(`kpicommand.benchmarks.${kpiKey}.label`),
        data: values,
        borderColor: colorAt(0),
        backgroundColor: withAlpha(colorAt(0), 0.1),
        fill: true, tension: 0.35, spanGaps: true,
        pointBackgroundColor: values.map(v => scoreColor(kpiScore(kpiKey, v))),
        pointRadius: 5,
      },
      { label: t('kpicommand.bands.worldClass'), data: labels.map(() => b.world_class), borderColor: '#10b981', borderDash: [4, 4], pointRadius: 0, borderWidth: 1.5 },
      { label: t('kpicommand.bands.good'), data: labels.map(() => b.good), borderColor: '#3b82f6', borderDash: [4, 4], pointRadius: 0, borderWidth: 1.5 },
      { label: t('kpicommand.bands.average'), data: labels.map(() => b.average), borderColor: '#f59e0b', borderDash: [4, 4], pointRadius: 0, borderWidth: 1.5 },
    ],
  }
  return (
    <Modal
      open
      onClose={onClose}
      size="lg"
      title={t('kpicommand.drilldown.title', { label: t(`kpicommand.benchmarks.${kpiKey}.label`) })}
      subtitle={b.description}
    >
      {hasData ? (
        <div className="h-72">
          <Line data={chartData} role="img" aria-label={`Monthly trend of ${b.label}`}
            options={{ ...CHART_BASE, plugins: { ...CHART_BASE.plugins, tooltip: { ...CHART_BASE.plugins.tooltip, callbacks: { label: ctx => `${ctx.dataset.label}: ${b.format(ctx.raw)}` } } } }} />
        </div>
      ) : (
        <p className="text-sm text-[var(--text-muted)] py-10 text-center">Not measured in any of the last 12 months.</p>
      )}
      <div className="mt-4 grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { l: t('kpicommand.bands.worldClass'), v: b.world_class, c: 'text-emerald-400' },
          { l: t('kpicommand.bands.good'), v: b.good, c: 'text-blue-400' },
          { l: t('kpicommand.bands.average'), v: b.average, c: 'text-yellow-400' },
          { l: t('kpicommand.bands.poor'), v: b.poor, c: 'text-red-400' },
        ].map(({ l, v, c }) => (
          <div key={l} className="bg-[var(--input-bg)] rounded-lg p-3 text-center">
            <div className="text-[var(--text-muted)] text-xs mb-1">{l}</div>
            <div className={`font-semibold ${c}`}>{b.format(v)}</div>
          </div>
        ))}
      </div>
    </Modal>
  )
}

function Panel({ icon: Icon, iconClass, title, hint, right, children, id }) {
  return (
    <section aria-labelledby={id} className="card">
      <div className="flex flex-wrap items-center gap-2 mb-3">
        <Icon size={16} className={iconClass} aria-hidden="true" />
        <h3 id={id} className="text-[var(--text-primary)] font-semibold">{title}</h3>
        {hint && <span className="text-[var(--text-muted)] text-xs">{hint}</span>}
        {right && <span className="ml-auto">{right}</span>}
      </div>
      {children}
    </section>
  )
}

// ── Main Component ────────────────────────────────────────────────────────────
export default function KpiCommandCenter() {
  const { t } = useLanguage()
  const { activeCountry, activeCurrency, appSettings } = useSettings()
  const { branding } = useTenant()
  const company = branding?.legal_name || branding?.display_name || appSettings?.company_name || 'TyrePulse'
  const BENCHMARKS = useMemo(() => makeBenchmarks(activeCurrency), [activeCurrency])
  const [period, setPeriod] = useState('90d')
  const [customFrom, setCustomFrom] = useState('')
  const [customTo, setCustomTo] = useState('')
  const [site, setSite] = useState('All')
  const [country, setCountry] = useState('All')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [exportError, setExportError] = useState('')
  const [truncated, setTruncated] = useState(false)
  const [records, setRecords] = useState([])
  const [prevRecords, setPrevRecords] = useState([])
  const [inspections, setInspections] = useState([])
  const [prevInspections, setPrevInspections] = useState([])
  const [sites, setSites] = useState([])
  const [drillKpi, setDrillKpi] = useState(null)
  const [targets, setTargets] = useState({})
  const [matrix, setMatrix] = useState([])

  useEffect(() => {
    try {
      const stored = localStorage.getItem('tp_kpi_targets')
      if (stored) setTargets(JSON.parse(stored))
    } catch { /* per-viewer convenience only */ }
  }, [])

  const scopeCountry = country !== 'All' ? country : (activeCountry !== 'All' ? activeCountry : null)

  // Distinct sites from the filter-options RPC (a bare select stops at 1,000 rows
  // and dropped real sites from the list).
  useEffect(() => {
    let cancelled = false
    listFilterOptions(scopeCountry)
      .then(res => { if (!cancelled) setSites(res.sites || []) })
      .catch(() => { if (!cancelled) setSites([]) })
    return () => { cancelled = true }
  }, [scopeCountry])

  // Latest issue_date in tyre_records for the active filters (one indexed row).
  const [dataAnchor, setDataAnchor] = useState(undefined)

  const applyFilters = useCallback((q) => {
    if (scopeCountry) q = q.eq('country', scopeCountry)
    if (site !== 'All') q = q.eq('site', site)
    return q
  }, [scopeCountry, site])

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const { data } = await applyFilters(
        supabase.from('tyre_records')
          .select('issue_date')
          .not('issue_date', 'is', null)
          .order('issue_date', { ascending: false })
          .limit(1)
      )
      if (cancelled) return
      const iso = data?.[0]?.issue_date
      setDataAnchor(iso ? new Date(iso.slice(0, 10) + 'T00:00:00') : new Date())
    })()
    return () => { cancelled = true }
  }, [applyFilters])

  const { from, to } = useMemo(() => periodDates(period, { from: customFrom, to: customTo }, dataAnchor ?? new Date()), [period, customFrom, customTo, dataAnchor])
  const { from: prevFrom, to: prevTo } = useMemo(() => prevPeriodDates(from, to), [from, to])

  const latestLoad = useLatestRequest()
  const load = useCallback(async () => {
    const stale = latestLoad.begin()
    setLoading(true)
    setError(null)
    try {
      const histFrom = (() => { const d = new Date(dataAnchor ?? Date.now()); d.setFullYear(d.getFullYear() - 1); return isoDay(d) })()
      const [
        { data: recs, error: e1, truncated: t1 },
        { data: prevRecs, error: e2, truncated: t2 },
        { data: insps, error: e3, truncated: t3 },
        { data: prevInsps, error: e4, truncated: t4 },
        { data: histRecs, error: e5, truncated: t5 },
      ] = await Promise.all([
        fetchAllPages((f, tt) => applyFilters(
          supabase.from('tyre_records')
            .select('id,issue_date,asset_no,brand,site,country,cost_per_tyre,km_at_fitment,km_at_removal,risk_level,category,tread_depth,pressure_reading')
            .gte('issue_date', from).lte('issue_date', to)
        ).order('id').range(f, tt), { max: ROW_CAP }),
        fetchAllPages((f, tt) => applyFilters(
          supabase.from('tyre_records')
            .select('id,issue_date,asset_no,cost_per_tyre,km_at_fitment,km_at_removal,risk_level,category,tread_depth')
            .gte('issue_date', prevFrom).lte('issue_date', prevTo)
        ).order('id').range(f, tt), { max: ROW_CAP }),
        fetchAllPages((f, tt) => applyFilters(
          supabase.from('inspections')
            // tyre_conditions carries the recorded pressure_psi pressure
            // compliance is measured from (kpiEngine.computePressureCompliance)
            .select('id,asset_no,site,country,status,scheduled_date,completed_date,findings,inspection_type,tyre_conditions')
            .gte('inspection_date', from).lte('inspection_date', to)
        ).order('id').range(f, tt), { max: ROW_CAP }),
        fetchAllPages((f, tt) => applyFilters(
          supabase.from('inspections')
            .select('id,status,scheduled_date,completed_date,findings,tyre_conditions')
            .gte('inspection_date', prevFrom).lte('inspection_date', prevTo)
        ).order('id').range(f, tt), { max: ROW_CAP }),
        // 12 months of history for sparklines + the trend matrix
        fetchAllPages((f, tt) => applyFilters(
          supabase.from('tyre_records')
            .select('id,issue_date,asset_no,cost_per_tyre,km_at_fitment,km_at_removal,risk_level,category,tread_depth')
            .gte('issue_date', histFrom)
        ).order('id').range(f, tt), { max: ROW_CAP }),
      ])

      if (stale()) return
      for (const e of [e1, e2, e3, e4, e5]) if (e) throw e

      setRecords(recs || [])
      setPrevRecords(prevRecs || [])
      setInspections(insps || [])
      setPrevInspections(prevInsps || [])
      setMatrix(monthlyMatrix(histRecs || []))
      setTruncated(Boolean(t1 || t2 || t3 || t4 || t5))
    } catch (err) {
      if (stale()) return
      setError(toUserMessage(err, 'Could not load KPI data.'))
      setTruncated(false)
    } finally {
      if (!stale()) setLoading(false)
    }
  }, [from, to, prevFrom, prevTo, applyFilters, dataAnchor, latestLoad])

  useEffect(() => { if (dataAnchor !== undefined) load() }, [load, dataAnchor])

  const kpiValues = useMemo(() => extractKpiValues(records, inspections), [records, inspections])
  const prevKpiValues = useMemo(() => extractKpiValues(prevRecords, prevInspections), [prevRecords, prevInspections])
  const overall = useMemo(() => overallScore(kpiValues), [kpiValues])
  const siteRows = useMemo(() => siteKpiRows(records, inspections), [records, inspections])
  const vehicles = useMemo(() => vehicleRows(records, 2), [records])
  const alerts = useMemo(() => kpiAlerts(kpiValues, matrix), [kpiValues, matrix])
  const sparks = useMemo(() => Object.fromEntries(KPI_KEYS.map(k => [k, matrix.map(m => m[k])])), [matrix])

  const radarData = useMemo(() => ({
    labels: KPI_KEYS.map(k => t(`kpicommand.benchmarks.${k}.short`)),
    datasets: [
      {
        label: t('kpicommand.radar.fleetCurrent'),
        data: KPI_KEYS.map(k => kpiScore(k, kpiValues[k])),
        backgroundColor: withAlpha(colorAt(0), 0.15), borderColor: colorAt(0), borderWidth: 2, pointBackgroundColor: colorAt(0), pointRadius: 4,
      },
      {
        label: t('kpicommand.radar.referenceAverage'),
        data: KPI_KEYS.map(k => kpiScore(k, BENCHMARKS[k].average)),
        backgroundColor: 'transparent', borderColor: colorAt(3), borderDash: [5, 5], borderWidth: 1.5, pointRadius: 2, pointBackgroundColor: colorAt(3),
      },
      {
        label: t('kpicommand.bands.worldClass'),
        data: KPI_KEYS.map(() => 100),
        backgroundColor: 'transparent', borderColor: '#10b981', borderDash: [3, 3], borderWidth: 1.5, pointRadius: 2, pointBackgroundColor: '#10b981',
      },
    ],
  }), [kpiValues, BENCHMARKS, t])

  const periodComparisonData = useMemo(() => {
    if (overall.measured === 0) return null
    return {
      labels: KPI_KEYS.map(k => t(`kpicommand.benchmarks.${k}.short`)),
      datasets: [
        { label: t('kpicommand.periodCompare.current'), data: KPI_KEYS.map(k => kpiScore(k, kpiValues[k])), backgroundColor: withAlpha(colorAt(0), 0.75), borderColor: colorAt(0), borderWidth: 1, borderRadius: 4 },
        { label: t('kpicommand.periodCompare.previous'), data: KPI_KEYS.map(k => kpiScore(k, prevKpiValues[k])), backgroundColor: withAlpha(colorAt(5), 0.45), borderColor: colorAt(5), borderWidth: 1, borderRadius: 4 },
      ],
    }
  }, [kpiValues, prevKpiValues, overall.measured, t])

  // ── Exports ─────────────────────────────────────────────────────────────────
  const scopeLabel = `${scopeCountry || 'All countries'} ${site !== 'All' ? site : ''} ${from} to ${to}`.replace(/\s+/g, ' ').trim()

  async function exportPdf() {
    setExportError('')
    try {
      const { default: jsPDF } = await import('jspdf')
      const autoTable = await loadAutoTable()
      const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' })
      const brand = await resolvePdfBrand(branding)
      pdfHeader(doc, 'KPI Command Center', `Period: ${from} to ${to} | Overall Fleet Score: ${overall.score == null ? 'N/A' : `${overall.score.toFixed(0)}/100`} (${overall.measured} of ${overall.total} KPIs measured) | ${formatDate(new Date())}`, company, brand)
      const rows = kpiSummaryExportRows(kpiValues, prevKpiValues, BENCHMARKS)
      autoTable(doc, {
        ...pdfTableTheme(brand.accent),
        startY: 30,
        head: [['KPI', 'Current', 'Score', 'Rating', 'vs Prev', 'vs Good', 'World Class', 'Good', 'Average', 'Poor']],
        body: rows.map(r => [r.kpi, r.value, r.score, r.rating, r.change, r.vsGood, r.worldClass, r.good, r.average, r.poor]),
        margin: { left: 14, right: 14 },
      })
      if (siteRows.length) {
        autoTable(doc, {
          ...pdfTableTheme(brand.accent),
          startY: doc.lastAutoTable.finalY + 8,
          head: [['Site', 'Overall', 'Records', ...KPI_KEYS.map(k => BENCHMARKS[k].label)]],
          body: siteRows.map(sd => [sd.site, sd.overall == null ? 'N/A' : `${sd.overall.toFixed(0)}/100`, sd.records, ...KPI_KEYS.map(k => BENCHMARKS[k].format(sd[k]))]),
          margin: { left: 14, right: 14 },
        })
      }
      const totalPages = doc.internal.getNumberOfPages()
      for (let p = 1; p <= totalPages; p++) { doc.setPage(p); pdfFooter(doc, p, totalPages, company, brand) }
      doc.save(`${reportFileName('TyrePulse KPI Command Center', scopeLabel)}.pdf`)
    } catch (e) {
      setExportError(toUserMessage(e, 'Could not export. Try again.'))
    }
  }

  async function exportExcel() {
    setExportError('')
    try {
      const XLSX = await import('xlsx')
      const wb = XLSX.utils.book_new()
      const rows = kpiSummaryExportRows(kpiValues, prevKpiValues, BENCHMARKS).map(r => ({
        KPI: r.kpi, Current: r.value, Score: r.score, Rating: r.rating, 'vs Previous': r.change, 'vs Good': r.vsGood,
        'World Class': r.worldClass, Good: r.good, Average: r.average, Poor: r.poor,
      }))
      XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows), 'KPI Summary')
      if (siteRows.length) {
        XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(siteRows.map(sd => ({
          Site: sd.site, 'Overall Score': sd.overall == null ? 'N/A' : Math.round(sd.overall), Records: sd.records,
          ...Object.fromEntries(KPI_KEYS.map(k => [BENCHMARKS[k].label, BENCHMARKS[k].format(sd[k])])),
        }))), 'Site Comparison')
      }
      if (vehicles.length) {
        XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(vehicles.map(v => ({
          Asset: v.asset, Score: v.overall ?? 'N/A', Records: v.records,
          CPK: BENCHMARKS.cpk.format(v.cpk), 'Tyre Life': BENCHMARKS.tyre_life.format(v.tyre_life),
          'Failure Rate': BENCHMARKS.failure_rate.format(v.failure_rate), 'Scrap Rate': BENCHMARKS.scrap_rate.format(v.scrap_rate),
        }))), 'Vehicles')
      }
      if (matrix.length) {
        XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(matrix.map(m => ({
          Month: m.month, Records: m.records,
          ...Object.fromEntries(KPI_KEYS.map(k => [BENCHMARKS[k].label, BENCHMARKS[k].format(m[k])])),
        }))), 'Monthly Trend')
      }
      XLSX.writeFile(wb, `${reportFileName('TyrePulse KPI Command Center', scopeLabel)}.xlsx`)
    } catch (e) {
      setExportError(toUserMessage(e, 'Could not export. Try again.'))
    }
  }

  // ── Table columns ───────────────────────────────────────────────────────────
  const kpiCell = useCallback((key) => ({ row }) => {
    const v = row.original[key]
    const rk = ratingKey(kpiScore(key, v))
    return (
      <span className={`inline-block px-2 py-1 rounded tabular-nums ${CELL_BG[rk]}`}>
        {BENCHMARKS[key].format(v)}
        {rk !== 'notMeasured' && <span className="sr-only"> ({RATING_LABEL[rk]})</span>}
      </span>
    )
  }, [BENCHMARKS])

  const kpiColumns = useMemo(() => KPI_KEYS.map(k => ({
    id: k,
    header: t(`kpicommand.benchmarks.${k}.short`),
    accessorFn: r => (isMeasured(r[k]) ? r[k] : undefined),
    sortUndefined: 'last',
    size: 120,
    meta: { align: 'right', exportValue: r => BENCHMARKS[k].format(r[k]) },
    cell: kpiCell(k),
  })), [BENCHMARKS, kpiCell, t])

  const matrixColumns = useMemo(() => [
    { id: 'month', header: 'Month', accessorFn: r => r.month, size: 110, meta: { exportValue: r => r.month },
      cell: ({ row }) => <span className="text-[var(--text-primary)] font-medium">{monthLabel(row.original.month)}</span> },
    { id: 'records', header: 'Records', accessorFn: r => r.records, size: 90, meta: { align: 'right' } },
    ...kpiColumns,
  ], [kpiColumns])

  const siteColumns = useMemo(() => [
    { id: 'site', header: t('kpicommand.columns.site'), accessorFn: r => r.site, size: 150, sortingFn: sortNullLast,
      cell: ({ row }) => <span className="text-[var(--text-primary)] font-medium">{row.original.site}</span> },
    { id: 'overall', header: t('kpicommand.columns.score'), accessorFn: r => r.overall ?? undefined, sortUndefined: 'last', size: 110,
      meta: { align: 'right', exportValue: r => (r.overall == null ? 'N/A' : Math.round(r.overall)) },
      cell: ({ row }) => <span className={`font-bold tabular-nums ${scoreTextColor(row.original.overall)}`}>{row.original.overall == null ? 'N/A' : row.original.overall.toFixed(0)}</span> },
    { id: 'records', header: 'Records', accessorFn: r => r.records, size: 90, meta: { align: 'right' } },
    ...kpiColumns,
  ], [kpiColumns, t])

  const vehicleColumns = useMemo(() => [
    { id: 'asset', header: 'Asset', accessorFn: r => r.asset, size: 130, sortingFn: sortNullLast,
      cell: ({ row }) => <span className="font-mono text-[var(--text-primary)]">{row.original.asset}</span> },
    { id: 'overall', header: 'Score', accessorFn: r => r.overall ?? undefined, sortUndefined: 'last', size: 100,
      meta: { align: 'right', exportValue: r => r.overall ?? 'N/A' },
      cell: ({ row }) => <span className={`font-bold tabular-nums ${scoreTextColor(row.original.overall)}`}>{row.original.overall ?? 'N/A'}</span> },
    { id: 'measured', header: 'KPIs measured', accessorFn: r => r.measured, size: 120, meta: { align: 'right', exportValue: r => `${r.measured} of 4` },
      cell: ({ row }) => <span className="tabular-nums text-[var(--text-secondary)]">{row.original.measured} of 4</span> },
    { id: 'records', header: 'Records', accessorFn: r => r.records, size: 90, meta: { align: 'right' } },
    ...kpiColumns.filter(c => ['cpk', 'tyre_life', 'failure_rate', 'scrap_rate'].includes(c.id)),
  ], [kpiColumns])

  const alertStyle = {
    achievement: { icon: Trophy, color: 'text-emerald-400', edge: 'border-l-emerald-500', badge: 'bg-emerald-900/30 text-emerald-400' },
    warning: { icon: AlertTriangle, color: 'text-red-400', edge: 'border-l-red-500', badge: 'bg-red-900/30 text-red-400' },
    deteriorating: { icon: TrendingDown, color: 'text-yellow-400', edge: 'border-l-yellow-500', badge: 'bg-yellow-900/30 text-yellow-400' },
  }

  const noData = !loading && !error && records.length === 0

  return (
    <div className="space-y-5">
      <SectionTabs tabs={KPI_TABS} />
      <PageHeader
        title={t('kpicommand.title')}
        subtitle={t('kpicommand.subtitle', { count: records.length.toLocaleString() })}
        icon={Command}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" onClick={load} disabled={loading} aria-label="Refresh KPI data"
              className={`btn-secondary flex items-center justify-center px-3 ${TOUCH} disabled:opacity-40`}>
              <RefreshCw size={15} className={loading ? 'animate-spin' : ''} aria-hidden="true" />
            </button>
            <button type="button" onClick={exportPdf} disabled={loading || records.length === 0}
              className={`btn-secondary flex items-center gap-2 px-3 text-xs ${TOUCH} disabled:opacity-40`}>
              <FileText size={14} aria-hidden="true" />{t('kpicommand.actions.pdf')}
            </button>
            <button type="button" onClick={exportExcel} disabled={loading || records.length === 0}
              className={`btn-secondary flex items-center gap-2 px-3 text-xs ${TOUCH} disabled:opacity-40`}>
              <Download size={14} aria-hidden="true" />{t('kpicommand.actions.excel')}
            </button>
          </div>
        }
      />

      {/* ── Filters ─────────────────────────────────────────────────────────── */}
      <section aria-label="Filters" className="card flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-3">
          <SegmentedControl
            ariaLabel={t('kpicommand.ariaLabels.period')}
            value={period}
            onChange={setPeriod}
            options={PERIOD_PRESETS.map(p => ({ value: p, label: t(`kpicommand.periods.${p}`) }))}
          />
          {period === 'custom' && (
            <div className="flex flex-wrap items-center gap-2">
              <DateField className="text-sm w-40" value={customFrom} onChange={setCustomFrom} placeholder="From date" ariaLabel="From date" />
              <span className="text-[var(--text-muted)] text-xs">{t('kpicommand.filters.to')}</span>
              <DateField className="text-sm w-40" value={customTo} onChange={setCustomTo} placeholder="To date" ariaLabel="To date" min={customFrom || undefined} />
            </div>
          )}
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:flex lg:flex-wrap gap-3 items-end">
          <div className="flex flex-col gap-1">
            <label htmlFor="kcc-site" className="label text-xs">Site</label>
            <select id="kcc-site" value={site} onChange={e => setSite(e.target.value)} className={`input text-sm lg:w-52 ${TOUCH}`}>
              <option value="All">{t('kpicommand.filters.allSites')}</option>
              {sites.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>
          <div className="flex flex-col gap-1">
            <label htmlFor="kcc-country" className="label text-xs">Country</label>
            <select id="kcc-country" value={country} onChange={e => setCountry(e.target.value)} className={`input text-sm lg:w-44 ${TOUCH}`}>
              <option value="All">{t('kpicommand.filters.allCountries')}</option>
              {COUNTRIES.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
          <p className="text-xs text-[var(--text-muted)] lg:pb-3">
            Window {from} to {to}, compared with {prevFrom} to {prevTo}.
          </p>
        </div>
      </section>

      {exportError && <p role="alert" className="text-sm text-red-400">{exportError}</p>}

      {error && (
        <div role="alert" className="bg-red-900/30 border border-red-700 rounded-xl p-4 text-red-300 text-sm flex flex-wrap items-center gap-3">
          <AlertTriangle size={16} aria-hidden="true" />
          <span className="flex-1">{error}</span>
          <button type="button" onClick={load} className={`btn-secondary text-xs px-4 ${TOUCH}`}>Retry</button>
        </div>
      )}

      {truncated && !loading && (
        <div role="status" className="flex items-center gap-2 text-amber-400 text-xs bg-amber-400/10 border border-amber-400/20 rounded-xl px-4 py-2.5">
          <AlertTriangle size={13} aria-hidden="true" />
          Showing a capped view of {ROW_CAP.toLocaleString()} records. Narrow the date range, site or country for exact figures.
        </div>
      )}

      {loading && records.length === 0 && (
        <div aria-busy="true" className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {Array.from({ length: 6 }).map((_, i) => <div key={i} className="card h-48 animate-pulse" />)}
        </div>
      )}

      {noData && (
        <div className="card text-center py-16">
          <Command size={48} className="mx-auto text-[var(--text-dim)] mb-4" aria-hidden="true" />
          <p className="text-[var(--text-secondary)] font-medium">{t('kpicommand.empty.title')}</p>
          <p className="text-[var(--text-muted)] text-sm mt-1">{t('kpicommand.empty.subtitle')}</p>
        </div>
      )}

      {records.length > 0 && !error && (
        <>
          {/* Command panel: overall score + KPI strip */}
          <section aria-label="KPI summary" className="card">
            <div className="flex flex-col lg:flex-row items-center gap-8">
              <div className="flex flex-col items-center gap-2">
                <FleetScoreGauge score={overall.score} measured={overall.measured} total={overall.total} />
                <div className="text-center">
                  <p className="text-[var(--text-primary)] font-semibold">{t('kpicommand.panel.overallScore')}</p>
                  <p className="text-[var(--text-muted)] text-xs">Average of the measured KPIs against benchmarks</p>
                </div>
              </div>
              <div className="flex-1 w-full grid grid-cols-1 min-[420px]:grid-cols-2 sm:grid-cols-3 xl:grid-cols-6 gap-3">
                {KPI_KEYS.map(key => {
                  const val = kpiValues[key]
                  const score = kpiScore(key, val)
                  const rk = ratingKey(score)
                  const Icon = ICONS[key]
                  return (
                    <button key={key} type="button" onClick={() => setDrillKpi(key)}
                      aria-label={`${t(`kpicommand.benchmarks.${key}.label`)} ${BENCHMARKS[key].format(val)}, ${RATING_LABEL[rk]}. Open monthly trend`}
                      className="bg-[var(--input-bg)] rounded-xl p-3 text-center border border-[var(--input-border)] hover:border-[var(--text-muted)] transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-500">
                      <Icon size={14} className={`mx-auto mb-1 ${RATING_STYLE[rk].color}`} aria-hidden="true" />
                      <div className="text-[var(--text-muted)] text-xs mb-1 truncate">{t(`kpicommand.benchmarks.${key}.short`)}</div>
                      <div className={`text-lg font-bold tabular-nums ${RATING_STYLE[rk].color}`}>{BENCHMARKS[key].format(val)}</div>
                      <div className={`text-xs mt-0.5 ${RATING_STYLE[rk].color}`}>{rk === 'notMeasured' ? RATING_LABEL.notMeasured : t(`kpicommand.ratings.${rk}`)}</div>
                      <div className="mt-2 h-1.5 bg-[var(--input-border)] rounded-full overflow-hidden" aria-hidden="true">
                        <div className="h-full rounded-full" style={{ width: `${score ?? 0}%`, backgroundColor: scoreColor(score) }} />
                      </div>
                      <div className="text-xs text-[var(--text-muted)] mt-1 tabular-nums">{score == null ? 'N/A' : `${score.toFixed(0)}/100`}</div>
                    </button>
                  )
                })}
              </div>
            </div>
          </section>

          {/* KPI scorecard */}
          <section aria-labelledby="kcc-scorecard-h">
            <h2 id="kcc-scorecard-h" className="text-[var(--text-primary)] font-semibold mb-3 flex items-center gap-2">
              <Target size={16} className="text-blue-400" aria-hidden="true" />
              {t('kpicommand.sections.kpiScorecard')}
            </h2>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {KPI_KEYS.map(key => (
                <KpiCard key={key} kpiKey={key} benchmark={BENCHMARKS[key]} value={kpiValues[key]}
                  prevValue={prevKpiValues[key]} sparkData={sparks[key]} target={targets[key]}
                  onOpen={() => setDrillKpi(key)} />
              ))}
            </div>
          </section>

          {/* Radar + period comparison */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
            <Panel id="kcc-radar-h" icon={Layers} iconClass="text-purple-400" title={t('kpicommand.sections.fleetVsBenchmark')} hint={t('kpicommand.sections.fleetVsBenchmarkDesc')}>
              <div className="h-72">
                <Radar data={radarData} role="img" aria-label="Radar chart of KPI scores against benchmark bands" options={{
                  responsive: true, maintainAspectRatio: false,
                  plugins: { legend: CHART_BASE.plugins.legend, tooltip: CHART_BASE.plugins.tooltip },
                  scales: { r: {
                    ticks: { color: 'var(--text-muted)', backdropColor: 'transparent', font: { size: 9 } },
                    grid: { color: 'var(--panel-2)' }, angleLines: { color: 'var(--panel-2)' },
                    pointLabels: { color: 'var(--text-secondary)', font: { size: 10 } },
                    suggestedMin: 0, suggestedMax: 100,
                  } },
                }} />
              </div>
            </Panel>
            <Panel id="kcc-period-h" icon={Calendar} iconClass="text-orange-400" title={t('kpicommand.sections.periodComparison')} hint={t('kpicommand.sections.periodComparisonDesc')}>
              {periodComparisonData ? (
                <div className="h-72">
                  <Bar data={periodComparisonData} role="img" aria-label="Bar chart of current versus previous period KPI scores" options={{
                    ...CHART_BASE,
                    scales: {
                      x: { ...CHART_BASE.scales.x, ticks: { ...CHART_BASE.scales.x.ticks, maxRotation: 30 } },
                      y: { ...CHART_BASE.scales.y, max: 110, title: { display: true, text: t('kpicommand.charts.scoreAxis'), color: 'var(--text-muted)', font: { size: 9 } } },
                    },
                  }} />
                </div>
              ) : (
                <p className="text-sm text-[var(--text-muted)] py-16 text-center">No KPI was measurable in this window.</p>
              )}
            </Panel>
          </div>

          {/* Trend matrix */}
          <Panel id="kcc-matrix-h" icon={BarChart3} iconClass="text-blue-400" title={t('kpicommand.sections.trendMatrix')} hint="Last 12 months with data. Cell colour follows the benchmark rating; the rating is also read out to screen readers.">
            <EnterpriseTable
              columns={matrixColumns}
              data={matrix}
              getRowId={r => r.month}
              enableColumnFilters={false}
              enableGlobalFilter={false}
              initialPageSize={25}
              exportFileName={reportFileName('TyrePulse KPI Trend Matrix', scopeLabel)}
              reportMeta={{ title: 'KPI trend matrix' }}
              emptyMessage="No tyre records in the last 12 months."
            />
          </Panel>

          {/* Site comparison */}
          <Panel id="kcc-sites-h" icon={MapPin} iconClass="text-emerald-400" title={t('kpicommand.sections.siteComparison')} hint={`${siteRows.length} sites, best overall score first`}>
            <EnterpriseTable
              columns={siteColumns}
              data={siteRows}
              getRowId={r => r.site}
              enableColumnFilters={false}
              searchPlaceholder="Search site"
              initialPageSize={25}
              exportFileName={reportFileName('TyrePulse Site KPI Comparison', scopeLabel)}
              reportMeta={{ title: 'Site KPI comparison', currency: activeCurrency }}
              emptyMessage="No site data in this window."
            />
          </Panel>

          {/* Alerts + target vs actual */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
            <Panel id="kcc-alerts-h" icon={AlertTriangle} iconClass="text-yellow-400" title={t('kpicommand.sections.alerts')}
              right={<span className="text-xs bg-[var(--input-bg)] px-2 py-0.5 rounded-full text-[var(--text-muted)]">{alerts.length}</span>}>
              <div className="divide-y divide-[var(--input-border)] max-h-80 overflow-y-auto -mx-1">
                {alerts.length === 0 && (
                  <div className="px-5 py-8 text-center">
                    {overall.measured === 0 ? (
                      <>
                        <Info size={28} className="mx-auto text-[var(--text-muted)] mb-2" aria-hidden="true" />
                        <p className="text-[var(--text-muted)] text-sm">No KPI is measurable in this window, so no alert can be raised.</p>
                      </>
                    ) : (
                      <>
                        <CheckCircle size={28} className="mx-auto text-emerald-400 mb-2" aria-hidden="true" />
                        <p className="text-emerald-400 font-medium text-sm">{t('kpicommand.alerts.allWithinRange')}</p>
                      </>
                    )}
                  </div>
                )}
                {alerts.map((a, i) => {
                  const st = alertStyle[a.type]
                  const TypeIcon = st.icon
                  const b = BENCHMARKS[a.kpi]
                  const msg = a.type === 'achievement' ? t('kpicommand.alerts.msgAchievement')
                    : a.type === 'warning' ? t('kpicommand.alerts.msgWarning', { value: b.format(b.average) })
                    : t('kpicommand.alerts.msgDeteriorating', { pct: a.change == null ? 'N/A' : a.change.toFixed(1) })
                  return (
                    <div key={`${a.kpi}-${a.type}-${i}`} className={`px-4 py-3 flex items-start gap-3 border-l-2 ${st.edge}`}>
                      <TypeIcon size={16} className={`${st.color} shrink-0 mt-0.5`} aria-hidden="true" />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-[var(--text-primary)] text-sm font-medium">{t(`kpicommand.benchmarks.${a.kpi}.label`)}</span>
                          <span className={`text-xs px-1.5 py-0.5 rounded-full ${st.badge}`}>{t(`kpicommand.alerts.type.${a.type}`)}</span>
                        </div>
                        <p className="text-[var(--text-muted)] text-xs mt-0.5">
                          <span className={`font-medium ${st.color}`}>{b.format(a.value)}</span>: {msg}
                        </p>
                      </div>
                    </div>
                  )
                })}
              </div>
            </Panel>

            <Panel id="kcc-target-h" icon={Target} iconClass="text-blue-400" title={t('kpicommand.sections.targetVsActual')}>
              <div className="divide-y divide-[var(--input-border)] -mx-1">
                {KPI_KEYS.map(key => {
                  const b = BENCHMARKS[key]
                  const val = kpiValues[key]
                  const target = targets[key] ?? b.good
                  const st = targetStatus(key, val, target)
                  const style = st === 'exceeded' ? 'bg-emerald-900/30 text-emerald-400'
                    : st === 'onTrack' ? 'bg-blue-900/30 text-blue-400'
                    : st === 'behind' ? 'bg-red-900/30 text-red-400' : 'bg-[var(--surface-2)] text-[var(--text-muted)]'
                  const label = st === 'notMeasured' ? 'Not measured' : t(`kpicommand.targetActual.status.${st}`)
                  return (
                    <div key={key} className="px-4 py-3 flex items-center gap-3">
                      <div className="flex-1 min-w-0">
                        <div className="text-[var(--text-primary)] text-sm font-medium truncate">{t(`kpicommand.benchmarks.${key}.label`)}</div>
                        <div className="flex flex-wrap items-center gap-3 mt-1 text-xs text-[var(--text-muted)]">
                          <span>{t('kpicommand.targetActual.target')} <span className="text-[var(--text-secondary)]">{b.format(target)}</span></span>
                          <span>{t('kpicommand.targetActual.actual')} <span className="text-[var(--text-secondary)]">{b.format(val)}</span></span>
                        </div>
                      </div>
                      <span className={`text-xs px-2 py-1 rounded-full font-medium shrink-0 ${style}`}>{label}</span>
                    </div>
                  )
                })}
              </div>
            </Panel>
          </div>

          {/* Vehicle scorecard */}
          <Panel id="kcc-vehicles-h" icon={Truck} iconClass="text-[var(--text-secondary)]" title="Vehicle KPI scorecard"
            hint="Vehicles with at least two tyre records in the window, best score first. Sort by Score ascending to find the ones that need attention.">
            <EnterpriseTable
              columns={vehicleColumns}
              data={vehicles}
              getRowId={r => r.asset}
              enableColumnFilters={false}
              searchPlaceholder="Search asset"
              initialPageSize={25}
              exportFileName={reportFileName('TyrePulse Vehicle KPI Scorecard', scopeLabel)}
              reportMeta={{ title: 'Vehicle KPI scorecard', currency: activeCurrency }}
              emptyMessage="No vehicle has two or more tyre records in this window."
            />
          </Panel>
        </>
      )}

      {drillKpi && (
        <DrillDown kpiKey={drillKpi} benchmark={BENCHMARKS[drillKpi]} matrix={matrix} onClose={() => setDrillKpi(null)} />
      )}
    </div>
  )
}
