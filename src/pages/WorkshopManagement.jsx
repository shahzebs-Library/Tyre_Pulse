import { useState, useEffect, useMemo, useCallback, useRef } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { supabase } from '../lib/supabase'
import { useSettings } from '../contexts/SettingsContext'
import { useAuth } from '../contexts/AuthContext'
import { exportToExcel, exportToPdf } from '../lib/exportUtils'
import { formatDate, formatDateTime } from '../lib/formatters'
import PageHeader from '../components/ui/PageHeader'
import {
  Wrench, ClipboardList, Clock, CheckCircle, DollarSign, AlertTriangle,
  TrendingUp, TrendingDown, Search, Filter, X, Download, RefreshCw,
  FileSpreadsheet, FileText, ChevronLeft, ChevronRight, ChevronDown,
  Calendar, User, Building2, Zap, BarChart2, PieChart, Activity,
  Package, Star, Award, Target, Maximize2, Loader2,
} from 'lucide-react'
import { SkeletonTable } from '../components/ui/Skeleton'
import {
  Chart as ChartJS, CategoryScale, LinearScale, BarElement,
  LineElement, PointElement, ArcElement, Title, Tooltip, Legend, Filler,
} from 'chart.js'
import { Bar, Line, Doughnut } from 'react-chartjs-2'

ChartJS.register(
  CategoryScale, LinearScale, BarElement, LineElement, PointElement,
  ArcElement, Title, Tooltip, Legend, Filler,
)

// ── Palette ────────────────────────────────────────────────────────────────────
const PALETTE = [
  '#3b82f6','#10b981','#f59e0b','#ef4444','#8b5cf6',
  '#ec4899','#14b8a6','#f97316','#6366f1','#84cc16',
]

const CHART_DEFAULTS = {
  responsive: true,
  maintainAspectRatio: false,
  plugins: {
    legend: { labels: { color: '#9ca3af', font: { size: 11 }, boxWidth: 12 } },
    tooltip: {
      backgroundColor: 'var(--panel-2)',
      titleColor: '#f3f4f6',
      bodyColor: '#9ca3af',
      borderColor: 'rgba(59,130,246,0.3)',
      borderWidth: 1,
    },
  },
  scales: {
    x: { ticks: { color: '#6b7280', font: { size: 11 } }, grid: { color:'var(--text-muted)' } },
    y: { ticks: { color: '#6b7280', font: { size: 11 } }, grid: { color:'var(--text-muted)' } },
  },
}

const NO_SCALE = {
  ...CHART_DEFAULTS,
  scales: undefined,
  plugins: {
    ...CHART_DEFAULTS.plugins,
    legend: { position: 'right', labels: { color: '#9ca3af', font: { size: 11 }, boxWidth: 12, padding: 12 } },
  },
}

const WORK_TYPES = ['Tyre Change','Inspection','Repair','Rotation','Balancing','Alignment','Retread','Other']
const STATUSES   = ['Open','In Progress','Awaiting Parts','Completed','Cancelled']
const PRIORITIES = ['Critical','High','Medium','Low']
const PAGE_SIZE  = 20

// ── Helpers ────────────────────────────────────────────────────────────────────
function fmtCurrency(v, currency) {
  if (v == null || !isFinite(v)) return `${currency} 0`
  if (Math.abs(v) >= 1_000_000) return `${currency} ${(v / 1_000_000).toFixed(2)}M`
  if (Math.abs(v) >= 1_000) return `${currency} ${(v / 1_000).toFixed(1)}K`
  return `${currency} ${Math.round(v).toLocaleString()}`
}

function fmtHours(h) {
  if (h == null || !isFinite(h) || h < 0) return 'N/A'
  if (h < 1) return `${Math.round(h * 60)}m`
  return `${h.toFixed(1)}h`
}

function fmtPct(v) {
  if (v == null || !isFinite(v)) return '0.0%'
  return `${v.toFixed(1)}%`
}

function monthKey(d) {
  if (!d) return null
  const dt = new Date(d)
  if (isNaN(dt)) return null
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}`
}

function monthLabel(key) {
  if (!key) return ''
  const [y, m] = key.split('-')
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
  return `${months[parseInt(m, 10) - 1]} ${y}`
}

function last12Months() {
  const keys = []
  const now = new Date()
  for (let i = 11; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1)
    keys.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`)
  }
  return keys
}

function turnaroundHours(row) {
  if (!row.created_at || !row.completed_at) return null
  const diff = new Date(row.completed_at) - new Date(row.created_at)
  if (diff < 0) return null
  return diff / 3_600_000
}

function isOnTime(row) {
  if (!row.completed_at || !row.scheduled_date) return null
  return new Date(row.completed_at) <= new Date(row.scheduled_date)
}

function scoreColor(s) {
  if (s >= 80) return 'text-green-400'
  if (s >= 60) return 'text-yellow-400'
  if (s >= 40) return 'text-orange-400'
  return 'text-red-400'
}

function scoreBg(s) {
  if (s >= 80) return 'bg-green-500/20 border-green-500/30'
  if (s >= 60) return 'bg-yellow-500/20 border-yellow-500/30'
  if (s >= 40) return 'bg-orange-500/20 border-orange-500/30'
  return 'bg-red-500/20 border-red-500/30'
}

function statusBadgeClass(status) {
  switch ((status || '').toLowerCase()) {
    case 'open':            return 'bg-blue-500/20 text-blue-400 border-blue-500/30'
    case 'in progress':     return 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30'
    case 'awaiting parts':  return 'bg-orange-500/20 text-orange-400 border-orange-500/30'
    case 'completed':       return 'bg-green-500/20 text-green-400 border-green-500/30'
    case 'cancelled':       return 'bg-gray-500/20 text-gray-400 border-gray-500/30'
    default:                return 'bg-gray-500/20 text-gray-400 border-gray-500/30'
  }
}

function priorityBadgeClass(priority) {
  switch ((priority || '').toLowerCase()) {
    case 'critical': return 'bg-red-500/20 text-red-400 border-red-500/30'
    case 'high':     return 'bg-orange-500/20 text-orange-400 border-orange-500/30'
    case 'medium':   return 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30'
    case 'low':      return 'bg-gray-500/20 text-gray-400 border-gray-500/30'
    default:         return 'bg-gray-500/20 text-gray-400 border-gray-500/30'
  }
}

