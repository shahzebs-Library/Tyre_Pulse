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
  Eye, ChevronDown, ChevronUp, Radio, ClipboardCheck,
} from 'lucide-react'
import { supabase } from '../lib/supabase'
import { toUserMessage } from '../lib/safeError'
import { fetchAllPages } from '../lib/fetchAll'
import { formatDate } from '../lib/formatters'
import { useAuth } from '../contexts/AuthContext'
import { useSettings } from '../contexts/SettingsContext'
import PageHeader from '../components/ui/PageHeader'
import VehicleTyreDiagram from '../components/VehicleTyreDiagram'
import { useLanguage } from '../contexts/LanguageContext'

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
  }[level] ?? 'bg-[var(--surface-2)] text-[var(--text-secondary)] border-[var(--border-bright)]'
}

function severityBgClass(s) {
  return {
    Critical: 'bg-red-900/40 text-red-300 border-red-800/50',
    High:     'bg-orange-900/40 text-orange-300 border-orange-800/50',
    Medium:   'bg-yellow-900/40 text-yellow-300 border-yellow-800/50',
    Low:      'bg-blue-900/40 text-blue-300 border-blue-800/50',
  }[s] ?? 'bg-[var(--surface-2)] text-[var(--text-secondary)] border-[var(--border-bright)]'
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

function scoreLabelKey(score) {
  if (score >= 80) return 'operational'
  if (score >= 60) return 'monitor'
  if (score >= 40) return 'atRisk'
  return 'critical'
}

// English-only label used by the CSV/Excel export builder (exports stay English).
function scoreLabelEn(score) {
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
  if (!d) return '-'
  return formatDate(d, 'All', { day: '2-digit', month: 'short', year: 'numeric' })
}

function fmtShortDate(d) {
  if (!d) return '-'
  return formatDate(d, 'All', { day: '2-digit', month: 'short' })
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
      scoreLabelEn(v.score),
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
      <span className="text-[var(--text-dim)] font-mono" style={{ fontSize: '8px' }}>{label}</span>
      {tip && tyre && (
        <div className="absolute bottom-6 left-1/2 -translate-x-1/2 z-50 bg-[var(--surface-1)] border border-[var(--border-bright)] rounded-lg p-2 text-xs whitespace-nowrap shadow-xl pointer-events-none">
          <p className="text-[var(--text-primary)] font-semibold">{label}</p>
          <p className="text-[var(--text-secondary)]">{tyre.brand ?? '-'}</p>
          {/* tread_depth disabled - re-enable when ready */}
          {tyre.pressure_reading != null && <p className="text-[var(--text-secondary)]">PSI: {tyre.pressure_reading}</p>}
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
    <div className="bg-[var(--surface-1)] border border-[var(--border-dim)] rounded-xl p-4 animate-pulse">
      <div className="flex items-start justify-between mb-3">
        <div className="space-y-1.5">
          <div className="h-5 w-28 bg-[var(--surface-2)] rounded" />
          <div className="h-3.5 w-20 bg-[var(--surface-2)] rounded" />
        </div>
        <div className="h-12 w-12 bg-[var(--surface-2)] rounded-full" />
      </div>
      <div className="flex justify-center py-3">
        <div className="h-10 w-28 bg-[var(--surface-2)] rounded" />
      </div>
      <div className="flex justify-between pt-3 border-t border-[var(--border-dim)] mt-2">
        <div className="h-4 w-16 bg-[var(--surface-2)] rounded" />
        <div className="h-4 w-12 bg-[var(--surface-2)] rounded" />
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
    <div className={`bg-[var(--surface-1)] border ${c.border} rounded-xl p-4 flex items-start justify-between`}>
      <div>
        <p className="text-[var(--text-secondary)] text-xs uppercase tracking-wide font-medium leading-tight">{label}</p>
        <p className={`text-2xl font-bold mt-1.5 ${c.value}`}>{value}</p>
        {sub && <p className="text-[var(--text-dim)] text-xs mt-0.5">{sub}</p>}
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
  const { t } = useLanguage()
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
        bg-[var(--surface-1)] border rounded-xl p-4 cursor-pointer transition-all duration-200
        hover:shadow-lg hover:shadow-black/30 select-none
        ${scoreBorderClass(score)}
        ${isSelected ? 'ring-1 ring-green-500/50 bg-[var(--surface-2)]' : ''}
      `}
    >
      {/* Header */}
      <div className="flex items-start justify-between mb-2.5">
        <div className="min-w-0 flex-1 mr-2">
          <div className="flex items-center gap-2">
            <span className="text-lg leading-none">{vehicleEmoji(vehicle_type)}</span>
            <div>
              <p className="text-[var(--text-primary)] font-bold text-sm leading-tight truncate">{asset_no}</p>
              {fleet_number && (
                <p className="text-[var(--text-muted)] text-xs leading-tight font-mono">{fleet_number}</p>
              )}
            </div>
          </div>
        </div>
        <HealthCircle score={score} size={46} />
      </div>

      {/* Badges row */}
      <div className="flex flex-wrap gap-1 mb-3">
        {site && (
          <span className="flex items-center gap-0.5 text-xs text-[var(--text-secondary)] bg-[var(--surface-2)] rounded px-1.5 py-0.5">
            <MapPin size={8} />{site}
          </span>
        )}
        {operator_name && (
          <span className="flex items-center gap-0.5 text-xs text-[var(--text-muted)] bg-[var(--surface-2)] rounded px-1.5 py-0.5 truncate max-w-[80px]">
            <Users size={8} />{operator_name}
          </span>
        )}
      </div>

      {/* Mini tyre grid */}
      {tyres.length > 0 ? (
        <div className="flex justify-center py-1.5 bg-[var(--surface-2)] rounded-lg mb-3">
          <MiniPositionGrid tyres={tyres} />
        </div>
      ) : (
        <div className="flex items-center justify-center py-4 bg-[var(--surface-2)] rounded-lg mb-3">
          <span className="text-[var(--text-dim)] text-xs">{t('livefleet.card.noTyreData')}</span>
        </div>
      )}

      {/* Footer */}
      <div className="flex items-center justify-between text-xs">
        {/* Last inspection */}
        <span className={`flex items-center gap-1 ${inspectionStale ? 'text-red-400' : 'text-[var(--text-muted)]'}`}>
          <Clock size={9} />
          {lastInspectionDate
            ? t('livefleet.card.daysAgo', { days: daysSinceInspection })
            : t('livefleet.card.noInspection')
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
          {t(`livefleet.scoreLabel.${scoreLabelKey(score)}`)}
        </span>

        {/* Alert badge */}
        {alertCount > 0 ? (
          <span className="flex items-center gap-0.5 bg-red-900/40 text-red-300 border border-red-800/50 rounded px-1.5 py-0.5">
            <Bell size={8} />{alertCount}
          </span>
        ) : (
          <span className="text-[var(--text-dim)] flex items-center gap-0.5">
            <Bell size={8} />0
          </span>
        )}
      </div>

      {/* Drill hint */}
      <div className="flex items-center justify-end mt-2 gap-0.5 text-[var(--text-dim)] hover:text-[var(--text-secondary)] transition-colors">
        <span className="text-xs">{t('livefleet.card.details')}</span>
        <ChevronRight size={10} />
      </div>
    </motion.div>
  )
}

// ── Main component ─────────────────────────────────────────────────────────────
export default function LiveFleetStatus() {
  const { t } = useLanguage()
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

        fetchAllPages((from, to) => supabase
          .from('tyre_records')
          .select('asset_no,risk_level,tread_depth,pressure_reading,position,site,issue_date,removal_date,brand,serial_number,size')
          .is('removal_date', null)
          .range(from, to)),

        fetchAllPages((from, to) => supabase
          .from('inspections')
          .select('asset_no,scheduled_date,status,inspection_type')
          .order('scheduled_date', { ascending: false })
          .range(from, to)),

        supabase
          .from('alerts')
          .select('asset_no,severity,message,created_at,is_active')
          .eq('is_active', true),
      ])

      if (fleetRes.error) throw fleetRes.error
      if (tyreRes.error)  throw tyreRes.error
      // inspections and alerts are best-effort - don't throw

      setFleetData(fleetRes.data   ?? [])
      setTyreRecords(tyreRes.data  ?? [])
      setInspections(inspRes.data  ?? [])
      setAlertsData(alertRes.data  ?? [])
      setLastUpdated(new Date())
    } catch (e) {
      setError(toUserMessage(e, 'Failed to load fleet data'))
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
      labels: [
        t('livefleet.drawer.doughnut.critical'),
        t('livefleet.drawer.doughnut.high'),
        t('livefleet.drawer.doughnut.medium'),
        t('livefleet.drawer.doughnut.low'),
        t('livefleet.drawer.doughnut.noData'),
      ],
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
    backgroundColor: 'var(--panel)',
    borderColor: 'var(--hairline)',
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
            <h1 className="text-2xl font-bold text-[var(--text-primary)]">{t('livefleet.header.title')}</h1>
            <p className="text-[var(--text-secondary)] text-sm mt-1">{t('livefleet.header.loading')}</p>
          </div>
        </div>
        <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
          {[1,2,3,4,5].map(i => (
            <div key={i} className="bg-[var(--surface-1)] border border-[var(--border-dim)] rounded-xl p-4 animate-pulse h-24">
              <div className="h-3 w-20 bg-[var(--surface-2)] rounded mb-2" />
              <div className="h-7 w-14 bg-[var(--surface-2)] rounded" />
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
          <RefreshCw size={14} /> {t('livefleet.actions.retry')}
        </button>
      </div>
    )
  }

  // ── Render ────────────────────────────────────────────────────────────────────
  return (
    <div className="space-y-5">

      {/* ── Page Header ── */}
      <PageHeader
        title={t('livefleet.header.title')}
        subtitle={`${t('livefleet.header.subtitle')}${lastUpdated ? t('livefleet.header.updated', { time: lastUpdated.toLocaleTimeString() }) : ''}`}
        icon={Radio}
        actions={<>
          <button
            onClick={() => setAutoRefresh(v => !v)}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-xs transition-colors ${
              autoRefresh
                ? 'bg-green-900/40 border-green-700 text-green-300'
                : 'bg-[var(--surface-2)] border-[var(--border-bright)] text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
            }`}
          >
            {autoRefresh ? <ToggleRight size={14} /> : <ToggleLeft size={14} />}
            {t('livefleet.actions.autoRefresh')}
            {autoRefresh && <span className="w-1.5 h-1.5 rounded-full bg-green-400 animate-ping" />}
          </button>
          <button
            onClick={() => exportFleetStatus(filtered, alertsData)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-[var(--border-bright)] bg-[var(--surface-2)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] text-xs transition-colors"
          >
            <Download size={13} /> {t('livefleet.actions.export')}
          </button>
          <button
            onClick={() => load(true)}
            disabled={refreshing}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-[var(--border-bright)] bg-[var(--surface-2)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] text-xs transition-colors"
          >
            <RefreshCw size={13} className={refreshing ? 'animate-spin' : ''} />
            {t('livefleet.actions.refresh')}
          </button>
        </>}
      />

      {/* ── KPI Status Bar ── */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
        <KpiCard
          label={t('livefleet.kpi.fleetTotal')}
          value={kpis.total}
          sub={t('livefleet.kpi.fleetTotalSub')}
          icon={Truck}
          color="blue"
        />
        <KpiCard
          label={t('livefleet.kpi.operational')}
          value={kpis.operational}
          sub={t('livefleet.kpi.operationalSub')}
          icon={CheckCircle}
          color={kpis.operational === kpis.total ? 'green' : 'yellow'}
        />
        <KpiCard
          label={t('livefleet.kpi.atRisk')}
          value={kpis.atRisk}
          sub={t('livefleet.kpi.atRiskSub')}
          icon={AlertTriangle}
          color={kpis.atRisk > 0 ? 'orange' : 'green'}
          pulse={kpis.atRisk > 0}
        />
        <KpiCard
          label={t('livefleet.kpi.inspectionOverdue')}
          value={kpis.overdue}
          sub={t('livefleet.kpi.inspectionOverdueSub')}
          icon={Calendar}
          color={kpis.overdue > 0 ? 'red' : 'green'}
        />
        <KpiCard
          label={t('livefleet.kpi.activeAlerts')}
          value={kpis.activeAlerts}
          sub={t('livefleet.kpi.activeAlertsSub', { date: formatDate(new Date(), 'All', { day:'2-digit', month:'short' }) })}
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
          <div className="bg-[var(--surface-1)] border border-[var(--border-dim)] rounded-xl p-3">
            <div className="flex flex-wrap gap-2 items-center">

              {/* Search */}
              <div className="relative flex-1 min-w-40">
                <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" />
                <input
                  className="w-full bg-[var(--surface-2)] border border-[var(--border-bright)] rounded-lg pl-8 pr-7 py-1.5 text-sm text-[var(--text-primary)] placeholder-[var(--text-muted)] focus:outline-none focus:border-green-700 focus:ring-1 focus:ring-green-700/30 transition"
                  placeholder={t('livefleet.filters.searchPlaceholder')}
                  value={search}
                  onChange={e => setSearch(e.target.value)}
                />
                {search && (
                  <button onClick={() => setSearch('')} className="absolute right-2 top-1/2 -translate-y-1/2 text-[var(--text-muted)] hover:text-[var(--text-secondary)]">
                    <X size={12} />
                  </button>
                )}
              </div>

              {/* Site filter */}
              <div className="flex items-center gap-1">
                <MapPin size={12} className="text-[var(--text-muted)]" />
                <select
                  className="bg-[var(--surface-2)] border border-[var(--border-bright)] rounded-lg px-2 py-1.5 text-sm text-[var(--text-primary)] focus:outline-none focus:border-green-700 transition"
                  value={siteFilter}
                  onChange={e => setSiteFilter(e.target.value)}
                >
                  {sites.map(s => <option key={s} value={s}>{s}</option>)}
                </select>
              </div>

              {/* Status filter */}
              <div className="flex items-center gap-1">
                <Filter size={12} className="text-[var(--text-muted)]" />
                <select
                  className="bg-[var(--surface-2)] border border-[var(--border-bright)] rounded-lg px-2 py-1.5 text-sm text-[var(--text-primary)] focus:outline-none focus:border-green-700 transition"
                  value={statusFilter}
                  onChange={e => setStatusFilter(e.target.value)}
                >
                  {[
                    { value: 'All',         labelKey: 'all' },
                    { value: 'Operational', labelKey: 'operational' },
                    { value: 'At Risk',     labelKey: 'atRisk' },
                    { value: 'Critical',    labelKey: 'critical' },
                    { value: 'Overdue',     labelKey: 'overdue' },
                  ].map(opt => (
                    <option key={opt.value} value={opt.value}>{t(`livefleet.filters.status.${opt.labelKey}`)}</option>
                  ))}
                </select>
              </div>

              {hasFilters && (
                <button onClick={clearFilters} className="text-xs text-green-500 hover:text-green-400 underline">
                  {t('livefleet.filters.clear')}
                </button>
              )}

              {/* View mode toggle */}
              <div className="flex bg-[var(--surface-2)] rounded-lg border border-[var(--border-bright)] overflow-hidden ml-auto">
                {[
                  { mode: 'grid', Icon: Grid, titleKey: 'gridView' },
                  { mode: 'list', Icon: List, titleKey: 'listView' },
                  { mode: 'map',  Icon: Map,  titleKey: 'mapView' },
                ].map(({ mode, Icon, titleKey }) => (
                  <button
                    key={mode}
                    onClick={() => setViewMode(mode)}
                    title={t(`livefleet.filters.${titleKey}`)}
                    className={`p-2 transition-colors ${
                      viewMode === mode
                        ? 'bg-green-700 text-white'
                        : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
                    }`}
                  >
                    <Icon size={14} />
                  </button>
                ))}
              </div>
            </div>

            {hasFilters && (
              <p className="text-xs text-green-500 mt-2">
                {t('livefleet.filters.matchingCount', { filtered: filtered.length, total: vehicles.length })}
              </p>
            )}
          </div>

          {/* ── Map view placeholder ── */}
          {viewMode === 'map' && (
            <div className="bg-[var(--surface-1)] border border-[var(--border-dim)] rounded-xl p-16 flex flex-col items-center justify-center gap-3">
              <Map size={48} className="text-[var(--text-dim)]" />
              <p className="text-[var(--text-secondary)] font-semibold">{t('livefleet.map.comingSoon')}</p>
              <p className="text-[var(--text-dim)] text-sm text-center">
                {t('livefleet.map.description')}
              </p>
              <button
                onClick={() => setViewMode('grid')}
                className="mt-2 text-sm text-green-500 hover:text-green-400 underline"
              >
                {t('livefleet.map.switchToGrid')}
              </button>
            </div>
          )}

          {/* ── Empty state ── */}
          {viewMode !== 'map' && filtered.length === 0 && vehicles.length === 0 && (
            <div className="bg-[var(--surface-1)] border border-[var(--border-dim)] rounded-xl py-16 flex flex-col items-center justify-center gap-3">
              <Truck size={48} className="text-[var(--text-dim)]" />
              <p className="text-[var(--text-secondary)] font-semibold">{t('livefleet.empty.noFleetTitle')}</p>
              <p className="text-[var(--text-dim)] text-sm text-center max-w-sm">
                {t('livefleet.empty.noFleetDesc')}
              </p>
              <button
                onClick={() => navigate('/fleet-master')}
                className="mt-2 bg-green-700 hover:bg-green-600 text-white px-4 py-2 rounded-lg text-sm transition-colors"
              >
                {t('livefleet.empty.goToFleetMaster')}
              </button>
            </div>
          )}

          {viewMode !== 'map' && filtered.length === 0 && vehicles.length > 0 && (
            <div className="bg-[var(--surface-1)] border border-[var(--border-dim)] rounded-xl py-12 flex flex-col items-center justify-center gap-3">
              <Filter size={36} className="text-[var(--text-dim)]" />
              <p className="text-[var(--text-secondary)] font-medium">{t('livefleet.empty.noMatch')}</p>
              <button onClick={clearFilters} className="text-sm text-green-500 hover:text-green-400 underline">
                {t('livefleet.filters.clearFilters')}
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
            <div className="bg-[var(--surface-1)] border border-[var(--border-dim)] rounded-xl overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-[var(--border-dim)] bg-[var(--surface-2)]">
                      {[
                        'assetNo', 'fleetNo', 'type', 'site', 'operator',
                        'tyres', 'health', 'lastInspection', 'alerts', 'status',
                      ].map(hKey => (
                        <th key={hKey} className="text-left px-3 py-3 text-xs font-medium text-[var(--text-secondary)] uppercase tracking-wide whitespace-nowrap">
                          {t(`livefleet.list.columns.${hKey}`)}
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
                            className="border-b border-[var(--border-dim)] hover:bg-[var(--surface-2)] cursor-pointer transition-colors"
                            onClick={() => openDrawer(v.asset_no)}
                          >
                            <td className="px-3 py-2.5">
                              <div className="flex items-center gap-1.5">
                                <span>{vehicleEmoji(v.vehicle_type)}</span>
                                <span className="text-[var(--text-primary)] font-semibold">{v.asset_no}</span>
                              </div>
                            </td>
                            <td className="px-3 py-2.5 text-[var(--text-secondary)] font-mono text-xs">{v.fleet_number ?? '-'}</td>
                            <td className="px-3 py-2.5 text-[var(--text-secondary)] whitespace-nowrap">{v.vehicle_type ?? '-'}</td>
                            <td className="px-3 py-2.5 text-[var(--text-secondary)]">{v.site ?? '-'}</td>
                            <td className="px-3 py-2.5 text-[var(--text-secondary)] max-w-24 truncate">{v.operator_name ?? '-'}</td>
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
                                  <span className="text-[var(--text-dim)]">{v.tyres.length} {t('livefleet.list.ok')}</span>
                                )}
                              </div>
                            </td>
                            <td className="px-3 py-2.5">
                              <div className="flex items-center gap-1.5">
                                <span className="font-bold text-sm" style={{ color: scoreColor(v.score) }}>
                                  {v.score}
                                </span>
                                <span className="text-[var(--text-dim)] text-xs">/100</span>
                              </div>
                            </td>
                            <td className="px-3 py-2.5">
                              <span className={`text-xs ${inspStale ? 'text-red-400' : 'text-[var(--text-muted)]'}`}>
                                {v.lastInspectionDate
                                  ? t('livefleet.card.daysAgo', { days: daysSinceInsp })
                                  : t('livefleet.list.never')
                                }
                              </span>
                            </td>
                            <td className="px-3 py-2.5">
                              {v.alertCount > 0 ? (
                                <span className="px-1.5 py-0.5 rounded text-xs bg-red-900/40 text-red-300 border border-red-800/50 flex items-center gap-0.5 w-fit">
                                  <Bell size={9} />{v.alertCount}
                                </span>
                              ) : (
                                <span className="text-[var(--text-dim)] text-xs">-</span>
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
                                {t(`livefleet.scoreLabel.${scoreLabelKey(v.score)}`)}
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
          <div className="bg-[var(--surface-1)] border border-[var(--border-dim)] rounded-xl overflow-hidden">
            <button
              onClick={() => setBriefingOpen(v => !v)}
              className="w-full flex items-center justify-between px-4 py-3 border-b border-[var(--border-dim)] hover:bg-[var(--surface-2)] transition-colors"
            >
              <div className="flex items-center gap-2">
                <Eye size={14} className="text-green-400" />
                <span className="text-sm font-semibold text-[var(--text-primary)]">{t('livefleet.sidebar.dailyBriefing')}</span>
              </div>
              {briefingOpen ? <ChevronUp size={13} className="text-[var(--text-muted)]" /> : <ChevronDown size={13} className="text-[var(--text-muted)]" />}
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
                    <div className="bg-[var(--surface-2)] border border-[var(--border-dim)] rounded-lg p-3">
                      <p className="text-xs text-[var(--text-secondary)] leading-relaxed">
                        {t('livefleet.sidebar.briefingOperational', { count: kpis.operational })}
                        {kpis.atRisk > 0 && t('livefleet.sidebar.briefingAtRisk', { count: kpis.atRisk })}
                        {kpis.overdue > 0 && t('livefleet.sidebar.briefingOverdue', { count: kpis.overdue })}
                        {kpis.activeAlerts > 0 && t('livefleet.sidebar.briefingAlerts', { count: kpis.activeAlerts })}.
                      </p>
                    </div>

                    {/* Top 5 needing attention */}
                    <div>
                      <p className="text-xs text-[var(--text-muted)] uppercase tracking-wide font-medium mb-2 flex items-center gap-1">
                        <TrendingDown size={10} />
                        {t('livefleet.sidebar.needsAttention')}
                      </p>
                      <div className="space-y-1.5">
                        {topAttention.length === 0 ? (
                          <p className="text-xs text-[var(--text-dim)] text-center py-2">{t('livefleet.sidebar.allHealthy')}</p>
                        ) : (
                          topAttention.map(v => (
                            <button
                              key={v.asset_no}
                              onClick={() => openDrawer(v.asset_no)}
                              className="w-full text-left bg-[var(--surface-2)] hover:bg-[var(--surface-3)] border border-[var(--border-dim)] hover:border-[var(--border-bright)] rounded-lg px-2.5 py-2 transition-colors group"
                            >
                              <div className="flex items-center justify-between">
                                <div className="flex items-center gap-1.5">
                                  <span className="text-sm">{vehicleEmoji(v.vehicle_type)}</span>
                                  <span className="text-[var(--text-primary)] text-xs font-semibold">{v.asset_no}</span>
                                </div>
                                <div className="flex items-center gap-1">
                                  <span className="text-xs font-bold" style={{ color: scoreColor(v.score) }}>
                                    {v.score}
                                  </span>
                                  <ChevronRight size={10} className="text-[var(--text-dim)] group-hover:text-[var(--text-primary)] transition-colors" />
                                </div>
                              </div>
                              {v.site && (
                                <p className="text-[var(--text-muted)] text-xs mt-0.5 truncate">{v.site}</p>
                              )}
                              {(v.criticalCount > 0 || v.highCount > 0) && (
                                <p className="text-xs mt-0.5" style={{ color: riskColor(v.criticalCount > 0 ? 'Critical' : 'High') }}>
                                  {v.criticalCount > 0
                                    ? t('livefleet.sidebar.criticalTyres', { count: v.criticalCount })
                                    : t('livefleet.sidebar.highRiskTyres', { count: v.highCount })}
                                </p>
                              )}
                            </button>
                          ))
                        )}
                      </div>
                    </div>

                    {/* Upcoming inspections this week */}
                    <div>
                      <p className="text-xs text-[var(--text-muted)] uppercase tracking-wide font-medium mb-2 flex items-center gap-1">
                        <Calendar size={10} />
                        {t('livefleet.sidebar.inspectionsThisWeek')}
                      </p>
                      <div className="space-y-1">
                        {upcomingInspections.length === 0 ? (
                          <p className="text-xs text-[var(--text-dim)] text-center py-2">{t('livefleet.sidebar.noneScheduled')}</p>
                        ) : (
                          upcomingInspections.map((ins, idx) => (
                            <div key={idx} className="flex items-center justify-between text-xs py-1 border-b border-[var(--border-dim)] last:border-0">
                              <div>
                                <span className="text-[var(--text-primary)] font-medium">{ins.asset_no}</span>
                                <span className="text-[var(--text-muted)] ml-1">{ins.inspection_type ?? t('livefleet.sidebar.generalInspection')}</span>
                              </div>
                              <span className={`font-mono ${
                                ins.status === 'Overdue' ? 'text-red-400' : 'text-[var(--text-muted)]'
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
            <div className="bg-[var(--surface-1)] border border-[var(--border-dim)] rounded-xl overflow-hidden flex-1 max-h-72 overflow-y-auto">
              <div className="flex items-center gap-2 px-4 py-3 border-b border-[var(--border-dim)]">
                <Bell size={13} className="text-red-400" />
                <span className="text-sm font-semibold text-[var(--text-primary)]">{t('livefleet.sidebar.fleetAlerts')}</span>
                <span className="ml-auto bg-red-900/50 text-red-300 text-xs px-1.5 py-0.5 rounded-full border border-red-800/50">
                  {alertsData.length}
                </span>
              </div>
              <div className="p-3 space-y-1.5">
                {alertsData.slice(0, 10).map((a, i) => (
                  <button
                    key={i}
                    onClick={() => a.asset_no && openDrawer(a.asset_no)}
                    className="w-full text-left bg-[var(--surface-2)] hover:bg-[var(--surface-3)] border border-[var(--border-dim)] hover:border-[var(--border-bright)] rounded-lg px-2.5 py-2 transition-colors"
                  >
                    <div className="flex items-start justify-between gap-1.5">
                      <span className={`text-xs px-1.5 py-0.5 rounded border ${severityBgClass(a.severity)} flex-shrink-0`}>
                        {a.severity ?? t('livefleet.sidebar.infoSeverity')}
                      </span>
                      {a.asset_no && <span className="text-[var(--text-secondary)] text-xs font-mono flex-shrink-0">{a.asset_no}</span>}
                    </div>
                    {a.message && (
                      <p className="text-[var(--text-secondary)] text-xs mt-1 line-clamp-2 leading-relaxed">{a.message}</p>
                    )}
                    {a.created_at && (
                      <p className="text-[var(--text-dim)] text-xs mt-0.5">
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
              className="fixed top-0 right-0 h-full w-full sm:w-[540px] lg:w-[620px] z-50 bg-[var(--surface-0)] border-l border-[var(--border-dim)] flex flex-col shadow-2xl"
            >
              {/* Drawer header */}
              <div className="flex items-center justify-between px-5 py-4 border-b border-[var(--border-dim)] flex-shrink-0">
                <div>
                  <h2 className="text-lg font-bold text-[var(--text-primary)] flex items-center gap-2">
                    <span className="text-2xl">{vehicleEmoji(drawerVehicle.vehicle_type)}</span>
                    {drawerVehicle.asset_no}
                    {drawerVehicle.fleet_number && (
                      <span className="text-[var(--text-muted)] font-mono text-sm">#{drawerVehicle.fleet_number}</span>
                    )}
                  </h2>
                  <p className="text-[var(--text-secondary)] text-sm mt-0.5">
                    {drawerVehicle.make} {drawerVehicle.model}
                    {drawerVehicle.site && <span> · {drawerVehicle.site}</span>}
                    {drawerVehicle.operator_name && (
                      <span className="ml-1 text-[var(--text-muted)]">· {drawerVehicle.operator_name}</span>
                    )}
                  </p>
                </div>
                <div className="flex items-center gap-3">
                  <HealthCircle score={drawerVehicle.score} size={52} />
                  <button
                    onClick={() => setDrawerOpen(false)}
                    className="p-1.5 rounded-lg hover:bg-[var(--surface-2)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors"
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
                    <span className="px-2.5 py-1 rounded-full text-xs bg-[var(--surface-2)] border border-[var(--border-bright)] text-[var(--text-secondary)]">
                      {drawerVehicle.vehicle_type}
                    </span>
                  )}
                  {drawerVehicle.status && (
                    <span className={`px-2.5 py-1 rounded-full text-xs border ${
                      drawerVehicle.status === 'Active'
                        ? 'bg-green-900/30 border-green-800/50 text-green-300'
                        : 'bg-[var(--surface-2)] border-[var(--border-bright)] text-[var(--text-secondary)]'
                    }`}>
                      {drawerVehicle.status}
                    </span>
                  )}
                  {drawerVehicle.isOverdue && (
                    <span className="px-2.5 py-1 rounded-full text-xs bg-red-900/30 border border-red-800/50 text-red-300 flex items-center gap-1">
                      <Calendar size={10} /> {t('livefleet.drawer.inspectionOverdue')}
                    </span>
                  )}
                  {drawerVehicle.alertCount > 0 && (
                    <span className="px-2.5 py-1 rounded-full text-xs bg-orange-900/30 border border-orange-800/50 text-orange-300 flex items-center gap-1">
                      <Bell size={10} /> {t('livefleet.drawer.alertCount', { count: drawerVehicle.alertCount })}
                    </span>
                  )}
                </div>

                {/* Tyre diagram + tyre table */}
                <div>
                  <h3 className="text-sm font-semibold text-[var(--text-secondary)] mb-3">{t('livefleet.drawer.tyreHealthMap')}</h3>
                  <div className="grid grid-cols-2 gap-4 items-start">
                    {/* SVG diagram */}
                    <div className="bg-[var(--surface-1)] border border-[var(--border-dim)] rounded-lg p-2 flex items-center justify-center min-h-32">
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
                      <div className="bg-[var(--surface-1)] border border-[var(--border-dim)] rounded-lg p-3">
                        <p className="text-xs text-[var(--text-muted)] mb-2 uppercase tracking-wide">{t('livefleet.drawer.riskBreakdown')}</p>
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
                    <h3 className="text-sm font-semibold text-[var(--text-secondary)] mb-2">{t('livefleet.drawer.currentTyres')}</h3>
                    <div className="overflow-x-auto rounded-lg border border-[var(--border-dim)]">
                      <table className="w-full text-xs">
                        <thead>
                          <tr className="border-b border-[var(--border-dim)] bg-[var(--surface-2)]">
                            {['position', 'brand', 'tread', 'psi', 'risk', 'fitted'].map(hKey => (
                              <th key={hKey} className="text-left px-2.5 py-2 text-[var(--text-muted)] font-medium whitespace-nowrap">{t(`livefleet.drawer.tyreColumns.${hKey}`)}</th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {[...drawerVehicle.tyres]
                            .sort((a, b) => (a.position ?? '').localeCompare(b.position ?? ''))
                            .map((t, i) => (
                            <tr key={i} className="border-b border-[var(--border-dim)] hover:bg-[var(--surface-2)] transition-colors">
                              <td className="px-2.5 py-2 text-[var(--text-secondary)] font-mono font-semibold">{t.position ?? '-'}</td>
                              <td className="px-2.5 py-2 text-[var(--text-secondary)]">{t.brand ?? '-'}</td>
                              <td className="px-2.5 py-2 text-[var(--text-secondary)]">
                                {t.tread_depth != null ? (
                                  <span style={{ color: t.tread_depth < 3 ? '#dc2626' : t.tread_depth < 5 ? '#ca8a04' : '#16a34a' }}>
                                    {t.tread_depth}mm
                                  </span>
                                ) : '-'}
                              </td>
                              <td className="px-2.5 py-2 text-[var(--text-secondary)]">
                                {t.pressure_reading != null ? `${t.pressure_reading}` : '-'}
                              </td>
                              <td className="px-2.5 py-2">
                                {t.risk_level ? (
                                  <span className={`px-1.5 py-0.5 rounded border text-xs ${riskBgClass(t.risk_level)}`}>
                                    {t.risk_level}
                                  </span>
                                ) : (
                                  <span className="text-[var(--text-dim)]">-</span>
                                )}
                              </td>
                              <td className="px-2.5 py-2 text-[var(--text-muted)] flex items-center gap-1">
                                <Clock size={9} />
                                {t.issue_date ? `${daysAgo(t.issue_date)}d` : '-'}
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
                    <h3 className="text-sm font-semibold text-[var(--text-secondary)] mb-2">{t('livefleet.drawer.recentInspections')}</h3>
                    <div className="space-y-1.5">
                      {drawerInspections.map((ins, i) => (
                        <div
                          key={i}
                          className="flex items-center justify-between bg-[var(--surface-1)] border border-[var(--border-dim)] rounded-lg px-3 py-2"
                        >
                          <div>
                            <p className="text-[var(--text-secondary)] text-xs font-medium">{ins.inspection_type ?? t('livefleet.drawer.generalInspectionFallback')}</p>
                            <p className="text-[var(--text-muted)] text-xs">{fmtDate(ins.scheduled_date)}</p>
                          </div>
                          <span className={`px-2 py-0.5 rounded text-xs border ${
                            ins.status === 'Done'
                              ? 'bg-green-900/30 border-green-800/50 text-green-300'
                              : ins.status === 'Overdue'
                              ? 'bg-red-900/30 border-red-800/50 text-red-300'
                              : 'bg-[var(--surface-2)] border-[var(--border-bright)] text-[var(--text-secondary)]'
                          }`}>
                            {ins.status ?? t('livefleet.drawer.scheduledFallback')}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Vehicle alerts */}
                {drawerVehicle.vehicleAlerts.length > 0 && (
                  <div>
                    <h3 className="text-sm font-semibold text-[var(--text-secondary)] mb-2 flex items-center gap-1.5">
                      <Bell size={13} className="text-red-400" />
                      {t('livefleet.drawer.activeAlerts')}
                    </h3>
                    <div className="space-y-1.5">
                      {drawerVehicle.vehicleAlerts.map((a, i) => (
                        <div
                          key={i}
                          className={`border rounded-lg px-3 py-2 ${severityBgClass(a.severity)}`}
                        >
                          <div className="flex items-center justify-between">
                            <span className="text-xs font-semibold uppercase tracking-wide">{a.severity ?? t('livefleet.sidebar.infoSeverity')}</span>
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
                <div className="space-y-2 pt-1 pb-2">
                  {/* Primary: open the dedicated full asset profile page. */}
                  <button
                    onClick={() => {
                      setDrawerOpen(false)
                      navigate(`/assets/${encodeURIComponent(drawerVehicle.asset_no)}`)
                    }}
                    className="btn-primary w-full gap-2"
                  >
                    <Truck size={14} /> {t('assetmgmt.detail.openAssetProfile')}
                  </button>
                  {/* Start the tyre checklist for this vehicle — opens the Inspections
                      checklist (same vehicle diagram) pre-loaded via deep-link. */}
                  <button
                    onClick={() => {
                      setDrawerOpen(false)
                      navigate(`/inspections?asset=${encodeURIComponent(drawerVehicle.asset_no)}`)
                    }}
                    className="btn-secondary w-full gap-2"
                  >
                    <ClipboardCheck size={14} /> {t('livefleet.drawer.startTyreChecklist')}
                  </button>
                  <div className="flex gap-3">
                    <button
                      onClick={() => {
                        setDrawerOpen(false)
                        navigate(`/work-orders?asset=${drawerVehicle.asset_no}`)
                      }}
                      className="flex-1 flex items-center justify-center gap-2 px-3 py-2.5 rounded-lg bg-[var(--surface-2)] hover:bg-[var(--surface-3)] border border-[var(--border-bright)] text-[var(--text-secondary)] text-sm font-medium transition-colors"
                    >
                      <Wrench size={14} /> {t('livefleet.drawer.createWorkOrder')}
                    </button>
                    <button
                      onClick={() => {
                        setDrawerOpen(false)
                        navigate(`/inspection-planner?asset=${drawerVehicle.asset_no}`)
                      }}
                      className="flex-1 flex items-center justify-center gap-2 px-3 py-2.5 rounded-lg bg-[var(--surface-2)] hover:bg-[var(--surface-3)] border border-[var(--border-bright)] text-[var(--text-secondary)] text-sm font-medium transition-colors"
                    >
                      <Calendar size={14} /> {t('livefleet.drawer.scheduleInspection')}
                    </button>
                  </div>
                </div>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </div>
  )
}
