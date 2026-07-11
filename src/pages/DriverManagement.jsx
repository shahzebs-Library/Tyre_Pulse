import { useState, useEffect, useMemo, useCallback, useRef } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { supabase } from '../lib/supabase'
import { fetchAllPages } from '../lib/fetchAll'
import { useSettings } from '../contexts/SettingsContext'
import { exportToExcel, exportToPdf } from '../lib/exportUtils'
import PageHeader from '../components/ui/PageHeader'
import EmptyState from '../components/EmptyState'
import {
  User, Users, TrendingUp, TrendingDown, Award, AlertTriangle,
  BarChart2, FileText, FileSpreadsheet, Search, Filter,
  X, ChevronDown, ChevronUp, RefreshCw, Eye, Calendar, Upload,
} from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import {
  Chart as ChartJS,
  CategoryScale, LinearScale, BarElement, Title, Tooltip, Legend,
} from 'chart.js'
import { Bar } from 'react-chartjs-2'

ChartJS.register(CategoryScale, LinearScale, BarElement, Title, Tooltip, Legend)

// ── Constants ──────────────────────────────────────────────────────────────────
const CHART_THEME = {
  gridColor:'var(--text-muted)',
  tickColor: '#6b7280',
  tooltipBg: '#1f2937',
}

const DRIVER_PALETTE = [
  '#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6',
  '#ec4899', '#14b8a6', '#f97316', '#6366f1', '#84cc16',
  '#06b6d4', '#a855f7', '#e11d48', '#78716c', '#0ea5e9',
]

const DATE_PRESETS = [
  { label: '3mo', days: 90 },
  { label: '6mo', days: 180 },
  { label: '1yr', days: 365 },
  { label: 'All', days: null },
]

// ── Helpers ────────────────────────────────────────────────────────────────────
function applyDatePreset(days) {
  if (!days) return { from: '', to: '' }
  const to = new Date()
  const from = new Date()
  from.setDate(from.getDate() - days)
  return { from: from.toISOString().slice(0, 10), to: to.toISOString().slice(0, 10) }
}

function fmtCpk(v, currency) {
  if (v == null || !isFinite(v) || v <= 0) return 'N/A'
  return `${currency} ${v.toFixed(4)}`
}

function fmtCurrency(v, currency) {
  if (v == null || !isFinite(v)) return `${currency} 0`
  return `${currency} ${Math.round(v).toLocaleString()}`
}

function fmtKm(v) {
  if (v == null || !isFinite(v) || v === 0) return 'N/A'
  if (v >= 1000) return `${(v / 1000).toFixed(1)}k km`
  return `${Math.round(v).toLocaleString()} km`
}

function fmtPct(v) {
  if (v == null || !isFinite(v)) return '0.0%'
  return `${v.toFixed(1)}%`
}

