import { useState, useEffect, useMemo, useCallback, useRef } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  Chart as ChartJS,
  CategoryScale, LinearScale, BarElement,
  LineElement, PointElement, ArcElement,
  RadialLinearScale,
  Title, Tooltip, Legend, Filler,
} from 'chart.js'
import { Bar, Line, Radar } from 'react-chartjs-2'
import {
  Command, RefreshCw, Download, AlertTriangle, CheckCircle, TrendingUp,
  TrendingDown, Minus, Target, Gauge, BarChart3, Layers, MapPin,
  Calendar, ChevronDown, ChevronUp, Star, Trophy, AlertOctagon,
  ArrowUpRight, ArrowDownRight, Info, X, FileText,
} from 'lucide-react'
import { useLanguage } from '../contexts/LanguageContext'
import { supabase } from '../lib/supabase'
import { fetchAllPages } from '../lib/fetchAll'
import { useSettings, COUNTRIES } from '../contexts/SettingsContext'
import { useTenant } from '../contexts/TenantContext'
import { formatDate, formatMonthYear } from '../lib/formatters'
import { resolvePdfBrand, pdfHeader, pdfFooter, pdfTableTheme } from '../lib/exportUtils'
import PageHeader from '../components/ui/PageHeader'
import SectionTabs, { KPI_TABS } from '../components/ui/SectionTabs'
import SegmentedControl from '../components/ui/SegmentedControl'
import {
  computeCpkFleet, computeAvgTyreLife, computeFailureRate,
  computeScrapRate, computePressureCompliance, computeInspectionCompliance,
  computeCostTrend, computeCpkBySite, computeFleetTyreLife,
} from '../lib/kpiEngine'

ChartJS.register(
  CategoryScale, LinearScale, BarElement,
  LineElement, PointElement, ArcElement,
  RadialLinearScale,
  Title, Tooltip, Legend, Filler,
)

// ── Constants ─────────────────────────────────────────────────────────────────
// Benchmark thresholds are static industry reference targets (not regional data).
// Currency only affects CPK display formatting, never the threshold values.
const makeBenchmarks = (currency) => ({
  cpk: {
    key: 'cpk', label: 'Cost Per Km (CPK)', unit: `${currency}/km`,
    world_class: 0.80, good: 1.20, average: 1.80, poor: 2.50,
    higherIsBetter: false,
    format: v => `${currency} ${Number(v).toFixed(3)}`,
    icon: Gauge,
    description: 'Cost spent per km on tyres',
  },
  tyre_life: {
    key: 'tyre_life', label: 'Avg Tyre Life', unit: 'km',
    world_class: 150000, good: 100000, average: 70000, poor: 45000,
    higherIsBetter: true,
    format: v => `${(Number(v) / 1000).toFixed(0)}k km`,
    icon: TrendingUp,
    description: 'Average km per tyre before removal',
  },
  failure_rate: {
    key: 'failure_rate', label: 'Failure Rate', unit: '%',
    world_class: 3, good: 8, average: 15, poor: 25,
    higherIsBetter: false,
    format: v => `${Number(v).toFixed(1)}%`,
    icon: AlertTriangle,
    description: 'High + Critical risk removals',
  },
  scrap_rate: {
    key: 'scrap_rate', label: 'Scrap Rate', unit: '%',
    world_class: 5, good: 12, average: 20, poor: 35,
    higherIsBetter: false,
    format: v => `${Number(v).toFixed(1)}%`,
    icon: AlertOctagon,
    description: 'Scrapped vs total tyres removed',
  },
  pressure_compliance: {
    key: 'pressure_compliance', label: 'Pressure Compliance', unit: '%',
    world_class: 97, good: 92, average: 85, poor: 70,
    higherIsBetter: true,
    format: v => `${Number(v).toFixed(1)}%`,
    icon: CheckCircle,
    description: 'Inspections within ±10% spec',
  },
  inspection_compliance: {
    key: 'inspection_compliance', label: 'Inspection Compliance', unit: '%',
    world_class: 98, good: 92, average: 80, poor: 65,
    higherIsBetter: true,
    format: v => `${Number(v).toFixed(1)}%`,
    icon: BarChart3,
    description: 'On-time inspection completion',
  },
})

// Currency-independent copy for threshold math (scores, keys). Display always
// uses the currency-aware instance built inside the component.
const BENCHMARKS_STATIC = makeBenchmarks('')

const KPI_KEYS = Object.keys(BENCHMARKS_STATIC)

const PERIOD_PRESETS = [
  { label: 'Today', value: '1d' },
  { label: '7D', value: '7d' },
  { label: '30D', value: '30d' },
  { label: '90D', value: '90d' },
  { label: '6M', value: '6m' },
  { label: '1Y', value: '1y' },
  { label: 'Custom', value: 'custom' },
]

