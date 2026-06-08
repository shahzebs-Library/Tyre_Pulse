import { useState, useEffect, useMemo, useCallback, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { motion, AnimatePresence } from 'framer-motion'
import {
  Chart as ChartJS,
  CategoryScale, LinearScale, BarElement,
  ArcElement, Title, Tooltip, Legend,
} from 'chart.js'
import { Bar, Doughnut } from 'react-chartjs-2'
import {
  Activity, AlertTriangle, CheckCircle, RefreshCw,
  Search, X, ChevronRight, Grid, List, Map,
  Truck, MapPin, Shield, Clock, Bell,
  Wrench, Calendar, Filter, Download,
  TrendingDown, Users, ToggleLeft, ToggleRight,
  Eye, ChevronDown, ChevronUp, Radio,
} from 'lucide-react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../contexts/AuthContext'
import { useSettings } from '../contexts/SettingsContext'
import VehicleTyreDiagram from '../components/VehicleTyreDiagram'

ChartJS.register(
  CategoryScale, LinearScale, BarElement,
  ArcElement, Title, Tooltip, Legend,
)

// ── Constants ─────────────────────────────────────────────────────────────────
const VEHICLE_EMOJI = {
  'Tri-mixer':     '🚛',
  'Concrete pump': '🏗️',
  'Canter':        '🚚',
  'Wheel loader':  '🚜',
  'Skid loader':   '🚜',
  'Pickup':        '🛻',
}

function vehicleEmoji(type) {
  return VEHICLE_EMOJI[type] ?? '🚗'
}

// ── Risk helpers ──────────────────────────────────────────────────────────────
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

function severityBgClass(s) {
  return {
    Critical: 'bg-red-900/40 text-red-300 border-red-800/50',
    High:     'bg-orange-900/40 text-orange-300 border-orange-800/50',
    Medium:   'bg-yellow-900/40 text-yellow-300 border-yellow-800/50',
    Low:      'bg-blue-900/40 text-blue-300 border-blue-800/50',
  }[s] ?? 'bg-gray-800/60 text-gray-400 border-gray-700'
}

// ── Health score (per spec) ───────────────────────────────────────────────────
function calcHealthScore(tyres) {
  if (!tyres?.length) return 0
  const critical = tyres.filter(t => t.risk_level === 'Critical').length
  const high     = tyres.filter(t => t.risk_level === 'High').length
  const medium   = tyres.filter(t => t.risk_level === 'Medium').length
  const score    = 100 - (critical * 25 + high * 15 + medium * 5)
  return Math.max(0, Math.min(100, score))
}

function scoreColor(score) {
  if (score >= 80) return '#16a34a'
  if (score >= 60) return '#ca8a04'
  if (score >= 40) return '#ea580c'
  return '#dc2626'
}

function scoreBorderClass(score) {
  if (score >= 80) return 'border-green-800/50'
  if (score >= 60) return 'border-yellow-800/50'
  if (score >= 40) return 'border-orange-800/50'
  return 'border-red-800/50'
}

function scoreLabel(score) {
  if (score >= 80) return 'Operational'
  if (score >= 60) return 'Monitor'
  if (score >= 40) return 'At Risk'
  return 'Critical'
}

// ── Date helpers ──────────────────────────────────────────────────────────────
function daysAgo(dateStr) {
  if (!dateStr) return null
  return Math.floor((Date.now() - new Date(dateStr)) / 86400000)
}

function fmtDate(d) {
  if (!d) return '—'
  return new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
}

function fmtShortDate(d) {
  if (!d) return '—'
  return new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' })
}

function startOfWeek() {
  const d = new Date()
  d.setHours(0, 0, 0, 0)
  d.setDate(d.getDate() - d.getDay())
  return d
}

function endOfWeek() {
  const d = startOfWeek()
  d.setDate(d.getDate() + 6)
  return d
}

// ── Export to Excel ───────────────────────────────────────────────────────────
function exportFleetStatus(vehicles, alerts) {
  const rows = [
    ['Asset No', 'Fleet No', 'Vehicle Type', 'Site', 'Operator', 'Health Score', 'Status', 'Critical Tyres', 'High Tyres', 'Medium Tyres', 'Total Tyres', 'Active Alerts', 'Last Inspection'],
    ...vehicles.map(v => [
      v.asset_no,
      v.fleet_number ?? '',
      v.vehicle_type ?? '',
      v.site ?? '',
      v.operator_name ?? '',
      v.score,
      scoreLabel(v.score),
      v.criticalCount,
      v.highCount,
      v.mediumCount,
      v.tyres.length,
      v.alertCount,
      v.lastInspectionDate ? fmtDate(v.lastInspectionDate) : 'None',
    ]),
  ]

  const csv = rows.map(r => r.map(c => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\n')
  const blob = new Blob([csv], { type: 'text/csv' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `fleet-status-${new Date().toISOString().slice(0, 10)}.csv`
  a.click()
  URL.revokeObjectURL(url)
}

// ── HealthCircle ──────────────────────────────────────────────────────────────
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

// ── Mini tyre position dots ───────────────────────────────────────────────────
function TyreDot({ tyre, label }) {
  const [tip, setTip] = useState(false)
  const color  = tyre ? riskColor(tyre.risk_level) : '#374151'
  const opacity = tyre ? 1 : 0.3

  return (
    <div className="relative flex flex-col items-center gap-0.5">
      <div
        className="w-3.5 h-3.5 rounded-full cursor-default transition-transform hover:scale-125"
        style={{ backgroundColor: color, opacity, boxShadow: tyre ? `0 0 5px ${color}55` : 'none' }}
        onMouseEnter={() => setTip(true)}
        onMouseLeave={() => setTip(false)}
      />
      <span className="text-gray-600 font-mono" style={{ fontSize: '8px' }}>{label}</span>
      {tip && tyre && (
        <div className="absolute bottom-6 left-1/2 -translate-x-1/2 z-50 bg-gray-900 border border-gray-700 rounded-lg p-2 text-xs whitespace-nowrap shadow-xl pointer-events-none">
          <p className="text-white font-semibold">{label}</p>
          <p className="text-gray-400">{tyre.brand ?? '—'}</p>
          {tyre.tread_depth != null && <p className="text-gray-400">Tread: {tyre.tread_depth}mm</p>}
          {tyre.pressure_reading != null && <p className="text-gray-400">PSI: {tyre.pressure_reading}</p>}
          <p style={{ color: riskColor(tyre.risk_level) }}>{tyre.risk_level}</p>
        </div>
      )}
    </div>
  )
}

function MiniPositionGrid({ tyres }) {
  function findTyre(pattern) {
    return tyres.find(t => new RegExp(pattern, 'i').test(t.position ?? '')) ?? null
  }

  const fl  = findTyre('FL|F1|steer.*l|left.*front')
  const fr  = findTyre('FR|F2|steer.*r|right.*front')
  const rli = findTyre('RLI')
  const rlo = findTyre('RLO')
  const rri = findTyre('RRI')
  const rro = findTyre('RRO')
  const rl  = !rli && !rlo ? findTyre('RL(?!I|O)|rear.*l') : null
  const rr  = !rri && !rro ? findTyre('RR(?!I|O)|rear.*r') : null

  return (
    <div className="flex flex-col items-center gap-1.5">
      <div className="flex gap-5">
        <TyreDot tyre={fl} label="FL" />
        <TyreDot tyre={fr} label="FR" />
      </div>
      {(rli || rlo || rri || rro) ? (
        <div className="flex gap-1.5">
          {rlo && <TyreDot tyre={rlo} label="RLO" />}
          {rli && <TyreDot tyre={rli} label="RLI" />}
          {rri && <TyreDot tyre={rri} label="RRI" />}
          {rro && <TyreDot tyre={rro} label="RRO" />}
        </div>
      ) : (
        <div className="flex gap-5">
          <TyreDot tyre={rl} label="RL" />
          <TyreDot tyre={rr} label="RR" />
        </div>
      )}
    </div>
  )
}

// ── Skeleton card ─────────────────────────────────────────────────────────────
function SkeletonCard() {
  return (
    <div className="bg-gray-900 border border-gray-800 rounded-xl p-4 animate-pulse">
      <div className="flex items-start justify-between mb-3">
        <div className="space-y-1.5">
          <div className="h-5 w-28 bg-gray-800 rounded" />
          <div className="h-3.5 w-20 bg-gray-800 rounded" />
        </div>
        <div className="h-12 w-12 bg-gray-800 rounded-full" />
      </div>
      <div className="flex justify-center py-3">
        <div className="h-10 w-28 bg-gray-800 rounded" />
      </div>
      <div className="flex justify-between pt-3 border-t border-gray-800 mt-2">
        <div className="h-4 w-16 bg-gray-800 rounded" />
        <div className="h-4 w-12 bg-gray-800 rounded" />
      </div>
    </div>
  )
}

// ── KPI Card ──────────────────────────────────────────────────────────────────
function KpiCard({ label, value, sub, icon: Icon, color, pulse }) {
  const colors = {
    green:  { icon: 'text-green-400',  value: 'text-green-400',  bg: 'bg-green-900/20',  border: 'border-green-900/40' },
    yellow: { icon: 'text-yellow-400', value: 'text-yellow-400', bg: 'bg-yellow-900/20', border: 'border-yellow-900/40' },
    red:    { icon: 'text-red-400',    value: 'text-red-400',    bg: 'bg-red-900/20',    border: 'border-red-900/40' },
    orange: { icon: 'text-orange-400', value: 'text-orange-400', bg: 'bg-orange-900/20', border: 'border-orange-900/40' },
    blue:   { icon: 'text-blue-400',   value: 'text-blue-400',   bg: 'bg-blue-900/20',   border: 'border-blue-900/40' },
  }
  const c = colors[color] ?? colors.blue

  return (
    <div className={`bg-gray-900 border ${c.border} rounded-xl p-4 flex items-start justify-between`}>
      <div>
        <p className="text-gray-400 text-xs uppercase tracking-wide font-medium leading-tight">{label}</p>
        <p className={`text-2xl font-bold mt-1.5 ${c.value}`}>{value}</p>
        {sub && <p className="text-gray-600 text-xs mt-0.5">{sub}</p>}
      </div>
      <div className={`p-2.5 rounded-lg ${c.bg} relative`}>
        <Icon size={18} className={c.icon} />
        {pulse && <span className="absolute top-1 right-1 w-2 h-2 rounded-full bg-red-500 animate-ping" />}
      </div>
    </div>
  )
}

// ── Vehicle Card ──────────────────────────────────────────────────────────────
function VehicleCard({ vehicle, onClick, isSelected }) {
  const {
    asset_no, fleet_number, vehicle_type, site, operator_name,
    tyres, score, alertCount, lastInspectionDate,
    criticalCount, highCount,
  } = vehicle

  const daysSinceInspection = daysAgo(lastInspectionDate)
  const inspectionStale     = daysSinceInspection != null && daysSinceInspection > 30

  return (
    <motion.div
      whileHover={{ y: -2 }}
      onClick={onClick}
      className={`
        bg-gray-900 border rounded-xl p-4 cursor-pointer transition-all duration-200
        hover:shadow-lg hover:shadow-black/30 select-none
        ${scoreBorderClass(score)}
        ${isSelected ? 'ring-1 ring-green-500/50 bg-gray-800/50' : ''}
      `}
    >
      {/* Header */}
      <div className="flex items-start justify-between mb-2.5">
        <div className="min-w-0 flex-1 mr-2">
          <div className="flex items-center gap-2">
            <span className="text-lg leading-none">{vehicleEmoji(vehicle_type)}</span>
            <div>
              <p className="text-white font-bold text-sm leading-tight truncate">{asset_no}</p>
              {fleet_number && (
                <p className="text-gray-500 text-xs leading-tight font-mono">{fleet_number}</p>
              )}
            </div>
          </div>
        </div>
        <HealthCircle score={score} size={46} />
      </div>

      {/* Badges row */}
      <div className="flex flex-wrap gap-1 mb-3">
        {site && (
          <span className="flex items-center gap-0.5 text-xs text-gray-400 bg-gray-800/70 rounded px-1.5 py-0.5">
            <MapPin size={8} />{site}
          </span>
        )}
        {operator_name && (
          <span className="flex items-center gap-0.5 text-xs text-gray-500 bg-gray-800/40 rounded px-1.5 py-0.5 truncate max-w-[80px]">
            <Users size={8} />{operator_name}
          </span>
        )}
      </div>

      {/* Mini tyre grid */}
      {tyres.length > 0 ? (
        <div className="flex justify-center py-1.5 bg-gray-950/40 rounded-lg mb-3">
          <MiniPositionGrid tyres={tyres} />
        </div>
      ) : (
        <div className="flex items-center justify-center py-4 bg-gray-950/40 rounded-lg mb-3">
          <span className="text-gray-600 text-xs">No tyre data</span>
        </div>
      )}

      {/* Footer */}
      <div className="flex items-center justify-between text-xs">
        {/* Last inspection */}
        <span className={`flex items-center gap-1 ${inspectionStale ? 'text-red-400' : 'text-gray-500'}`}>
          <Clock size={9} />
          {lastInspectionDate
            ? `${daysSinceInspection}d ago`
            : 'No insp.'
          }
        </span>

        {/* Score label */}
        <span
          className="px-1.5 py-0.5 rounded text-xs font-medium border"
          style={{
            color: scoreColor(score),
            borderColor: scoreColor(score) + '55',
            backgroundColor: scoreColor(score) + '15',
          }}
        >
          {scoreLabel(score)}
        </span>

        {/* Alert badge */}
        {alertCount > 0 ? (
          <span className="flex items-center gap-0.5 bg-red-900/40 text-red-300 border border-red-800/50 rounded px-1.5 py-0.5">
            <Bell size={8} />{alertCount}
          </span>
        ) : (
          <span className="text-gray-700 flex items-center gap-0.5">
            <Bell size={8} />0
          </span>
        )}
      </div>

      {/* Drill hint */}
      <div className="flex items-center justify-end mt-2 gap-0.5 text-gray-700 hover:text-gray-400 transition-colors">
        <span className="text-xs">Details</span>
        <ChevronRight size={10} />
      </div>
    </motion.div>
  )
}

// ── Main component ─────────────────────────────────────────────────────────────
export default function LiveFleetStatus() {
  const navigate = useNavigate()
  const { profile } = useAuth()
  const { activeCurrency, activeCountry } = useSettings()

  // ── Data state ───────────────────────────────────────────────────────────────
  const [fleetData,    setFleetData]    = useState([])
  const [tyreRecords,  setTyreRecords]  = useState([])
  const [inspections,  setInspections]  = useState([])
  const [alertsData,   setAlertsData]   = useState([])

  const [loading,      setLoading]      = useState(true)
  const [error,        setError]        = useState(null)
  const [lastUpdated,  setLastUpdated]  = useState(null)
  const [refreshing,   setRefreshing]   = useState(false)
  const [autoRefresh,  setAutoRefresh]  = useState(false)
  const autoRefreshRef = useRef(null)

  // ── UI state ─────────────────────────────────────────────────────────────────
  const [viewMode,       setViewMode]       = useState('grid')
  const [siteFilter,     setSiteFilter]     = useState('All')
  const [statusFilter,   setStatusFilter]   = useState('All')
  const [search,         setSearch]         = useState('')
  const [selectedAsset,  setSelectedAsset]  = useState(null)
  const [drawerOpen,     setDrawerOpen]     = useState(false)
  const [briefingOpen,   setBriefingOpen]   = useState(true)
  const drawerRef = useRef(null)

  // ── Fetch ────────────────────────────────────────────────────────────────────
  const load = useCallback(async (silent = false) => {
    if (!silent) setLoading(true)
    else setRefreshing(true)
    setError(null)

    try {
      const today = new Date().toISOString().slice(0, 10)
      const weekAgo = new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 10)

      // Parallel fetch all four tables
      const [fleetRes, tyreRes, inspRes, alertRes] = await Promise.all([
        supabase
          .from('fleet_master')
          .select('asset_no,fleet_number,make,model,vehicle_type,site,status,operator_name'),

        supabase
          .from('tyre_records')
          .select('asset_no,risk_level,tread_depth,pressure_reading,position,site,issue_date,removal_date,brand,serial_number,size')
          .is('removal_date', null),

        supabase
          .from('inspections')
          .select('asset_no,scheduled_date,status,inspection_type')
          .order('scheduled_date', { ascending: false }),

        supabase
          .from('alerts')
          .select('asset_no,severity,message,created_at,is_active')
          .eq('is_active', true),
      ])

      if (fleetRes.error) throw fleetRes.error
      if (tyreRes.error)  throw tyreRes.error
      // inspections and alerts are best-effort — don't throw

      setFleetData(fleetRes.data   ?? [])
      setTyreRecords(tyreRes.data  ?? [])
      setInspections(inspRes.data  ?? [])
      setAlertsData(alertRes.data  ?? [])
      setLastUpdated(new Date())
    } catch (e) {
      setError(e.message ?? 'Failed to load fleet data')
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  // ── Auto-refresh ─────────────────────────────────────────────────────────────
  useEffect(() => {
    if (autoRefresh) {
      autoRefreshRef.current = setInterval(() => load(true), 60000)
    } else {
      clearInterval(autoRefreshRef.current)
    }
    return () => clearInterval(autoRefreshRef.current)
  }, [autoRefresh, load])

  // ── Close drawer on outside click ────────────────────────────────────────────
  useEffect(() => {
    function handler(e) {
      if (drawerOpen && drawerRef.current && !drawerRef.current.contains(e.target)) {
        setDrawerOpen(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [drawerOpen])

  // ── Derived: enrich fleet_master with tyres, inspections, alerts ──────────────
  const vehicles = useMemo(() => {
    const tyresByAsset = {}
    tyreRecords.forEach(t => {
      if (!t.asset_no) return
      if (!tyresByAsset[t.asset_no]) tyresByAsset[t.asset_no] = []
      tyresByAsset[t.asset_no].push(t)
    })

    const lastInspByAsset = {}
    const overdueByAsset  = {}
    inspections.forEach(i => {
      if (!i.asset_no) return
      // track latest scheduled date per asset
      if (!lastInspByAsset[i.asset_no] ||
          new Date(i.scheduled_date) > new Date(lastInspByAsset[i.asset_no].scheduled_date)) {
        lastInspByAsset[i.asset_no] = i
      }
      if (i.status === 'Overdue') overdueByAsset[i.asset_no] = true
    })

    const alertsByAsset = {}
    alertsData.forEach(a => {
      if (!a.asset_no) return
      if (!alertsByAsset[a.asset_no]) alertsByAsset[a.asset_no] = []
      alertsByAsset[a.asset_no].push(a)
    })

    return fleetData.map(v => {
      const tyres              = tyresByAsset[v.asset_no] ?? []
      const score              = calcHealthScore(tyres)
      const criticalCount      = tyres.filter(t => t.risk_level === 'Critical').length
      const highCount          = tyres.filter(t => t.risk_level === 'High').length
      const mediumCount        = tyres.filter(t => t.risk_level === 'Medium').length
      const lastInsp           = lastInspByAsset[v.asset_no]
      const lastInspectionDate = lastInsp?.scheduled_date ?? null
      const isOverdue          = !!overdueByAsset[v.asset_no]
      const vehicleAlerts      = alertsByAsset[v.asset_no] ?? []
      const alertCount         = vehicleAlerts.length

      return {
        ...v,
        tyres,
        score,
        criticalCount,
        highCount,
        mediumCount,
        lastInspectionDate,
        isOverdue,
        alertCount,
        vehicleAlerts,
      }
    })
  }, [fleetData, tyreRecords, inspections, alertsData])

  // ── Sites for filter ──────────────────────────────────────────────────────────
  const sites = useMemo(() =>
    ['All', ...new Set(vehicles.map(v => v.site).filter(Boolean))],
    [vehicles]
  )

  // ── KPIs ──────────────────────────────────────────────────────────────────────
  const kpis = useMemo(() => {
    const total       = vehicles.length
    const operational = vehicles.filter(v => v.criticalCount === 0 && v.highCount === 0).length
    const atRisk      = vehicles.filter(v => v.highCount > 0 || v.criticalCount > 0).length
    const overdue     = vehicles.filter(v => v.isOverdue).length
    const activeAlerts = alertsData.filter(a => a.is_active).length

    return { total, operational, atRisk, overdue, activeAlerts }
  }, [vehicles, alertsData])

  // ── Filtered & sorted vehicles ────────────────────────────────────────────────
  const filtered = useMemo(() => {
    return vehicles.filter(v => {
      if (siteFilter !== 'All' && v.site !== siteFilter) return false

      if (statusFilter !== 'All') {
        if (statusFilter === 'Operational' && (v.criticalCount > 0 || v.highCount > 0)) return false
        if (statusFilter === 'At Risk'     && v.highCount === 0 && v.criticalCount === 0) return false
        if (statusFilter === 'Critical'    && v.criticalCount === 0) return false
        if (statusFilter === 'Overdue'     && !v.isOverdue) return false
      }

      if (search) {
        const q = search.toLowerCase()
        if (
          !v.asset_no?.toLowerCase().includes(q) &&
          !v.fleet_number?.toLowerCase().includes(q) &&
          !v.site?.toLowerCase().includes(q) &&
          !v.operator_name?.toLowerCase().includes(q) &&
          !v.vehicle_type?.toLowerCase().includes(q)
        ) return false
      }

      return true
    }).sort((a, b) => a.score - b.score)
  }, [vehicles, siteFilter, statusFilter, search])

  // ── Detail drawer data ────────────────────────────────────────────────────────
  const drawerVehicle = useMemo(() => {
    if (!selectedAsset) return null
    return vehicles.find(v => v.asset_no === selectedAsset) ?? null
  }, [selectedAsset, vehicles])

  const drawerInspections = useMemo(() => {
    if (!selectedAsset) return []
    return inspections
      .filter(i => i.asset_no === selectedAsset)
      .sort((a, b) => new Date(b.scheduled_date) - new Date(a.scheduled_date))
      .slice(0, 5)
  }, [selectedAsset, inspections])

  // ── Top 5 vehicles needing attention ─────────────────────────────────────────
  const topAttention = useMemo(() =>
    [...vehicles].sort((a, b) => a.score - b.score).slice(0, 5),
    [vehicles]
  )

  // ── Upcoming inspections this week ────────────────────────────────────────────
  const weekStart = startOfWeek().toISOString().slice(0, 10)
  const weekEnd   = endOfWeek().toISOString().slice(0, 10)

  const upcomingInspections = useMemo(() => {
    return inspections
      .filter(i => i.scheduled_date >= weekStart && i.scheduled_date <= weekEnd)
      .sort((a, b) => new Date(a.scheduled_date) - new Date(b.scheduled_date))
      .slice(0, 8)
  }, [inspections, weekStart, weekEnd])

  // ── Doughnut chart data for drawer ───────────────────────────────────────────
  function drawerDoughnutData(tyres) {
    const critical = tyres.filter(t => t.risk_level === 'Critical').length
    const high     = tyres.filter(t => t.risk_level === 'High').length
    const medium   = tyres.filter(t => t.risk_level === 'Medium').length
    const low      = tyres.filter(t => t.risk_level === 'Low').length
    const noData   = tyres.filter(t => !t.risk_level).length
    return {
      labels: ['Critical', 'High', 'Medium', 'Low', 'No Data'],
      datasets: [{
        data: [critical, high, medium, low, noData],
        backgroundColor: ['#dc2626', '#ea580c', '#ca8a04', '#16a34a', '#374151'],
        borderWidth: 0,
      }],
    }
  }

  // ── Handlers ──────────────────────────────────────────────────────────────────
  function openDrawer(assetNo) {
    setSelectedAsset(assetNo)
    setDrawerOpen(true)
  }

  function clearFilters() {
    setSiteFilter('All')
    setStatusFilter('All')
    setSearch('')
  }

  const hasFilters = siteFilter !== 'All' || statusFilter !== 'All' || search

  const chartTooltipDefaults = {
    backgroundColor: '#111827',
    borderColor: '#374151',
    borderWidth: 1,
    titleColor: '#f9fafb',
    bodyColor: '#9ca3af',
  }

  // ── Loading ───────────────────────────────────────────────────────────────────
  if (loading) {
    return (
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-white">Live Fleet Status</h1>
            <p className="text-gray-400 text-sm mt-1">Loading fleet data…</p>
          </div>
        </div>
        <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
          {[1,2,3,4,5].map(i => (
            <div key={i} className="bg-gray-900 border border-gray-800 rounded-xl p-4 animate-pulse h-24">
              <div className="h-3 w-20 bg-gray-800 rounded mb-2" />
              <div className="h-7 w-14 bg-gray-800 rounded" />
            </div>
          ))}
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {Array.from({ length: 12 }).map((_, i) => <SkeletonCard key={i} />)}
        </div>
      </div>
    )
  }

  // ── Error ─────────────────────────────────────────────────────────────────────
  if (error) {
    return (
      <div className="flex flex-col items-center justify-center min-h-64 gap-4">
        <AlertTriangle size={40} className="text-red-400" />
        <p className="text-red-300 font-medium">{error}</p>
        <button onClick={() => load()} className="flex items-center gap-2 bg-green-700 hover:bg-green-600 text-white px-4 py-2 rounded-lg text-sm transition-colors">
          <RefreshCw size={14} /> Retry
        </button>
      </div>
    )
  }

  // ── Render ────────────────────────────────────────────────────────────────────
  return (
    <div className="space-y-5">

      {/* ── Page Header ── */}
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-white flex items-center gap-2">
            <Radio size={20} className="text-green-400" />
            Live Fleet Status
          </h1>
          <p className="text-gray-400 text-sm mt-0.5">
            Morning briefing — real-time vehicle & tyre health
            {lastUpdated && (
              <span className="ml-2 text-gray-600">
                · Updated {lastUpdated.toLocaleTimeString()}
              </span>
            )}
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {/* Auto-refresh toggle */}
          <button
            onClick={() => setAutoRefresh(v => !v)}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-xs transition-colors ${
              autoRefresh
                ? 'bg-green-900/40 border-green-700 text-green-300'
                : 'bg-gray-800 border-gray-700 text-gray-400 hover:text-white'
            }`}
          >
            {autoRefresh ? <ToggleRight size={14} /> : <ToggleLeft size={14} />}
            Auto-refresh
            {autoRefresh && <span className="w-1.5 h-1.5 rounded-full bg-green-400 animate-ping" />}
          </button>

          {/* Export */}
          <button
            onClick={() => exportFleetStatus(filtered, alertsData)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-gray-700 bg-gray-800 text-gray-400 hover:text-white text-xs transition-colors"
          >
            <Download size={13} /> Export
          </button>

          {/* Refresh */}
          <button
            onClick={() => load(true)}
            disabled={refreshing}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-gray-700 bg-gray-800 text-gray-400 hover:text-white text-xs transition-colors"
          >
            <RefreshCw size={13} className={refreshing ? 'animate-spin' : ''} />
            Refresh
          </button>
        </div>
      </div>

      {/* ── KPI Status Bar ── */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
        <KpiCard
          label="Fleet Total"
          value={kpis.total}
          sub="registered vehicles"
          icon={Truck}
          color="blue"
        />
        <KpiCard
          label="Operational"
          value={kpis.operational}
          sub="no critical/high risk"
          icon={CheckCircle}
          color={kpis.operational === kpis.total ? 'green' : 'yellow'}
        />
        <KpiCard
          label="At Risk"
          value={kpis.atRisk}
          sub="high or critical tyres"
          icon={AlertTriangle}
          color={kpis.atRisk > 0 ? 'orange' : 'green'}
          pulse={kpis.atRisk > 0}
        />
        <KpiCard
          label="Inspection Overdue"
          value={kpis.overdue}
          sub="past scheduled date"
          icon={Calendar}
          color={kpis.overdue > 0 ? 'red' : 'green'}
        />
        <KpiCard
          label="Active Alerts"
          value={kpis.activeAlerts}
          sub={`as of ${new Date().toLocaleDateString('en-GB', { day:'2-digit', month:'short' })}`}
          icon={Bell}
          color={kpis.activeAlerts > 0 ? 'red' : 'green'}
          pulse={kpis.activeAlerts > 0}
        />
      </div>

      {/* ── Main layout ── */}
      <div className="flex gap-4">

        {/* ── Board (left/main) ── */}
        <div className="flex-1 min-w-0 space-y-4">

          {/* ── Filter & View Bar ── */}
          <div className="bg-gray-900 border border-gray-800 rounded-xl p-3">
            <div className="flex flex-wrap gap-2 items-center">

              {/* Search */}
              <div className="relative flex-1 min-w-40">
                <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-500" />
                <input
                  className="w-full bg-gray-800 border border-gray-700 rounded-lg pl-8 pr-7 py-1.5 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-green-700 focus:ring-1 focus:ring-green-700/30 transition"
                  placeholder="Search asset, fleet no, operator…"
                  value={search}
                  onChange={e => setSearch(e.target.value)}
                />
                {search && (
                  <button onClick={() => setSearch('')} className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-300">
                    <X size={12} />
                  </button>
                )}
              </div>

              {/* Site filter */}
              <div className="flex items-center gap-1">
                <MapPin size={12} className="text-gray-500" />
                <select
                  className="bg-gray-800 border border-gray-700 rounded-lg px-2 py-1.5 text-sm text-white focus:outline-none focus:border-green-700 transition"
                  value={siteFilter}
                  onChange={e => setSiteFilter(e.target.value)}
                >
                  {sites.map(s => <option key={s} value={s}>{s}</option>)}
                </select>
              </div>

              {/* Status filter */}
              <div className="flex items-center gap-1">
                <Filter size={12} className="text-gray-500" />
                <select
                  className="bg-gray-800 border border-gray-700 rounded-lg px-2 py-1.5 text-sm text-white focus:outline-none focus:border-green-700 transition"
                  value={statusFilter}
                  onChange={e => setStatusFilter(e.target.value)}
                >
                  {['All', 'Operational', 'At Risk', 'Critical', 'Overdue'].map(s => (
                    <option key={s} value={s}>{s}</option>
                  ))}
                </select>
              </div>

              {hasFilters && (
                <button onClick={clearFilters} className="text-xs text-green-500 hover:text-green-400 underline">
                  Clear
                </button>
              )}

              {/* View mode toggle */}
              <div className="flex bg-gray-800 rounded-lg border border-gray-700 overflow-hidden ml-auto">
                {[
                  { mode: 'grid', Icon: Grid },
                  { mode: 'list', Icon: List },
                  { mode: 'map',  Icon: Map  },
                ].map(({ mode, Icon }) => (
                  <button
                    key={mode}
                    onClick={() => setViewMode(mode)}
                    title={mode.charAt(0).toUpperCase() + mode.slice(1) + ' view'}
                    className={`p-2 transition-colors ${
                      viewMode === mode
                        ? 'bg-green-700 text-white'
                        : 'text-gray-400 hover:text-white'
                    }`}
                  >
                    <Icon size={14} />
                  </button>
                ))}
              </div>
            </div>

            {hasFilters && (
              <p className="text-xs text-green-500 mt-2">
                {filtered.length} of {vehicles.length} vehicles matching filters
              </p>
            )}
          </div>

          {/* ── Map view placeholder ── */}
          {viewMode === 'map' && (
            <div className="bg-gray-900 border border-gray-800 rounded-xl p-16 flex flex-col items-center justify-center gap-3">
              <Map size={48} className="text-gray-700" />
              <p className="text-gray-400 font-semibold">Map view coming soon</p>
              <p className="text-gray-600 text-sm text-center">
                Geographic fleet tracking with live GPS integration will be available in a future release.
              </p>
              <button
                onClick={() => setViewMode('grid')}
                className="mt-2 text-sm text-green-500 hover:text-green-400 underline"
              >
                Switch to Grid view
              </button>
            </div>
          )}

          {/* ── Empty state ── */}
          {viewMode !== 'map' && filtered.length === 0 && vehicles.length === 0 && (
            <div className="bg-gray-900 border border-gray-800 rounded-xl py-16 flex flex-col items-center justify-center gap-3">
              <Truck size={48} className="text-gray-700" />
              <p className="text-gray-300 font-semibold">No Fleet Records Found</p>
              <p className="text-gray-600 text-sm text-center max-w-sm">
                Add vehicles to your fleet master table to see live status here.
              </p>
              <button
                onClick={() => navigate('/fleet-master')}
                className="mt-2 bg-green-700 hover:bg-green-600 text-white px-4 py-2 rounded-lg text-sm transition-colors"
              >
                Go to Fleet Master
              </button>
            </div>
          )}

          {viewMode !== 'map' && filtered.length === 0 && vehicles.length > 0 && (
            <div className="bg-gray-900 border border-gray-800 rounded-xl py-12 flex flex-col items-center justify-center gap-3">
              <Filter size={36} className="text-gray-700" />
              <p className="text-gray-400 font-medium">No vehicles match your filters</p>
              <button onClick={clearFilters} className="text-sm text-green-500 hover:text-green-400 underline">
                Clear filters
              </button>
            </div>
          )}

          {/* ── Grid view ── */}
          {viewMode === 'grid' && filtered.length > 0 && (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
              <AnimatePresence mode="popLayout">
                {filtered.map(v => (
                  <motion.div
                    key={v.asset_no}
                    layout
                    initial={{ opacity: 0, scale: 0.95 }}
                    animate={{ opacity: 1, scale: 1 }}
                    exit={{ opacity: 0, scale: 0.9 }}
                    transition={{ duration: 0.18 }}
                  >
                    <VehicleCard
                      vehicle={v}
                      onClick={() => openDrawer(v.asset_no)}
                      isSelected={selectedAsset === v.asset_no && drawerOpen}
                    />
                  </motion.div>
                ))}
              </AnimatePresence>
            </div>
          )}

          {/* ── List view ── */}
          {viewMode === 'list' && filtered.length > 0 && (
            <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-gray-800 bg-gray-900/80">
                      {[
                        'Asset No', 'Fleet No', 'Type', 'Site', 'Operator',
                        'Tyres', 'Health', 'Last Inspection', 'Alerts', 'Status',
                      ].map(h => (
                        <th key={h} className="text-left px-3 py-3 text-xs font-medium text-gray-400 uppercase tracking-wide whitespace-nowrap">
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    <AnimatePresence>
                      {filtered.map(v => {
                        const daysSinceInsp     = daysAgo(v.lastInspectionDate)
                        const inspStale         = daysSinceInsp != null && daysSinceInsp > 30
                        return (
                          <motion.tr
                            key={v.asset_no}
                            initial={{ opacity: 0 }}
                            animate={{ opacity: 1 }}
                            exit={{ opacity: 0 }}
                            className="border-b border-gray-800/50 hover:bg-gray-800/30 cursor-pointer transition-colors"
                            onClick={() => openDrawer(v.asset_no)}
                          >
                            <td className="px-3 py-2.5">
                              <div className="flex items-center gap-1.5">
                                <span>{vehicleEmoji(v.vehicle_type)}</span>
                                <span className="text-white font-semibold">{v.asset_no}</span>
                              </div>
                            </td>
                            <td className="px-3 py-2.5 text-gray-400 font-mono text-xs">{v.fleet_number ?? '—'}</td>
                            <td className="px-3 py-2.5 text-gray-300 whitespace-nowrap">{v.vehicle_type ?? '—'}</td>
                            <td className="px-3 py-2.5 text-gray-400">{v.site ?? '—'}</td>
                            <td className="px-3 py-2.5 text-gray-400 max-w-24 truncate">{v.operator_name ?? '—'}</td>
                            <td className="px-3 py-2.5 whitespace-nowrap">
                              <div className="flex items-center gap-1 text-xs">
                                {v.criticalCount > 0 && (
                                  <span className="px-1.5 py-0.5 rounded bg-red-900/40 text-red-300 border border-red-800/50">
                                    {v.criticalCount}C
                                  </span>
                                )}
                                {v.highCount > 0 && (
                                  <span className="px-1.5 py-0.5 rounded bg-orange-900/40 text-orange-300 border border-orange-800/50">
                                    {v.highCount}H
                                  </span>
                                )}
                                {v.criticalCount === 0 && v.highCount === 0 && (
                                  <span className="text-gray-600">{v.tyres.length} ok</span>
                                )}
                              </div>
                            </td>
                            <td className="px-3 py-2.5">
                              <div className="flex items-center gap-1.5">
                                <span className="font-bold text-sm" style={{ color: scoreColor(v.score) }}>
                                  {v.score}
                                </span>
                                <span className="text-gray-600 text-xs">/100</span>
                              </div>
                            </td>
                            <td className="px-3 py-2.5">
                              <span className={`text-xs ${inspStale ? 'text-red-400' : 'text-gray-500'}`}>
                                {v.lastInspectionDate
                                  ? `${daysSinceInsp}d ago`
                                  : 'Never'
                                }
                              </span>
                            </td>
                            <td className="px-3 py-2.5">
                              {v.alertCount > 0 ? (
                                <span className="px-1.5 py-0.5 rounded text-xs bg-red-900/40 text-red-300 border border-red-800/50 flex items-center gap-0.5 w-fit">
                                  <Bell size={9} />{v.alertCount}
                                </span>
                              ) : (
                                <span className="text-gray-700 text-xs">—</span>
                              )}
                            </td>
                            <td className="px-3 py-2.5">
                              <span
                                className="px-2 py-0.5 rounded text-xs font-medium border"
                                style={{
                                  color: scoreColor(v.score),
                                  borderColor: scoreColor(v.score) + '55',
                                  backgroundColor: scoreColor(v.score) + '15',
                                }}
                              >
                                {scoreLabel(v.score)}
                              </span>
                            </td>
                          </motion.tr>
                        )
                      })}
                    </AnimatePresence>
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>

        {/* ── Daily Briefing Sidebar (desktop) ── */}
        <div className="hidden lg:flex flex-col gap-3 w-64 xl:w-72 flex-shrink-0">

          {/* Briefing Panel */}
          <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
            <button
              onClick={() => setBriefingOpen(v => !v)}
              className="w-full flex items-center justify-between px-4 py-3 border-b border-gray-800 hover:bg-gray-800/40 transition-colors"
            >
              <div className="flex items-center gap-2">
                <Eye size={14} className="text-green-400" />
                <span className="text-sm font-semibold text-white">Daily Briefing</span>
              </div>
              {briefingOpen ? <ChevronUp size={13} className="text-gray-500" /> : <ChevronDown size={13} className="text-gray-500" />}
            </button>

            <AnimatePresence initial={false}>
              {briefingOpen && (
                <motion.div
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: 'auto', opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  transition={{ duration: 0.2 }}
                  className="overflow-hidden"
                >
                  <div className="px-4 py-3 space-y-3">
                    {/* Summary text */}
                    <div className="bg-gray-950/60 border border-gray-800/60 rounded-lg p-3">
                      <p className="text-xs text-gray-300 leading-relaxed">
                        <span className="text-green-400 font-semibold">{kpis.operational}</span> vehicles operational
                        {kpis.atRisk > 0 && (
                          <>, <span className="text-orange-400 font-semibold">{kpis.atRisk}</span> at risk</>
                        )}
                        {kpis.overdue > 0 && (
                          <>, <span className="text-red-400 font-semibold">{kpis.overdue}</span> overdue for inspection</>
                        )}
                        {kpis.activeAlerts > 0 && (
                          <>, <span className="text-red-400 font-semibold">{kpis.activeAlerts}</span> active alert{kpis.activeAlerts !== 1 ? 's' : ''}</>
                        )}.
                      </p>
                    </div>

                    {/* Top 5 needing attention */}
                    <div>
                      <p className="text-xs text-gray-500 uppercase tracking-wide font-medium mb-2 flex items-center gap-1">
                        <TrendingDown size={10} />
                        Needs Attention Today
                      </p>
                      <div className="space-y-1.5">
                        {topAttention.length === 0 ? (
                          <p className="text-xs text-gray-600 text-center py-2">All vehicles healthy</p>
                        ) : (
                          topAttention.map(v => (
                            <button
                              key={v.asset_no}
                              onClick={() => openDrawer(v.asset_no)}
                              className="w-full text-left bg-gray-800/50 hover:bg-gray-800 border border-gray-800 hover:border-gray-700 rounded-lg px-2.5 py-2 transition-colors group"
                            >
                              <div className="flex items-center justify-between">
                                <div className="flex items-center gap-1.5">
                                  <span className="text-sm">{vehicleEmoji(v.vehicle_type)}</span>
                                  <span className="text-white text-xs font-semibold">{v.asset_no}</span>
                                </div>
                                <div className="flex items-center gap-1">
                                  <span className="text-xs font-bold" style={{ color: scoreColor(v.score) }}>
                                    {v.score}
                                  </span>
                                  <ChevronRight size={10} className="text-gray-600 group-hover:text-white transition-colors" />
                                </div>
                              </div>
                              {v.site && (
                                <p className="text-gray-500 text-xs mt-0.5 truncate">{v.site}</p>
                              )}
                              {(v.criticalCount > 0 || v.highCount > 0) && (
                                <p className="text-xs mt-0.5" style={{ color: riskColor(v.criticalCount > 0 ? 'Critical' : 'High') }}>
                                  {v.criticalCount > 0 ? `${v.criticalCount} critical` : `${v.highCount} high risk`} tyre{(v.criticalCount || v.highCount) !== 1 ? 's' : ''}
                                </p>
                              )}
                            </button>
                          ))
                        )}
                      </div>
                    </div>

                    {/* Upcoming inspections this week */}
                    <div>
                      <p className="text-xs text-gray-500 uppercase tracking-wide font-medium mb-2 flex items-center gap-1">
                        <Calendar size={10} />
                        Inspections This Week
                      </p>
                      <div className="space-y-1">
                        {upcomingInspections.length === 0 ? (
                          <p className="text-xs text-gray-600 text-center py-2">None scheduled this week</p>
                        ) : (
                          upcomingInspections.map((ins, idx) => (
                            <div key={idx} className="flex items-center justify-between text-xs py-1 border-b border-gray-800/50 last:border-0">
                              <div>
                                <span className="text-white font-medium">{ins.asset_no}</span>
                                <span className="text-gray-500 ml-1">{ins.inspection_type ?? 'General'}</span>
                              </div>
                              <span className={`font-mono ${
                                ins.status === 'Overdue' ? 'text-red-400' : 'text-gray-500'
                              }`}>
                                {fmtShortDate(ins.scheduled_date)}
                              </span>
                            </div>
                          ))
                        )}
                      </div>
                    </div>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          {/* Active alerts mini list */}
          {alertsData.length > 0 && (
            <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden flex-1 max-h-72 overflow-y-auto">
              <div className="flex items-center gap-2 px-4 py-3 border-b border-gray-800">
                <Bell size={13} className="text-red-400" />
                <span className="text-sm font-semibold text-white">Fleet Alerts</span>
                <span className="ml-auto bg-red-900/50 text-red-300 text-xs px-1.5 py-0.5 rounded-full border border-red-800/50">
                  {alertsData.length}
                </span>
              </div>
              <div className="p-3 space-y-1.5">
                {alertsData.slice(0, 10).map((a, i) => (
                  <button
                    key={i}
                    onClick={() => a.asset_no && openDrawer(a.asset_no)}
                    className="w-full text-left bg-gray-800/40 hover:bg-gray-800 border border-gray-800 hover:border-gray-700 rounded-lg px-2.5 py-2 transition-colors"
                  >
                    <div className="flex items-start justify-between gap-1.5">
                      <span className={`text-xs px-1.5 py-0.5 rounded border ${severityBgClass(a.severity)} flex-shrink-0`}>
                        {a.severity ?? 'Info'}
                      </span>
                      {a.asset_no && <span className="text-gray-400 text-xs font-mono flex-shrink-0">{a.asset_no}</span>}
                    </div>
                    {a.message && (
                      <p className="text-gray-400 text-xs mt-1 line-clamp-2 leading-relaxed">{a.message}</p>
                    )}
                    {a.created_at && (
                      <p className="text-gray-600 text-xs mt-0.5">
                        {fmtDate(a.created_at)}
                      </p>
                    )}
                  </button>
                ))}
              </div>
            </div>
          )}
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
              className="fixed inset-0 bg-black/60 z-40"
              onClick={() => setDrawerOpen(false)}
            />

            {/* Drawer */}
            <motion.div
              ref={drawerRef}
              initial={{ x: '100%' }}
              animate={{ x: 0 }}
              exit={{ x: '100%' }}
              transition={{ type: 'spring', damping: 28, stiffness: 280 }}
              className="fixed top-0 right-0 h-full w-full sm:w-[540px] lg:w-[620px] z-50 bg-gray-950 border-l border-gray-800 flex flex-col shadow-2xl"
            >
              {/* Drawer header */}
              <div className="flex items-center justify-between px-5 py-4 border-b border-gray-800 flex-shrink-0">
                <div>
                  <h2 className="text-lg font-bold text-white flex items-center gap-2">
                    <span className="text-2xl">{vehicleEmoji(drawerVehicle.vehicle_type)}</span>
                    {drawerVehicle.asset_no}
                    {drawerVehicle.fleet_number && (
                      <span className="text-gray-500 font-mono text-sm">#{drawerVehicle.fleet_number}</span>
                    )}
                  </h2>
                  <p className="text-gray-400 text-sm mt-0.5">
                    {drawerVehicle.make} {drawerVehicle.model}
                    {drawerVehicle.site && <span> · {drawerVehicle.site}</span>}
                    {drawerVehicle.operator_name && (
                      <span className="ml-1 text-gray-500">· {drawerVehicle.operator_name}</span>
                    )}
                  </p>
                </div>
                <div className="flex items-center gap-3">
                  <HealthCircle score={drawerVehicle.score} size={52} />
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

                {/* Vehicle info badges */}
                <div className="flex flex-wrap gap-2">
                  {drawerVehicle.vehicle_type && (
                    <span className="px-2.5 py-1 rounded-full text-xs bg-gray-800 border border-gray-700 text-gray-300">
                      {drawerVehicle.vehicle_type}
                    </span>
                  )}
                  {drawerVehicle.status && (
                    <span className={`px-2.5 py-1 rounded-full text-xs border ${
                      drawerVehicle.status === 'Active'
                        ? 'bg-green-900/30 border-green-800/50 text-green-300'
                        : 'bg-gray-800 border-gray-700 text-gray-400'
                    }`}>
                      {drawerVehicle.status}
                    </span>
                  )}
                  {drawerVehicle.isOverdue && (
                    <span className="px-2.5 py-1 rounded-full text-xs bg-red-900/30 border border-red-800/50 text-red-300 flex items-center gap-1">
                      <Calendar size={10} /> Inspection Overdue
                    </span>
                  )}
                  {drawerVehicle.alertCount > 0 && (
                    <span className="px-2.5 py-1 rounded-full text-xs bg-orange-900/30 border border-orange-800/50 text-orange-300 flex items-center gap-1">
                      <Bell size={10} /> {drawerVehicle.alertCount} Alert{drawerVehicle.alertCount !== 1 ? 's' : ''}
                    </span>
                  )}
                </div>

                {/* Tyre diagram + tyre table */}
                <div>
                  <h3 className="text-sm font-semibold text-gray-300 mb-3">Tyre Health Map</h3>
                  <div className="grid grid-cols-2 gap-4 items-start">
                    {/* SVG diagram */}
                    <div className="bg-gray-900 border border-gray-800 rounded-lg p-2 flex items-center justify-center min-h-32">
                      <VehicleTyreDiagram
                        vehicleType={drawerVehicle.vehicle_type}
                        positions={drawerVehicle.tyres.map(t => ({
                          position:     t.position,
                          risk_level:   t.risk_level,
                          brand:        t.brand,
                          serial_no:    t.serial_number,
                          tread_depth:  t.tread_depth,
                          pressure:     t.pressure_reading,
                        }))}
                      />
                    </div>

                    {/* Doughnut risk breakdown */}
                    {drawerVehicle.tyres.length > 0 && (
                      <div className="bg-gray-900 border border-gray-800 rounded-lg p-3">
                        <p className="text-xs text-gray-500 mb-2 uppercase tracking-wide">Risk Breakdown</p>
                        <div className="h-32">
                          <Doughnut
                            data={drawerDoughnutData(drawerVehicle.tyres)}
                            options={{
                              responsive: true,
                              maintainAspectRatio: false,
                              cutout: '65%',
                              plugins: {
                                legend: {
                                  position: 'bottom',
                                  labels: { color: '#6b7280', font: { size: 9 }, boxWidth: 8, padding: 6 },
                                },
                                tooltip: {
                                  ...chartTooltipDefaults,
                                  callbacks: {
                                    label: ctx => ` ${ctx.label}: ${ctx.parsed}`,
                                  },
                                },
                              },
                            }}
                          />
                        </div>
                      </div>
                    )}
                  </div>
                </div>

                {/* Tyre table */}
                {drawerVehicle.tyres.length > 0 && (
                  <div>
                    <h3 className="text-sm font-semibold text-gray-300 mb-2">Current Tyres</h3>
                    <div className="overflow-x-auto rounded-lg border border-gray-800">
                      <table className="w-full text-xs">
                        <thead>
                          <tr className="border-b border-gray-800 bg-gray-900/60">
                            {['Position', 'Brand', 'Tread', 'PSI', 'Risk', 'Fitted'].map(h => (
                              <th key={h} className="text-left px-2.5 py-2 text-gray-500 font-medium whitespace-nowrap">{h}</th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {[...drawerVehicle.tyres]
                            .sort((a, b) => (a.position ?? '').localeCompare(b.position ?? ''))
                            .map((t, i) => (
                            <tr key={i} className="border-b border-gray-800/50 hover:bg-gray-800/30 transition-colors">
                              <td className="px-2.5 py-2 text-gray-300 font-mono font-semibold">{t.position ?? '—'}</td>
                              <td className="px-2.5 py-2 text-gray-300">{t.brand ?? '—'}</td>
                              <td className="px-2.5 py-2 text-gray-300">
                                {t.tread_depth != null ? (
                                  <span style={{ color: t.tread_depth < 3 ? '#dc2626' : t.tread_depth < 5 ? '#ca8a04' : '#16a34a' }}>
                                    {t.tread_depth}mm
                                  </span>
                                ) : '—'}
                              </td>
                              <td className="px-2.5 py-2 text-gray-300">
                                {t.pressure_reading != null ? `${t.pressure_reading}` : '—'}
                              </td>
                              <td className="px-2.5 py-2">
                                {t.risk_level ? (
                                  <span className={`px-1.5 py-0.5 rounded border text-xs ${riskBgClass(t.risk_level)}`}>
                                    {t.risk_level}
                                  </span>
                                ) : (
                                  <span className="text-gray-600">—</span>
                                )}
                              </td>
                              <td className="px-2.5 py-2 text-gray-500 flex items-center gap-1">
                                <Clock size={9} />
                                {t.issue_date ? `${daysAgo(t.issue_date)}d` : '—'}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}

                {/* Recent inspections */}
                {drawerInspections.length > 0 && (
                  <div>
                    <h3 className="text-sm font-semibold text-gray-300 mb-2">Recent Inspections</h3>
                    <div className="space-y-1.5">
                      {drawerInspections.map((ins, i) => (
                        <div
                          key={i}
                          className="flex items-center justify-between bg-gray-900 border border-gray-800 rounded-lg px-3 py-2"
                        >
                          <div>
                            <p className="text-gray-300 text-xs font-medium">{ins.inspection_type ?? 'General Inspection'}</p>
                            <p className="text-gray-500 text-xs">{fmtDate(ins.scheduled_date)}</p>
                          </div>
                          <span className={`px-2 py-0.5 rounded text-xs border ${
                            ins.status === 'Done'
                              ? 'bg-green-900/30 border-green-800/50 text-green-300'
                              : ins.status === 'Overdue'
                              ? 'bg-red-900/30 border-red-800/50 text-red-300'
                              : 'bg-gray-800 border-gray-700 text-gray-400'
                          }`}>
                            {ins.status ?? 'Scheduled'}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Vehicle alerts */}
                {drawerVehicle.vehicleAlerts.length > 0 && (
                  <div>
                    <h3 className="text-sm font-semibold text-gray-300 mb-2 flex items-center gap-1.5">
                      <Bell size={13} className="text-red-400" />
                      Active Alerts
                    </h3>
                    <div className="space-y-1.5">
                      {drawerVehicle.vehicleAlerts.map((a, i) => (
                        <div
                          key={i}
                          className={`border rounded-lg px-3 py-2 ${severityBgClass(a.severity)}`}
                        >
                          <div className="flex items-center justify-between">
                            <span className="text-xs font-semibold uppercase tracking-wide">{a.severity ?? 'Info'}</span>
                            {a.created_at && (
                              <span className="text-xs opacity-60">{fmtShortDate(a.created_at)}</span>
                            )}
                          </div>
                          {a.message && (
                            <p className="text-xs mt-0.5 opacity-80">{a.message}</p>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Quick actions */}
                <div className="flex gap-3 pt-1 pb-2">
                  <button
                    onClick={() => {
                      setDrawerOpen(false)
                      navigate(`/work-orders?asset=${drawerVehicle.asset_no}`)
                    }}
                    className="flex-1 flex items-center justify-center gap-2 px-3 py-2.5 rounded-lg bg-green-700 hover:bg-green-600 text-white text-sm font-medium transition-colors"
                  >
                    <Wrench size={14} /> Create Work Order
                  </button>
                  <button
                    onClick={() => {
                      setDrawerOpen(false)
                      navigate(`/inspection-planner?asset=${drawerVehicle.asset_no}`)
                    }}
                    className="flex-1 flex items-center justify-center gap-2 px-3 py-2.5 rounded-lg bg-gray-800 hover:bg-gray-700 border border-gray-700 text-gray-300 text-sm font-medium transition-colors"
                  >
                    <Calendar size={14} /> Schedule Inspection
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