function performanceBadge(score) {
  if (score <= 20) return { label: 'Excellent', cls: 'bg-green-500/20 text-green-400 border-green-500/30' }
  if (score <= 40) return { label: 'Good',      cls: 'bg-blue-500/20 text-blue-400 border-blue-500/30' }
  if (score <= 60) return { label: 'Average',   cls: 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30' }
  if (score <= 80) return { label: 'Poor',      cls: 'bg-orange-500/20 text-orange-400 border-orange-500/30' }
  return                  { label: 'Critical',  cls: 'bg-red-500/20 text-red-400 border-red-500/30' }
}

function riskScoreColor(score) {
  if (score <= 20) return '#10b981'
  if (score <= 40) return '#3b82f6'
  if (score <= 60) return '#f59e0b'
  if (score <= 80) return '#f97316'
  return '#ef4444'
}

function cpkColor(cpk) {
  if (cpk == null || !isFinite(cpk) || cpk <= 0) return 'text-[var(--text-muted)]'
  if (cpk <= 1.0) return 'text-green-400'
  if (cpk <= 2.0) return 'text-yellow-400'
  return 'text-red-400'
}

function calcCpk(cost, kmFit, kmRem) {
  if (cost == null || kmFit == null || kmRem == null) return null
  const dist = kmRem - kmFit
  if (dist <= 0) return null
  return cost / dist
}

function isHighRisk(r) {
  const rl = (r.risk_level ?? '').toLowerCase()
  return rl === 'high' || rl === 'critical'
}

// ── Aggregate driver stats ────────────────────────────────────────────────────
function aggregateDrivers(records) {
  const map = new Map()

  for (const r of records) {
    const name = (r.driver_name ?? '').trim() || 'Unassigned'
    if (!map.has(name)) {
      map.set(name, {
        name,
        records: [],
        cpkValues: [],
        totalCost: 0,
        kmValues: [],
        highRiskCount: 0,
      })
    }
    const d = map.get(name)
    d.records.push(r)
    d.totalCost += (r.cost_per_tyre ?? 0) * (r.qty || 1)
    if (isHighRisk(r)) d.highRiskCount++
    const cpk = calcCpk(r.cost_per_tyre, r.km_at_fitment, r.km_at_removal)
    if (cpk !== null && cpk > 0) d.cpkValues.push(cpk)
    const life = (r.km_at_removal != null && r.km_at_fitment != null)
      ? r.km_at_removal - r.km_at_fitment
      : null
    if (life !== null && life > 0) d.kmValues.push(life)
  }

  const drivers = Array.from(map.values()).map(d => ({
    name: d.name,
    totalTyres: d.records.length,
    totalCost: d.totalCost,
    avgCpk: d.cpkValues.length > 0
      ? d.cpkValues.reduce((s, v) => s + v, 0) / d.cpkValues.length
      : null,
    avgTyreLife: d.kmValues.length > 0
      ? d.kmValues.reduce((s, v) => s + v, 0) / d.kmValues.length
      : null,
    failureRate: d.records.length > 0
      ? (d.highRiskCount / d.records.length) * 100
      : 0,
    highRiskCount: d.highRiskCount,
    records: d.records,
  }))

  // Rank by avgCpk (nulls last), then compute composite risk scores
  const withCpk = drivers.filter(d => d.avgCpk !== null)
  const noCpk   = drivers.filter(d => d.avgCpk === null)

  withCpk.sort((a, b) => a.avgCpk - b.avgCpk)
  const cpkRanked = withCpk.map((d, i) => ({ ...d, cpkRank: (i / Math.max(withCpk.length - 1, 1)) * 100 }))

  const allForFailure = [...cpkRanked, ...noCpk.map(d => ({ ...d, cpkRank: 100 }))]
  const sortedByFailure = [...allForFailure].sort((a, b) => a.failureRate - b.failureRate)
  const failureRankMap = new Map(
    sortedByFailure.map((d, i) => [d.name, (i / Math.max(sortedByFailure.length - 1, 1)) * 100])
  )

  const withScores = allForFailure.map(d => {
    const failureRank = failureRankMap.get(d.name) ?? 100
    const riskScore = Math.min(100, Math.round(d.cpkRank * 0.4 + failureRank * 0.6))
    return { ...d, riskScore }
  })

  withScores.sort((a, b) => a.riskScore - b.riskScore)
  return withScores.map((d, i) => ({ ...d, rank: i + 1 }))
}

// ── Chart config factories ─────────────────────────────────────────────────────
function barOptions(horizontal = false) {
  return {
    responsive: true,
    maintainAspectRatio: false,
    indexAxis: horizontal ? 'y' : 'x',
    plugins: {
      legend: { display: false },
      tooltip: {
        backgroundColor: CHART_THEME.tooltipBg,
        titleColor:'var(--panel-ink)',
        bodyColor: '#d1d5db',
        padding: 10,
        cornerRadius: 8,
      },
    },
    scales: {
      x: {
        grid: { color: CHART_THEME.gridColor },
        ticks: { color: CHART_THEME.tickColor, font: { size: 10 } },
      },
      y: {
        grid: { color: CHART_THEME.gridColor },
        ticks: { color: CHART_THEME.tickColor, font: { size: 10 } },
      },
    },
  }
}

// ── KPI Card ──────────────────────────────────────────────────────────────────
function KpiCard({ icon: Icon, label, value, sub, color = '#3b82f6', loading }) {
  return (
    <motion.div
      className="rounded-xl p-4 flex items-start gap-3 relative overflow-hidden"
      style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.07)' }}
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3 }}
    >
      <div className="w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0"
        style={{ background: `${color}20`, border: `1px solid ${color}30` }}>
        <Icon size={16} style={{ color }} />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-xs text-[var(--text-muted)] mb-0.5">{label}</p>
        {loading
          ? <div className="h-6 w-24 bg-[var(--input-bg)] rounded animate-pulse" />
          : <p className="text-lg font-bold text-[var(--text-primary)] truncate">{value}</p>
        }
        {sub && <p className="text-[11px] text-[var(--text-dim)] mt-0.5 truncate">{sub}</p>}
      </div>
      <div className="absolute bottom-0 left-0 right-0 h-0.5 opacity-30 rounded-b-xl"
        style={{ background: `linear-gradient(90deg, transparent, ${color}, transparent)` }} />
    </motion.div>
  )
}