const CHART_BASE = {
  responsive: true,
  maintainAspectRatio: false,
  plugins: {
    legend: { labels: { color: '#9ca3af', boxWidth: 10, font: { size: 10 } } },
    tooltip: {
      backgroundColor: 'var(--panel)', borderColor: 'var(--hairline)', borderWidth: 1,
      titleColor: '#f9fafb', bodyColor: '#d1d5db',
    },
  },
  scales: {
    x: { ticks: { color: '#6b7280', font: { size: 10 } }, grid: { color: 'var(--panel-2)' } },
    y: { ticks: { color: '#6b7280', font: { size: 10 } }, grid: { color: 'var(--panel-2)' } },
  },
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function fmt(d) {
  const p = n => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

function periodDates(preset, custom = {}, anchor = new Date()) {
  // Presets window backwards from the anchor (latest issue_date in the data,
  // fallback: today) so historic imports still return populated periods.
  const now = anchor
  if (preset === '1d') { const f = new Date(now); f.setDate(f.getDate() - 1); return { from: fmt(f), to: fmt(now) } }
  if (preset === '7d') { const f = new Date(now); f.setDate(f.getDate() - 7); return { from: fmt(f), to: fmt(now) } }
  if (preset === '30d') { const f = new Date(now); f.setDate(f.getDate() - 30); return { from: fmt(f), to: fmt(now) } }
  if (preset === '90d') { const f = new Date(now); f.setDate(f.getDate() - 90); return { from: fmt(f), to: fmt(now) } }
  if (preset === '6m') { const f = new Date(now); f.setMonth(f.getMonth() - 6); return { from: fmt(f), to: fmt(now) } }
  if (preset === '1y') { const f = new Date(now); f.setFullYear(f.getFullYear() - 1); return { from: fmt(f), to: fmt(now) } }
  return { from: custom.from || fmt(new Date(now.getFullYear(), now.getMonth() - 1, 1)), to: custom.to || fmt(now) }
}

function prevPeriodDates(from, to) {
  const f = new Date(from)
  const t = new Date(to)
  const days = Math.round((t - f) / 86400000)
  const pf = new Date(f); pf.setDate(pf.getDate() - days)
  const pt = new Date(f); pt.setDate(pt.getDate() - 1)
  return { from: fmt(pf), to: fmt(pt) }
}

function kpiScore(key, value) {
  const b = BENCHMARKS_STATIC[key]
  if (!b || value == null || isNaN(value)) return 0
  const { world_class, good, average, poor, higherIsBetter } = b
  if (higherIsBetter) {
    if (value >= world_class) return 100
    if (value >= good) return 75 + 25 * ((value - good) / (world_class - good))
    if (value >= average) return 50 + 25 * ((value - average) / (good - average))
    if (value >= poor) return 25 + 25 * ((value - poor) / (average - poor))
    return Math.max(0, 25 * (value / poor))
  } else {
    if (value <= world_class) return 100
    if (value <= good) return 75 + 25 * ((good - value) / (good - world_class))
    if (value <= average) return 50 + 25 * ((average - value) / (average - good))
    if (value <= poor) return 25 + 25 * ((poor - value) / (poor - average))
    return Math.max(0, 25 * (1 - (value - poor) / poor))
  }
}

function ratingLabel(score) {
  if (score >= 90) return { key: 'worldClass', label: 'World Class', color: 'text-emerald-400', bg: 'bg-emerald-900/30 border-emerald-700', dot: 'bg-emerald-400' }
  if (score >= 70) return { key: 'good', label: 'Good', color: 'text-blue-400', bg: 'bg-blue-900/30 border-blue-700', dot: 'bg-blue-400' }
  if (score >= 45) return { key: 'average', label: 'Average', color: 'text-yellow-400', bg: 'bg-yellow-900/30 border-yellow-700', dot: 'bg-yellow-400' }
  if (score >= 20) return { key: 'poor', label: 'Poor', color: 'text-orange-400', bg: 'bg-orange-900/30 border-orange-700', dot: 'bg-orange-400' }
  return { key: 'critical', label: 'Critical', color: 'text-red-400', bg: 'bg-red-900/30 border-red-700', dot: 'bg-red-400' }
}

function scoreColor(score) {
  if (score >= 75) return '#10b981'
  if (score >= 50) return '#f59e0b'
  if (score >= 25) return '#f97316'
  return '#ef4444'
}

function scoreTextColor(score) {
  if (score >= 75) return 'text-emerald-400'
  if (score >= 50) return 'text-yellow-400'
  if (score >= 25) return 'text-orange-400'
  return 'text-red-400'
}

function normalizeForRadar(key, value) {
  return Math.max(0, Math.min(100, kpiScore(key, value)))
}

function monthLabel(key) {
  if (!key) return ''
  const [y, m] = key.split('-')
  return formatMonthYear(new Date(+y, +m - 1, 1))
}

// ── KPI extraction from computed data ────────────────────────────────────────
function extractKpiValues(records, inspections) {
  const cpkData = computeCpkFleet(records)
  const lifeData = computeAvgTyreLife(records)
  const failData = computeFailureRate(records)
  const scrapData = computeScrapRate(records)
  const pressData = computePressureCompliance(inspections)
  const inspData = computeInspectionCompliance(inspections)

  return {
    cpk: cpkData.fleetAvgCpk,
    tyre_life: lifeData.avgKm,
    failure_rate: failData.failureRate * 100,
    scrap_rate: scrapData.scrapRate * 100,
    pressure_compliance: pressData.compliancePct,
    inspection_compliance: inspData.compliancePct,
  }
}

// ── Circular Score Gauge ──────────────────────────────────────────────────────
function FleetScoreGauge({ score }) {
  const { t } = useLanguage()
  const r = 64
  const circ = 2 * Math.PI * r
  const arc = circ * 0.75
  const offset = arc - (arc * Math.min(score, 100)) / 100
  const color = scoreColor(score)

  return (
    <div className="relative flex items-center justify-center" style={{ width: 180, height: 180 }}>
      <svg width="180" height="180" viewBox="0 0 180 180" className="absolute inset-0 -rotate-[135deg]">
        <circle cx="90" cy="90" r={r} fill="none" stroke="#1f2937" strokeWidth="12"
          strokeDasharray={`${arc} ${circ - arc}`} strokeLinecap="round" />
        <circle cx="90" cy="90" r={r} fill="none" stroke={color} strokeWidth="12"
          strokeDasharray={`${arc - offset} ${circ - (arc - offset)}`}
          strokeLinecap="round"
          style={{ transition: 'stroke-dasharray 1.2s cubic-bezier(.4,0,.2,1)' }} />
      </svg>
      <div className="text-center z-10">
        <div className={`text-4xl font-bold leading-none tabular-nums ${scoreTextColor(score)}`}>
          {score.toFixed(0)}
        </div>
        <div className="text-[var(--text-muted)] text-xs mt-1">/ 100</div>
        <div className={`text-xs font-semibold mt-1 ${scoreTextColor(score)}`}>
          {score >= 75 ? t('kpicommand.gauge.strong') : score >= 50 ? t('kpicommand.gauge.fair') : score >= 25 ? t('kpicommand.gauge.weak') : t('kpicommand.gauge.critical')}
        </div>
      </div>
    </div>
  )
}

// ── Sparkline via inline SVG ──────────────────────────────────────────────────
function Sparkline({ data, positive = true, height = 32, width = 100 }) {
  if (!data || data.length < 2) return <div style={{ width, height }} className="opacity-30 bg-[var(--input-bg)] rounded" />
  const min = Math.min(...data)
  const max = Math.max(...data)
  const range = max - min || 1
  const pts = data.map((v, i) => {
    const x = (i / (data.length - 1)) * width
    const y = height - ((v - min) / range) * (height - 4) - 2
    return `${x},${y}`
  }).join(' ')
  const last = data[data.length - 1]
  const first = data[0]
  const improving = positive ? last >= first : last <= first
  const color = improving ? '#10b981' : '#ef4444'
  return (
    <svg width={width} height={height} className="overflow-visible">
      <polyline points={pts} fill="none" stroke={color} strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  )
}

// ── KPI Card ──────────────────────────────────────────────────────────────────
function KpiCard({ kpiKey, benchmark, value, prevValue, sparkData, targets, onClick }) {
  const { t } = useLanguage()
  const b = benchmark
  const score = kpiScore(kpiKey, value)
  const rating = ratingLabel(score)
  const Icon = b.icon
  const pctChange = prevValue && prevValue !== 0
    ? ((value - prevValue) / Math.abs(prevValue)) * 100
    : null
  const isImproving = pctChange != null
    ? (b.higherIsBetter ? pctChange >= 0 : pctChange <= 0)
    : null
  const target = targets?.[kpiKey] ?? b.good
  const progressPct = b.higherIsBetter
    ? Math.min(100, (value / b.world_class) * 100)
    : Math.min(100, (b.world_class / Math.max(value, 0.001)) * 100)
  const poorPct = b.higherIsBetter
    ? (b.poor / b.world_class) * 100
    : (b.world_class / b.poor) * 100
  const goodPct = b.higherIsBetter
    ? (b.good / b.world_class) * 100
    : (b.world_class / b.good) * 100

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      whileHover={{ scale: 1.01 }}
      onClick={onClick}
      className="card cursor-pointer hover:border-[var(--input-border)] transition-all group"
    >
      <div className="flex items-start justify-between mb-3">
        <div className="flex items-center gap-2">
          <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${rating.bg} border`}>
            <Icon size={15} className={rating.color} />
          </div>
          <div>
            <p className="text-xs text-[var(--text-muted)] leading-tight">{t(`kpicommand.benchmarks.${kpiKey}.label`)}</p>
            <p className="text-xs text-[var(--text-dim)]">{t(`kpicommand.benchmarks.${kpiKey}.description`)}</p>
          </div>
        </div>
        <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium border ${rating.bg} ${rating.color}`}>
          <span className={`w-1.5 h-1.5 rounded-full ${rating.dot}`} />
          {t(`kpicommand.ratings.${rating.key}`)}
        </span>
      </div>

      <div className="flex items-end justify-between mb-3">
        <div>
          <div className={`text-3xl font-bold tabular-nums ${rating.color}`}>
            {value != null && !isNaN(value) ? b.format(value) : '-'}
          </div>
          {pctChange != null && (
            <div className={`flex items-center gap-1 text-xs mt-1 ${isImproving ? 'text-emerald-400' : 'text-red-400'}`}>
              {isImproving ? <ArrowUpRight size={12} /> : <ArrowDownRight size={12} />}
              {t('kpicommand.card.vsPrevPeriod', { pct: Math.abs(pctChange).toFixed(1) })}
            </div>
          )}
        </div>
        <Sparkline data={sparkData} positive={b.higherIsBetter} />
      </div>

      <div className="space-y-1.5 mb-3">
        <div className="flex justify-between text-xs">
          <span className="text-[var(--text-dim)]">{t('kpicommand.bands.poor')}</span>
          <span className="text-[var(--text-dim)]">{t('kpicommand.bands.worldClass')}</span>
        </div>
        <div className="relative h-2 bg-[var(--input-bg)] rounded-full overflow-hidden">
          <div className="absolute inset-0 flex">
            <div className="h-full bg-red-900/60" style={{ width: `${poorPct}%` }} />
            <div className="h-full bg-yellow-900/40" style={{ width: `${goodPct - poorPct}%` }} />
            <div className="h-full bg-emerald-900/40" style={{ flex: 1 }} />
          </div>
          <div
            className="absolute top-0 h-full w-1 rounded-full transition-all duration-1000"
            style={{
              left: `${Math.min(progressPct, 99)}%`,
              backgroundColor: scoreColor(score),
            }}
          />
        </div>
        <div className="flex justify-between text-xs text-[var(--text-muted)]">
          <span>{b.format(b.poor)}</span>
          <span className="text-[var(--text-dim)]">{t('kpicommand.card.target', { value: b.format(target) })}</span>
          <span>{b.format(b.world_class)}</span>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-1 text-xs">
        {[
          { l: t('kpicommand.bands.good'), v: b.good, c: 'text-blue-400' },
          { l: t('kpicommand.bands.avg'), v: b.average, c: 'text-yellow-400' },
          { l: t('kpicommand.bands.vsGood'), v: null, delta: true },
        ].map(({ l, v, c, delta }) => (
          <div key={l} className="bg-[var(--input-bg)]/60 rounded-lg p-1.5 text-center">
            <div className="text-[var(--text-muted)] text-xs">{l}</div>
            {delta ? (
              <div className={`font-medium ${isImproving == null ? 'text-[var(--text-muted)]' : isImproving ? 'text-emerald-400' : 'text-orange-400'}`}>
                {value != null && !isNaN(value) ? (
                  b.higherIsBetter
                    ? `${value >= b.good ? '+' : ''}${((value - b.good) / b.good * 100).toFixed(1)}%`
                    : `${value <= b.good ? '' : '+'}${((value - b.good) / b.good * 100).toFixed(1)}%`
                ) : '-'}
              </div>
            ) : (
              <div className={c}>{b.format(v)}</div>
            )}
          </div>
        ))}
      </div>

      <div className="mt-3 text-xs text-[var(--text-dim)] group-hover:text-[var(--text-muted)] transition-colors text-center">
        {t('kpicommand.card.clickDrillDown')}
      </div>
    </motion.div>
  )
}