function ratingBadge(rate) {
  if (rate >= 95) return { label: 'Excellent', cls: 'bg-green-500/20 text-green-400 border-green-500/30' }
  if (rate >= 85) return { label: 'Good',      cls: 'bg-blue-500/20 text-blue-400 border-blue-500/30' }
  if (rate >= 70) return { label: 'Average',   cls: 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30' }
  return               { label: 'Needs Improvement', cls: 'bg-red-500/20 text-red-400 border-red-500/30' }
}

function applyDatePreset(days) {
  if (!days) return { from: '', to: '' }
  const to = new Date()
  const from = new Date()
  from.setDate(from.getDate() - days)
  return { from: from.toISOString().slice(0, 10), to: to.toISOString().slice(0, 10) }
}

// ── KPI Card ───────────────────────────────────────────────────────────────────
function KpiCard({ icon: Icon, label, value, sub, color = 'blue', delta }) {
  const colorMap = {
    blue:   { ring: 'ring-blue-500/20',   bg: 'bg-blue-500/10',   text: 'text-blue-400'   },
    green:  { ring: 'ring-green-500/20',  bg: 'bg-green-500/10',  text: 'text-green-400'  },
    yellow: { ring: 'ring-yellow-500/20', bg: 'bg-yellow-500/10', text: 'text-yellow-400' },
    orange: { ring: 'ring-orange-500/20', bg: 'bg-orange-500/10', text: 'text-orange-400' },
    red:    { ring: 'ring-red-500/20',    bg: 'bg-red-500/10',    text: 'text-red-400'    },
    purple: { ring: 'ring-purple-500/20', bg: 'bg-purple-500/10', text: 'text-purple-400' },
  }
  const c = colorMap[color] || colorMap.blue
  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      className={`bg-gray-900 border border-gray-800 rounded-xl p-5 ring-1 ${c.ring} flex flex-col gap-3`}
    >
      <div className="flex items-center justify-between">
        <span className="text-xs text-gray-500 uppercase tracking-wider font-medium">{label}</span>
        <div className={`${c.bg} p-2 rounded-lg`}>
          <Icon className={`w-4 h-4 ${c.text}`} />
        </div>
      </div>
      <div className="text-2xl font-bold text-white">{value}</div>
      {(sub || delta != null) && (
        <div className="flex items-center gap-2 text-xs">
          {sub && <span className="text-gray-500">{sub}</span>}
          {delta != null && (
            <span className={delta >= 0 ? 'text-green-400 flex items-center gap-0.5' : 'text-red-400 flex items-center gap-0.5'}>
              {delta >= 0 ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
              {Math.abs(delta).toFixed(1)}%
            </span>
          )}
        </div>
      )}
    </motion.div>
  )
}

// ── Chart Card ─────────────────────────────────────────────────────────────────
function ChartCard({ title, subtitle, children, height = 260, action }) {
  return (
    <div className="bg-gray-900 border border-gray-800 rounded-xl p-5">
      <div className="flex items-start justify-between mb-4">
        <div>
          <h3 className="text-sm font-semibold text-white">{title}</h3>
          {subtitle && <p className="text-xs text-gray-500 mt-0.5">{subtitle}</p>}
        </div>
        {action}
      </div>
      <div style={{ height }}>{children}</div>
    </div>
  )
}

// ── Job Drawer ─────────────────────────────────────────────────────────────────
function JobDrawer({ job, onClose, currency }) {
  if (!job) return null
  let parts = []
  try { parts = typeof job.parts_used === 'string' ? JSON.parse(job.parts_used) : (job.parts_used || []) }
  catch { parts = [] }

  const ta = turnaroundHours(job)
  const ot = isOnTime(job)

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm"
        onClick={onClose}
      />
      <motion.div
        initial={{ x: '100%' }}
        animate={{ x: 0 }}
        exit={{ x: '100%' }}
        transition={{ type: 'spring', damping: 30, stiffness: 300 }}
        className="fixed right-0 top-0 h-full w-full max-w-xl z-50 bg-gray-950 border-l border-gray-800 overflow-y-auto"
        onClick={e => e.stopPropagation()}
      >
        <div className="sticky top-0 bg-gray-950 border-b border-gray-800 px-6 py-4 flex items-center justify-between z-10">
          <div>
            <p className="text-xs text-gray-500 uppercase tracking-wider">Work Order</p>
            <h2 className="text-base font-bold text-white mt-0.5">{job.work_order_no || job.id}</h2>
          </div>
          <button onClick={onClose} className="p-2 rounded-lg hover:bg-gray-800 text-gray-400 hover:text-white transition-colors">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-6 space-y-6">
          {/* Status & Priority */}
          <div className="flex gap-2 flex-wrap">
            <span className={`px-3 py-1 rounded-full text-xs font-medium border ${statusBadgeClass(job.status)}`}>{job.status}</span>
            <span className={`px-3 py-1 rounded-full text-xs font-medium border ${priorityBadgeClass(job.priority)}`}>{job.priority}</span>
            {ot != null && (
              <span className={`px-3 py-1 rounded-full text-xs font-medium border ${ot ? 'bg-green-500/20 text-green-400 border-green-500/30' : 'bg-red-500/20 text-red-400 border-red-500/30'}`}>
                {ot ? 'On Time' : 'Late'}
              </span>
            )}
          </div>

          {/* Core details */}
          <div className="grid grid-cols-2 gap-3">
            {[
              { label: 'Asset', value: job.asset_no },
              { label: 'Site', value: job.site },
              { label: 'Work Type', value: job.work_type },
              { label: 'Assigned To', value: job.assigned_to },
              { label: 'Created', value: job.created_at ? formatDateTime(job.created_at) : '-' },
              { label: 'Scheduled', value: job.scheduled_date ? formatDate(job.scheduled_date) : '-' },
              { label: 'Completed', value: job.completed_at ? formatDateTime(job.completed_at) : '-' },
              { label: 'Turnaround', value: fmtHours(ta) },
            ].map(({ label, value }) => (
              <div key={label} className="bg-gray-900 rounded-lg p-3">
                <p className="text-xs text-gray-500 mb-1">{label}</p>
                <p className="text-sm text-white font-medium">{value || '-'}</p>
              </div>
            ))}
          </div>

          {/* Cost breakdown */}
          <div>
            <h3 className="text-xs text-gray-500 uppercase tracking-wider mb-3">Cost Breakdown</h3>
            <div className="bg-gray-900 rounded-xl overflow-hidden">
              {[
                { label: 'Labour Cost', value: job.labour_cost, color: 'bg-blue-500' },
                { label: 'Parts Cost', value: job.parts_cost, color: 'bg-purple-500' },
                { label: 'Total Cost', value: job.total_cost, color: 'bg-green-500', bold: true },
              ].map(({ label, value, color, bold }) => (
                <div key={label} className={`flex items-center justify-between px-4 py-3 ${bold ? 'border-t border-gray-800' : ''}`}>
                  <div className="flex items-center gap-2">
                    <div className={`w-2 h-2 rounded-full ${color}`} />
                    <span className={`text-sm ${bold ? 'text-white font-semibold' : 'text-gray-400'}`}>{label}</span>
                  </div>
                  <span className={`text-sm font-medium ${bold ? 'text-white' : 'text-gray-300'}`}>
                    {fmtCurrency(value, currency)}
                  </span>
                </div>
              ))}
            </div>
            {job.total_cost > 0 && (
              <div className="mt-2 bg-gray-900 rounded-lg p-3">
                <div className="flex gap-1 h-3 rounded overflow-hidden">
                  <div
                    className="bg-blue-500 rounded-l"
                    style={{ width: `${((job.labour_cost || 0) / job.total_cost) * 100}%` }}
                  />
                  <div
                    className="bg-purple-500 rounded-r"
                    style={{ width: `${((job.parts_cost || 0) / job.total_cost) * 100}%` }}
                  />
                </div>
                <div className="flex justify-between mt-1.5 text-xs text-gray-500">
                  <span>Labour {job.total_cost > 0 ? fmtPct(((job.labour_cost || 0) / job.total_cost) * 100) : '-'}</span>
                  <span>Parts {job.total_cost > 0 ? fmtPct(((job.parts_cost || 0) / job.total_cost) * 100) : '-'}</span>
                </div>
              </div>
            )}
          </div>

          {/* Description */}
          {job.description && (
            <div>
              <h3 className="text-xs text-gray-500 uppercase tracking-wider mb-2">Description</h3>
              <p className="text-sm text-gray-300 bg-gray-900 rounded-lg p-4 leading-relaxed">{job.description}</p>
            </div>
          )}

          {/* Parts used */}
          {parts.length > 0 && (
            <div>
              <h3 className="text-xs text-gray-500 uppercase tracking-wider mb-3">Parts Used</h3>
              <div className="space-y-2">
                {parts.map((p, i) => (
                  <div key={i} className="flex items-center justify-between bg-gray-900 rounded-lg px-4 py-2">
                    <span className="text-sm text-gray-300">{p.name || p.part_name || p.description || `Part ${i + 1}`}</span>
                    <div className="flex items-center gap-3 text-xs text-gray-500">
                      {p.qty != null && <span>Qty: {p.qty}</span>}
                      {p.cost != null && <span className="text-gray-300">{fmtCurrency(p.cost, currency)}</span>}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </motion.div>
    </AnimatePresence>
  )
}

// ── Main Component ─────────────────────────────────────────────────────────────
export default function WorkshopManagement() {
  const { activeCurrency } = useSettings()
  const { profile } = useAuth()

  const [orders, setOrders]       = useState([])
  const [loading, setLoading]     = useState(true)
  const [tableExists, setTableExists] = useState(true)
  const [error, setError]         = useState(null)
  const [selectedJob, setSelectedJob] = useState(null)

  // Filters
  const [site, setSite]           = useState('')
  const [workType, setWorkType]   = useState('')
  const [status, setStatus]       = useState('')
  const [priority, setPriority]   = useState('')
  const [techSearch, setTechSearch] = useState('')
  const [dateFrom, setDateFrom]   = useState('')
  const [dateTo, setDateTo]       = useState('')
  const [search, setSearch]       = useState('')
  const [page, setPage]           = useState(1)
  const [activeTab, setActiveTab] = useState('overview')

  const fetchData = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      let q = supabase
        .from('work_orders')
        .select('id,work_order_no,asset_no,status,priority,work_type,site,assigned_to:technician_name,labour_cost,parts_cost,total_cost,created_at,completed_at,scheduled_date:target_completion,description,parts_used')
        .order('created_at', { ascending: false })

      if (site)     q = q.eq('site', site)
      if (workType) q = q.eq('work_type', workType)
      if (status)   q = q.eq('status', status)
      if (priority) q = q.eq('priority', priority)
      if (dateFrom) q = q.gte('created_at', dateFrom)
      if (dateTo)   q = q.lte('created_at', dateTo + 'T23:59:59')

      const { data, error: err } = await q
      if (err) {
        if (err.code === '42P01' || err.message?.toLowerCase().includes('does not exist')) {
          setTableExists(false)
          setOrders([])
        } else {
          setError(err.message)
        }
      } else {
        setTableExists(true)
        setOrders(data || [])
      }
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }, [site, workType, status, priority, dateFrom, dateTo])

  useEffect(() => { fetchData() }, [fetchData])

  // ── Derived data ─────────────────────────────────────────────────────────────
  const now  = new Date()
  const thisMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`

  const filteredOrders = useMemo(() => {
    return orders.filter(o => {
      if (techSearch && !(o.assigned_to || '').toLowerCase().includes(techSearch.toLowerCase())) return false
      if (search) {
        const q = search.toLowerCase()
        return (
          (o.work_order_no || '').toLowerCase().includes(q) ||
          (o.asset_no || '').toLowerCase().includes(q) ||
          (o.site || '').toLowerCase().includes(q) ||
          (o.assigned_to || '').toLowerCase().includes(q)
        )
      }
      return true
    })
  }, [orders, techSearch, search])

  // KPIs
  const kpis = useMemo(() => {
    const thisMonthOrders = orders.filter(o => monthKey(o.created_at) === thisMonth)
    const completed = orders.filter(o => o.status === 'Completed')
    const openJobs  = orders.filter(o => ['Open','In Progress','Awaiting Parts'].includes(o.status))

    const taTimes = completed.map(turnaroundHours).filter(h => h != null)
    const avgTA   = taTimes.length ? taTimes.reduce((a, b) => a + b, 0) / taTimes.length : null

    const completionRate = orders.length ? (completed.length / orders.length) * 100 : 0

    const totalCost = orders.reduce((s, o) => s + (o.total_cost || 0), 0)

    const withScheduled = completed.filter(o => o.scheduled_date)
    const onTimeCount   = withScheduled.filter(isOnTime).length
    const onTimePct     = withScheduled.length ? (onTimeCount / withScheduled.length) * 100 : null

    return {
      totalThisMonth: thisMonthOrders.length,
      avgTA,
      completionRate,
      totalCost,
      openJobs: openJobs.length,
      onTimePct,
    }
  }, [orders, thisMonth])

  // Site performance
  const sitePerf = useMemo(() => {
    const map = {}
    const thisMonthOrders = orders.filter(o => monthKey(o.created_at) === thisMonth)

    orders.forEach(o => {
      const s = o.site || 'Unknown'
      if (!map[s]) map[s] = { site: s, jobs: 0, thisMonth: 0, completed: 0, total: 0, taTimes: [], openJobs: 0, onTimePairs: [] }
      map[s].total++
      if (monthKey(o.created_at) === thisMonth) map[s].thisMonth++
      if (o.status === 'Completed') {
        map[s].completed++
        const ta = turnaroundHours(o)
        if (ta != null) map[s].taTimes.push(ta)
        if (o.scheduled_date) map[s].onTimePairs.push(isOnTime(o))
      }
      if (['Open','In Progress','Awaiting Parts'].includes(o.status)) map[s].openJobs++
      map[s].jobs += o.total_cost || 0
    })

    const rows = Object.values(map).map(s => {
      const avgTA   = s.taTimes.length ? s.taTimes.reduce((a, b) => a + b, 0) / s.taTimes.length : null
      const compRate = s.total ? (s.completed / s.total) * 100 : 0
      const otRate  = s.onTimePairs.length ? (s.onTimePairs.filter(Boolean).length / s.onTimePairs.length) * 100 : 0
      const maxTA   = Math.max(...(Object.values(map).map(x => x.taTimes.length ? x.taTimes.reduce((a,b)=>a+b,0)/x.taTimes.length : 0)), 1)
      const taNorm  = avgTA != null ? Math.min(avgTA / maxTA, 1) : 0.5
      const score   = compRate * 0.4 + (1 - taNorm) * 30 + otRate * 0.3
      return { ...s, avgTA, compRate, otRate, totalCost: s.jobs, score: Math.round(score) }
    })

    return rows.sort((a, b) => b.score - a.score)
  }, [orders, thisMonth])

  // Unique site/tech options
  const siteOptions = useMemo(() => [...new Set(orders.map(o => o.site).filter(Boolean))].sort(), [orders])
  const techOptions = useMemo(() => [...new Set(orders.map(o => o.assigned_to).filter(Boolean))].sort(), [orders])

  // Technician performance
  const techPerf = useMemo(() => {
    const map = {}
    orders.forEach(o => {
      const t = o.assigned_to || 'Unassigned'
      if (!map[t]) map[t] = { tech: t, total: 0, completed: 0, taTimes: [], labourCost: 0 }
      map[t].total++
      if (o.status === 'Completed') {
        map[t].completed++
        const ta = turnaroundHours(o)
        if (ta != null) map[t].taTimes.push(ta)
      }
      map[t].labourCost += o.labour_cost || 0
    })
    return Object.values(map).map(t => {
      const compRate = t.total ? (t.completed / t.total) * 100 : 0
      const avgTA    = t.taTimes.length ? t.taTimes.reduce((a, b) => a + b, 0) / t.taTimes.length : null
      return { ...t, compRate, avgTA, rating: ratingBadge(compRate) }
    }).sort((a, b) => b.compRate - a.compRate)
  }, [orders])

  // Job volume chart (last 12 months, top 5 sites)
  const jobVolumeChart = useMemo(() => {
    const months = last12Months()
    const top5Sites = [...siteOptions].slice(0, 5)
    if (!top5Sites.length) return null

    const datasets = top5Sites.map((s, i) => {
      const data = months.map(mk =>
        orders.filter(o => o.site === s && o.status === 'Completed' && monthKey(o.completed_at) === mk).length
      )
      return {
        label: s,
        data,
        backgroundColor: PALETTE[i % PALETTE.length] + 'cc',
        borderColor: PALETTE[i % PALETTE.length],
        borderWidth: 1,
        borderRadius: 4,
      }
    })

    return {
      labels: months.map(monthLabel),
      datasets,
    }
  }, [orders, siteOptions])

  // Work type distribution
  const workTypeChart = useMemo(() => {
    const counts = {}
    WORK_TYPES.forEach(t => { counts[t] = 0 })
    orders.forEach(o => {
      const t = WORK_TYPES.includes(o.work_type) ? o.work_type : 'Other'
      counts[t] = (counts[t] || 0) + 1
    })
    const labels = Object.keys(counts).filter(k => counts[k] > 0)
    return {
      labels,
      datasets: [{
        data: labels.map(l => counts[l]),
        backgroundColor: labels.map((_, i) => PALETTE[i % PALETTE.length] + 'cc'),
        borderColor: labels.map((_, i) => PALETTE[i % PALETTE.length]),
        borderWidth: 1,
      }],
    }
  }, [orders])

  // Turnaround trend (12-month rolling avg)
  const taTrendChart = useMemo(() => {
    const months = last12Months()
    const data = months.map(mk => {
      const completed = orders.filter(o => o.status === 'Completed' && monthKey(o.completed_at) === mk)
      const times = completed.map(turnaroundHours).filter(h => h != null)
      return times.length ? times.reduce((a, b) => a + b, 0) / times.length : null
    })
    return {
      labels: months.map(monthLabel),
      datasets: [{
        label: 'Avg Turnaround (hrs)',
        data,
        borderColor: '#3b82f6',
        backgroundColor: 'rgba(59,130,246,0.1)',
        fill: true,
        tension: 0.4,
        pointBackgroundColor: '#3b82f6',
        pointRadius: 4,
        spanGaps: true,
      }],
    }
  }, [orders])

  // Cost stacked bar
  const costChart = useMemo(() => {
    const months = last12Months()
    const labour = months.map(mk =>
      orders.filter(o => monthKey(o.created_at) === mk).reduce((s, o) => s + (o.labour_cost || 0), 0)
    )
    const parts = months.map(mk =>
      orders.filter(o => monthKey(o.created_at) === mk).reduce((s, o) => s + (o.parts_cost || 0), 0)
    )
    return {
      labels: months.map(monthLabel),
      datasets: [
        {
          label: 'Labour Cost',
          data: labour,
          backgroundColor: 'rgba(59,130,246,0.8)',
          borderColor: '#3b82f6',
          borderWidth: 1,
          borderRadius: 4,
          stack: 'stack',
        },
        {
          label: 'Parts Cost',
          data: parts,
          backgroundColor: 'rgba(139,92,246,0.8)',
          borderColor: '#8b5cf6',
          borderWidth: 1,
          borderRadius: 4,
          stack: 'stack',
        },
      ],
    }
  }, [orders])

  // Paginated jobs
  const paginatedJobs = useMemo(() => {
    const start = (page - 1) * PAGE_SIZE
    return filteredOrders.slice(start, start + PAGE_SIZE)
  }, [filteredOrders, page])

  const totalPages = Math.max(1, Math.ceil(filteredOrders.length / PAGE_SIZE))

  // ── Export ────────────────────────────────────────────────────────────────────
  function handleExcelExport() {
    exportToExcel(
      filteredOrders,
      ['work_order_no','asset_no','site','work_type','priority','status','assigned_to','created_at','scheduled_date','completed_at','total_cost','labour_cost','parts_cost'],
      ['WO No','Asset','Site','Type','Priority','Status','Assigned To','Created','Scheduled','Completed','Total Cost','Labour Cost','Parts Cost'],
      'workshop_jobs_export',
      'Work Orders',
    )
  }

  function handlePdfExport() {
    const doc_data = [
      { section: 'Workshop Performance by Site', rows: sitePerf, columns: [
        { key: 'site', header: 'Site' },
        { key: 'thisMonth', header: 'Jobs (Month)' },
        { key: 'avgTA_fmt', header: 'Avg Turnaround' },
        { key: 'compRate_fmt', header: 'Completion %' },
        { key: 'totalCost_fmt', header: 'Total Cost' },
        { key: 'openJobs', header: 'Open Jobs' },
        { key: 'score', header: 'Score' },
      ]},
    ]

    const siteRows = sitePerf.map(s => ({
      ...s,
      avgTA_fmt: fmtHours(s.avgTA),
      compRate_fmt: fmtPct(s.compRate),
      totalCost_fmt: fmtCurrency(s.totalCost, activeCurrency),
    }))

    const techRows = techPerf.map(t => ({
      ...t,
      compRate_fmt: fmtPct(t.compRate),
      avgTA_fmt: fmtHours(t.avgTA),
      labourCost_fmt: fmtCurrency(t.labourCost, activeCurrency),
      rating_label: t.rating.label,
    }))

    exportToPdf(
      siteRows,
      [
        { key: 'site', header: 'Site' },
        { key: 'thisMonth', header: 'Jobs (Month)' },
        { key: 'avgTA_fmt', header: 'Avg Turnaround' },
        { key: 'compRate_fmt', header: 'Completion %' },
        { key: 'totalCost_fmt', header: 'Total Cost' },
        { key: 'openJobs', header: 'Open Jobs' },
        { key: 'score', header: 'Score' },
      ],
      'Workshop Performance Report',
      'workshop_performance',
      'landscape',
    )
  }

  // ── Render ────────────────────────────────────────────────────────────────────
  if (!tableExists) {
    return (
      <div className="min-h-screen bg-gray-950 flex items-center justify-center p-8">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="max-w-lg w-full bg-gray-900 border border-gray-800 rounded-2xl p-8 text-center"
        >
          <div className="w-16 h-16 bg-orange-500/10 rounded-2xl flex items-center justify-center mx-auto mb-5">
            <Wrench className="w-8 h-8 text-orange-400" />
          </div>
          <h2 className="text-xl font-bold text-white mb-3">Work Orders Module Not Configured</h2>
          <p className="text-gray-400 text-sm leading-relaxed mb-6">
            The <code className="bg-gray-800 px-1.5 py-0.5 rounded text-orange-400 text-xs">work_orders</code> table does not exist in your database.
            Apply <code className="bg-gray-800 px-1.5 py-0.5 rounded text-blue-400 text-xs">MIGRATIONS_V16.sql</code> in your Supabase SQL Editor to enable this module.
          </p>
          <div className="bg-gray-800/60 rounded-xl p-4 text-left text-xs text-gray-400 font-mono space-y-1">
            <p className="text-gray-500">-- Required table:</p>
            <p className="text-green-400">CREATE TABLE work_orders (...</p>
            <p className="text-gray-500">-- See MIGRATIONS_V16.sql</p>
          </div>
          <button
            onClick={fetchData}
            className="mt-6 px-5 py-2.5 bg-blue-600 hover:bg-blue-500 text-white rounded-xl text-sm font-medium transition-colors flex items-center gap-2 mx-auto"
          >
            <RefreshCw className="w-4 h-4" />
            Retry Connection
          </button>
        </motion.div>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Workshop Management"
        subtitle="Track workshop productivity, repairs, and turnaround time"
        icon={Wrench}
        actions={
          <div className="flex items-center gap-2 flex-wrap">
            <button
              onClick={fetchData}
              disabled={loading}
              className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-gray-800 hover:bg-gray-700 text-gray-300 text-sm transition-colors disabled:opacity-50"
            >
              <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
              Refresh
            </button>
            <button
              onClick={handlePdfExport}
              className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-gray-800 hover:bg-gray-700 text-gray-300 text-sm transition-colors"
            >
              <FileText className="w-4 h-4 text-red-400" />
              PDF
            </button>
            <button
              onClick={handleExcelExport}
              className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-gray-800 hover:bg-gray-700 text-gray-300 text-sm transition-colors"
            >
              <FileSpreadsheet className="w-4 h-4 text-green-400" />
              Excel
            </button>
          </div>
        }
      />

      <div className="space-y-6">
        {/* Filters */}
        <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
          <div className="flex flex-wrap gap-3">
            {/* Search */}
            <div className="relative flex-1 min-w-[200px]">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" />
              <input
                value={search}
                onChange={e => { setSearch(e.target.value); setPage(1) }}
                placeholder="Search WO#, Asset, Site..."
                className="w-full pl-9 pr-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-sm text-white placeholder-gray-500 focus:outline-none focus:border-blue-500"
              />
            </div>

            {/* Site */}
            <select
              value={site}
              onChange={e => { setSite(e.target.value); setPage(1) }}
              className="px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-sm text-white focus:outline-none focus:border-blue-500 min-w-[130px]"
            >
              <option value="">All Sites</option>
              {siteOptions.map(s => <option key={s} value={s}>{s}</option>)}
            </select>

            {/* Work Type */}
            <select
              value={workType}
              onChange={e => { setWorkType(e.target.value); setPage(1) }}
              className="px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-sm text-white focus:outline-none focus:border-blue-500 min-w-[140px]"
            >
              <option value="">All Types</option>
              {WORK_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
            </select>

            {/* Status */}
            <select
              value={status}
              onChange={e => { setStatus(e.target.value); setPage(1) }}
              className="px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-sm text-white focus:outline-none focus:border-blue-500 min-w-[140px]"
            >
              <option value="">All Statuses</option>
              {STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
            </select>

            {/* Priority */}
            <select
              value={priority}
              onChange={e => { setPriority(e.target.value); setPage(1) }}
              className="px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-sm text-white focus:outline-none focus:border-blue-500 min-w-[120px]"
            >
              <option value="">All Priorities</option>
              {PRIORITIES.map(p => <option key={p} value={p}>{p}</option>)}
            </select>

            {/* Technician search */}
            <div className="relative min-w-[160px]">
              <User className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" />
              <input
                value={techSearch}
                onChange={e => { setTechSearch(e.target.value); setPage(1) }}
                placeholder="Technician..."
                className="w-full pl-9 pr-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-sm text-white placeholder-gray-500 focus:outline-none focus:border-blue-500"
              />
            </div>

            {/* Date range */}
            <div className="flex items-center gap-1.5">
              <Calendar className="w-4 h-4 text-gray-500" />
              <input
                type="date"
                value={dateFrom}
                onChange={e => { setDateFrom(e.target.value); setPage(1) }}
                className="px-2 py-2 bg-gray-800 border border-gray-700 rounded-lg text-sm text-white focus:outline-none focus:border-blue-500 w-36"
              />
              <span className="text-gray-600 text-xs">to</span>
              <input
                type="date"
                value={dateTo}
                onChange={e => { setDateTo(e.target.value); setPage(1) }}
                className="px-2 py-2 bg-gray-800 border border-gray-700 rounded-lg text-sm text-white focus:outline-none focus:border-blue-500 w-36"
              />
            </div>

            {/* Presets */}
            <div className="flex items-center gap-1">
              {[{ label: '30d', days: 30 }, { label: '90d', days: 90 }, { label: '6m', days: 180 }, { label: '1yr', days: 365 }].map(p => (
                <button
                  key={p.label}
                  onClick={() => { const r = applyDatePreset(p.days); setDateFrom(r.from); setDateTo(r.to); setPage(1) }}
                  className="px-2.5 py-1.5 rounded-lg text-xs bg-gray-800 hover:bg-gray-700 text-gray-400 hover:text-white transition-colors"
                >
                  {p.label}
                </button>
              ))}
            </div>

            {/* Clear filters */}
            {(site || workType || status || priority || techSearch || dateFrom || dateTo || search) && (
              <button
                onClick={() => { setSite(''); setWorkType(''); setStatus(''); setPriority(''); setTechSearch(''); setDateFrom(''); setDateTo(''); setSearch(''); setPage(1) }}
                className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-red-500/10 hover:bg-red-500/20 text-red-400 text-sm transition-colors"
              >
                <X className="w-4 h-4" />
                Clear
              </button>
            )}
          </div>
        </div>

        {/* Loading */}
        {loading && <SkeletonTable rows={8} cols={6} />}

        {!loading && error && (
          <div className="bg-red-500/10 border border-red-500/30 rounded-xl p-5 text-red-400 text-sm flex items-center gap-3">
            <AlertTriangle className="w-5 h-5 flex-shrink-0" />
            <div>
              <p className="font-semibold">Failed to load data</p>
              <p className="text-xs text-red-400/70 mt-0.5">{error}</p>
            </div>
          </div>
        )}

        {!loading && !error && (
          <>
            {/* KPI Cards */}
            <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-4">
              <KpiCard
                icon={ClipboardList}
                label="Total Work Orders"
                value={kpis.totalThisMonth.toLocaleString()}
                sub="this month"
                color="blue"
              />
              <KpiCard
                icon={Clock}
                label="Avg Turnaround"
                value={fmtHours(kpis.avgTA)}
                sub="created → completed"
                color="purple"
              />
              <KpiCard
                icon={CheckCircle}
                label="Completion Rate"
                value={fmtPct(kpis.completionRate)}
                sub={`${orders.filter(o => o.status === 'Completed').length} completed`}
                color="green"
              />
              <KpiCard
                icon={DollarSign}
                label="Total Cost"
                value={fmtCurrency(kpis.totalCost, activeCurrency)}
                sub="labour + parts"
                color="yellow"
              />
              <KpiCard
                icon={AlertTriangle}
                label="Open Jobs"
                value={kpis.openJobs.toLocaleString()}
                sub="open / in progress / waiting"
                color={kpis.openJobs > 20 ? 'red' : kpis.openJobs > 10 ? 'orange' : 'blue'}
              />
              <KpiCard
                icon={Target}
                label="On-Time Rate"
                value={kpis.onTimePct != null ? fmtPct(kpis.onTimePct) : 'N/A'}
                sub="completed ≤ scheduled"
                color={kpis.onTimePct == null ? 'blue' : kpis.onTimePct >= 80 ? 'green' : kpis.onTimePct >= 60 ? 'yellow' : 'red'}
              />
            </div>

            {/* Tab Navigation */}
            <div className="flex gap-1 bg-gray-900 border border-gray-800 rounded-xl p-1 w-fit flex-wrap">
              {[
                { id: 'overview', label: 'Overview', icon: BarChart2 },
                { id: 'jobs', label: 'Jobs Table', icon: ClipboardList },
                { id: 'sites', label: 'Site Performance', icon: Building2 },
                { id: 'technicians', label: 'Technicians', icon: User },
                { id: 'costs', label: 'Cost Analysis', icon: DollarSign },
              ].map(tab => (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id)}
                  className={`flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                    activeTab === tab.id
                      ? 'bg-blue-600 text-white'
                      : 'text-gray-400 hover:text-white hover:bg-gray-800'
                  }`}
                >
                  <tab.icon className="w-4 h-4" />
                  {tab.label}
                </button>
              ))}
            </div>

            {/* Overview Tab */}
            <AnimatePresence mode="wait">
              {activeTab === 'overview' && (
                <motion.div
                  key="overview"
                  initial={{ opacity: 0, y: 12 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -12 }}
                  className="grid grid-cols-1 xl:grid-cols-2 gap-5"
                >
                  {/* Job Volume Chart */}
                  <ChartCard
                    title="Job Volume by Site"
                    subtitle="Completed jobs per site - last 12 months"
                    height={280}
                  >
                    {jobVolumeChart && jobVolumeChart.datasets.length > 0 ? (
                      <Bar
                        data={jobVolumeChart}
                        options={{
                          ...CHART_DEFAULTS,
                          plugins: {
                            ...CHART_DEFAULTS.plugins,
                            legend: { labels: { color: '#9ca3af', font: { size: 11 }, boxWidth: 12 } },
                          },
                        }}
                      />
                    ) : (
                      <div className="h-full flex items-center justify-center text-gray-600 text-sm">No data available</div>
                    )}
                  </ChartCard>

                  {/* Work Type Distribution */}
                  <ChartCard
                    title="Work Type Distribution"
                    subtitle="Breakdown by job category"
                    height={280}
                  >
                    {workTypeChart && workTypeChart.labels.length > 0 ? (
                      <Doughnut data={workTypeChart} options={NO_SCALE} />
                    ) : (
                      <div className="h-full flex items-center justify-center text-gray-600 text-sm">No data available</div>
                    )}
                  </ChartCard>

                  {/* Turnaround Trend */}
                  <ChartCard
                    title="Turnaround Time Trend"
                    subtitle="12-month rolling average hours - lower is better"
                    height={240}
                  >
                    {taTrendChart ? (
                      <Line
                        data={taTrendChart}
                        options={{
                          ...CHART_DEFAULTS,
                          plugins: {
                            ...CHART_DEFAULTS.plugins,
                            legend: { display: false },
                          },
                        }}
                      />
                    ) : (
                      <div className="h-full flex items-center justify-center text-gray-600 text-sm">No data available</div>
                    )}
                  </ChartCard>

                  {/* Cost Stacked Bar */}
                  <ChartCard
                    title="Monthly Cost Analysis"
                    subtitle="Labour vs parts cost per month"
                    height={240}
                  >
                    {costChart ? (
                      <Bar
                        data={costChart}
                        options={{
                          ...CHART_DEFAULTS,
                          plugins: {
                            ...CHART_DEFAULTS.plugins,
                            legend: { labels: { color: '#9ca3af', font: { size: 11 }, boxWidth: 12 } },
                          },
                          scales: {
                            ...CHART_DEFAULTS.scales,
                            x: { ...CHART_DEFAULTS.scales.x, stacked: true },
                            y: { ...CHART_DEFAULTS.scales.y, stacked: true },
                          },
                        }}
                      />
                    ) : (
                      <div className="h-full flex items-center justify-center text-gray-600 text-sm">No data available</div>
                    )}
                  </ChartCard>
                </motion.div>
              )}

              {/* Jobs Table Tab */}
              {activeTab === 'jobs' && (
                <motion.div
                  key="jobs"
                  initial={{ opacity: 0, y: 12 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -12 }}
                  className="space-y-4"
                >
                  <div className="flex items-center justify-between">
                    <p className="text-sm text-gray-500">
                      {filteredOrders.length.toLocaleString()} jobs · page {page} of {totalPages}
                    </p>
                  </div>

                  <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
                    <div className="overflow-x-auto">
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="border-b border-gray-800 bg-gray-800/50">
                            {['WO No','Asset','Site','Type','Priority','Status','Assigned To','Created','Scheduled','Completed','Cost'].map(h => (
                              <th key={h} className="px-4 py-3 text-left text-xs font-medium text-gray-400 uppercase tracking-wider whitespace-nowrap">{h}</th>
                            ))}
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-800">
                          {paginatedJobs.length === 0 ? (
                            <tr>
                              <td colSpan={11} className="px-4 py-12 text-center text-gray-600 text-sm">
                                No work orders found matching current filters.
                              </td>
                            </tr>
                          ) : (
                            paginatedJobs.map((job, i) => (
                              <motion.tr
                                key={job.id}
                                initial={{ opacity: 0 }}
                                animate={{ opacity: 1 }}
                                transition={{ delay: i * 0.02 }}
                                onClick={() => setSelectedJob(job)}
                                className="hover:bg-gray-800/50 cursor-pointer transition-colors group"
                              >
                                <td className="px-4 py-3 text-blue-400 font-mono text-xs whitespace-nowrap group-hover:text-blue-300">
                                  {job.work_order_no || job.id?.slice(0, 8)}
                                </td>
                                <td className="px-4 py-3 text-gray-300 font-medium whitespace-nowrap">{job.asset_no || '-'}</td>
                                <td className="px-4 py-3 text-gray-400 whitespace-nowrap">{job.site || '-'}</td>
                                <td className="px-4 py-3 text-gray-400 whitespace-nowrap">{job.work_type || '-'}</td>
                                <td className="px-4 py-3 whitespace-nowrap">
                                  {job.priority && (
                                    <span className={`px-2 py-0.5 rounded text-xs font-medium border ${priorityBadgeClass(job.priority)}`}>
                                      {job.priority}
                                    </span>
                                  )}
                                </td>
                                <td className="px-4 py-3 whitespace-nowrap">
                                  {job.status && (
                                    <span className={`px-2 py-0.5 rounded text-xs font-medium border ${statusBadgeClass(job.status)}`}>
                                      {job.status}
                                    </span>
                                  )}
                                </td>
                                <td className="px-4 py-3 text-gray-400 whitespace-nowrap">{job.assigned_to || '-'}</td>
                                <td className="px-4 py-3 text-gray-500 text-xs whitespace-nowrap">
                                  {job.created_at ? formatDate(job.created_at) : '-'}
                                </td>
                                <td className="px-4 py-3 text-gray-500 text-xs whitespace-nowrap">
                                  {job.scheduled_date ? formatDate(job.scheduled_date) : '-'}
                                </td>
                                <td className="px-4 py-3 text-gray-500 text-xs whitespace-nowrap">
                                  {job.completed_at ? formatDate(job.completed_at) : '-'}
                                </td>
                                <td className="px-4 py-3 text-gray-300 whitespace-nowrap font-medium">
                                  {fmtCurrency(job.total_cost, activeCurrency)}
                                </td>
                              </motion.tr>
                            ))
                          )}
                        </tbody>
                      </table>
                    </div>

                    {/* Pagination */}
                    {totalPages > 1 && (
                      <div className="flex items-center justify-between px-4 py-3 border-t border-gray-800">
                        <span className="text-xs text-gray-500">
                          Showing {((page - 1) * PAGE_SIZE) + 1}-{Math.min(page * PAGE_SIZE, filteredOrders.length)} of {filteredOrders.length}
                        </span>
                        <div className="flex items-center gap-1">
                          <button
                            onClick={() => setPage(p => Math.max(1, p - 1))}
                            disabled={page === 1}
                            className="p-1.5 rounded-lg hover:bg-gray-800 text-gray-400 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                          >
                            <ChevronLeft className="w-4 h-4" />
                          </button>
                          {Array.from({ length: Math.min(7, totalPages) }, (_, i) => {
                            let p = i + 1
                            if (totalPages > 7) {
                              if (page <= 4) p = i + 1
                              else if (page >= totalPages - 3) p = totalPages - 6 + i
                              else p = page - 3 + i
                            }
                            return (
                              <button
                                key={p}
                                onClick={() => setPage(p)}
                                className={`px-2.5 py-1.5 rounded-lg text-xs transition-colors ${
                                  p === page ? 'bg-blue-600 text-white' : 'text-gray-400 hover:bg-gray-800'
                                }`}
                              >
                                {p}
                              </button>
                            )
                          })}
                          <button
                            onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                            disabled={page === totalPages}
                            className="p-1.5 rounded-lg hover:bg-gray-800 text-gray-400 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                          >
                            <ChevronRight className="w-4 h-4" />
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                </motion.div>
              )}

              {/* Site Performance Tab */}
              {activeTab === 'sites' && (
                <motion.div
                  key="sites"
                  initial={{ opacity: 0, y: 12 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -12 }}
                >
                  <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
                    <div className="px-5 py-4 border-b border-gray-800 flex items-center justify-between">
                      <h3 className="text-sm font-semibold text-white">Workshop Performance by Site</h3>
                      <span className="text-xs text-gray-500">{sitePerf.length} sites</span>
                    </div>
                    <div className="overflow-x-auto">
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="border-b border-gray-800 bg-gray-800/40">
                            {['Site','Jobs (Month)','Avg Turnaround','Completion %','Total Cost','Open Jobs','Score'].map(h => (
                              <th key={h} className="px-4 py-3 text-left text-xs font-medium text-gray-400 uppercase tracking-wider whitespace-nowrap">{h}</th>
                            ))}
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-800">
                          {sitePerf.length === 0 ? (
                            <tr>
                              <td colSpan={7} className="px-4 py-12 text-center text-gray-600 text-sm">No site data available.</td>
                            </tr>
                          ) : (
                            sitePerf.map((s, i) => (
                              <motion.tr
                                key={s.site}
                                initial={{ opacity: 0, x: -10 }}
                                animate={{ opacity: 1, x: 0 }}
                                transition={{ delay: i * 0.04 }}
                                className="hover:bg-gray-800/30 transition-colors"
                              >
                                <td className="px-4 py-3">
                                  <div className="flex items-center gap-2">
                                    <Building2 className="w-4 h-4 text-gray-600" />
                                    <span className="text-white font-medium">{s.site}</span>
                                  </div>
                                </td>
                                <td className="px-4 py-3 text-gray-300">{s.thisMonth}</td>
                                <td className="px-4 py-3 text-gray-400">{fmtHours(s.avgTA)}</td>
                                <td className="px-4 py-3">
                                  <div className="flex items-center gap-2">
                                    <div className="flex-1 bg-gray-800 rounded-full h-1.5 min-w-[60px]">
                                      <div
                                        className={`h-1.5 rounded-full ${s.compRate >= 80 ? 'bg-green-500' : s.compRate >= 60 ? 'bg-yellow-500' : 'bg-red-500'}`}
                                        style={{ width: `${Math.min(s.compRate, 100)}%` }}
                                      />
                                    </div>
                                    <span className="text-gray-300 text-xs">{fmtPct(s.compRate)}</span>
                                  </div>
                                </td>
                                <td className="px-4 py-3 text-gray-300">{fmtCurrency(s.totalCost, activeCurrency)}</td>
                                <td className="px-4 py-3">
                                  <span className={`text-sm font-medium ${s.openJobs > 10 ? 'text-red-400' : s.openJobs > 5 ? 'text-yellow-400' : 'text-gray-300'}`}>
                                    {s.openJobs}
                                  </span>
                                </td>
                                <td className="px-4 py-3">
                                  <span className={`inline-flex items-center px-2.5 py-1 rounded-lg text-xs font-bold border ${scoreBg(s.score)} ${scoreColor(s.score)}`}>
                                    {s.score}
                                  </span>
                                </td>
                              </motion.tr>
                            ))
                          )}
                        </tbody>
                      </table>
                    </div>
                  </div>
                </motion.div>
              )}

              {/* Technicians Tab */}
              {activeTab === 'technicians' && (
                <motion.div
                  key="technicians"
                  initial={{ opacity: 0, y: 12 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -12 }}
                >
                  <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
                    <div className="px-5 py-4 border-b border-gray-800 flex items-center justify-between">
                      <h3 className="text-sm font-semibold text-white">Technician Performance</h3>
                      <span className="text-xs text-gray-500">{techPerf.length} technicians</span>
                    </div>
                    <div className="overflow-x-auto">
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="border-b border-gray-800 bg-gray-800/40">
                            {['Technician','Jobs Completed','Avg Turnaround','Total Labour Cost','Completion Rate','Rating'].map(h => (
                              <th key={h} className="px-4 py-3 text-left text-xs font-medium text-gray-400 uppercase tracking-wider whitespace-nowrap">{h}</th>
                            ))}
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-800">
                          {techPerf.length === 0 ? (
                            <tr>
                              <td colSpan={6} className="px-4 py-12 text-center text-gray-600 text-sm">No technician data available.</td>
                            </tr>
                          ) : (
                            techPerf.map((t, i) => (
                              <motion.tr
                                key={t.tech}
                                initial={{ opacity: 0, x: -10 }}
                                animate={{ opacity: 1, x: 0 }}
                                transition={{ delay: i * 0.04 }}
                                className="hover:bg-gray-800/30 transition-colors"
                              >
                                <td className="px-4 py-3">
                                  <div className="flex items-center gap-2">
                                    <div className="w-7 h-7 rounded-full bg-gray-700 flex items-center justify-center text-xs font-bold text-gray-300">
                                      {(t.tech || '?')[0].toUpperCase()}
                                    </div>
                                    <span className="text-white font-medium">{t.tech}</span>
                                  </div>
                                </td>
                                <td className="px-4 py-3 text-gray-300">{t.completed}</td>
                                <td className="px-4 py-3 text-gray-400">{fmtHours(t.avgTA)}</td>
                                <td className="px-4 py-3 text-gray-300">{fmtCurrency(t.labourCost, activeCurrency)}</td>
                                <td className="px-4 py-3">
                                  <div className="flex items-center gap-2">
                                    <div className="flex-1 bg-gray-800 rounded-full h-1.5 min-w-[60px]">
                                      <div
                                        className={`h-1.5 rounded-full ${t.compRate >= 85 ? 'bg-green-500' : t.compRate >= 70 ? 'bg-yellow-500' : 'bg-red-500'}`}
                                        style={{ width: `${Math.min(t.compRate, 100)}%` }}
                                      />
                                    </div>
                                    <span className="text-gray-300 text-xs">{fmtPct(t.compRate)}</span>
                                  </div>
                                </td>
                                <td className="px-4 py-3">
                                  <span className={`px-2.5 py-1 rounded-lg text-xs font-medium border ${t.rating.cls}`}>
                                    {t.rating.label}
                                  </span>
                                </td>
                              </motion.tr>
                            ))
                          )}
                        </tbody>
                      </table>
                    </div>
                  </div>
                </motion.div>
              )}

              {/* Cost Analysis Tab */}
              {activeTab === 'costs' && (
                <motion.div
                  key="costs"
                  initial={{ opacity: 0, y: 12 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -12 }}
                  className="space-y-5"
                >
                  {/* Cost stacked bar */}
                  <ChartCard
                    title="Labour vs Parts Cost"
                    subtitle="Monthly stacked breakdown - identify cost drivers"
                    height={300}
                  >
                    {costChart ? (
                      <Bar
                        data={costChart}
                        options={{
                          ...CHART_DEFAULTS,
                          plugins: {
                            ...CHART_DEFAULTS.plugins,
                            legend: { labels: { color: '#9ca3af', font: { size: 11 }, boxWidth: 12 } },
                          },
                          scales: {
                            x: { ...CHART_DEFAULTS.scales.x, stacked: true },
                            y: { ...CHART_DEFAULTS.scales.y, stacked: true },
                          },
                        }}
                      />
                    ) : (
                      <div className="h-full flex items-center justify-center text-gray-600 text-sm">No cost data available</div>
                    )}
                  </ChartCard>

                  {/* Cost summary cards */}
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    {[
                      {
                        label: 'Total Labour Cost',
                        value: fmtCurrency(orders.reduce((s, o) => s + (o.labour_cost || 0), 0), activeCurrency),
                        pct: orders.reduce((s, o) => s + (o.total_cost || 0), 0) > 0
                          ? (orders.reduce((s, o) => s + (o.labour_cost || 0), 0) / orders.reduce((s, o) => s + (o.total_cost || 0), 0)) * 100
                          : 0,
                        color: 'bg-blue-500',
                        icon: User,
                        iconColor: 'text-blue-400',
                      },
                      {
                        label: 'Total Parts Cost',
                        value: fmtCurrency(orders.reduce((s, o) => s + (o.parts_cost || 0), 0), activeCurrency),
                        pct: orders.reduce((s, o) => s + (o.total_cost || 0), 0) > 0
                          ? (orders.reduce((s, o) => s + (o.parts_cost || 0), 0) / orders.reduce((s, o) => s + (o.total_cost || 0), 0)) * 100
                          : 0,
                        color: 'bg-purple-500',
                        icon: Package,
                        iconColor: 'text-purple-400',
                      },
                      {
                        label: 'Total Workshop Cost',
                        value: fmtCurrency(orders.reduce((s, o) => s + (o.total_cost || 0), 0), activeCurrency),
                        pct: 100,
                        color: 'bg-green-500',
                        icon: DollarSign,
                        iconColor: 'text-green-400',
                      },
                    ].map(c => (
                      <div key={c.label} className="bg-gray-900 border border-gray-800 rounded-xl p-5">
                        <div className="flex items-center justify-between mb-3">
                          <span className="text-xs text-gray-500 uppercase tracking-wider">{c.label}</span>
                          <c.icon className={`w-4 h-4 ${c.iconColor}`} />
                        </div>
                        <div className="text-2xl font-bold text-white mb-3">{c.value}</div>
                        <div className="bg-gray-800 rounded-full h-1.5">
                          <div className={`h-1.5 rounded-full ${c.color}`} style={{ width: `${c.pct}%` }} />
                        </div>
                        <p className="text-xs text-gray-500 mt-1.5">{c.pct.toFixed(1)}% of total</p>
                      </div>
                    ))}
                  </div>

                  {/* Per-site cost breakdown */}
                  <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
                    <div className="px-5 py-4 border-b border-gray-800">
                      <h3 className="text-sm font-semibold text-white">Cost by Site</h3>
                    </div>
                    <div className="overflow-x-auto">
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="border-b border-gray-800 bg-gray-800/40">
                            {['Site','Total Cost','Labour Cost','Parts Cost','Labour %','Avg Cost/Job'].map(h => (
                              <th key={h} className="px-4 py-3 text-left text-xs font-medium text-gray-400 uppercase tracking-wider whitespace-nowrap">{h}</th>
                            ))}
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-800">
                          {sitePerf.length === 0 ? (
                            <tr>
                              <td colSpan={6} className="px-4 py-10 text-center text-gray-600 text-sm">No data.</td>
                            </tr>
                          ) : (
                            sitePerf.map((s, i) => {
                              const labourCost = orders.filter(o => o.site === s.site).reduce((a, o) => a + (o.labour_cost || 0), 0)
                              const partsCost  = orders.filter(o => o.site === s.site).reduce((a, o) => a + (o.parts_cost || 0), 0)
                              const avgPerJob  = s.total > 0 ? s.totalCost / s.total : 0
                              const labourPct  = s.totalCost > 0 ? (labourCost / s.totalCost) * 100 : 0
                              return (
                                <tr key={s.site} className="hover:bg-gray-800/30 transition-colors">
                                  <td className="px-4 py-3 text-white font-medium">{s.site}</td>
                                  <td className="px-4 py-3 text-gray-300 font-medium">{fmtCurrency(s.totalCost, activeCurrency)}</td>
                                  <td className="px-4 py-3 text-blue-400">{fmtCurrency(labourCost, activeCurrency)}</td>
                                  <td className="px-4 py-3 text-purple-400">{fmtCurrency(partsCost, activeCurrency)}</td>
                                  <td className="px-4 py-3 text-gray-400">{fmtPct(labourPct)}</td>
                                  <td className="px-4 py-3 text-gray-300">{fmtCurrency(avgPerJob, activeCurrency)}</td>
                                </tr>
                              )
                            })
                          )}
                        </tbody>
                      </table>
                    </div>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </>
        )}
      </div>

      {/* Job Detail Drawer */}
      {selectedJob && (
        <JobDrawer
          job={selectedJob}
          onClose={() => setSelectedJob(null)}
          currency={activeCurrency}
        />
      )}
    </div>
  )
}