// ── Sort header ───────────────────────────────────────────────────────────────
function SortTh({ col, label, sortCol, sortDir, onSort, className = '' }) {
  const active = sortCol === col
  return (
    <th
      className={`px-3 py-2.5 text-left text-[11px] font-semibold text-[var(--text-muted)] uppercase tracking-wider cursor-pointer select-none hover:text-[var(--text-dim)] transition-colors ${className}`}
      onClick={() => onSort(col)}
    >
      <span className="flex items-center gap-1">
        {label}
        {active
          ? sortDir === 'asc'
            ? <ChevronUp size={11} className="text-green-400" />
            : <ChevronDown size={11} className="text-green-400" />
          : <ChevronDown size={11} className="opacity-30" />
        }
      </span>
    </th>
  )
}

// ── Risk Score Bar ────────────────────────────────────────────────────────────
function RiskBar({ score }) {
  const color = riskScoreColor(score)
  return (
    <div className="flex items-center gap-2 min-w-[80px]">
      <div className="flex-1 h-1.5 bg-[var(--input-border)] rounded-full overflow-hidden">
        <div
          className="h-full rounded-full transition-all duration-500"
          style={{ width: `${score}%`, backgroundColor: color }}
        />
      </div>
      <span className="text-[11px] font-mono" style={{ color }}>{score}</span>
    </div>
  )
}