// ── Drill-down Modal ──────────────────────────────────────────────────────────
function DrillDownModal({ kpiKey, benchmark, monthlyData, onClose }) {
  const { t } = useLanguage()
  if (!kpiKey) return null
  const b = benchmark
  const labels = monthlyData.map(d => monthLabel(d.month))
  const values = monthlyData.map(d => d.value)

  const chartData = {
    labels,
    datasets: [
      {
        label: t(`kpicommand.benchmarks.${kpiKey}.label`),
        data: values,
        borderColor: '#3b82f6',
        backgroundColor: 'rgba(59,130,246,0.1)',
        fill: true,
        tension: 0.4,
        pointBackgroundColor: values.map(v => scoreColor(kpiScore(kpiKey, v))),
        pointRadius: 5,
      },
      {
        label: t('kpicommand.bands.worldClass'),
        data: Array(labels.length).fill(b.world_class),
        borderColor: '#10b981',
        borderDash: [4, 4],
        pointRadius: 0,
        borderWidth: 1.5,
      },
      {
        label: t('kpicommand.bands.good'),
        data: Array(labels.length).fill(b.good),
        borderColor: '#3b82f6',
        borderDash: [4, 4],
        pointRadius: 0,
        borderWidth: 1.5,
      },
      {
        label: t('kpicommand.bands.average'),
        data: Array(labels.length).fill(b.average),
        borderColor: '#f59e0b',
        borderDash: [4, 4],
        pointRadius: 0,
        borderWidth: 1.5,
      },
    ],
  }

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 bg-black/70 z-50 flex items-center justify-center p-4"
        onClick={onClose}
      >
        <motion.div
          initial={{ scale: 0.95, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          exit={{ scale: 0.95, opacity: 0 }}
          onClick={e => e.stopPropagation()}
          className="bg-[var(--surface-1)] border border-[var(--input-border)] rounded-2xl p-6 w-full max-w-3xl"
        >
          <div className="flex items-center justify-between mb-5">
            <div>
              <h3 className="text-white font-bold text-lg">{t('kpicommand.drilldown.title', { label: t(`kpicommand.benchmarks.${kpiKey}.label`) })}</h3>
              <p className="text-[var(--text-muted)] text-sm">{t(`kpicommand.benchmarks.${kpiKey}.description`)}</p>
            </div>
            <button onClick={onClose} className="p-2 rounded-lg bg-[var(--input-bg)] hover:bg-[var(--input-bg-hover)] text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors">
              <X size={16} />
            </button>
          </div>
          <div className="h-72">
            <Line data={chartData} options={{
              ...CHART_BASE,
              plugins: {
                ...CHART_BASE.plugins,
                tooltip: {
                  ...CHART_BASE.plugins.tooltip,
                  callbacks: {
                    label: ctx => `${ctx.dataset.label}: ${b.format(ctx.raw)}`,
                  },
                },
              },
            }} />
          </div>
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
        </motion.div>
      </motion.div>
    </AnimatePresence>
  )
}

// ── Main Component ────────────────────────────────────────────────────────────
export default function KpiCommandCenter() {
  const { t } = useLanguage()
  const { activeCountry, activeCurrency, appSettings } = useSettings()
  const { branding } = useTenant()
  const company = branding?.legal_name || branding?.display_name || appSettings?.company_name || 'TyrePulse'
  // Currency-aware benchmark set - shadows nothing; all display formatting below uses this.
  const BENCHMARKS = useMemo(() => makeBenchmarks(activeCurrency), [activeCurrency])
  const [period, setPeriod] = useState('90d')
  const [customFrom, setCustomFrom] = useState('')
  const [customTo, setCustomTo] = useState('')
  const [site, setSite] = useState('All')
  const [country, setCountry] = useState('All')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [records, setRecords] = useState([])
  const [prevRecords, setPrevRecords] = useState([])
  const [inspections, setInspections] = useState([])
  const [prevInspections, setPrevInspections] = useState([])
  const [sites, setSites] = useState(['All'])
  const [drillKpi, setDrillKpi] = useState(null)
  const [targets, setTargets] = useState({})
  const [monthlyKpiMatrix, setMonthlyKpiMatrix] = useState([])

  useEffect(() => {
    try {
      const stored = localStorage.getItem('tp_kpi_targets')
      if (stored) setTargets(JSON.parse(stored))
    } catch {}
  }, [])

  // Latest issue_date in tyre_records (per active filters), resolved with one
  // cheap indexed single-row query. undefined = still resolving.
  const [dataAnchor, setDataAnchor] = useState(undefined)

  const applyFilters = useCallback((q) => {
    const c = country !== 'All' ? country : activeCountry !== 'All' ? activeCountry : null
    if (c) q = q.eq('country', c)
    if (site !== 'All') q = q.eq('site', site)
    return q
  }, [country, activeCountry, site])

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

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const [
        { data: recs, error: e1 },
        { data: prevRecs, error: e2 },
        { data: insps, error: e3 },
        { data: prevInsps, error: e4 },
        { data: siteRows },
        { data: histRecs },
      ] = await Promise.all([
        fetchAllPages((from_, to_) => applyFilters(
          supabase.from('tyre_records')
            .select('id,issue_date,asset_no,brand,site,country,cost_per_tyre,km_at_fitment,km_at_removal,risk_level,category,tread_depth,pressure_reading')
            .gte('issue_date', from).lte('issue_date', to)
        ).range(from_, to_), { max: 200000 }),
        fetchAllPages((from_, to_) => applyFilters(
          supabase.from('tyre_records')
            .select('id,issue_date,asset_no,cost_per_tyre,km_at_fitment,km_at_removal,risk_level,category,tread_depth')
            .gte('issue_date', prevFrom).lte('issue_date', prevTo)
        ).range(from_, to_), { max: 200000 }),
        fetchAllPages((from_, to_) => applyFilters(
          supabase.from('inspections')
            .select('id,asset_no,site,country,status,scheduled_date,completed_date,findings,inspection_type')
            .gte('inspection_date', from).lte('inspection_date', to)
        ).range(from_, to_), { max: 200000 }),
        fetchAllPages((from_, to_) => applyFilters(
          supabase.from('inspections')
            .select('id,status,scheduled_date,completed_date,findings')
            .gte('inspection_date', prevFrom).lte('inspection_date', prevTo)
        ).range(from_, to_), { max: 200000 }),
        supabase.from('tyre_records').select('site').not('site', 'is', null).limit(1000),
        // 12 months historical for sparklines + matrix
        fetchAllPages((from_, to_) => applyFilters(
          supabase.from('tyre_records')
            .select('id,issue_date,asset_no,cost_per_tyre,km_at_fitment,km_at_removal,risk_level,category,tread_depth')
            .gte('issue_date', (() => { const d = new Date(dataAnchor ?? Date.now()); d.setFullYear(d.getFullYear() - 1); return fmt(d) })())
        ).range(from_, to_), { max: 200000 }),
      ])

      if (e1) throw new Error(e1.message)
      if (e3) throw new Error(e3.message)

      setRecords(recs || [])
      setPrevRecords(prevRecs || [])
      setInspections(insps || [])
      setPrevInspections(prevInsps || [])

      if (siteRows) {
        const unique = ['All', ...new Set(siteRows.map(r => r.site).filter(Boolean)).values()]
        setSites(unique)
      }

      // Build monthly KPI matrix (last 12 months)
      if (histRecs) {
        const allMonths = {}
        histRecs.forEach(r => {
          if (!r.issue_date) return
          const mk = r.issue_date.slice(0, 7)
          if (!allMonths[mk]) allMonths[mk] = { records: [], inspections: [] }
          allMonths[mk].records.push(r)
        })
        const matrix = Object.entries(allMonths)
          .sort(([a], [b]) => a.localeCompare(b))
          .slice(-12)
          .map(([month, { records: mr }]) => {
            const vals = extractKpiValues(mr, [])
            return { month, ...vals }
          })
        setMonthlyKpiMatrix(matrix)
      }
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }, [from, to, prevFrom, prevTo, applyFilters, dataAnchor])

  // Defer the heavy load until the anchor has resolved so the initial fetch
  // already windows over the data's timeline (avoids a wasted empty round-trip).
  useEffect(() => { if (dataAnchor !== undefined) load() }, [load, dataAnchor])

  const kpiValues = useMemo(() => extractKpiValues(records, inspections), [records, inspections])
  const prevKpiValues = useMemo(() => extractKpiValues(prevRecords, prevInspections), [prevRecords, prevInspections])

  const overallScore = useMemo(() => {
    const scores = KPI_KEYS.map(k => kpiScore(k, kpiValues[k]))
    return scores.reduce((s, v) => s + v, 0) / scores.length
  }, [kpiValues])

  const kpiSparklines = useMemo(() => {
    const sparks = {}
    KPI_KEYS.forEach(key => {
      sparks[key] = monthlyKpiMatrix.map(m => m[key] ?? 0)
    })
    return sparks
  }, [monthlyKpiMatrix])

  const radarData = useMemo(() => {
    const labels = KPI_KEYS.map(k => t(`kpicommand.benchmarks.${k}.short`))
    return {
      labels,
      datasets: [
        {
          label: t('kpicommand.radar.fleetCurrent'),
          data: KPI_KEYS.map(k => normalizeForRadar(k, kpiValues[k])),
          backgroundColor: 'rgba(59,130,246,0.15)',
          borderColor: '#3b82f6',
          borderWidth: 2,
          pointBackgroundColor: '#3b82f6',
          pointRadius: 4,
        },
        {
          label: t('kpicommand.radar.referenceAverage'),
          data: KPI_KEYS.map(k => normalizeForRadar(k, BENCHMARKS[k].average)),
          backgroundColor: 'transparent',
          borderColor: '#f97316',
          borderDash: [5, 5],
          borderWidth: 1.5,
          pointRadius: 2,
          pointBackgroundColor: '#f97316',
        },
        {
          label: t('kpicommand.bands.worldClass'),
          data: KPI_KEYS.map(() => 100),
          backgroundColor: 'transparent',
          borderColor: '#10b981',
          borderDash: [3, 3],
          borderWidth: 1.5,
          pointRadius: 2,
          pointBackgroundColor: '#10b981',
        },
      ],
    }
  }, [kpiValues, BENCHMARKS, t])

  const siteKpiData = useMemo(() => {
    if (!records.length) return []
    const groups = {}
    records.forEach(r => {
      const s = r.site || 'Unknown'
      if (!groups[s]) groups[s] = []
      groups[s].push(r)
    })
    return Object.entries(groups).map(([s, recs]) => {
      const vals = extractKpiValues(recs, inspections.filter(i => i.site === s))
      const scores = KPI_KEYS.map(k => kpiScore(k, vals[k]))
      return { site: s, vals, scores, overall: scores.reduce((a, b) => a + b, 0) / scores.length }
    }).sort((a, b) => b.overall - a.overall)
  }, [records, inspections])

  const vehicleScores = useMemo(() => {
    if (!records.length) return { best: [], worst: [] }
    const groups = {}
    records.forEach(r => {
      const v = r.asset_no || 'Unknown'
      if (!groups[v]) groups[v] = []
      groups[v].push(r)
    })
    const vehicles = Object.entries(groups)
      .filter(([, recs]) => recs.length >= 2)
      .map(([asset, recs]) => {
        const cpk = computeCpkFleet(recs).fleetAvgCpk
        const life = computeAvgTyreLife(recs).avgKm
        const fail = computeFailureRate(recs).failureRate * 100
        const scrap = computeScrapRate(recs).scrapRate * 100
        const scores = [
          kpiScore('cpk', cpk),
          kpiScore('tyre_life', life),
          kpiScore('failure_rate', fail),
          kpiScore('scrap_rate', scrap),
        ]
        const overall = scores.reduce((a, b) => a + b, 0) / scores.length
        return { asset, overall: Math.round(overall), cpk, life, fail, count: recs.length }
      })
      .sort((a, b) => b.overall - a.overall)
    return { best: vehicles.slice(0, 5), worst: vehicles.slice(-5).reverse() }
  }, [records])

  const kpiAlerts = useMemo(() => {
    const alerts = []
    KPI_KEYS.forEach(key => {
      const val = kpiValues[key]
      const score = kpiScore(key, val)
      const b = BENCHMARKS[key]
      if (score >= 90) {
        alerts.push({ type: 'achievement', kpi: key, label: b.label, value: b.format(val), msg: t('kpicommand.alerts.msgAchievement'), severity: 0 })
      } else if (score < 45) {
        alerts.push({ type: 'warning', kpi: key, label: b.label, value: b.format(val), msg: t('kpicommand.alerts.msgWarning', { value: b.format(b.average) }), severity: 2 })
      }
      // Trend check
      if (monthlyKpiMatrix.length >= 3) {
        const last3 = monthlyKpiMatrix.slice(-3).map(m => m[key] ?? 0)
        const trend = b.higherIsBetter
          ? last3[2] < last3[0]
          : last3[2] > last3[0]
        if (trend && score < 85) {
          const chg = last3[0] !== 0 ? Math.abs((last3[2] - last3[0]) / last3[0] * 100).toFixed(1) : '-'
          alerts.push({ type: 'deteriorating', kpi: key, label: b.label, value: b.format(val), msg: t('kpicommand.alerts.msgDeteriorating', { pct: chg }), severity: 1 })
        }
      }
    })
    return alerts.sort((a, b) => b.severity - a.severity)
  }, [kpiValues, monthlyKpiMatrix, BENCHMARKS, t])

  const periodComparisonData = useMemo(() => {
    if (!KPI_KEYS.some(k => kpiValues[k] != null)) return null
    return {
      labels: KPI_KEYS.map(k => t(`kpicommand.benchmarks.${k}.short`)),
      datasets: [
        {
          label: t('kpicommand.periodCompare.current'),
          data: KPI_KEYS.map(k => normalizeForRadar(k, kpiValues[k])),
          backgroundColor: 'rgba(59,130,246,0.7)',
          borderColor: '#3b82f6',
          borderWidth: 1,
          borderRadius: 4,
        },
        {
          label: t('kpicommand.periodCompare.previous'),
          data: KPI_KEYS.map(k => normalizeForRadar(k, prevKpiValues[k])),
          backgroundColor: 'rgba(107,114,128,0.4)',
          borderColor: '#6b7280',
          borderWidth: 1,
          borderRadius: 4,
        },
      ],
    }
  }, [kpiValues, prevKpiValues, BENCHMARKS, t])

  const drillMonthlyData = useMemo(() => {
    if (!drillKpi || !monthlyKpiMatrix.length) return []
    return monthlyKpiMatrix.map(m => ({ month: m.month, value: m[drillKpi] ?? 0 }))
  }, [drillKpi, monthlyKpiMatrix])

  async function exportPdf() {
    const { default: jsPDF } = await import('jspdf')
    const { default: autoTable } = await import('jspdf-autotable')
    const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' })
    const brand = await resolvePdfBrand(branding)
    pdfHeader(doc, 'KPI Command Center', `Period: ${from} to ${to}  ·  Overall Fleet Score: ${overallScore.toFixed(0)}/100  ·  ${formatDate(new Date())}`, company, brand)

    autoTable(doc, {
      ...pdfTableTheme(brand.accent),
      startY: 30,
      head: [['KPI', 'Current Value', 'Score', 'Rating', 'vs Good', 'World Class', 'Good', 'Average', 'Poor']],
      body: KPI_KEYS.map(k => {
        const b = BENCHMARKS[k]
        const val = kpiValues[k]
        const score = kpiScore(k, val)
        const rating = ratingLabel(score)
        const delta = val != null
          ? b.higherIsBetter
            ? `${val >= b.good ? '+' : ''}${((val - b.good) / b.good * 100).toFixed(1)}%`
            : `${val <= b.good ? '' : '+'}${((val - b.good) / b.good * 100).toFixed(1)}%`
          : '-'
        return [b.label, b.format(val), `${score.toFixed(0)}/100`, rating.label, delta, b.format(b.world_class), b.format(b.good), b.format(b.average), b.format(b.poor)]
      }),
      margin: { left: 14, right: 14 },
    })

    if (siteKpiData.length) {
      const finalY = doc.lastAutoTable.finalY + 8
      autoTable(doc, {
        ...pdfTableTheme(brand.accent),
        startY: finalY,
        head: [['Site', 'Overall', ...KPI_KEYS.map(k => BENCHMARKS[k].label.replace(' Compliance', '').replace('Avg ', '').slice(0, 12))]],
        body: siteKpiData.map(sd => [
          sd.site,
          `${sd.overall.toFixed(0)}/100`,
          ...KPI_KEYS.map(k => BENCHMARKS[k].format(sd.vals[k])),
        ]),
        margin: { left: 14, right: 14 },
      })
    }

    const totalPages = doc.internal.getNumberOfPages()
    for (let p = 1; p <= totalPages; p++) { doc.setPage(p); pdfFooter(doc, p, totalPages, company, brand) }
    doc.save(`kpi-command-center-${new Date().toISOString().slice(0, 10)}.pdf`)
  }

  async function exportExcel() {
    const XLSX = await import('xlsx')
    const wb = XLSX.utils.book_new()
    const kpiRows = KPI_KEYS.map(k => {
      const b = BENCHMARKS[k]
      const val = kpiValues[k]
      const score = kpiScore(k, val)
      return {
        KPI: b.label,
        'Current Value': val != null ? Number(val.toFixed(4)) : null,
        'Formatted Value': b.format(val),
        Score: score.toFixed(0),
        Rating: ratingLabel(score).label,
        'World Class': b.world_class,
        Good: b.good,
        Average: b.average,
        Poor: b.poor,
      }
    })
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(kpiRows), 'KPI Summary')

    if (siteKpiData.length) {
      const siteRows = siteKpiData.map(sd => ({
        Site: sd.site,
        'Overall Score': sd.overall.toFixed(0),
        ...Object.fromEntries(KPI_KEYS.map(k => [BENCHMARKS[k].label, BENCHMARKS[k].format(sd.vals[k])])),
      }))
      XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(siteRows), 'Site Comparison')
    }

    if (monthlyKpiMatrix.length) {
      const matrixRows = monthlyKpiMatrix.map(m => ({
        Month: m.month,
        ...Object.fromEntries(KPI_KEYS.map(k => [BENCHMARKS[k].label, BENCHMARKS[k].format(m[k])])),
      }))
      XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(matrixRows), 'Monthly Trend')
    }

    XLSX.writeFile(wb, `kpi-command-center-${new Date().toISOString().slice(0, 10)}.xlsx`)
  }

  const cellBg = (key, val) => {
    const score = kpiScore(key, val)
    if (score >= 90) return 'bg-emerald-900/40 text-emerald-300'
    if (score >= 70) return 'bg-blue-900/40 text-blue-300'
    if (score >= 45) return 'bg-yellow-900/40 text-yellow-300'
    if (score >= 20) return 'bg-orange-900/40 text-orange-300'
    return 'bg-red-900/40 text-red-300'
  }

  return (
    <div className="space-y-5">

      <SectionTabs tabs={KPI_TABS} />
      {/* Header */}
      <PageHeader
        title={t('kpicommand.title')}
        subtitle={t('kpicommand.subtitle', { count: records.length.toLocaleString() })}
        icon={Command}
        actions={<>
          <SegmentedControl
            ariaLabel={t('kpicommand.ariaLabels.period')}
            size="sm"
            value={period}
            onChange={setPeriod}
            options={PERIOD_PRESETS.map(p => ({ value: p.value, label: t(`kpicommand.periods.${p.value}`) }))}
          />

          {period === 'custom' && (
            <div className="flex items-center gap-1">
              <input type="date" value={customFrom} onChange={e => setCustomFrom(e.target.value)}
                className="px-2 py-1.5 bg-[var(--input-bg)] border border-[var(--input-border)] rounded-lg text-white text-xs focus:outline-none" />
              <span className="text-[var(--text-muted)] text-xs">{t('kpicommand.filters.to')}</span>
              <input type="date" value={customTo} onChange={e => setCustomTo(e.target.value)}
                className="px-2 py-1.5 bg-[var(--input-bg)] border border-[var(--input-border)] rounded-lg text-white text-xs focus:outline-none" />
            </div>
          )}

          <select value={site} onChange={e => setSite(e.target.value)}
            className="px-3 py-1.5 bg-[var(--input-bg)] border border-[var(--input-border)] rounded-lg text-white text-xs focus:outline-none">
            {sites.map(s => <option key={s} value={s}>{s === 'All' ? t('kpicommand.filters.allSites') : s}</option>)}
          </select>

          <select value={country} onChange={e => setCountry(e.target.value)}
            className="px-3 py-1.5 bg-[var(--input-bg)] border border-[var(--input-border)] rounded-lg text-white text-xs focus:outline-none">
            <option value="All">{t('kpicommand.filters.allCountries')}</option>
            {COUNTRIES.map(c => <option key={c}>{c}</option>)}
          </select>

          <button onClick={load} disabled={loading}
            className="p-2 rounded-lg bg-[var(--input-bg)] border border-[var(--input-border)] text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors">
            <RefreshCw size={15} className={loading ? 'animate-spin' : ''} />
          </button>

          <button onClick={exportPdf}
            className="flex items-center gap-2 px-3 py-1.5 bg-[var(--input-bg)] border border-[var(--input-border)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] text-xs rounded-lg transition-colors">
            <FileText size={14} />{t('kpicommand.actions.pdf')}
          </button>

          <button onClick={exportExcel}
            className="flex items-center gap-2 px-3 py-1.5 bg-[var(--input-bg)] border border-[var(--input-border)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] text-xs rounded-lg transition-colors">
            <Download size={14} />{t('kpicommand.actions.excel')}
          </button>
        </>}
      />

      {error && (
        <div className="bg-red-900/30 border border-red-700 rounded-xl p-4 text-red-300 text-sm flex items-center gap-2">
          <AlertTriangle size={16} />
          {error}
        </div>
      )}

      {/* Command Panel: Fleet Score + KPI Scores Strip */}
      <div className="card">
        <div className="flex flex-col lg:flex-row items-center gap-8">
          <div className="flex flex-col items-center gap-2">
            <FleetScoreGauge score={overallScore} />
            <div className="text-center">
              <p className="text-[var(--text-primary)] font-semibold">{t('kpicommand.panel.overallScore')}</p>
              <p className="text-[var(--text-muted)] text-xs">{t('kpicommand.panel.overallScoreDesc')}</p>
            </div>
          </div>

          <div className="flex-1 grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
            {KPI_KEYS.map(key => {
              const val = kpiValues[key]
              const score = kpiScore(key, val)
              const rating = ratingLabel(score)
              const b = BENCHMARKS[key]
              const Icon = b.icon
              return (
                <motion.div key={key} whileHover={{ scale: 1.02 }}
                  onClick={() => setDrillKpi(key)}
                  className="bg-[var(--input-bg)] rounded-xl p-3 text-center cursor-pointer hover:border-gray-600 border border-[var(--input-border)] transition-all">
                  <Icon size={14} className={`mx-auto mb-1 ${rating.color}`} />
                  <div className="text-[var(--text-muted)] text-xs mb-1 truncate">{t(`kpicommand.benchmarks.${key}.short`)}</div>
                  <div className={`text-lg font-bold tabular-nums ${rating.color}`}>
                    {val != null && !isNaN(val) ? b.format(val) : '-'}
                  </div>
                  <div className={`text-xs mt-0.5 ${rating.color}`}>{t(`kpicommand.ratings.${rating.key}`)}</div>
                  <div className="mt-2 h-1.5 bg-[var(--input-border)] rounded-full overflow-hidden">
                    <div
                      className="h-full rounded-full transition-all duration-1000"
                      style={{ width: `${score}%`, backgroundColor: scoreColor(score) }}
                    />
                  </div>
                  <div className="text-xs text-[var(--text-dim)] mt-1">{score.toFixed(0)}/100</div>
                </motion.div>
              )
            })}
          </div>
        </div>
      </div>

      {/* KPI Scorecard Grid */}
      <div>
        <h2 className="text-[var(--text-primary)] font-semibold mb-3 flex items-center gap-2">
          <Target size={16} className="text-blue-400" />
          {t('kpicommand.sections.kpiScorecard')}
        </h2>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {KPI_KEYS.map(key => (
            <KpiCard
              key={key}
              kpiKey={key}
              benchmark={BENCHMARKS[key]}
              value={kpiValues[key]}
              prevValue={prevKpiValues[key]}
              sparkData={kpiSparklines[key]}
              targets={targets}
              onClick={() => setDrillKpi(key)}
            />
          ))}
        </div>
      </div>

      {/* Radar + Period Comparison */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        {/* Radar Chart */}
        <div className="card">
          <h3 className="text-[var(--text-primary)] font-semibold mb-1 flex items-center gap-2">
            <Layers size={16} className="text-purple-400" />
            {t('kpicommand.sections.fleetVsBenchmark')}
          </h3>
          <p className="text-[var(--text-muted)] text-xs mb-4">{t('kpicommand.sections.fleetVsBenchmarkDesc')}</p>
          <div className="h-72">
            <Radar data={radarData} options={{
              responsive: true,
              maintainAspectRatio: false,
              plugins: {
                legend: { labels: { color: '#9ca3af', boxWidth: 10, font: { size: 10 } } },
                tooltip: { backgroundColor: 'var(--panel)', borderColor: 'var(--hairline)', borderWidth: 1, titleColor: '#f9fafb', bodyColor: '#d1d5db' },
              },
              scales: {
                r: {
                  ticks: { color: '#6b7280', backdropColor: 'transparent', font: { size: 9 } },
                  grid: { color: 'var(--panel-2)' },
                  pointLabels: { color: '#9ca3af', font: { size: 10 } },
                  suggestedMin: 0,
                  suggestedMax: 100,
                },
              },
            }} />
          </div>
        </div>

        {/* Period Comparison */}
        <div className="card">
          <h3 className="text-[var(--text-primary)] font-semibold mb-1 flex items-center gap-2">
            <Calendar size={16} className="text-orange-400" />
            {t('kpicommand.sections.periodComparison')}
          </h3>
          <p className="text-[var(--text-muted)] text-xs mb-4">{t('kpicommand.sections.periodComparisonDesc')}</p>
          <div className="h-72">
            {periodComparisonData && (
              <Bar data={periodComparisonData} options={{
                ...CHART_BASE,
                plugins: {
                  ...CHART_BASE.plugins,
                  legend: { labels: { color: '#9ca3af', boxWidth: 10, font: { size: 10 } } },
                },
                scales: {
                  x: { ...CHART_BASE.scales.x, ticks: { ...CHART_BASE.scales.x.ticks, maxRotation: 30 } },
                  y: { ...CHART_BASE.scales.y, max: 110, title: { display: true, text: t('kpicommand.charts.scoreAxis'), color: '#6b7280', font: { size: 9 } } },
                },
              }} />
            )}
          </div>
          <div className="mt-3 grid grid-cols-1 sm:grid-cols-3 gap-2">
            {KPI_KEYS.slice(0, 3).map(key => {
              const curr = kpiValues[key]
              const prev = prevKpiValues[key]
              const b = BENCHMARKS[key]
              const pct = prev && prev !== 0 ? ((curr - prev) / Math.abs(prev) * 100) : null
              const improving = pct != null ? (b.higherIsBetter ? pct >= 0 : pct <= 0) : null
              return (
                <div key={key} className="bg-[var(--input-bg)] rounded-lg p-2 text-center">
                  <div className="text-[var(--text-muted)] text-xs truncate">{t(`kpicommand.benchmarks.${key}.short`)}</div>
                  <div className="text-white text-sm font-semibold">{b.format(curr)}</div>
                  {pct != null && (
                    <div className={`text-xs flex items-center justify-center gap-0.5 ${improving ? 'text-emerald-400' : 'text-red-400'}`}>
                      {improving ? <ArrowUpRight size={10} /> : <ArrowDownRight size={10} />}
                      {Math.abs(pct).toFixed(1)}%
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </div>
      </div>

      {/* KPI Trend Matrix */}
      {monthlyKpiMatrix.length > 0 && (
        <div className="bg-[var(--surface-1)] border border-[var(--input-border)] rounded-2xl overflow-hidden">
          <div className="px-5 py-4 border-b border-[var(--input-border)] flex items-center gap-2">
            <BarChart3 size={16} className="text-blue-400" />
            <h3 className="text-[var(--text-primary)] font-semibold">{t('kpicommand.sections.trendMatrix')}</h3>
            <span className="text-[var(--text-muted)] text-xs ml-1">{t('kpicommand.sections.clickCellHint')}</span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-[var(--input-border)]">
                  <th className="px-4 py-3 text-left text-[var(--text-muted)] font-medium sticky left-0 bg-[var(--surface-1)] min-w-40">{t('kpicommand.columns.kpi')}</th>
                  {monthlyKpiMatrix.map(m => (
                    <th key={m.month} className="px-3 py-3 text-center text-[var(--text-muted)] font-medium min-w-20">
                      {monthLabel(m.month)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {KPI_KEYS.map(key => {
                  const b = BENCHMARKS[key]
                  return (
                    <tr key={key} className="border-b border-[var(--input-border)] hover:bg-[var(--input-bg)]/30">
                      <td className="px-4 py-2.5 sticky left-0 bg-[var(--surface-1)]">
                        <div className="text-[var(--text-secondary)] font-medium">{t(`kpicommand.benchmarks.${key}.short`)}</div>
                      </td>
                      {monthlyKpiMatrix.map(m => {
                        const val = m[key]
                        return (
                          <td key={m.month}
                            onClick={() => setDrillKpi(key)}
                            className={`px-3 py-2.5 text-center font-medium cursor-pointer hover:opacity-80 transition-opacity rounded ${cellBg(key, val)}`}>
                            {val != null && !isNaN(val) ? b.format(val) : '-'}
                          </td>
                        )
                      })}
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Site KPI Heatmap */}
      {siteKpiData.length > 0 && (
        <div className="bg-[var(--surface-1)] border border-[var(--input-border)] rounded-2xl overflow-hidden">
          <div className="px-5 py-4 border-b border-[var(--input-border)] flex items-center gap-2">
            <MapPin size={16} className="text-emerald-400" />
            <h3 className="text-[var(--text-primary)] font-semibold">{t('kpicommand.sections.siteComparison')}</h3>
            <span className="text-[var(--text-muted)] text-xs ml-1">{t('kpicommand.sections.colorLegendHint')}</span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-[var(--input-border)]">
                  <th className="px-4 py-3 text-left text-[var(--text-muted)] font-medium sticky left-0 bg-[var(--surface-1)] min-w-36">{t('kpicommand.columns.site')}</th>
                  <th className="px-3 py-3 text-center text-[var(--text-muted)] font-medium">{t('kpicommand.columns.score')}</th>
                  {KPI_KEYS.map(k => (
                    <th key={k} className="px-3 py-3 text-center text-[var(--text-muted)] font-medium min-w-24">
                      {t(`kpicommand.benchmarks.${k}.short`)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {siteKpiData.map((sd, i) => (
                  <tr key={sd.site} className="border-b border-[var(--input-border)] hover:bg-[var(--input-bg)]/30">
                    <td className="px-4 py-2.5 sticky left-0 bg-[var(--surface-1)]">
                      <div className="flex items-center gap-2">
                        {i === 0 && <Trophy size={12} className="text-yellow-400" />}
                        <span className="text-white font-medium">{sd.site}</span>
                      </div>
                    </td>
                    <td className="px-3 py-2.5 text-center">
                      <span className={`font-bold ${scoreTextColor(sd.overall)}`}>{sd.overall.toFixed(0)}</span>
                    </td>
                    {KPI_KEYS.map((key, ki) => {
                      const val = sd.vals[key]
                      const b = BENCHMARKS[key]
                      const isBest = siteKpiData[0]?.vals[key] === val
                      const isWorst = siteKpiData[siteKpiData.length - 1]?.vals[key] === val
                      return (
                        <td key={key} className={`px-3 py-2.5 text-center font-medium rounded ${cellBg(key, val)}`}>
                          <div className="flex items-center justify-center gap-1">
                            {val != null && !isNaN(val) ? b.format(val) : '-'}
                            {isBest && siteKpiData.length > 1 && <Star size={9} className="text-yellow-400" />}
                          </div>
                        </td>
                      )
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* KPI Alerts + Target vs Actual */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        {/* Alerts */}
        <div className="bg-[var(--surface-1)] border border-[var(--input-border)] rounded-2xl overflow-hidden">
          <div className="px-5 py-4 border-b border-[var(--input-border)] flex items-center gap-2">
            <AlertTriangle size={16} className="text-yellow-400" />
            <h3 className="text-[var(--text-primary)] font-semibold">{t('kpicommand.sections.alerts')}</h3>
            <span className="ml-auto text-xs bg-[var(--input-bg)] px-2 py-0.5 rounded-full text-[var(--text-muted)]">{kpiAlerts.length}</span>
          </div>
          <div className="divide-y divide-[var(--input-border)] max-h-80 overflow-y-auto">
            {kpiAlerts.length === 0 && (
              <div className="px-5 py-8 text-center">
                <CheckCircle size={32} className="mx-auto text-emerald-400 mb-2" />
                <p className="text-emerald-400 font-medium text-sm">{t('kpicommand.alerts.allWithinRange')}</p>
              </div>
            )}
            {kpiAlerts.map((a, i) => {
              const b = BENCHMARKS[a.kpi]
              const Icon = b.icon
              const typeConfig = {
                achievement: { icon: Trophy, color: 'text-emerald-400', bg: 'border-l-emerald-500', badge: 'bg-emerald-900/30 text-emerald-400' },
                warning: { icon: AlertTriangle, color: 'text-red-400', bg: 'border-l-red-500', badge: 'bg-red-900/30 text-red-400' },
                deteriorating: { icon: TrendingDown, color: 'text-yellow-400', bg: 'border-l-yellow-500', badge: 'bg-yellow-900/30 text-yellow-400' },
              }[a.type] || {}
              const TypeIcon = typeConfig.icon
              return (
                <div key={i} className={`px-5 py-3 flex items-start gap-3 border-l-2 ${typeConfig.bg}`}>
                  <TypeIcon size={16} className={`${typeConfig.color} flex-shrink-0 mt-0.5`} />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-white text-sm font-medium">{t(`kpicommand.benchmarks.${a.kpi}.label`)}</span>
                      <span className={`text-xs px-1.5 py-0.5 rounded-full ${typeConfig.badge}`}>
                        {a.type === 'achievement' ? t('kpicommand.alerts.type.achievement') : a.type === 'warning' ? t('kpicommand.alerts.type.warning') : t('kpicommand.alerts.type.deteriorating')}
                      </span>
                    </div>
                    <p className="text-[var(--text-muted)] text-xs mt-0.5">
                      <span className={`font-medium ${typeConfig.color}`}>{a.value}</span> - {a.msg}
                    </p>
                  </div>
                </div>
              )
            })}
          </div>
        </div>

        {/* Target vs Actual */}
        <div className="bg-[var(--surface-1)] border border-[var(--input-border)] rounded-2xl overflow-hidden">
          <div className="px-5 py-4 border-b border-[var(--input-border)] flex items-center gap-2">
            <Target size={16} className="text-blue-400" />
            <h3 className="text-[var(--text-primary)] font-semibold">{t('kpicommand.sections.targetVsActual')}</h3>
          </div>
          <div className="divide-y divide-[var(--input-border)]">
            {KPI_KEYS.map(key => {
              const b = BENCHMARKS[key]
              const val = kpiValues[key]
              const target = targets[key] ?? b.good
              const gap = val != null ? val - target : null
              const onTrack = gap != null ? (b.higherIsBetter ? gap >= 0 : gap <= 0) : null
              const exceeded = gap != null ? (b.higherIsBetter ? val >= b.good * 1.1 : val <= b.good * 0.9) : null
              const status = exceeded ? t('kpicommand.targetActual.status.exceeded') : onTrack ? t('kpicommand.targetActual.status.onTrack') : t('kpicommand.targetActual.status.behind')
              const statusStyle = exceeded
                ? 'bg-emerald-900/30 text-emerald-400'
                : onTrack
                  ? 'bg-blue-900/30 text-blue-400'
                  : 'bg-red-900/30 text-red-400'
              return (
                <div key={key} className="px-5 py-3 flex items-center gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="text-white text-sm font-medium truncate">{t(`kpicommand.benchmarks.${key}.label`)}</div>
                    <div className="flex items-center gap-3 mt-1 text-xs text-[var(--text-muted)]">
                      <span>{t('kpicommand.targetActual.target')} <span className="text-[var(--text-secondary)]">{b.format(target)}</span></span>
                      <span>{t('kpicommand.targetActual.actual')} <span className="text-[var(--text-secondary)]">{val != null ? b.format(val) : '-'}</span></span>
                      {gap != null && (
                        <span>{t('kpicommand.targetActual.gap')} <span className={onTrack ? 'text-emerald-400' : 'text-red-400'}>
                          {b.higherIsBetter ? (gap >= 0 ? '+' : '') : (gap <= 0 ? '' : '+')}
                          {b.format(Math.abs(gap))}
                        </span></span>
                      )}
                    </div>
                  </div>
                  <span className={`text-xs px-2 py-1 rounded-full font-medium flex-shrink-0 ${statusStyle}`}>
                    {status}
                  </span>
                </div>
              )
            })}
          </div>
        </div>
      </div>

      {/* Top/Bottom Vehicles */}
      {(vehicleScores.best.length > 0 || vehicleScores.worst.length > 0) && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
          <div className="bg-[var(--surface-1)] border border-[var(--input-border)] rounded-2xl overflow-hidden">
            <div className="px-5 py-4 border-b border-[var(--input-border)] flex items-center gap-2">
              <Trophy size={16} className="text-yellow-400" />
              <h3 className="text-[var(--text-primary)] font-semibold">{t('kpicommand.sections.topVehicles')}</h3>
            </div>
            <div className="divide-y divide-[var(--input-border)]">
              {vehicleScores.best.map((v, i) => (
                <div key={v.asset} className="px-5 py-3 flex items-center gap-3">
                  <div className={`w-7 h-7 rounded-full flex items-center justify-center flex-shrink-0 text-xs font-bold ${
                    i === 0 ? 'bg-yellow-900/40 text-yellow-400 border border-yellow-700' :
                    i === 1 ? 'bg-[var(--input-border)]/40 text-[var(--text-secondary)] border border-gray-600' :
                    i === 2 ? 'bg-amber-900/40 text-amber-600 border border-amber-700' :
                    'bg-[var(--input-bg)] text-[var(--text-muted)] border border-[var(--input-border)]'
                  }`}>
                    {i === 0 ? <Star size={12} /> : `#${i + 1}`}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-white text-sm font-semibold">{v.asset}</div>
                    <div className="text-[var(--text-muted)] text-xs">
                      {t('kpicommand.vehicles.statsBest', { cpk: BENCHMARKS.cpk.format(v.cpk), life: (v.life / 1000).toFixed(0), count: v.count })}
                    </div>
                  </div>
                  <div className={`text-lg font-bold ${scoreTextColor(v.overall)}`}>{v.overall}</div>
                </div>
              ))}
            </div>
          </div>

          <div className="bg-[var(--surface-1)] border border-[var(--input-border)] rounded-2xl overflow-hidden">
            <div className="px-5 py-4 border-b border-[var(--input-border)] flex items-center gap-2">
              <AlertOctagon size={16} className="text-red-400" />
              <h3 className="text-[var(--text-primary)] font-semibold">{t('kpicommand.sections.bottomVehicles')}</h3>
            </div>
            <div className="divide-y divide-[var(--input-border)]">
              {vehicleScores.worst.map((v, i) => (
                <div key={v.asset} className="px-5 py-3 flex items-center gap-3">
                  <div className="w-7 h-7 rounded-full flex items-center justify-center flex-shrink-0 text-xs font-bold bg-red-900/40 text-red-400 border border-red-700">
                    !
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-white text-sm font-semibold">{v.asset}</div>
                    <div className="text-[var(--text-muted)] text-xs">
                      {t('kpicommand.vehicles.statsWorst', { cpk: BENCHMARKS.cpk.format(v.cpk), fail: v.fail.toFixed(1), count: v.count })}
                    </div>
                  </div>
                  <div className={`text-lg font-bold ${scoreTextColor(v.overall)}`}>{v.overall}</div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Drill-down Modal */}
      {drillKpi && (
        <DrillDownModal
          kpiKey={drillKpi}
          benchmark={BENCHMARKS[drillKpi]}
          monthlyData={drillMonthlyData}
          onClose={() => setDrillKpi(null)}
        />
      )}

      {/* Empty state */}
      {!loading && records.length === 0 && !error && (
        <div className="text-center py-16">
          <Command size={48} className="mx-auto text-gray-700 mb-4" />
          <p className="text-[var(--text-muted)] font-medium">{t('kpicommand.empty.title')}</p>
          <p className="text-[var(--text-dim)] text-sm mt-1">{t('kpicommand.empty.subtitle')}</p>
        </div>
      )}
    </div>
  )
}
