import { useState, useEffect, useMemo, useCallback, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { motion, AnimatePresence } from 'framer-motion'
import {
  Chart as ChartJS,
  CategoryScale, LinearScale,
  LineElement, PointElement,
  Title, Tooltip, Legend, Filler,
} from 'chart.js'
import { Line } from 'react-chartjs-2'
import {
  Activity, AlertTriangle, CheckCircle, RefreshCw,
  Search, X, ChevronRight, Grid, List,
  Truck, MapPin, Globe, Shield, Circle,
  ExternalLink, Wrench, Clock, TrendingUp,
  BarChart2, Filter,
} from 'lucide-react'
import { supabase } from '../lib/supabase'
import { fetchAllPages } from '../lib/fetchAll'
import { formatDate } from '../lib/formatters'
import { useSettings } from '../contexts/SettingsContext'
import { useAuth } from '../contexts/AuthContext'
import PageHeader from '../components/ui/PageHeader'
import { useLanguage } from '../contexts/LanguageContext'

ChartJS.register(
  CategoryScale, LinearScale,
  LineElement, PointElement,
  Title, Tooltip, Legend, Filler,
)

// ── Risk helpers ──────────────────────────────────────────────────────────────
const RISK_ORDER = { Critical: 0, High: 1, Medium: 2, Low: 3 }

function riskColor(level) {
  return {
    Critical: '#dc2626',
    High:     '#ea580c',
    Medium:   '#ca8a04',
    Low:      '#16a34a',
  }[level] ?? '#374151'
}

function riskBgClass(level) {
  return {
    Critical: 'bg-red-900/40 text-red-300 border-red-800/50',
    High:     'bg-orange-900/40 text-orange-300 border-orange-800/50',
    Medium:   'bg-yellow-900/40 text-yellow-300 border-yellow-800/50',
    Low:      'bg-green-900/40 text-green-300 border-green-800/50',
  }[level] ?? 'bg-gray-800/60 text-gray-400 border-gray-700'
}

function worstRisk(tyres) {
  if (!tyres?.length) return null
  return tyres.reduce((worst, t) => {
    const a = RISK_ORDER[worst] ?? 99
    const b = RISK_ORDER[t.risk_level] ?? 99
    return b < a ? t.risk_level : worst
  }, tyres[0].risk_level)
}

// ── Vehicle health score ──────────────────────────────────────────────────────
function vehicleHealthScore(tyres) {
  if (!tyres?.length) return 0
  let score = 0
  tyres.forEach(t => {
    const riskScore = { Low: 100, Medium: 65, High: 30, Critical: 0 }[t.risk_level] ?? 50
    const treadScore = t.tread_depth != null
      ? Math.min(100, (t.tread_depth / 8) * 100)
      : 50
    score += (riskScore * 0.7 + treadScore * 0.3)
  })
  return Math.round(score / tyres.length)
}

function scoreColor(score) {
  if (score >= 80) return '#16a34a'
  if (score >= 60) return '#ca8a04'
  if (score >= 40) return '#ea580c'
  return '#dc2626'
}

function scoreBorderClass(score) {
  if (score >= 80) return 'border-green-700/40'
  if (score >= 60) return 'border-yellow-700/40'
  if (score >= 40) return 'border-orange-700/40'
  return 'border-red-700/40'
}

// ── Tyre position mini-diagram ────────────────────────────────────────────────
const POSITIONS_LAYOUT = [
  { id: 0, label: 'FL', col: 0, row: 0 },
  { id: 1, label: 'FR', col: 2, row: 0 },
  { id: 2, label: 'RLI', col: 0, row: 1 },
  { id: 3, label: 'RLO', col: 1, row: 1 },
  { id: 4, label: 'RRI', col: 2, row: 1 },
  { id: 5, label: 'RRO', col: 3, row: 1 },
]

function TyrePositionDot({ tyre, position }) {
  const { t } = useLanguage()
  const [showTip, setShowTip] = useState(false)
  const color = tyre ? riskColor(tyre.risk_level) : '#374151'
  const opacity = tyre ? 1 : 0.35

  return (
    <div className="relative flex items-center justify-center">
      <div
        className="w-4 h-4 rounded-full cursor-pointer transition-transform hover:scale-125"
        style={{ backgroundColor: color, opacity, boxShadow: tyre ? `0 0 6px ${color}66` : 'none' }}
        onMouseEnter={() => setShowTip(true)}
        onMouseLeave={() => setShowTip(false)}
      />
      {showTip && tyre && (
        <div className="absolute bottom-5 left-1/2 -translate-x-1/2 z-50 bg-gray-900 border border-gray-700 rounded-lg p-2 text-xs whitespace-nowrap shadow-xl pointer-events-none">
          <p className="text-white font-semibold">{position}</p>
          <p className="text-gray-400">{t('fleethealth.card.tread', { value: tyre.tread_depth != null ? `${tyre.tread_depth}mm` : '-' })}</p>
          <p style={{ color: riskColor(tyre.risk_level) }}>{tyre.risk_level ?? '-'}</p>
        </div>
      )}
    </div>
  )
}

function MiniTyreDiagram({ tyres }) {
  const byPos = {}
  tyres.forEach(t => { if (t.position) byPos[t.position] = t })

  const frontLeft  = tyres.find(t => /FL|F1|steer.*l|left.*front/i.test(t.position ?? ''))
  const frontRight = tyres.find(t => /FR|F2|steer.*r|right.*front/i.test(t.position ?? ''))
  const rearGroup  = tyres.filter(t => !/FL|FR|F1|F2|steer/i.test(t.position ?? ''))

  const frontPair = [frontLeft, frontRight]
  const rearSlots = rearGroup.slice(0, 4)
  while (rearSlots.length < 4) rearSlots.push(null)

  const posLabels = ['FL', 'FR', 'RL', 'RLO', 'RR', 'RRO']

  return (
    <div className="flex flex-col items-center gap-1">
      <div className="flex gap-4">
        <TyrePositionDot tyre={frontLeft} position={frontLeft?.position ?? 'FL'} />
        <TyrePositionDot tyre={frontRight} position={frontRight?.position ?? 'FR'} />
      </div>
      <div className="flex gap-1.5">
        {rearSlots.map((t, i) => (
          <TyrePositionDot key={i} tyre={t} position={t?.position ?? posLabels[i + 2]} />
        ))}
      </div>
    </div>
  )
}

// ── Health score circle ───────────────────────────────────────────────────────
function HealthCircle({ score, size = 56 }) {
  const r = (size - 8) / 2
  const circ = 2 * Math.PI * r
  const fill = (score / 100) * circ
  const color = scoreColor(score)

  return (
    <div className="relative flex items-center justify-center" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="#1f2937" strokeWidth="4" />
        <circle
          cx={size / 2} cy={size / 2} r={r}
          fill="none" stroke={color} strokeWidth="4"
          strokeDasharray={`${fill} ${circ}`}
          strokeLinecap="round"
          style={{ transition: 'stroke-dasharray 0.6s ease' }}
        />
      </svg>
      <span className="absolute text-xs font-bold" style={{ color }}>{score}</span>
    </div>
  )
}

// ── Loading skeleton ──────────────────────────────────────────────────────────
function SkeletonCard() {
  return (
    <div className="card animate-pulse">
      <div className="flex items-start justify-between mb-3">
        <div className="h-5 w-24 bg-gray-800 rounded" />
        <div className="h-4 w-16 bg-gray-800 rounded-full" />
      </div>
      <div className="flex items-center justify-between mb-3">
        <div className="h-14 w-14 bg-gray-800 rounded-full" />
        <div className="flex flex-col gap-1">
          {[1,2,3].map(i => <div key={i} className="h-3 w-20 bg-gray-800 rounded" />)}
        </div>
      </div>
      <div className="h-8 bg-gray-800 rounded mt-2" />
    </div>
  )
}

// ── Main component ────────────────────────────────────────────────────────────
export default function FleetHealthBoard() {
  const { t } = useLanguage()
  const navigate = useNavigate()
  const { activeCountry } = useSettings()
  const { profile } = useAuth()

  const [rawRecords, setRawRecords]   = useState([])
  const [loading, setLoading]         = useState(true)
  const [error, setError]             = useState(null)
  const [lastUpdated, setLastUpdated] = useState(null)
  const [refreshing, setRefreshing]   = useState(false)

  const [siteFilter, setSiteFilter]     = useState('All')
  const [countryFilter, setCountryFilter] = useState('All')
  const [riskFilter, setRiskFilter]     = useState('All')
  const [search, setSearch]             = useState('')
  const [viewMode, setViewMode]         = useState('grid')

  const [selectedVehicle, setSelectedVehicle] = useState(null)
  const [drawerOpen, setDrawerOpen]           = useState(false)

  const [trendData, setTrendData]   = useState([])
  const drawerRef = useRef(null)

  // Guards against a slow earlier response overwriting a newer one after the
  // active country changes (fetch-race cancellation).
  const reqIdRef = useRef(0)

  // ── Fetch ───────────────────────────────────────────────────────────────────
  const load = useCallback(async (silent = false) => {
    const myReq = ++reqIdRef.current
    if (!silent) setLoading(true)
    else setRefreshing(true)
    setError(null)

    try {
      const { data, error: err } = await fetchAllPages((from, to) => {
        let q = supabase
          .from('tyre_records')
          .select('id,asset_no,serial_number,position,tread_depth,pressure_reading,risk_level,issue_date,km_at_fitment,km_at_removal,cost_per_tyre,site,country,brand,size')
          .is('km_at_removal', null)
        if (activeCountry !== 'All') q = q.eq('country', activeCountry)
        return q.range(from, to)
      })
      if (myReq !== reqIdRef.current) return
      if (err) throw err

      setRawRecords(data ?? [])
      setLastUpdated(new Date())

      // Anchor the 12-month window to the data's latest issue_date (fallback:
      // today) so historic imports still populate the trend chart.
      let maxIssue = null
      for (const r of data ?? []) { if (r.issue_date && (!maxIssue || r.issue_date > maxIssue)) maxIssue = r.issue_date }
      const anchor = maxIssue ? new Date(maxIssue.slice(0, 10) + 'T00:00:00') : new Date()

      // Trend: last 12 months from ALL records (not filtered by km_at_removal)
      const trendQ = supabase
        .from('tyre_records')
        .select('issue_date,risk_level,asset_no')
        .gte('issue_date', new Date(anchor.getTime() - 365 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10))
      if (activeCountry !== 'All') trendQ.eq('country', activeCountry)
      const { data: trendRaw } = await trendQ
      if (myReq !== reqIdRef.current) return
      setTrendData(trendRaw ?? [])
    } catch (e) {
      if (myReq === reqIdRef.current) setError(e.message ?? 'Failed to load fleet data')
    } finally {
      if (myReq === reqIdRef.current) {
        setLoading(false)
        setRefreshing(false)
      }
    }
  }, [activeCountry])

  useEffect(() => { load() }, [load])

  // ── Close drawer on outside click ──────────────────────────────────────────
  useEffect(() => {
    function handler(e) {
      if (drawerOpen && drawerRef.current && !drawerRef.current.contains(e.target)) {
        setDrawerOpen(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [drawerOpen])

  // ── Derived: group by asset_no ─────────────────────────────────────────────
  const vehicleMap = useMemo(() => {
    const map = {}
    rawRecords.forEach(r => {
      if (!r.asset_no) return
      if (!map[r.asset_no]) map[r.asset_no] = { asset_no: r.asset_no, site: r.site, country: r.country, tyres: [] }
      map[r.asset_no].tyres.push(r)
    })
    return map
  }, [rawRecords])

  const vehicles = useMemo(() => Object.values(vehicleMap), [vehicleMap])

  // ── Filter options ──────────────────────────────────────────────────────────
  const sites     = useMemo(() => ['All', ...new Set(vehicles.map(v => v.site).filter(Boolean))], [vehicles])
  const countries = useMemo(() => ['All', ...new Set(vehicles.map(v => v.country).filter(Boolean))], [vehicles])

  // ── Filtered vehicles ───────────────────────────────────────────────────────
  const filtered = useMemo(() => {
    return vehicles
      .map(v => ({ ...v, score: vehicleHealthScore(v.tyres), worst: worstRisk(v.tyres) }))
      .filter(v => {
        if (siteFilter !== 'All' && v.site !== siteFilter) return false
        if (countryFilter !== 'All' && v.country !== countryFilter) return false
        if (riskFilter !== 'All') {
          if (riskFilter === 'Critical' && v.worst !== 'Critical') return false
          if (riskFilter === 'High' && !['Critical','High'].includes(v.worst)) return false
          if (riskFilter === 'Medium' && !['Critical','High','Medium'].includes(v.worst)) return false
          if (riskFilter === 'Low' && v.worst !== 'Low') return false
        }
        if (search) {
          const q = search.toLowerCase()
          if (!v.asset_no?.toLowerCase().includes(q) &&
              !v.site?.toLowerCase().includes(q) &&
              !v.country?.toLowerCase().includes(q)) return false
        }
        return true
      })
      .sort((a, b) => a.score - b.score)
  }, [vehicles, siteFilter, countryFilter, riskFilter, search])

  // ── KPIs ───────────────────────────────────────────────────────────────────
  const kpis = useMemo(() => {
    const total = vehicles.length
    const criticalVehicles = vehicles.filter(v =>
      v.tyres.some(t => t.risk_level === 'Critical')
    ).length
    const atRiskCount = rawRecords.filter(t => ['Critical','High'].includes(t.risk_level)).length
    const avgTread = rawRecords.filter(t => t.tread_depth != null).reduce((s, t) => s + t.tread_depth, 0) /
      Math.max(1, rawRecords.filter(t => t.tread_depth != null).length)
    const healthyVehicles = vehicles.filter(v =>
      !v.tyres.some(t => ['Critical','High'].includes(t.risk_level))
    ).length
    const fleetHealth = total > 0 ? Math.round((healthyVehicles / total) * 100) : 0
    return { total, criticalVehicles, atRiskCount, avgTread: avgTread.toFixed(1), fleetHealth }
  }, [vehicles, rawRecords])

  // ── Fleet health trend (12 months) ────────────────────────────────────────
  const trendChartData = useMemo(() => {
    // Anchor buckets to the trend data's latest issue_date, not today, so
    // historic datasets still render (matches Dashboard's dataAnchor pattern).
    let maxIssue = null
    for (const r of trendData) { if (r.issue_date && (!maxIssue || r.issue_date > maxIssue)) maxIssue = r.issue_date }
    const now = maxIssue ? new Date(maxIssue.slice(0, 10) + 'T00:00:00') : new Date()
    const months = Array.from({ length: 12 }, (_, i) => {
      const d = new Date(now.getFullYear(), now.getMonth() - 11 + i, 1)
      return {
        label: d.toLocaleString('default', { month: 'short', year: '2-digit' }),
        y: d.getFullYear(),
        m: d.getMonth() + 1,
      }
    })

    const scores = months.map(({ y, m }) => {
      const monthRecords = trendData.filter(r => {
        if (!r.issue_date) return false
        const d = new Date(r.issue_date)
        return d.getFullYear() === y && d.getMonth() + 1 === m
      })
      if (!monthRecords.length) return null
      const assetGroups = {}
      monthRecords.forEach(r => {
        if (!r.asset_no) return
        if (!assetGroups[r.asset_no]) assetGroups[r.asset_no] = []
        assetGroups[r.asset_no].push(r)
      })
      const vList = Object.values(assetGroups)
      const healthy = vList.filter(tyres => !tyres.some(t => ['Critical','High'].includes(t.risk_level))).length
      return vList.length > 0 ? Math.round((healthy / vList.length) * 100) : null
    })

    return {
      labels: months.map(m => m.label),
      datasets: [{
        label: t('fleethealth.trend.seriesLabel'),
        data: scores,
        borderColor: '#16a34a',
        backgroundColor: 'rgba(22,163,74,0.1)',
        fill: true,
        tension: 0.4,
        pointRadius: 3,
        pointBackgroundColor: '#16a34a',
        spanGaps: true,
      }],
    }
  }, [trendData, t])

  const TICK = { color: '#6b7280', font: { size: 10 } }
  const GRID = { color:'var(--text-muted)' }

  const trendOpts = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: { display: false },
      tooltip: {
        backgroundColor: 'var(--panel)',
        borderColor: 'var(--hairline)',
        borderWidth: 1,
        titleColor: '#f9fafb',
        bodyColor: '#9ca3af',
        callbacks: { label: ctx => ` ${ctx.parsed.y ?? '-'}%` },
      },
    },
    scales: {
      x: { ticks: TICK, grid: GRID },
      y: {
        ticks: { ...TICK, callback: v => `${v}%` },
        grid: GRID,
        min: 0,
        max: 100,
      },
    },
  }

  // ── Critical alerts panel ──────────────────────────────────────────────────
  const criticalList = useMemo(() => {
    return vehicles
      .filter(v => v.tyres.some(t => t.risk_level === 'Critical'))
      .map(v => {
        const worst = v.tyres.filter(t => t.risk_level === 'Critical')
          .sort((a, b) => (a.tread_depth ?? 99) - (b.tread_depth ?? 99))[0]
        return { ...v, worstTread: worst?.tread_depth, worstPos: worst?.position }
      })
      .sort((a, b) => (a.worstTread ?? 99) - (b.worstTread ?? 99))
  }, [vehicles])

  // ── Detail drawer data ─────────────────────────────────────────────────────
  const drawerVehicle = useMemo(() => {
    if (!selectedVehicle) return null
    const v = vehicleMap[selectedVehicle]
    if (!v) return null
    const tyres = [...v.tyres].sort((a, b) => (a.position ?? '').localeCompare(b.position ?? ''))
    return { ...v, tyres }
  }, [selectedVehicle, vehicleMap])

  const drawerTrendData = useMemo(() => {
    if (!selectedVehicle) return null
    const allForAsset = trendData.filter(r => r.asset_no === selectedVehicle)
    const sorted = allForAsset
      .filter(r => r.issue_date)
      .sort((a, b) => new Date(a.issue_date) - new Date(b.issue_date))
      .slice(-6)

    if (!sorted.length) return null
    return {
      labels: sorted.map(r => r.issue_date?.slice(0, 10)),
      datasets: [{
        label: t('fleethealth.drawer.riskIndexSeriesLabel'),
        data: sorted.map(r => ({ Critical: 0, High: 33, Medium: 66, Low: 100 }[r.risk_level] ?? 50)),
        borderColor: '#f59e0b',
        backgroundColor: 'rgba(245,158,11,0.1)',
        fill: true,
        tension: 0.4,
        pointRadius: 3,
      }],
    }
  }, [selectedVehicle, trendData, t])

  function openDrawer(assetNo) {
    setSelectedVehicle(assetNo)
    setDrawerOpen(true)
  }

  function daysFitted(issueDate) {
    if (!issueDate) return '-'
    const diff = Math.floor((Date.now() - new Date(issueDate)) / 86400000)
    return `${diff}d`
  }

  function fmtDate(d) {
    if (!d) return '-'
    return formatDate(d, 'All', { day: '2-digit', month: 'short', year: 'numeric' })
  }

  // ── Render ─────────────────────────────────────────────────────────────────
  if (loading) {
    return (
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-white">{t('fleethealth.header.title')}</h1>
            <p className="text-gray-400 text-sm mt-1">{t('fleethealth.header.loading')}</p>
          </div>
        </div>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {[1,2,3,4].map(i => (
            <div key={i} className="card animate-pulse h-24">
              <div className="h-4 w-24 bg-gray-800 rounded mb-2" />
              <div className="h-7 w-16 bg-gray-800 rounded" />
            </div>
          ))}
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {Array.from({ length: 12 }).map((_, i) => <SkeletonCard key={i} />)}
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center min-h-64 gap-4">
        <AlertTriangle size={40} className="text-red-400" />
        <p className="text-red-300 font-medium">{error}</p>
        <button onClick={() => load()} className="btn-primary flex items-center gap-2">
          <RefreshCw size={14} /> {t('fleethealth.actions.retry')}
        </button>
      </div>
    )
  }

  return (
    <div className="space-y-6">

      {/* ── Header ── */}
      <PageHeader
        title={t('fleethealth.header.title')}
        subtitle={`${t('fleethealth.header.subtitle')}${lastUpdated ? t('fleethealth.header.updated', { time: lastUpdated.toLocaleTimeString() }) : ''}`}
        icon={Activity}
        actions={
          <button
            onClick={() => load(true)}
            disabled={refreshing}
            className="btn-secondary flex items-center gap-2 text-sm"
          >
            <RefreshCw size={14} className={refreshing ? 'animate-spin' : ''} />
            {t('fleethealth.actions.refresh')}
          </button>
        }
      />

      {/* ── KPI Bar ── */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <KpiCard
          label={t('fleethealth.kpi.fleetHealthScore')}
          value={`${kpis.fleetHealth}%`}
          sub={t('fleethealth.kpi.vehiclesCount', { count: vehicles.length })}
          icon={Shield}
          color={kpis.fleetHealth >= 70 ? 'green' : kpis.fleetHealth >= 40 ? 'yellow' : 'red'}
        />
        <KpiCard
          label={t('fleethealth.kpi.criticalVehicles')}
          value={kpis.criticalVehicles}
          sub={t('fleethealth.kpi.criticalVehiclesSub')}
          icon={AlertTriangle}
          color={kpis.criticalVehicles > 0 ? 'red' : 'green'}
        />
        <KpiCard
          label={t('fleethealth.kpi.atRiskTyres')}
          value={kpis.atRiskCount}
          sub={t('fleethealth.kpi.atRiskTyresSub')}
          icon={Circle}
          color={kpis.atRiskCount > 0 ? 'orange' : 'green'}
        />
        <KpiCard
          label={t('fleethealth.kpi.avgTreadDepth')}
          value={`${kpis.avgTread}mm`}
          sub={t('fleethealth.kpi.avgTreadDepthSub')}
          icon={BarChart2}
          color="blue"
        />
      </div>

      {/* ── Main layout: board + sidebar ── */}
      <div className="flex gap-6">

        {/* ── Left: board ── */}
        <div className="flex-1 min-w-0 space-y-4">

          {/* ── Filters ── */}
          <div className="card py-3">
            <div className="flex flex-wrap gap-3 items-center">
              {/* Search */}
              <div className="relative flex-1 min-w-48">
                <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
                <input
                  className="input pl-8 w-full text-sm"
                  placeholder={t('fleethealth.filters.searchPlaceholder')}
                  value={search}
                  onChange={e => setSearch(e.target.value)}
                />
                {search && (
                  <button onClick={() => setSearch('')} className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-300">
                    <X size={12} />
                  </button>
                )}
              </div>

              {/* Site */}
              <div className="flex items-center gap-1.5">
                <MapPin size={13} className="text-gray-500" />
                <select
                  className="input text-sm py-1.5"
                  value={siteFilter}
                  onChange={e => setSiteFilter(e.target.value)}
                >
                  {sites.map(s => <option key={s} value={s}>{s === 'All' ? t('fleethealth.filters.all') : s}</option>)}
                </select>
              </div>

              {/* Country */}
              <div className="flex items-center gap-1.5">
                <Globe size={13} className="text-gray-500" />
                <select
                  className="input text-sm py-1.5"
                  value={countryFilter}
                  onChange={e => setCountryFilter(e.target.value)}
                >
                  {countries.map(c => <option key={c} value={c}>{c === 'All' ? t('fleethealth.filters.all') : c}</option>)}
                </select>
              </div>

              {/* Risk */}
              <div className="flex items-center gap-1.5">
                <Filter size={13} className="text-gray-500" />
                <select
                  className="input text-sm py-1.5"
                  value={riskFilter}
                  onChange={e => setRiskFilter(e.target.value)}
                >
                  {['All','Critical','High','Medium','Low'].map(r => (
                    <option key={r} value={r}>{r === 'All' ? t('fleethealth.filters.all') : r}</option>
                  ))}
                </select>
              </div>

              {/* View toggle */}
              <div className="flex bg-gray-800 rounded-lg border border-gray-700 overflow-hidden ml-auto">
                <button
                  onClick={() => setViewMode('grid')}
                  className={`p-2 transition-colors ${viewMode === 'grid' ? 'bg-green-700 text-white' : 'text-gray-400 hover:text-white'}`}
                >
                  <Grid size={14} />
                </button>
                <button
                  onClick={() => setViewMode('list')}
                  className={`p-2 transition-colors ${viewMode === 'list' ? 'bg-green-700 text-white' : 'text-gray-400 hover:text-white'}`}
                >
                  <List size={14} />
                </button>
              </div>
            </div>

            {(siteFilter !== 'All' || countryFilter !== 'All' || riskFilter !== 'All' || search) && (
              <p className="text-xs text-green-500 mt-2">
                {t('fleethealth.filters.matchingCount', { filtered: filtered.length, total: vehicles.length })}
              </p>
            )}
          </div>

          {/* ── Empty state ── */}
          {filtered.length === 0 && (
            <div className="card flex flex-col items-center justify-center py-16 gap-3">
              <Truck size={40} className="text-gray-700" />
              <p className="text-gray-400 font-medium">{t('fleethealth.empty.noMatch')}</p>
              <p className="text-gray-600 text-sm">{t('fleethealth.empty.tryAdjusting')}</p>
              <button
                onClick={() => { setSiteFilter('All'); setCountryFilter('All'); setRiskFilter('All'); setSearch('') }}
                className="btn-secondary text-sm mt-1"
              >
                {t('fleethealth.empty.clearFilters')}
              </button>
            </div>
          )}

          {/* ── Grid view ── */}
          {viewMode === 'grid' && filtered.length > 0 && (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
              <AnimatePresence mode="popLayout">
                {filtered.map(v => (
                  <motion.div
                    key={v.asset_no}
                    layout
                    initial={{ opacity: 0, scale: 0.95 }}
                    animate={{ opacity: 1, scale: 1 }}
                    exit={{ opacity: 0, scale: 0.9 }}
                    transition={{ duration: 0.2 }}
                  >
                    <VehicleCard
                      vehicle={v}
                      onClick={() => openDrawer(v.asset_no)}
                      isSelected={selectedVehicle === v.asset_no && drawerOpen}
                    />
                  </motion.div>
                ))}
              </AnimatePresence>
            </div>
          )}

          {/* ── List view ── */}
          {viewMode === 'list' && filtered.length > 0 && (
            <div className="card overflow-hidden p-0">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-gray-800">
                      {['asset','site','country','health','critical','high','medium','low','avgTread','lastTyre'].map(hKey => (
                        <th key={hKey} className="text-left px-3 py-3 text-xs font-medium text-gray-400 uppercase tracking-wide whitespace-nowrap">
                          {t(`fleethealth.list.columns.${hKey}`)}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    <AnimatePresence>
                      {filtered.map((v, i) => {
                        const counts = { Critical: 0, High: 0, Medium: 0, Low: 0 }
                        v.tyres.forEach(t => { if (counts[t.risk_level] !== undefined) counts[t.risk_level]++ })
                        const avgTread = v.tyres.filter(t => t.tread_depth != null)
                          .reduce((s, t) => s + t.tread_depth, 0) /
                          Math.max(1, v.tyres.filter(t => t.tread_depth != null).length)
                        const lastDate = v.tyres.filter(t => t.issue_date)
                          .sort((a, b) => new Date(b.issue_date) - new Date(a.issue_date))[0]?.issue_date

                        return (
                          <motion.tr
                            key={v.asset_no}
                            initial={{ opacity: 0 }}
                            animate={{ opacity: 1 }}
                            exit={{ opacity: 0 }}
                            className="border-b border-gray-800/50 hover:bg-gray-800/30 cursor-pointer transition-colors"
                            onClick={() => openDrawer(v.asset_no)}
                          >
                            <td className="px-3 py-2.5 font-semibold text-white">{v.asset_no}</td>
                            <td className="px-3 py-2.5 text-gray-300">{v.site ?? '-'}</td>
                            <td className="px-3 py-2.5 text-gray-400">{v.country ?? '-'}</td>
                            <td className="px-3 py-2.5">
                              <span className="font-bold" style={{ color: scoreColor(v.score) }}>
                                {v.score}%
                              </span>
                            </td>
                            <td className="px-3 py-2.5">
                              {counts.Critical > 0
                                ? <span className="badge bg-red-900/40 text-red-300 border border-red-800/50">{counts.Critical}</span>
                                : <span className="text-gray-600">-</span>}
                            </td>
                            <td className="px-3 py-2.5">
                              {counts.High > 0
                                ? <span className="badge bg-orange-900/40 text-orange-300 border border-orange-800/50">{counts.High}</span>
                                : <span className="text-gray-600">-</span>}
                            </td>
                            <td className="px-3 py-2.5">
                              {counts.Medium > 0
                                ? <span className="badge bg-yellow-900/40 text-yellow-300 border border-yellow-800/50">{counts.Medium}</span>
                                : <span className="text-gray-600">-</span>}
                            </td>
                            <td className="px-3 py-2.5">
                              {counts.Low > 0
                                ? <span className="badge bg-green-900/40 text-green-300 border border-green-800/50">{counts.Low}</span>
                                : <span className="text-gray-600">-</span>}
                            </td>
                            <td className="px-3 py-2.5 text-gray-300">
                              {v.tyres.some(t => t.tread_depth != null) ? `${avgTread.toFixed(1)}mm` : '-'}
                            </td>
                            <td className="px-3 py-2.5 text-gray-500 text-xs">{fmtDate(lastDate)}</td>
                          </motion.tr>
                        )
                      })}
                    </AnimatePresence>
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* ── Trend chart ── */}
          <div className="card">
            <div className="flex items-center gap-2 mb-4">
              <TrendingUp size={16} className="text-green-400" />
              <h2 className="text-base font-semibold text-white">{t('fleethealth.trend.title')}</h2>
            </div>
            <div className="h-48">
              <Line data={trendChartData} options={trendOpts} />
            </div>
          </div>
        </div>

        {/* ── Right: critical alerts sidebar ── */}
        <div className="hidden lg:flex flex-col gap-3 w-64 xl:w-72 flex-shrink-0">
          <div className="card flex-1 max-h-[calc(100vh-12rem)] overflow-y-auto">
            <div className="flex items-center gap-2 mb-3">
              <AlertTriangle size={15} className="text-red-400" />
              <h2 className="text-sm font-semibold text-white">{t('fleethealth.sidebar.criticalAlerts')}</h2>
              {criticalList.length > 0 && (
                <span className="ml-auto bg-red-900/50 text-red-300 text-xs px-2 py-0.5 rounded-full border border-red-800/50">
                  {criticalList.length}
                </span>
              )}
            </div>

            {criticalList.length === 0 ? (
              <div className="flex flex-col items-center gap-2 py-8">
                <CheckCircle size={28} className="text-green-500" />
                <p className="text-green-400 text-sm font-medium">{t('fleethealth.sidebar.noCriticalAlerts')}</p>
                <p className="text-gray-600 text-xs text-center">{t('fleethealth.sidebar.allSafe')}</p>
              </div>
            ) : (
              <div className="space-y-2">
                {criticalList.map(v => (
                  <button
                    key={v.asset_no}
                    onClick={() => openDrawer(v.asset_no)}
                    className="w-full text-left bg-red-950/30 border border-red-900/40 rounded-lg px-3 py-2.5 hover:border-red-700/60 transition-colors group"
                  >
                    <div className="flex items-center justify-between">
                      <span className="text-white font-semibold text-sm">{v.asset_no}</span>
                      <ChevronRight size={12} className="text-gray-600 group-hover:text-white transition-colors" />
                    </div>
                    <p className="text-gray-400 text-xs mt-0.5">{v.site} · {v.country}</p>
                    {v.worstTread != null && (
                      <p className="text-red-400 text-xs mt-1">
                        {t('fleethealth.sidebar.treadAt', { mm: v.worstTread, position: v.worstPos ?? t('fleethealth.sidebar.na') })}
                      </p>
                    )}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ── Detail Drawer ── */}
      <AnimatePresence>
        {drawerOpen && drawerVehicle && (
          <>
            {/* Backdrop */}
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 bg-black/50 z-40"
              onClick={() => setDrawerOpen(false)}
            />

            {/* Drawer */}
            <motion.div
              ref={drawerRef}
              initial={{ x: '100%' }}
              animate={{ x: 0 }}
              exit={{ x: '100%' }}
              transition={{ type: 'spring', damping: 28, stiffness: 280 }}
              className="fixed top-0 right-0 h-full w-full sm:w-[520px] lg:w-[600px] z-50 bg-gray-950 border-l border-gray-800 flex flex-col shadow-2xl"
            >
              {/* Drawer header */}
              <div className="flex items-center justify-between px-5 py-4 border-b border-gray-800">
                <div>
                  <h2 className="text-lg font-bold text-white flex items-center gap-2">
                    <Truck size={18} className="text-green-400" />
                    {drawerVehicle.asset_no}
                  </h2>
                  <p className="text-gray-400 text-sm mt-0.5">
                    {drawerVehicle.site ?? '-'} · {drawerVehicle.country ?? '-'}
                  </p>
                </div>
                <div className="flex items-center gap-3">
                  <HealthCircle score={vehicleHealthScore(drawerVehicle.tyres)} size={52} />
                  <button
                    onClick={() => setDrawerOpen(false)}
                    className="p-1.5 rounded-lg hover:bg-gray-800 text-gray-400 hover:text-white transition-colors"
                  >
                    <X size={18} />
                  </button>
                </div>
              </div>

              {/* Drawer body */}
              <div className="flex-1 overflow-y-auto px-5 py-4 space-y-5">

                {/* Tyre table */}
                <div>
                  <h3 className="text-sm font-semibold text-gray-300 mb-2">{t('fleethealth.drawer.activeTyres')}</h3>
                  <div className="overflow-x-auto rounded-lg border border-gray-800">
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="border-b border-gray-800 bg-gray-900/50">
                          {['position','serial','brand','size','tread','pressure','risk','fitted'].map(hKey => (
                            <th key={hKey} className="text-left px-2.5 py-2 text-gray-500 font-medium whitespace-nowrap">{t(`fleethealth.drawer.tyreColumns.${hKey}`)}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {drawerVehicle.tyres.map(t => (
                          <tr key={t.id} className="border-b border-gray-800/50 hover:bg-gray-800/30">
                            <td className="px-2.5 py-2 text-gray-300 font-mono">{t.position ?? '-'}</td>
                            <td className="px-2.5 py-2 text-gray-400 font-mono">{t.serial_number?.slice(-8) ?? '-'}</td>
                            <td className="px-2.5 py-2 text-gray-300">{t.brand ?? '-'}</td>
                            <td className="px-2.5 py-2 text-gray-400">{t.size ?? '-'}</td>
                            <td className="px-2.5 py-2 text-gray-300">
                              {t.tread_depth != null ? `${t.tread_depth}mm` : '-'}
                            </td>
                            <td className="px-2.5 py-2 text-gray-300">
                              {t.pressure_reading != null ? `${t.pressure_reading}` : '-'}
                            </td>
                            <td className="px-2.5 py-2">
                              <span className={`badge border text-xs ${riskBgClass(t.risk_level)}`}>
                                {t.risk_level ?? '-'}
                              </span>
                            </td>
                            <td className="px-2.5 py-2 text-gray-500 flex items-center gap-1">
                              <Clock size={10} />
                              {daysFitted(t.issue_date)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>

                {/* Risk trend mini chart */}
                {drawerTrendData && (
                  <div>
                    <h3 className="text-sm font-semibold text-gray-300 mb-2">{t('fleethealth.drawer.riskIndexTrend')}</h3>
                    <div className="bg-gray-900 rounded-lg border border-gray-800 p-3 h-36">
                      <Line
                        data={drawerTrendData}
                        options={{
                          responsive: true,
                          maintainAspectRatio: false,
                          plugins: { legend: { display: false } },
                          scales: {
                            x: { ticks: { color: '#6b7280', font: { size: 9 } }, grid: GRID },
                            y: {
                              ticks: {
                                color: '#6b7280', font: { size: 9 },
                                callback: v => v === 0 ? t('fleethealth.drawer.riskAxis.critical') : v === 33 ? t('fleethealth.drawer.riskAxis.high') : v === 66 ? t('fleethealth.drawer.riskAxis.medium') : t('fleethealth.drawer.riskAxis.low'),
                              },
                              grid: GRID,
                              min: 0, max: 100,
                            },
                          },
                        }}
                      />
                    </div>
                  </div>
                )}

                {/* Actions */}
                <div className="flex gap-3 pt-1">
                  <button
                    onClick={() => navigate(`/vehicle-history?asset=${drawerVehicle.asset_no}`)}
                    className="flex-1 btn-secondary flex items-center justify-center gap-2 text-sm"
                  >
                    <ExternalLink size={13} /> {t('fleethealth.drawer.viewInTyreRecords')}
                  </button>
                  <button
                    onClick={() => navigate(`/work-orders?asset=${drawerVehicle.asset_no}`)}
                    className="flex-1 btn-primary flex items-center justify-center gap-2 text-sm"
                  >
                    <Wrench size={13} /> {t('fleethealth.drawer.createWorkOrder')}
                  </button>
                </div>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </div>
  )
}

// ── KPI Card ──────────────────────────────────────────────────────────────────
function KpiCard({ label, value, sub, icon: Icon, color }) {
  const colors = {
    green:  { icon: 'text-green-400',  value: 'text-green-400',  bg: 'bg-green-900/20' },
    yellow: { icon: 'text-yellow-400', value: 'text-yellow-400', bg: 'bg-yellow-900/20' },
    red:    { icon: 'text-red-400',    value: 'text-red-400',    bg: 'bg-red-900/20' },
    orange: { icon: 'text-orange-400', value: 'text-orange-400', bg: 'bg-orange-900/20' },
    blue:   { icon: 'text-blue-400',   value: 'text-blue-400',   bg: 'bg-blue-900/20' },
  }
  const c = colors[color] ?? colors.blue

  return (
    <div className="card">
      <div className="flex items-start justify-between">
        <div>
          <p className="text-gray-400 text-xs uppercase tracking-wide font-medium">{label}</p>
          <p className={`text-2xl font-bold mt-1 ${c.value}`}>{value}</p>
          {sub && <p className="text-gray-600 text-xs mt-0.5">{sub}</p>}
        </div>
        <div className={`p-2 rounded-lg ${c.bg}`}>
          <Icon size={18} className={c.icon} />
        </div>
      </div>
    </div>
  )
}

// ── Vehicle Card ──────────────────────────────────────────────────────────────
function VehicleCard({ vehicle, onClick, isSelected }) {
  const { t } = useLanguage()
  const { asset_no, site, country, tyres, score, worst } = vehicle

  const lastDate = tyres
    .filter(t => t.issue_date)
    .sort((a, b) => new Date(b.issue_date) - new Date(a.issue_date))[0]?.issue_date

  function fmtDate(d) {
    if (!d) return '-'
    return formatDate(d, 'All', { day: '2-digit', month: 'short', year: 'numeric' })
  }

  return (
    <motion.div
      whileHover={{ y: -2 }}
      onClick={onClick}
      className={`card cursor-pointer transition-all duration-200 ${scoreBorderClass(score)} ${isSelected ? 'ring-1 ring-green-500/50' : ''} hover:shadow-lg hover:shadow-green-900/10`}
    >
      {/* Asset + location */}
      <div className="flex items-start justify-between mb-3">
        <div>
          <p className="text-white font-bold text-base leading-tight">{asset_no}</p>
          <div className="flex items-center gap-1.5 mt-1 flex-wrap">
            {site && (
              <span className="flex items-center gap-1 text-xs text-gray-400 bg-gray-800/60 rounded px-1.5 py-0.5">
                <MapPin size={9} />{site}
              </span>
            )}
            {country && (
              <span className="flex items-center gap-1 text-xs text-gray-500 bg-gray-800/40 rounded px-1.5 py-0.5">
                <Globe size={9} />{country}
              </span>
            )}
          </div>
        </div>
        <HealthCircle score={score} size={48} />
      </div>

      {/* Mini tyre diagram */}
      {tyres.length > 0 ? (
        <div className="flex justify-center py-2">
          <MiniTyreDiagram tyres={tyres} />
        </div>
      ) : (
        <div className="flex items-center justify-center py-4">
          <span className="text-gray-600 text-xs">{t('fleethealth.card.noTyreData')}</span>
        </div>
      )}

      {/* Footer row */}
      <div className="flex items-center justify-between mt-3 pt-3 border-t border-gray-800/60">
        <span className="text-gray-500 text-xs">{t('fleethealth.card.tyresCount', { count: tyres.length })}</span>
        {worst && (
          <span className={`badge border text-xs ${riskBgClass(worst)}`}>{worst}</span>
        )}
        {!worst && (
          <span className="text-gray-600 text-xs">{t('fleethealth.card.noData')}</span>
        )}
        <span className="text-gray-600 text-xs">{lastDate ? formatDate(lastDate, 'All', { day:'2-digit', month:'short' }) : '-'}</span>
      </div>

      {/* Drill-in hint */}
      <div className="flex items-center justify-end mt-2 gap-1 text-gray-700 hover:text-gray-400 transition-colors">
        <span className="text-xs">{t('fleethealth.card.details')}</span>
        <ChevronRight size={11} />
      </div>
    </motion.div>
  )
}