// ── Main Component ─────────────────────────────────────────────────────────────
export default function DriverManagement() {
  const navigate = useNavigate()
  const { activeCurrency, activeCountry } = useSettings()

  // Data state
  const [records, setRecords]   = useState([])
  const [loading, setLoading]   = useState(true)
  const [error, setError]       = useState(null)

  // Filters
  const [datePreset, setDatePreset] = useState('1yr')
  const [dateFrom, setDateFrom]     = useState(() => applyDatePreset(365).from)
  const [dateTo, setDateTo]         = useState(() => applyDatePreset(365).to)
  const [searchQuery, setSearchQuery] = useState('')
  const [siteFilter, setSiteFilter]   = useState('all')
  const [countryFilter, setCountryFilter] = useState('all')
  const [showFilters, setShowFilters] = useState(false)

  // Table state
  const [sortCol, setSortCol] = useState('riskScore')
  const [sortDir, setSortDir] = useState('asc')

  // Guards against a slow earlier response overwriting a newer one after the
  // active country changes (fetch-race cancellation).
  const reqIdRef = useRef(0)

  // ── Data fetch ──────────────────────────────────────────────────────────────
  const load = useCallback(async () => {
    const myReq = ++reqIdRef.current
    setLoading(true)
    setError(null)
    try {
      const { data, error: err } = await fetchAllPages((from, to) => {
        let q = supabase
          .from('tyre_records')
          .select(
            'id,asset_no,asset_number,serial_no,brand,site,country,driver_name,driver_id,' +
            'cost_per_tyre,km_at_fitment,km_at_removal,risk_level,removal_reason,issue_date,category'
          )
        if (activeCountry && activeCountry !== 'All') {
          q = q.eq('country', activeCountry)
        }
        return q.range(from, to)
      })
      if (myReq !== reqIdRef.current) return
      if (err) throw err
      setRecords(data || [])
    } catch (e) {
      if (myReq === reqIdRef.current) setError(e.message || 'Failed to load driver data')
    } finally {
      if (myReq === reqIdRef.current) setLoading(false)
    }
  }, [activeCountry])

  useEffect(() => { load() }, [load])

  // ── Unique filter values ───────────────────────────────────────────────────
  const uniqueSites = useMemo(() => {
    const s = new Set(records.map(r => r.site).filter(Boolean))
    return ['all', ...Array.from(s).sort()]
  }, [records])

  const uniqueCountries = useMemo(() => {
    const s = new Set(records.map(r => r.country).filter(Boolean))
    return ['all', ...Array.from(s).sort()]
  }, [records])

  // ── Filtered records ───────────────────────────────────────────────────────
  const filteredRecords = useMemo(() => {
    return records.filter(r => {
      if (siteFilter !== 'all' && r.site !== siteFilter) return false
      if (countryFilter !== 'all' && r.country !== countryFilter) return false
      if (dateFrom && r.issue_date && r.issue_date < dateFrom) return false
      if (dateTo   && r.issue_date && r.issue_date > dateTo)   return false
      return true
    })
  }, [records, siteFilter, countryFilter, dateFrom, dateTo])

  // ── Aggregated driver stats ───────────────────────────────────────────────
  const allDrivers = useMemo(() => aggregateDrivers(filteredRecords), [filteredRecords])

  // ── Search-filtered drivers ───────────────────────────────────────────────
  const visibleDrivers = useMemo(() => {
    const q = searchQuery.trim().toLowerCase()
    let result = q
      ? allDrivers.filter(d => d.name.toLowerCase().includes(q))
      : allDrivers

    result = [...result].sort((a, b) => {
      let va = a[sortCol] ?? (sortDir === 'asc' ? Infinity : -Infinity)
      let vb = b[sortCol] ?? (sortDir === 'asc' ? Infinity : -Infinity)
      if (typeof va === 'string') { va = va.toLowerCase(); vb = (vb ?? '').toLowerCase() }
      if (va < vb) return sortDir === 'asc' ? -1 : 1
      if (va > vb) return sortDir === 'asc' ? 1 : -1
      return 0
    })
    return result
  }, [allDrivers, searchQuery, sortCol, sortDir])

  // ── KPI summary ───────────────────────────────────────────────────────────
  const kpis = useMemo(() => {
    const totalDrivers = allDrivers.length
    const driversWithCpk = allDrivers.filter(d => d.avgCpk !== null && d.avgCpk > 0)
    const fleetAvgCpk = driversWithCpk.length > 0
      ? driversWithCpk.reduce((s, d) => s + d.avgCpk, 0) / driversWithCpk.length
      : null

    let highestCost = null
    let bestPerformer = null

    if (driversWithCpk.length > 0) {
      highestCost  = driversWithCpk.reduce((prev, cur) => cur.avgCpk > prev.avgCpk ? cur : prev)
      bestPerformer = driversWithCpk.reduce((prev, cur) => cur.avgCpk < prev.avgCpk ? cur : prev)
    }

    return { totalDrivers, fleetAvgCpk, highestCost, bestPerformer }
  }, [allDrivers])

  // ── CPK bar chart data (top 10) ───────────────────────────────────────────
  const cpkChartData = useMemo(() => {
    const top10 = [...allDrivers]
      .filter(d => d.avgCpk !== null && d.avgCpk > 0)
      .sort((a, b) => a.avgCpk - b.avgCpk)
      .slice(0, 10)

    return {
      labels: top10.map(d => d.name.length > 14 ? d.name.slice(0, 14) + '...' : d.name),
      datasets: [{
        label: `Avg CPK (${activeCurrency})`,
        data: top10.map(d => parseFloat(d.avgCpk.toFixed(4))),
        backgroundColor: top10.map((d, i) => DRIVER_PALETTE[i % DRIVER_PALETTE.length] + 'cc'),
        borderColor:     top10.map((d, i) => DRIVER_PALETTE[i % DRIVER_PALETTE.length]),
        borderWidth: 1,
        borderRadius: 4,
      }],
    }
  }, [allDrivers, activeCurrency])

  // ── Failure rate horizontal bar chart ─────────────────────────────────────
  const failureChartData = useMemo(() => {
    const top = [...allDrivers]
      .filter(d => d.totalTyres >= 2)
      .sort((a, b) => b.failureRate - a.failureRate)
      .slice(0, 12)

    return {
      labels: top.map(d => d.name.length > 16 ? d.name.slice(0, 16) + '...' : d.name),
      datasets: [{
        label: 'Failure Rate %',
        data: top.map(d => parseFloat(d.failureRate.toFixed(1))),
        backgroundColor: top.map(d =>
          d.failureRate >= 30 ? '#ef444499' :
          d.failureRate >= 15 ? '#f9731699' :
          '#10b98199'
        ),
        borderColor: top.map(d =>
          d.failureRate >= 30 ? '#ef4444' :
          d.failureRate >= 15 ? '#f97316' :
          '#10b981'
        ),
        borderWidth: 1,
        borderRadius: 4,
      }],
    }
  }, [allDrivers])

  // ── Sort handler ──────────────────────────────────────────────────────────
  function handleSort(col) {
    setSortDir(prev => sortCol === col && prev === 'asc' ? 'desc' : 'asc')
    setSortCol(col)
  }

  // ── Date preset handler ────────────────────────────────────────────────────
  function handlePreset(preset) {
    setDatePreset(preset.label)
    const { from, to } = applyDatePreset(preset.days)
    setDateFrom(from)
    setDateTo(to)
  }

  // ── Export handlers ────────────────────────────────────────────────────────
  function handleExportExcel() {
    exportToExcel(
      visibleDrivers.map(d => ({
        rank: d.rank,
        name: d.name,
        totalTyres: d.totalTyres,
        avgCpk: d.avgCpk != null ? d.avgCpk.toFixed(4) : 'N/A',
        totalCost: Math.round(d.totalCost),
        failureRate: d.failureRate.toFixed(1) + '%',
        avgTyreLife: d.avgTyreLife != null ? Math.round(d.avgTyreLife) : 'N/A',
        riskScore: d.riskScore,
        performance: performanceBadge(d.riskScore).label,
      })),
      ['rank','name','totalTyres','avgCpk','totalCost','failureRate','avgTyreLife','riskScore','performance'],
      ['Rank','Driver Name','Total Tyres','Avg CPK','Total Cost','Failure Rate','Avg Life (km)','Risk Score','Performance'],
      'driver_intelligence_ranking',
      'Driver Ranking',
    )
  }

  function handleExportPdf() {
    exportToPdf(
      visibleDrivers.map(d => ({
        rank: d.rank,
        name: d.name,
        totalTyres: d.totalTyres,
        avgCpk: fmtCpk(d.avgCpk, activeCurrency),
        totalCost: fmtCurrency(d.totalCost, activeCurrency),
        failureRate: fmtPct(d.failureRate),
        avgTyreLife: fmtKm(d.avgTyreLife),
        riskScore: d.riskScore,
        performance: performanceBadge(d.riskScore).label,
      })),
      [
        { key: 'rank',        header: 'Rank' },
        { key: 'name',        header: 'Driver Name' },
        { key: 'totalTyres',  header: 'Tyres' },
        { key: 'avgCpk',      header: 'Avg CPK' },
        { key: 'totalCost',   header: 'Total Cost' },
        { key: 'failureRate', header: 'Failure Rate' },
        { key: 'avgTyreLife', header: 'Avg Life' },
        { key: 'riskScore',   header: 'Risk Score' },
        { key: 'performance', header: 'Performance' },
      ],
      'Driver Intelligence - Ranking Report',
      'driver_intelligence_ranking',
      'landscape',
    )
  }

  // ── Loading / error states ─────────────────────────────────────────────────
  if (loading) {
    return (
      <div className="min-h-[60vh] flex flex-col items-center justify-center gap-4">
        <div className="w-10 h-10 rounded-full border-2 border-green-600/20 border-t-green-500 animate-spin" />
        <p className="text-[var(--text-muted)] text-sm">Loading driver intelligence...</p>
      </div>
    )
  }

  if (error) {
    return (
      <div className="min-h-[60vh] flex flex-col items-center justify-center gap-3">
        <AlertTriangle size={32} className="text-red-500" />
        <p className="text-red-400 font-medium">Failed to load data</p>
        <p className="text-[var(--text-dim)] text-sm">{error}</p>
        <button
          onClick={load}
          className="mt-2 flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium text-green-400 transition-colors hover:bg-green-400/10"
          style={{ border: '1px solid rgba(22,163,74,0.3)' }}
        >
          <RefreshCw size={14} /> Retry
        </button>
      </div>
    )
  }

  return (
    <div className="space-y-6">

      {/* ── Page header ─────────────────────────────────────────────────── */}
      <PageHeader
        title="Driver Intelligence"
        subtitle="CPK ranking, failure analysis and tyre cost impact by driver"
        icon={Users}
        actions={<>
          <button
            onClick={() => navigate('/data-intake?module=driver')}
            className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-green-600 hover:bg-green-500 text-white text-xs font-medium transition-colors"
          >
            <Upload size={13} /> Import via Data Intake Center
          </button>
          <button
            onClick={load}
            className="p-2 rounded-lg text-[var(--text-muted)] hover:text-green-400 transition-colors hover:bg-green-400/10"
            title="Refresh"
          >
            <RefreshCw size={14} />
          </button>
          <button
            onClick={handleExportExcel}
            className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors"
            style={{ background: 'rgba(34,197,94,0.08)', border: '1px solid rgba(34,197,94,0.15)' }}
          >
            <FileSpreadsheet size={13} /> Excel
          </button>
          <button
            onClick={handleExportPdf}
            className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors"
            style={{ background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.15)' }}
          >
            <FileText size={13} /> PDF
          </button>
        </>}
      />

      {/* ── KPI Cards ────────────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <KpiCard
          icon={Users}
          label="Total Drivers Identified"
          value={kpis.totalDrivers.toLocaleString()}
          sub={`from ${filteredRecords.length.toLocaleString()} tyre records`}
          color="#3b82f6"
        />
        <KpiCard
          icon={BarChart2}
          label="Fleet Average CPK"
          value={fmtCpk(kpis.fleetAvgCpk, activeCurrency)}
          sub="across all drivers with CPK data"
          color="#10b981"
        />
        <KpiCard
          icon={TrendingDown}
          label="Highest Cost Driver"
          value={kpis.highestCost ? fmtCpk(kpis.highestCost.avgCpk, activeCurrency) : 'N/A'}
          sub={kpis.highestCost?.name ?? 'No data'}
          color="#ef4444"
        />
        <KpiCard
          icon={Award}
          label="Best Performing Driver"
          value={kpis.bestPerformer ? fmtCpk(kpis.bestPerformer.avgCpk, activeCurrency) : 'N/A'}
          sub={kpis.bestPerformer?.name ?? 'No data'}
          color="#f59e0b"
        />
      </div>

      {/* ── Filters bar ──────────────────────────────────────────────────── */}
      <div className="rounded-xl p-4 space-y-3"
        style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.06)' }}>
        <div className="flex flex-wrap items-center gap-3">
          {/* Search */}
          <div className="relative flex-1 min-w-[200px] max-w-xs">
            <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-dim)]" />
            <input
              type="text"
              placeholder="Search driver..."
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              className="w-full pl-8 pr-3 py-2 rounded-lg text-sm text-[var(--text-primary)] placeholder-[var(--text-dim)] focus:outline-none"
              style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.08)' }}
            />
            {searchQuery && (
              <button
                onClick={() => setSearchQuery('')}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-[var(--text-dim)] hover:text-[var(--text-muted)]"
              >
                <X size={12} />
              </button>
            )}
          </div>

          {/* Date presets */}
          <div className="flex gap-1 rounded-lg p-0.5" style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.07)' }}>
            {DATE_PRESETS.map(p => (
              <button
                key={p.label}
                onClick={() => handlePreset(p)}
                className={`px-2.5 py-1 rounded-md text-xs font-medium transition-colors ${
                  datePreset === p.label
                    ? 'text-white'
                    : 'text-[var(--text-dim)] hover:text-[var(--text-muted)]'
                }`}
                style={datePreset === p.label ? { background: '#15803d' } : {}}
              >
                {p.label}
              </button>
            ))}
          </div>

          {/* Toggle extra filters */}
          <button
            onClick={() => setShowFilters(v => !v)}
            className={`flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium transition-colors ${
              showFilters ? 'text-green-400' : 'text-[var(--text-muted)] hover:text-[var(--text-dim)]'
            }`}
            style={{
              background: showFilters ? 'rgba(22,163,74,0.1)' : 'rgba(255,255,255,0.04)',
              border: `1px solid ${showFilters ? 'rgba(22,163,74,0.3)' : 'rgba(255,255,255,0.07)'}`,
            }}
          >
            <Filter size={12} /> Filters {showFilters ? <ChevronUp size={11} /> : <ChevronDown size={11} />}
          </button>

          <p className="text-xs text-[var(--text-dim)] ml-auto">
            {visibleDrivers.length} driver{visibleDrivers.length !== 1 ? 's' : ''}
          </p>
        </div>

        <AnimatePresence>
          {showFilters && (
            <motion.div
              className="flex flex-wrap gap-3 pt-1"
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: 'auto', opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ duration: 0.2 }}
              style={{ overflow: 'hidden' }}
            >
              {/* Date range */}
              <div className="flex items-center gap-2">
                <Calendar size={12} className="text-[var(--text-dim)]" />
                <input
                  type="date"
                  value={dateFrom}
                  onChange={e => { setDateFrom(e.target.value); setDatePreset('') }}
                  className="px-2 py-1.5 rounded-lg text-xs text-[var(--text-dim)] focus:outline-none"
                  style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.08)' }}
                />
                <span className="text-[var(--text-dim)] text-xs">to</span>
                <input
                  type="date"
                  value={dateTo}
                  onChange={e => { setDateTo(e.target.value); setDatePreset('') }}
                  className="px-2 py-1.5 rounded-lg text-xs text-[var(--text-dim)] focus:outline-none"
                  style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.08)' }}
                />
              </div>

              {/* Site filter */}
              {uniqueSites.length > 1 && (
                <select
                  value={siteFilter}
                  onChange={e => setSiteFilter(e.target.value)}
                  className="px-2 py-1.5 rounded-lg text-xs text-[var(--text-dim)] focus:outline-none"
                  style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.08)' }}
                >
                  <option value="all">All Sites</option>
                  {uniqueSites.filter(s => s !== 'all').map(s => (
                    <option key={s} value={s}>{s}</option>
                  ))}
                </select>
              )}

              {/* Country filter */}
              {uniqueCountries.length > 2 && (
                <select
                  value={countryFilter}
                  onChange={e => setCountryFilter(e.target.value)}
                  className="px-2 py-1.5 rounded-lg text-xs text-[var(--text-dim)] focus:outline-none"
                  style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.08)' }}
                >
                  <option value="all">All Countries</option>
                  {uniqueCountries.filter(c => c !== 'all').map(c => (
                    <option key={c} value={c}>{c}</option>
                  ))}
                </select>
              )}

              {(siteFilter !== 'all' || countryFilter !== 'all') && (
                <button
                  onClick={() => { setSiteFilter('all'); setCountryFilter('all') }}
                  className="flex items-center gap-1 text-xs text-red-400 hover:text-red-300 transition-colors"
                >
                  <X size={11} /> Clear filters
                </button>
              )}
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* ── Charts row ───────────────────────────────────────────────────── */}
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">

        {/* CPK bar chart */}
        <div className="rounded-xl p-5"
          style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.06)' }}>
          <div className="flex items-center gap-2 mb-4">
            <TrendingUp size={14} className="text-blue-400" />
            <h3 className="text-sm font-semibold text-[var(--text-primary)]">Driver Comparison: Avg CPK (Top 10)</h3>
          </div>
          {cpkChartData.labels.length > 0 ? (
            <div style={{ height: 220 }}>
              <Bar
                data={cpkChartData}
                options={{
                  ...barOptions(false),
                  plugins: {
                    ...barOptions(false).plugins,
                    tooltip: {
                      ...barOptions(false).plugins.tooltip,
                      callbacks: {
                        label: ctx => `CPK: ${activeCurrency} ${Number(ctx.raw).toFixed(4)}`,
                      },
                    },
                  },
                  scales: {
                    ...barOptions(false).scales,
                    y: {
                      ...barOptions(false).scales.y,
                      ticks: {
                        ...barOptions(false).scales.y.ticks,
                        callback: v => `${activeCurrency} ${Number(v).toFixed(3)}`,
                      },
                    },
                  },
                }}
              />
            </div>
          ) : (
            <div className="h-[220px] flex items-center justify-center text-[var(--text-dim)] text-sm">
              Insufficient CPK data
            </div>
          )}
        </div>

        {/* Failure rate horizontal bar chart */}
        <div className="rounded-xl p-5"
          style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.06)' }}>
          <div className="flex items-center gap-2 mb-4">
            <AlertTriangle size={14} className="text-orange-400" />
            <h3 className="text-sm font-semibold text-[var(--text-primary)]">Tyre Failure Rate by Driver</h3>
          </div>
          {failureChartData.labels.length > 0 ? (
            <div style={{ height: 220 }}>
              <Bar
                data={failureChartData}
                options={{
                  ...barOptions(true),
                  plugins: {
                    ...barOptions(true).plugins,
                    tooltip: {
                      ...barOptions(true).plugins.tooltip,
                      callbacks: {
                        label: ctx => `Failure Rate: ${Number(ctx.raw).toFixed(1)}%`,
                      },
                    },
                  },
                  scales: {
                    ...barOptions(true).scales,
                    x: {
                      ...barOptions(true).scales.x,
                      ticks: {
                        ...barOptions(true).scales.x.ticks,
                        callback: v => `${v}%`,
                      },
                    },
                  },
                }}
              />
            </div>
          ) : (
            <div className="h-[220px] flex items-center justify-center text-[var(--text-dim)] text-sm">
              No failure data available
            </div>
          )}
        </div>
      </div>

      {/* ── Driver Ranking Table ─────────────────────────────────────────── */}
      <div className="rounded-xl overflow-hidden"
        style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.06)' }}>

        <div className="px-5 py-4 border-b border-[var(--input-border)] flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Users size={14} className="text-green-400" />
            <h3 className="text-sm font-semibold text-[var(--text-primary)]">Driver Ranking</h3>
            <span className="text-xs text-[var(--text-dim)] ml-1">
              ({visibleDrivers.length} drivers)
            </span>
          </div>
          <p className="text-[11px] text-[var(--text-dim)]">Sorted by Risk Score (ascending = best)</p>
        </div>

        {visibleDrivers.length === 0 ? (
          <EmptyState
            illustration="module/fleet"
            icon={User}
            title="No drivers found"
            description="No drivers match the current filters. Try adjusting your search or date range."
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead style={{ background: 'rgba(255,255,255,0.03)' }}>
                <tr>
                  <th className="px-4 py-3 text-left text-[11px] font-semibold text-[var(--text-muted)] uppercase tracking-wider w-12">Rank</th>
                  <SortTh col="name"         label="Driver"        sortCol={sortCol} sortDir={sortDir} onSort={handleSort} />
                  <SortTh col="totalTyres"   label="Tyres"         sortCol={sortCol} sortDir={sortDir} onSort={handleSort} />
                  <SortTh col="avgCpk"       label="Avg CPK"       sortCol={sortCol} sortDir={sortDir} onSort={handleSort} />
                  <SortTh col="totalCost"    label="Total Cost"    sortCol={sortCol} sortDir={sortDir} onSort={handleSort} />
                  <SortTh col="failureRate"  label="Failure Rate"  sortCol={sortCol} sortDir={sortDir} onSort={handleSort} />
                  <SortTh col="avgTyreLife"  label="Avg Life"      sortCol={sortCol} sortDir={sortDir} onSort={handleSort} />
                  <SortTh col="riskScore"    label="Risk Score"    sortCol={sortCol} sortDir={sortDir} onSort={handleSort} />
                  <th className="px-3 py-3 text-left text-[11px] font-semibold text-[var(--text-muted)] uppercase tracking-wider">Performance</th>
                  <th className="px-3 py-3 text-left text-[11px] font-semibold text-[var(--text-muted)] uppercase tracking-wider">Action</th>
                </tr>
              </thead>
              <tbody>
                {visibleDrivers.map((driver, idx) => {
                  const badge = performanceBadge(driver.riskScore)
                  const rankNum = driver.rank
                  const rankColor =
                    rankNum === 1 ? 'text-yellow-400' :
                    rankNum === 2 ? 'text-[var(--text-dim)]'   :
                    rankNum === 3 ? 'text-amber-600'  :
                    'text-[var(--text-dim)]'

                  return (
                    <motion.tr
                      key={driver.name}
                      className="border-t border-[var(--input-border)] hover:bg-white/[0.02] transition-colors group"
                      initial={{ opacity: 0, y: 4 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: Math.min(idx * 0.02, 0.3) }}
                    >
                      <td className="px-4 py-3">
                        <span className={`text-sm font-bold ${rankColor}`}>#{rankNum}</span>
                      </td>
                      <td className="px-3 py-3">
                        <div className="flex items-center gap-2">
                          <div className="w-7 h-7 rounded-full flex items-center justify-center text-white text-xs font-semibold flex-shrink-0"
                            style={{ background: `${DRIVER_PALETTE[idx % DRIVER_PALETTE.length]}30`, border: `1px solid ${DRIVER_PALETTE[idx % DRIVER_PALETTE.length]}50` }}>
                            {driver.name[0]?.toUpperCase() ?? 'D'}
                          </div>
                          <span className="text-[var(--text-secondary)] font-medium text-sm">{driver.name}</span>
                        </div>
                      </td>
                      <td className="px-3 py-3 text-[var(--text-muted)] text-sm">{driver.totalTyres}</td>
                      <td className={`px-3 py-3 font-mono text-sm font-semibold ${cpkColor(driver.avgCpk)}`}>
                        {fmtCpk(driver.avgCpk, activeCurrency)}
                      </td>
                      <td className="px-3 py-3 text-[var(--text-dim)] text-sm">{fmtCurrency(driver.totalCost, activeCurrency)}</td>
                      <td className="px-3 py-3">
                        <span className={`text-sm font-medium ${
                          driver.failureRate >= 30 ? 'text-red-400' :
                          driver.failureRate >= 15 ? 'text-yellow-400' :
                          'text-green-400'
                        }`}>
                          {fmtPct(driver.failureRate)}
                        </span>
                      </td>
                      <td className="px-3 py-3 text-[var(--text-muted)] text-sm">{fmtKm(driver.avgTyreLife)}</td>
                      <td className="px-3 py-3 min-w-[110px]">
                        <RiskBar score={driver.riskScore} />
                      </td>
                      <td className="px-3 py-3">
                        <span className={`text-[11px] px-2 py-0.5 rounded-full border font-semibold ${badge.cls}`}>
                          {badge.label}
                        </span>
                      </td>
                      <td className="px-3 py-3">
                        <button
                          onClick={() => navigate(`/driver-management/${encodeURIComponent(driver.name)}`)}
                          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors"
                          style={{ background: 'rgba(22,163,74,0.08)', border: '1px solid rgba(22,163,74,0.2)' }}
                        >
                          <Eye size={12} /> History
                        </button>
                      </td>
                    </motion.tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}

        {/* Table footer summary */}
        {visibleDrivers.length > 0 && (
          <div className="px-5 py-3 border-t border-[var(--input-border)] flex flex-wrap gap-6 text-xs text-[var(--text-dim)]">
            <span>Total Records: <span className="text-[var(--text-muted)] font-medium">{filteredRecords.length.toLocaleString()}</span></span>
            <span>Total Fleet Cost: <span className="text-[var(--text-muted)] font-medium">
              {fmtCurrency(visibleDrivers.reduce((s, d) => s + d.totalCost, 0), activeCurrency)}
            </span></span>
            <span>High Risk Drivers: <span className="text-red-400 font-medium">
              {visibleDrivers.filter(d => d.riskScore >= 60).length}
            </span></span>
            <span>Excellent Performers: <span className="text-green-400 font-medium">
              {visibleDrivers.filter(d => d.riskScore <= 20).length}
            </span></span>
          </div>
        )}
      </div>

    </div>
  )
}
