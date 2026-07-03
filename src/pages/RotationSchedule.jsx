// ─────────────────────────────────────────────────────────────────────────────
// RotationSchedule.jsx - Tyre Rotation Compliance Tracker · /rotation
// ─────────────────────────────────────────────────────────────────────────────
import { useState, useEffect, useMemo, useCallback, useRef } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  Chart as ChartJS,
  CategoryScale, LinearScale, BarElement, LineElement, PointElement,
  ArcElement, Title, Tooltip, Legend, Filler,
} from 'chart.js'
import { Bar, Line } from 'react-chartjs-2'
import {
  RotateCcw, AlertTriangle, CheckCircle, Clock, TrendingUp,
  Download, FileText, RefreshCw, ChevronDown, ChevronUp,
  X, Filter, Search, Building2, Truck, Layers,
  DollarSign, Settings2, Calendar, ArrowRight, Info,
  AlertOctagon, Gauge, Activity, ChevronRight, Wrench,
  FileSpreadsheet, BarChart3, Target, MapPin,
} from 'lucide-react'
import { supabase } from '../lib/supabase'
import * as rotations from '../lib/api/rotations'
import { normalizePosition } from '../lib/tyrePositions'
import { useSettings } from '../contexts/SettingsContext'
import { useTenant } from '../contexts/TenantContext'
import { resolvePdfBrand, pdfHeader, pdfFooter, pdfEmptyState, pdfTableTheme } from '../lib/exportUtils'
import PageHeader from '../components/ui/PageHeader'
import EmptyState from '../components/EmptyState'

ChartJS.register(
  CategoryScale, LinearScale, BarElement, LineElement, PointElement,
  ArcElement, Title, Tooltip, Legend, Filler,
)

// ── Constants ──────────────────────────────────────────────────────────────────
const DEFAULT_INTERVAL     = 20_000
const MIN_INTERVAL         = 10_000
const MAX_INTERVAL         = 40_000
const DUE_SOON_BUFFER      = 2_000
const WEAR_IMBALANCE_MM    = 3

const CHART_DEFAULTS = {
  responsive: true,
  maintainAspectRatio: false,
  plugins: {
    legend: { labels: { color: '#9ca3af', boxWidth: 12, font: { size: 11 } } },
    tooltip: {
      backgroundColor: 'var(--panel)',
      borderColor: 'var(--hairline)',
      borderWidth: 1,
      titleColor: '#f9fafb',
      bodyColor: '#d1d5db',
    },
  },
  scales: {
    x: { ticks: { color: '#9ca3af', font: { size: 11 } }, grid: { color: '#1f2937' } },
    y: { ticks: { color: '#9ca3af', font: { size: 11 } }, grid: { color: '#1f2937' } },
  },
}

const STATUS_CFG = {
  'On Schedule': { color: 'text-green-400',  bg: 'bg-green-900/30',  border: 'border-green-700',  dot: 'bg-green-500'  },
  'Due Soon':    { color: 'text-yellow-400', bg: 'bg-yellow-900/30', border: 'border-yellow-700', dot: 'bg-yellow-500' },
  'Overdue':     { color: 'text-red-400',    bg: 'bg-red-900/30',    border: 'border-red-700',    dot: 'bg-red-500'    },
  'No History':  { color: 'text-gray-400',   bg: 'bg-gray-800',      border: 'border-gray-600',   dot: 'bg-gray-500'   },
}

const URGENCY_ORDER = { Overdue: 0, 'Due Soon': 1, 'No History': 2, 'On Schedule': 3 }

const MONTH_LABELS = Array.from({ length: 12 }, (_, i) => {
  const d = new Date()
  d.setMonth(d.getMonth() - 11 + i)
  return d.toLocaleDateString('en-GB', { month: 'short', year: '2-digit' })
})

// ── Helpers ────────────────────────────────────────────────────────────────────
function fmt(n, dec = 0) {
  if (n == null || isNaN(n)) return '-'
  return Number(n).toLocaleString('en-US', { minimumFractionDigits: dec, maximumFractionDigits: dec })
}
function fmtDate(d) {
  if (!d) return '-'
  return new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
}
function safeKm(v) {
  const n = parseFloat(v)
  return isNaN(n) ? null : n
}
function normPos(pos) {
  // Delegate to the shared canonical mapper (recognises coded positions like
  // LHF1 / LHRI) then collapse to this page's short axle-group labels.
  const g = normalizePosition(pos)
  if (g === 'Lift Axle') return 'Lift'
  if (g === 'Tag Axle')  return 'Tag'
  return g
}

// ── Core rotation analytics engine ────────────────────────────────────────────
function buildRotationAnalytics(records, interval) {
  if (!records || records.length === 0) return null

  // Index all records by serial_number to detect position changes
  const bySerial = {}
  records.forEach(r => {
    const sn = (r.serial_number || r.serial_no || '').trim()
    if (!sn) return
    if (!bySerial[sn]) bySerial[sn] = []
    bySerial[sn].push(r)
  })

  // Sort each serial's records by issue_date
  Object.values(bySerial).forEach(arr => arr.sort((a, b) => new Date(a.issue_date) - new Date(b.issue_date)))

  // Detect rotations per serial (position change between consecutive records)
  const rotationsDetected = {} // serial → [{ from, to, date, km }]
  Object.entries(bySerial).forEach(([sn, arr]) => {
    const events = []
    for (let i = 1; i < arr.length; i++) {
      const prev = arr[i - 1]
      const curr = arr[i]
      const fromPos = normPos(prev.position)
      const toPos   = normPos(curr.position)
      if (fromPos !== toPos) {
        events.push({
          from: fromPos,
          to: toPos,
          date: curr.issue_date,
          km: safeKm(curr.km_at_fitment),
          asset: curr.asset_no,
        })
      }
    }
    if (events.length) rotationsDetected[sn] = events
  })

  // Group records by asset_no
  const byAsset = {}
  records.forEach(r => {
    const asset = (r.asset_no || '').trim()
    if (!asset) return
    if (!byAsset[asset]) byAsset[asset] = []
    byAsset[asset].push(r)
  })

  // Per-vehicle stats
  const vehicles = []
  Object.entries(byAsset).forEach(([asset, recs]) => {
    const site    = recs[0]?.site || '-'
    const country = recs[0]?.country || '-'

    // Active tyres: latest record per serial on this asset
    const latestBySn = {}
    recs.forEach(r => {
      const sn = (r.serial_number || r.serial_no || '').trim()
      if (!sn) return
      if (!latestBySn[sn] || new Date(r.issue_date) > new Date(latestBySn[sn].issue_date)) {
        latestBySn[sn] = r
      }
    })
    const activeTyres = Object.values(latestBySn)

    // Detect last rotation across all serials on this vehicle
    let lastRotationDate = null
    let lastRotationKm   = null
    let totalRotations   = 0
    const rotationEvents = []

    Object.entries(latestBySn).forEach(([sn, _]) => {
      const events = rotationsDetected[sn] || []
      const vehicleEvents = events.filter(e => e.asset === asset)
      vehicleEvents.forEach(ev => {
        totalRotations++
        rotationEvents.push({ serial: sn, ...ev })
        if (!lastRotationDate || new Date(ev.date) > new Date(lastRotationDate)) {
          lastRotationDate = ev.date
          lastRotationKm   = ev.km
        }
      })
    })

    // Current max km on vehicle (highest km_at_fitment or km_at_removal among active)
    const currentKm = activeTyres.reduce((mx, r) => {
      const k = safeKm(r.km_at_fitment) || 0
      return k > mx ? k : mx
    }, 0)

    const sinceLastKm = lastRotationKm != null ? currentKm - lastRotationKm : null
    const dueInKm     = lastRotationKm != null ? interval - sinceLastKm : null

    let status
    if (totalRotations === 0) {
      status = 'No History'
    } else if (sinceLastKm >= interval) {
      status = 'Overdue'
    } else if (dueInKm != null && dueInKm <= DUE_SOON_BUFFER) {
      status = 'Due Soon'
    } else {
      status = 'On Schedule'
    }

    // Tread balance (steer vs drive)
    const treadByPos = {}
    activeTyres.forEach(r => {
      const pos = normPos(r.position)
      const td  = parseFloat(r.tread_depth)
      if (!isNaN(td)) {
        if (!treadByPos[pos]) treadByPos[pos] = []
        treadByPos[pos].push(td)
      }
    })
    const avgTread = pos => treadByPos[pos] ? treadByPos[pos].reduce((s, v) => s + v, 0) / treadByPos[pos].length : null
    const steerTread = avgTread('Steer')
    const driveTread = avgTread('Drive')
    const wearImbalance = steerTread != null && driveTread != null ? Math.abs(steerTread - driveTread) : null

    vehicles.push({
      asset, site, country,
      activeTyreCount: activeTyres.length,
      activeTyres,
      lastRotationDate,
      lastRotationKm,
      currentKm,
      sinceLastKm,
      dueInKm,
      status,
      totalRotations,
      rotationEvents: rotationEvents.sort((a, b) => new Date(b.date) - new Date(a.date)),
      wearImbalance,
      steerTread,
      driveTread,
      treadByPos,
    })
  })

  // Sort by urgency
  vehicles.sort((a, b) => {
    const uo = (URGENCY_ORDER[a.status] ?? 4) - (URGENCY_ORDER[b.status] ?? 4)
    if (uo !== 0) return uo
    if (a.sinceLastKm != null && b.sinceLastKm != null) return b.sinceLastKm - a.sinceLastKm
    return 0
  })

  // Fleet KPIs
  const total         = vehicles.length
  const compliant     = vehicles.filter(v => v.status === 'On Schedule').length
  const overdue       = vehicles.filter(v => v.status === 'Overdue').length
  const compliancePct = total > 0 ? Math.round((compliant / total) * 100) : 0

  // Average interval between rotations
  const allIntervals = []
  Object.values(rotationsDetected).forEach(evts => {
    for (let i = 1; i < evts.length; i++) {
      const k1 = evts[i - 1].km
      const k2 = evts[i].km
      if (k1 != null && k2 != null && k2 > k1) allIntervals.push(k2 - k1)
    }
  })
  const avgInterval = allIntervals.length > 0
    ? Math.round(allIntervals.reduce((s, v) => s + v, 0) / allIntervals.length)
    : null

  // Cost savings estimate
  const avgCost     = records.reduce((s, r) => s + (parseFloat(r.cost_per_tyre) || 0), 0) / Math.max(records.length, 1)
  const effCost     = avgCost > 0 ? avgCost : 1200
  const lifeBenefit = interval * 0.15
  const costSavings = Math.round((lifeBenefit / 100_000) * effCost * total * 4 * 0.3)

  // Tyre life comparison (rotated vs not rotated)
  const withRotation    = []
  const withoutRotation = []
  records.forEach(r => {
    const sn = (r.serial_number || r.serial_no || '').trim()
    const km_start = safeKm(r.km_at_fitment)
    const km_end   = safeKm(r.km_at_removal)
    if (km_start == null || km_end == null || km_end <= km_start) return
    const life = km_end - km_start
    if (rotationsDetected[sn]) withRotation.push(life)
    else withoutRotation.push(life)
  })
  const avgLifeWith    = withRotation.length    ? Math.round(withRotation.reduce((s, v) => s + v, 0) / withRotation.length) : null
  const avgLifeWithout = withoutRotation.length ? Math.round(withoutRotation.reduce((s, v) => s + v, 0) / withoutRotation.length) : null

  // Site compliance
  const bySite = {}
  vehicles.forEach(v => {
    if (!bySite[v.site]) bySite[v.site] = { total: 0, compliant: 0 }
    bySite[v.site].total++
    if (v.status === 'On Schedule') bySite[v.site].compliant++
  })
  const siteCompliance = Object.entries(bySite)
    .map(([site, d]) => ({ site, pct: Math.round((d.compliant / d.total) * 100), total: d.total, compliant: d.compliant }))
    .sort((a, b) => b.pct - a.pct)

  // Monthly rotation activity - derived from actual detected rotation events
  // (position changes in tyre_records) over the trailing 12 months. No synthetic
  // variance: each bucket is a real count of rotations performed that month.
  const now = new Date()
  const monthlyRotations = Array.from({ length: 12 }, (_, i) => {
    const refDate  = new Date(now.getFullYear(), now.getMonth() - 11 + i, 1)
    const nextDate = new Date(refDate.getFullYear(), refDate.getMonth() + 1, 1)
    let count = 0
    Object.values(rotationsDetected).forEach(evts => {
      evts.forEach(ev => {
        if (!ev.date) return
        const rd = new Date(ev.date)
        if (rd >= refDate && rd < nextDate) count++
      })
    })
    return count
  })
  const hasMonthlyRotations = monthlyRotations.some(c => c > 0)

  return {
    vehicles,
    total, compliant, overdue, compliancePct,
    avgInterval, costSavings,
    avgLifeWith, avgLifeWithout,
    siteCompliance, monthlyRotations, hasMonthlyRotations,
    effCost,
  }
}

// ── KPI Card ───────────────────────────────────────────────────────────────────
function KpiCard({ icon: Icon, label, value, sub, color = 'blue', delay = 0 }) {
  const colors = {
    blue:   { icon: 'text-blue-400',   bg: 'bg-blue-900/20',   border: 'border-blue-800'   },
    green:  { icon: 'text-green-400',  bg: 'bg-green-900/20',  border: 'border-green-800'  },
    red:    { icon: 'text-red-400',    bg: 'bg-red-900/20',    border: 'border-red-800'    },
    yellow: { icon: 'text-yellow-400', bg: 'bg-yellow-900/20', border: 'border-yellow-800' },
  }
  const c = colors[color] || colors.blue
  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay }}
      className={`rounded-xl border ${c.border} ${c.bg} p-5 flex flex-col gap-3`}
    >
      <div className="flex items-center justify-between">
        <span className="text-xs text-gray-400 uppercase tracking-wider">{label}</span>
        <div className={`p-2 rounded-lg bg-gray-900`}>
          <Icon size={16} className={c.icon} />
        </div>
      </div>
      <div className="text-2xl font-bold text-white">{value}</div>
      {sub && <div className="text-xs text-gray-400">{sub}</div>}
    </motion.div>
  )
}

// ── Status Badge ───────────────────────────────────────────────────────────────
function StatusBadge({ status }) {
  const cfg = STATUS_CFG[status] || STATUS_CFG['No History']
  return (
    <span className={`inline-flex items-center gap-1.5 text-xs px-2 py-1 rounded-full border ${cfg.bg} ${cfg.border} ${cfg.color}`}>
      <span className={`w-1.5 h-1.5 rounded-full ${cfg.dot}`} />
      {status}
    </span>
  )
}

// ── Rotation History Drawer ────────────────────────────────────────────────────
function RotationDrawer({ vehicle, onClose }) {
  if (!vehicle) return null

  const treadPositions = ['Steer', 'Drive', 'Trailer', 'Lift', 'Tag']
  const posColors = { Steer: '#3b82f6', Drive: '#ef4444', Trailer: '#f59e0b', Lift: '#10b981', Tag: '#8b5cf6', Other: '#6b7280' }

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 z-50 bg-black/60 flex justify-end"
        onClick={onClose}
      >
        <motion.div
          initial={{ x: '100%' }}
          animate={{ x: 0 }}
          exit={{ x: '100%' }}
          transition={{ type: 'spring', damping: 30, stiffness: 300 }}
          className="w-full max-w-2xl h-full bg-gray-950 border-l border-gray-800 overflow-y-auto"
          onClick={e => e.stopPropagation()}
        >
          <div className="flex items-center justify-between p-6 border-b border-gray-800 sticky top-0 bg-gray-950 z-10">
            <div>
              <div className="flex items-center gap-2 text-white font-semibold text-lg">
                <Truck size={18} className="text-blue-400" />
                {vehicle.asset}
              </div>
              <div className="text-sm text-gray-400 mt-0.5">{vehicle.site} · Rotation History</div>
            </div>
            <button onClick={onClose} className="p-2 hover:bg-gray-800 rounded-lg text-gray-400 hover:text-white transition-colors">
              <X size={18} />
            </button>
          </div>

          <div className="p-6 space-y-6">
            {/* Position tread depth visual */}
            <div className="card">
              <h3 className="text-sm font-semibold text-white mb-4 flex items-center gap-2">
                <Gauge size={15} className="text-blue-400" />
                Tread Depth by Position
              </h3>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                {treadPositions.map(pos => {
                  const depths = vehicle.treadByPos?.[pos]
                  const avg    = depths ? depths.reduce((s, v) => s + v, 0) / depths.length : null
                  const isLow  = avg != null && avg < 4
                  return (
                    <div key={pos} className="bg-gray-800 rounded-lg p-3">
                      <div className="text-xs text-gray-400 mb-1">{pos}</div>
                      {avg != null ? (
                        <>
                          <div className={`text-lg font-bold ${isLow ? 'text-red-400' : 'text-green-400'}`}>
                            {avg.toFixed(1)} mm
                          </div>
                          <div className="mt-2 h-1.5 rounded-full bg-gray-700">
                            <div
                              className={`h-full rounded-full ${isLow ? 'bg-red-500' : 'bg-green-500'}`}
                              style={{ width: `${Math.min(100, (avg / 12) * 100)}%` }}
                            />
                          </div>
                        </>
                      ) : (
                        <div className="text-sm text-gray-500">-</div>
                      )}
                    </div>
                  )
                })}
              </div>
              {vehicle.wearImbalance != null && vehicle.wearImbalance > WEAR_IMBALANCE_MM && (
                <div className="mt-3 flex items-center gap-2 text-xs text-orange-400 bg-orange-900/20 border border-orange-800 rounded-lg px-3 py-2">
                  <AlertTriangle size={13} />
                  Steer-Drive tread imbalance of {vehicle.wearImbalance.toFixed(1)} mm - rotation recommended
                </div>
              )}
            </div>

            {/* Rotation events timeline */}
            <div className="card">
              <h3 className="text-sm font-semibold text-white mb-4 flex items-center gap-2">
                <RotateCcw size={15} className="text-green-400" />
                Detected Rotation Events
              </h3>
              {vehicle.rotationEvents.length === 0 ? (
                <div className="text-center py-6 text-gray-500 text-sm">No rotation history detected for this vehicle</div>
              ) : (
                <div className="space-y-3">
                  {vehicle.rotationEvents.map((ev, i) => (
                    <div key={i} className="flex items-start gap-3">
                      <div className="mt-1 flex-shrink-0 w-6 h-6 rounded-full bg-green-900/40 border border-green-700 flex items-center justify-center">
                        <RotateCcw size={11} className="text-green-400" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-sm text-white font-medium">{ev.serial}</span>
                          <span className="text-xs text-gray-500">{fmtDate(ev.date)}</span>
                        </div>
                        <div className="flex items-center gap-2 mt-1">
                          <span
                            className="text-xs px-2 py-0.5 rounded"
                            style={{ backgroundColor: `${posColors[ev.from] || '#6b7280'}30`, color: posColors[ev.from] || '#9ca3af', border: `1px solid ${posColors[ev.from] || '#6b7280'}50` }}
                          >
                            {ev.from}
                          </span>
                          <ArrowRight size={12} className="text-gray-500" />
                          <span
                            className="text-xs px-2 py-0.5 rounded"
                            style={{ backgroundColor: `${posColors[ev.to] || '#6b7280'}30`, color: posColors[ev.to] || '#9ca3af', border: `1px solid ${posColors[ev.to] || '#6b7280'}50` }}
                          >
                            {ev.to}
                          </span>
                          {ev.km != null && (
                            <span className="text-xs text-gray-500">@ {fmt(ev.km)} km</span>
                          )}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Active tyres table */}
            <div className="card">
              <h3 className="text-sm font-semibold text-white mb-4 flex items-center gap-2">
                <Layers size={15} className="text-purple-400" />
                Active Tyres ({vehicle.activeTyreCount})
              </h3>
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-gray-800">
                      {['Serial', 'Position', 'Brand', 'Tread (mm)', 'Fitted km'].map(h => (
                        <th key={h} className="text-left text-gray-500 pb-2 pr-4 font-medium">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-800">
                    {vehicle.activeTyres.map((t, i) => {
                      const td = parseFloat(t.tread_depth)
                      return (
                        <tr key={i} className="hover:bg-gray-800/50">
                          <td className="py-2 pr-4 text-white font-mono">{t.serial_number || t.serial_no || '-'}</td>
                          <td className="py-2 pr-4 text-gray-300">{normPos(t.position)}</td>
                          <td className="py-2 pr-4 text-gray-300">{t.brand || '-'}</td>
                          <td className={`py-2 pr-4 font-medium ${!isNaN(td) && td < 4 ? 'text-red-400' : 'text-green-400'}`}>
                            {isNaN(td) ? '-' : `${td.toFixed(1)}`}
                          </td>
                          <td className="py-2 pr-4 text-gray-300">{fmt(safeKm(t.km_at_fitment))}</td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  )
}

// ── Schedule Rotation Modal ────────────────────────────────────────────────────
function ScheduleModal({ vehicle, onClose, onSave }) {
  const [notes, setNotes]     = useState('')
  const [date, setDate]       = useState(() => {
    const d = new Date(); d.setDate(d.getDate() + 7)
    return d.toISOString().slice(0, 10)
  })
  const [priority, setPriority] = useState(
    vehicle?.status === 'Overdue' ? 'Critical' : vehicle?.status === 'Due Soon' ? 'High' : 'Medium'
  )

  const [saving, setSaving] = useState(false)

  async function handleSave() {
    if (saving) return
    setSaving(true)
    const entry = {
      asset: vehicle.asset,
      site:  vehicle.site,
      scheduledDate: date,
      priority,
      notes,
      currentKm: vehicle.currentKm,
      status: 'Open',
    }
    try {
      await onSave(entry)
      onClose()
    } finally {
      setSaving(false)
    }
  }

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4"
        onClick={onClose}
      >
        <motion.div
          initial={{ scale: 0.95, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          exit={{ scale: 0.95, opacity: 0 }}
          className="bg-gray-900 border border-gray-800 rounded-2xl w-full max-w-md"
          onClick={e => e.stopPropagation()}
        >
          <div className="flex items-center justify-between p-5 border-b border-gray-800">
            <div className="flex items-center gap-2 text-white font-semibold">
              <RotateCcw size={16} className="text-green-400" />
              Schedule Rotation - {vehicle?.asset}
            </div>
            <button onClick={onClose} className="p-1.5 hover:bg-gray-800 rounded-lg text-gray-400 hover:text-white transition-colors">
              <X size={16} />
            </button>
          </div>

          <div className="p-5 space-y-4">
            <div>
              <label className="block text-xs text-gray-400 mb-1.5">Scheduled Date</label>
              <input
                type="date"
                value={date}
                onChange={e => setDate(e.target.value)}
                className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-blue-500"
              />
            </div>

            <div>
              <label className="block text-xs text-gray-400 mb-1.5">Priority</label>
              <select
                value={priority}
                onChange={e => setPriority(e.target.value)}
                className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-blue-500"
              >
                {['Critical', 'High', 'Medium', 'Low'].map(p => (
                  <option key={p} value={p}>{p}</option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-xs text-gray-400 mb-1.5">Notes</label>
              <textarea
                value={notes}
                onChange={e => setNotes(e.target.value)}
                rows={3}
                placeholder="Optional workshop notes..."
                className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white text-sm resize-none focus:outline-none focus:border-blue-500 placeholder-gray-600"
              />
            </div>

            <div className="bg-gray-800 rounded-lg p-3 grid grid-cols-2 gap-3 text-xs">
              <div>
                <div className="text-gray-400">Current km</div>
                <div className="text-white font-medium">{fmt(vehicle?.currentKm)}</div>
              </div>
              <div>
                <div className="text-gray-400">Site</div>
                <div className="text-white font-medium">{vehicle?.site}</div>
              </div>
              <div>
                <div className="text-gray-400">Status</div>
                <StatusBadge status={vehicle?.status} />
              </div>
              <div>
                <div className="text-gray-400">Since Last Rotation</div>
                <div className="text-white font-medium">{vehicle?.sinceLastKm != null ? `${fmt(vehicle.sinceLastKm)} km` : '-'}</div>
              </div>
            </div>
          </div>

          <div className="flex gap-3 p-5 border-t border-gray-800">
            <button onClick={onClose} className="btn-secondary flex-1">
              Cancel
            </button>
            <button onClick={handleSave} disabled={saving} className="btn-primary flex-1">
              {saving ? 'Saving...' : 'Save to Schedule'}
            </button>
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  )
}

// ── Main Component ─────────────────────────────────────────────────────────────
export default function RotationSchedule() {
  const { appSettings, activeCurrency, activeCountry } = useSettings()
  const { branding } = useTenant()
  const company = branding?.legal_name || branding?.display_name || appSettings?.company_name || 'TyrePulse'

  const [records,  setRecords]  = useState([])
  const [loading,  setLoading]  = useState(true)
  const [error,    setError]    = useState(null)
  const [interval, setInterval] = useState(DEFAULT_INTERVAL)
  const [search,   setSearch]   = useState('')
  const [siteFilter, setSiteFilter] = useState('All')
  const [statusFilter, setStatusFilter] = useState('All')
  const [drawerVehicle, setDrawerVehicle] = useState(null)
  const [modalVehicle,  setModalVehicle]  = useState(null)
  const [schedules, setSchedules] = useState([])
  const [schedLoading, setSchedLoading] = useState(true)
  const [schedError,   setSchedError]   = useState(null)
  const [schedBusy,    setSchedBusy]    = useState(false)
  const [activeTab, setActiveTab] = useState('status') // 'status' | 'schedule' | 'impact'
  const [sortCol,   setSortCol]   = useState('status')
  const [sortAsc,   setSortAsc]   = useState(true)
  const [page, setPage]           = useState(1)
  const PAGE_SIZE = 25

  // ── Data fetch ─────────────────────────────────────────────────────────────
  const fetchData = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const data = await rotations.listRotationRecords({ country: activeCountry })
      setRecords(data || [])
    } catch (e) {
      setError(e.message || 'Failed to load data')
    } finally {
      setLoading(false)
    }
  }, [activeCountry])

  useEffect(() => { fetchData() }, [fetchData])

  // ── Schedule persistence (Supabase: tyre_rotations) ─────────────────────────
  // DB rows are snake_case; the UI/exports below consume a camelCase shape, so we
  // normalise on read and whitelist columns on write.
  const mapRow = useCallback((r) => ({
    id: r.id,
    asset: r.asset_no,
    site: r.site,
    scheduledDate: r.scheduled_date,
    priority: r.priority,
    notes: r.notes,
    currentKm: r.current_km,
    status: r.status,
    createdAt: r.created_at,
  }), [])

  const fetchSchedules = useCallback(async () => {
    setSchedLoading(true)
    setSchedError(null)
    try {
      const data = await rotations.listRotations({ country: activeCountry })
      setSchedules((data || []).map(mapRow))
    } catch (e) {
      setSchedError(e.message || 'Failed to load schedule')
    } finally {
      setSchedLoading(false)
    }
  }, [activeCountry, mapRow])

  useEffect(() => { fetchSchedules() }, [fetchSchedules])

  // Insert one or more schedule entries, then refresh from DB.
  const createSchedules = useCallback(async (entries) => {
    if (!entries.length) return
    setSchedBusy(true)
    setSchedError(null)
    try {
      const { data: userData } = await supabase.auth.getUser()
      const uid = userData?.user?.id ?? null
      const rows = entries.map(e => ({
        asset_no: e.asset,
        site: e.site,
        scheduled_date: e.scheduledDate,
        priority: e.priority,
        status: e.status || 'Open',
        notes: e.notes || null,
        current_km: e.currentKm ?? null,
        country: (activeCountry && activeCountry !== 'All') ? activeCountry : null,
        created_by: uid,
      }))
      await rotations.createRotations(rows)
      await fetchSchedules()
    } catch (e) {
      setSchedError(e.message || 'Failed to save schedule')
    } finally {
      setSchedBusy(false)
    }
  }, [activeCountry, fetchSchedules])

  const updateScheduleStatus = useCallback(async (id, status) => {
    setSchedBusy(true)
    setSchedError(null)
    try {
      await rotations.updateRotation(id, { status, updated_at: new Date().toISOString() })
      await fetchSchedules()
    } catch (e) {
      setSchedError(e.message || 'Failed to update schedule')
    } finally {
      setSchedBusy(false)
    }
  }, [fetchSchedules])

  const removeSchedule = useCallback(async (id) => {
    setSchedBusy(true)
    setSchedError(null)
    try {
      await rotations.deleteRotation(id)
      await fetchSchedules()
    } catch (e) {
      setSchedError(e.message || 'Failed to remove schedule')
    } finally {
      setSchedBusy(false)
    }
  }, [fetchSchedules])

  // ── Analytics ──────────────────────────────────────────────────────────────
  const analytics = useMemo(() => buildRotationAnalytics(records, interval), [records, interval])

  // ── Filters ────────────────────────────────────────────────────────────────
  const sites = useMemo(() => {
    if (!analytics) return []
    const s = new Set(analytics.vehicles.map(v => v.site).filter(Boolean))
    return ['All', ...Array.from(s).sort()]
  }, [analytics])

  const filteredVehicles = useMemo(() => {
    if (!analytics) return []
    let vv = analytics.vehicles
    if (siteFilter !== 'All') vv = vv.filter(v => v.site === siteFilter)
    if (statusFilter !== 'All') vv = vv.filter(v => v.status === statusFilter)
    if (search.trim()) {
      const q = search.trim().toLowerCase()
      vv = vv.filter(v => v.asset.toLowerCase().includes(q) || v.site.toLowerCase().includes(q))
    }
    // Sort
    const dir = sortAsc ? 1 : -1
    vv = [...vv].sort((a, b) => {
      if (sortCol === 'status') return dir * ((URGENCY_ORDER[a.status] ?? 4) - (URGENCY_ORDER[b.status] ?? 4))
      if (sortCol === 'asset')  return dir * a.asset.localeCompare(b.asset)
      if (sortCol === 'since')  return dir * ((a.sinceLastKm ?? -1) - (b.sinceLastKm ?? -1))
      if (sortCol === 'dueIn')  return dir * ((a.dueInKm ?? Infinity) - (b.dueInKm ?? Infinity))
      return 0
    })
    return vv
  }, [analytics, siteFilter, statusFilter, search, sortCol, sortAsc])

  const paginatedVehicles = useMemo(() => {
    const start = (page - 1) * PAGE_SIZE
    return filteredVehicles.slice(start, start + PAGE_SIZE)
  }, [filteredVehicles, page])

  const totalPages = Math.ceil(filteredVehicles.length / PAGE_SIZE)

  function toggleSort(col) {
    if (sortCol === col) setSortAsc(s => !s)
    else { setSortCol(col); setSortAsc(true) }
  }

  // ── Charts ─────────────────────────────────────────────────────────────────
  const trendChartData = useMemo(() => {
    if (!analytics || !analytics.hasMonthlyRotations) return null
    return {
      labels: MONTH_LABELS,
      datasets: [
        {
          label: 'Rotations Performed',
          data: analytics.monthlyRotations,
          borderColor: '#10b981',
          backgroundColor: 'rgba(16,185,129,0.1)',
          fill: true,
          tension: 0.4,
          pointRadius: 4,
          pointBackgroundColor: '#10b981',
        },
      ],
    }
  }, [analytics])

  const siteChartData = useMemo(() => {
    if (!analytics) return null
    const sc = analytics.siteCompliance
    return {
      labels: sc.map(s => s.site),
      datasets: [{
        label: 'Compliance %',
        data: sc.map(s => s.pct),
        backgroundColor: sc.map(s =>
          s.pct >= 90 ? '#10b981' : s.pct >= 70 ? '#f59e0b' : '#ef4444'
        ),
        borderRadius: 4,
      }],
    }
  }, [analytics])

  const impactChartData = useMemo(() => {
    if (!analytics || !analytics.avgLifeWith || !analytics.avgLifeWithout) return null
    return {
      labels: ['With Regular Rotation', 'No Rotation Detected'],
      datasets: [{
        label: 'Avg Tyre Life (km)',
        data: [analytics.avgLifeWith, analytics.avgLifeWithout],
        backgroundColor: ['#10b981', '#ef4444'],
        borderRadius: 6,
      }],
    }
  }, [analytics])

  // ── Export ─────────────────────────────────────────────────────────────────
  async function exportExcel() {
    const XLSX = await import('xlsx')
    if (!analytics) return
    const rows = filteredVehicles.map(v => ({
      Asset:               v.asset,
      Site:                v.site,
      'Active Tyres':      v.activeTyreCount,
      'Last Rotation Date': fmtDate(v.lastRotationDate),
      'Last Rotation (km)': v.lastRotationKm ?? '',
      'Since Last (km)':   v.sinceLastKm ?? '',
      'Due In (km)':       v.dueInKm ?? '',
      Status:              v.status,
      'Total Rotations':   v.totalRotations,
      'Wear Imbalance (mm)': v.wearImbalance != null ? v.wearImbalance.toFixed(1) : '',
    }))
    const ws = XLSX.utils.json_to_sheet(rows)
    ws['!cols'] = Object.keys(rows[0] || {}).map(k => ({ wch: Math.min(Math.max(k.length + 4, 14), 30) }))
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, 'Rotation Status')

    // Schedule sheet
    if (schedules.length) {
      const ws2 = XLSX.utils.json_to_sheet(schedules.map(s => ({
        Asset: s.asset, Site: s.site, 'Scheduled Date': s.scheduledDate,
        Priority: s.priority, Status: s.status, Notes: s.notes,
      })))
      XLSX.utils.book_append_sheet(wb, ws2, 'Rotation Schedule')
    }

    XLSX.writeFile(wb, `Rotation_Compliance_${new Date().toISOString().slice(0, 10)}.xlsx`)
  }

  async function exportPdf() {
    const { default: jsPDF } = await import('jspdf')
    const { default: autoTable } = await import('jspdf-autotable')
    if (!analytics) return
    const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' })
    const brand = await resolvePdfBrand(branding)
    const filename = `Rotation_Schedule_${new Date().toISOString().slice(0, 10)}.pdf`
    const title = 'Tyre Rotation Compliance Report'
    const subtitle = `Interval: ${fmt(interval)} km · Fleet: ${analytics.total} vehicles`

    if (filteredVehicles.length === 0) {
      pdfHeader(doc, title, subtitle, company, brand)
      pdfEmptyState(doc, 'No vehicles match the selected filters', 'Adjust the site or status filter and export again.')
      pdfFooter(doc, 1, 1, company, brand)
      doc.save(filename)
      return
    }

    // KPI summary (page 1)
    doc.setTextColor(55, 65, 81)
    doc.setFontSize(8)
    const kpis = [
      ['Compliance', `${analytics.compliancePct}%`],
      ['Overdue', String(analytics.overdue)],
      ['Avg Interval', analytics.avgInterval ? `${fmt(analytics.avgInterval)} km` : '-'],
      ['Est. Savings', `${activeCurrency} ${fmt(analytics.costSavings)}`],
    ]
    kpis.forEach(([k, v], i) => {
      doc.setFont('helvetica', 'bold'); doc.text(v, 14 + i * 65, 30)
      doc.setFont('helvetica', 'normal'); doc.text(k, 14 + i * 65, 35)
    })

    autoTable(doc, {
      ...pdfTableTheme(brand.accent),
      startY: 42,
      margin: { left: 14, right: 14, top: 28 },
      head: [['Asset', 'Site', 'Active Tyres', 'Last Rotation', 'Since Last (km)', 'Due In (km)', 'Status', 'Rotations']],
      body: filteredVehicles.map(v => [
        v.asset, v.site, v.activeTyreCount,
        fmtDate(v.lastRotationDate),
        v.sinceLastKm != null ? fmt(v.sinceLastKm) : '-',
        v.dueInKm != null ? fmt(v.dueInKm) : '-',
        v.status, v.totalRotations,
      ]),
      didParseCell: data => {
        if (data.section === 'body' && data.column.index === 6) {
          const s = data.cell.raw
          if (s === 'Overdue')     { data.cell.styles.textColor = [239, 68, 68]  }
          if (s === 'Due Soon')    { data.cell.styles.textColor = [245, 158, 11] }
          if (s === 'On Schedule') { data.cell.styles.textColor = [16, 185, 129] }
        }
      },
      didDrawPage: () => pdfHeader(doc, title, subtitle, company, brand),
    })

    // Schedule page
    if (schedules.length) {
      doc.addPage()
      autoTable(doc, {
        ...pdfTableTheme(brand.accent),
        startY: 30,
        margin: { left: 14, right: 14, top: 28 },
        head: [['Asset', 'Site', 'Scheduled Date', 'Priority', 'Status', 'Notes']],
        body: schedules.map(s => [s.asset, s.site, s.scheduledDate, s.priority, s.status, s.notes || '']),
        didDrawPage: () => pdfHeader(doc, 'Upcoming Rotation Schedule', `${schedules.length} scheduled`, company, brand),
      })
    }

    const totalPages = doc.internal.getNumberOfPages()
    for (let p = 1; p <= totalPages; p++) { doc.setPage(p); pdfFooter(doc, p, totalPages, company, brand) }

    doc.save(filename)
  }

  // ── Render ─────────────────────────────────────────────────────────────────
  if (loading) return (
    <div className="min-h-screen bg-gray-950 flex items-center justify-center">
      <div className="text-center space-y-3">
        <RotateCcw size={36} className="text-green-400 animate-spin mx-auto" />
        <p className="text-gray-400 text-sm">Loading rotation data...</p>
      </div>
    </div>
  )

  if (error) return (
    <div className="min-h-screen bg-gray-950 flex items-center justify-center p-8">
      <div className="bg-red-900/20 border border-red-800 rounded-2xl p-6 max-w-md text-center space-y-3">
        <AlertOctagon size={32} className="text-red-400 mx-auto" />
        <p className="text-red-300 font-medium">Failed to load rotation data</p>
        <p className="text-red-400/70 text-sm">{error}</p>
        <button onClick={fetchData} className="px-4 py-2 bg-red-700 hover:bg-red-600 text-white rounded-lg text-sm transition-colors">
          Retry
        </button>
      </div>
    </div>
  )

  const noData = !analytics || analytics.total === 0

  return (
    <div className="space-y-6">
      <PageHeader
        title="Rotation Compliance Tracker"
        subtitle="Schedule and monitor tyre rotation compliance across fleet"
        icon={RotateCcw}
        actions={
          <div className="flex items-center gap-2 flex-wrap">
            <button
              onClick={fetchData}
              className="p-2 bg-gray-800 hover:bg-gray-700 border border-gray-700 rounded-lg text-gray-400 hover:text-white transition-colors"
              title="Refresh"
            >
              <RefreshCw size={15} />
            </button>
            <button
              onClick={exportExcel}
              disabled={noData}
              className="flex items-center gap-2 px-3 py-2 bg-gray-800 hover:bg-gray-700 border border-gray-700 rounded-lg text-gray-300 text-sm transition-colors disabled:opacity-40"
            >
              <FileSpreadsheet size={14} /> Excel
            </button>
            <button
              onClick={exportPdf}
              disabled={noData}
              className="flex items-center gap-2 px-3 py-2 bg-green-700 hover:bg-green-600 rounded-lg text-white text-sm font-medium transition-colors disabled:opacity-40"
            >
              <Download size={14} /> PDF Report
            </button>
          </div>
        }
      />

        {/* ── Interval Config ──────────────────────────────────────────────── */}
        <div className="card">
          <div className="flex flex-col sm:flex-row sm:items-center gap-4">
            <div className="flex items-center gap-2 text-sm font-medium text-white min-w-max">
              <Settings2 size={15} className="text-blue-400" />
              Rotation Interval
            </div>
            <div className="flex-1 flex items-center gap-4">
              <input
                type="range"
                min={MIN_INTERVAL}
                max={MAX_INTERVAL}
                step={1000}
                value={interval}
                onChange={e => { setInterval(Number(e.target.value)); setPage(1) }}
                className="flex-1 accent-green-500 h-2 rounded-full cursor-pointer"
              />
              <input
                type="number"
                min={MIN_INTERVAL}
                max={MAX_INTERVAL}
                step={1000}
                value={interval}
                onChange={e => {
                  const v = Math.max(MIN_INTERVAL, Math.min(MAX_INTERVAL, Number(e.target.value)))
                  setInterval(v); setPage(1)
                }}
                className="w-28 bg-gray-800 border border-gray-700 rounded-lg px-3 py-1.5 text-white text-sm text-right focus:outline-none focus:border-blue-500"
              />
              <span className="text-sm text-gray-400 min-w-max">km</span>
            </div>
            <div className="flex items-center gap-1 text-xs text-gray-500">
              <Info size={11} />
              <span>Recalculates all metrics in real-time</span>
            </div>
          </div>
        </div>

        {/* ── KPI Cards ───────────────────────────────────────────────────── */}
        {noData ? (
          <div className="card">
            <EmptyState
              icon={RotateCcw}
              title="No tyre records found"
              description="Upload tyre data to begin tracking rotation compliance."
            />
          </div>
        ) : (
          <>
            <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
              <KpiCard
                icon={Target}
                label="Fleet Rotation Compliance"
                value={`${analytics.compliancePct}%`}
                sub={`${analytics.compliant} of ${analytics.total} vehicles on schedule`}
                color={analytics.compliancePct >= 90 ? 'green' : analytics.compliancePct >= 70 ? 'yellow' : 'red'}
                delay={0}
              />
              <KpiCard
                icon={AlertTriangle}
                label="Overdue for Rotation"
                value={fmt(analytics.overdue)}
                sub={`Vehicles exceeding ${fmt(interval)} km interval`}
                color={analytics.overdue === 0 ? 'green' : analytics.overdue <= 3 ? 'yellow' : 'red'}
                delay={0.05}
              />
              <KpiCard
                icon={Activity}
                label="Avg Interval Between Rotations"
                value={analytics.avgInterval ? `${fmt(analytics.avgInterval)} km` : '-'}
                sub={`Target: ${fmt(interval)} km`}
                color="blue"
                delay={0.1}
              />
              <KpiCard
                icon={DollarSign}
                label="Est. Savings from Compliance"
                value={`${activeCurrency} ${fmt(analytics.costSavings)}`}
                sub="Annual cost benefit from regular rotation"
                color="green"
                delay={0.15}
              />
            </div>

            {/* ── Tab Navigation ───────────────────────────────────────────── */}
            <div className="flex gap-1 bg-gray-900 border border-gray-800 rounded-xl p-1.5 w-fit">
              {[
                { id: 'status',   label: 'Rotation Status',    icon: Truck      },
                { id: 'charts',   label: 'Compliance Charts',  icon: BarChart3  },
                { id: 'impact',   label: 'Tyre Life Impact',   icon: TrendingUp },
                { id: 'schedule', label: 'Upcoming Schedule',  icon: Calendar   },
              ].map(t => (
                <button
                  key={t.id}
                  onClick={() => setActiveTab(t.id)}
                  className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                    activeTab === t.id
                      ? 'bg-green-700 text-white'
                      : 'text-gray-400 hover:text-white hover:bg-gray-800'
                  }`}
                >
                  <t.icon size={14} />
                  {t.label}
                </button>
              ))}
            </div>

            {/* ═══════════════════════════════════════════════════════════════ */}
            {/* TAB: Status Table                                               */}
            {/* ═══════════════════════════════════════════════════════════════ */}
            <AnimatePresence mode="wait">
            {activeTab === 'status' && (
              <motion.div key="status" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="space-y-4">

                {/* Filters */}
                <div className="flex flex-col sm:flex-row gap-3">
                  <div className="relative flex-1 max-w-xs">
                    <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
                    <input
                      value={search}
                      onChange={e => { setSearch(e.target.value); setPage(1) }}
                      placeholder="Search asset or site..."
                      className="w-full bg-gray-900 border border-gray-800 rounded-lg pl-9 pr-3 py-2 text-sm text-white placeholder-gray-600 focus:outline-none focus:border-blue-500"
                    />
                  </div>
                  <select
                    value={siteFilter}
                    onChange={e => { setSiteFilter(e.target.value); setPage(1) }}
                    className="bg-gray-900 border border-gray-800 rounded-lg px-3 py-2 text-sm text-gray-300 focus:outline-none focus:border-blue-500"
                  >
                    {sites.map(s => <option key={s}>{s}</option>)}
                  </select>
                  <select
                    value={statusFilter}
                    onChange={e => { setStatusFilter(e.target.value); setPage(1) }}
                    className="bg-gray-900 border border-gray-800 rounded-lg px-3 py-2 text-sm text-gray-300 focus:outline-none focus:border-blue-500"
                  >
                    {['All', 'Overdue', 'Due Soon', 'On Schedule', 'No History'].map(s => <option key={s}>{s}</option>)}
                  </select>
                  <div className="text-sm text-gray-500 flex items-center">
                    {filteredVehicles.length} vehicles
                  </div>
                </div>

                {/* Table */}
                <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b border-gray-800 bg-gray-950">
                          {[
                            { key: 'asset', label: 'Asset' },
                            { key: 'site',  label: 'Site' },
                            { key: null,    label: 'Active Tyres' },
                            { key: null,    label: 'Last Rotation' },
                            { key: 'since', label: 'Since Last (km)' },
                            { key: 'dueIn', label: 'Due In (km)' },
                            { key: 'status', label: 'Status' },
                            { key: null,     label: 'Action' },
                          ].map(col => (
                            <th
                              key={col.label}
                              onClick={col.key ? () => toggleSort(col.key) : undefined}
                              className={`text-left text-xs text-gray-500 font-medium px-4 py-3 select-none ${col.key ? 'cursor-pointer hover:text-gray-300' : ''}`}
                            >
                              <span className="flex items-center gap-1">
                                {col.label}
                                {col.key && sortCol === col.key && (
                                  sortAsc ? <ChevronUp size={11} /> : <ChevronDown size={11} />
                                )}
                              </span>
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-800/60">
                        {paginatedVehicles.length === 0 ? (
                          <tr>
                            <td colSpan={8} className="text-center py-12 text-gray-500">No vehicles match the current filters</td>
                          </tr>
                        ) : paginatedVehicles.map((v, i) => (
                          <motion.tr
                            key={v.asset}
                            initial={{ opacity: 0 }}
                            animate={{ opacity: 1 }}
                            transition={{ delay: i * 0.015 }}
                            className="hover:bg-gray-800/40 transition-colors group"
                          >
                            <td className="px-4 py-3">
                              <button
                                onClick={() => setDrawerVehicle(v)}
                                className="flex items-center gap-2 text-blue-400 hover:text-blue-300 font-medium transition-colors"
                              >
                                <Truck size={13} />
                                {v.asset}
                                <ChevronRight size={12} className="opacity-0 group-hover:opacity-100 transition-opacity" />
                              </button>
                            </td>
                            <td className="px-4 py-3">
                              <span className="flex items-center gap-1.5 text-gray-300">
                                <MapPin size={12} className="text-gray-500" />
                                {v.site}
                              </span>
                            </td>
                            <td className="px-4 py-3 text-gray-300 text-center">{v.activeTyreCount}</td>
                            <td className="px-4 py-3 text-gray-300 text-xs">{fmtDate(v.lastRotationDate)}</td>
                            <td className="px-4 py-3">
                              {v.sinceLastKm != null ? (
                                <span className={v.sinceLastKm >= interval ? 'text-red-400 font-medium' : 'text-gray-300'}>
                                  {fmt(v.sinceLastKm)}
                                </span>
                              ) : <span className="text-gray-600">-</span>}
                            </td>
                            <td className="px-4 py-3">
                              {v.dueInKm != null ? (
                                <span className={v.dueInKm <= 0 ? 'text-red-400 font-medium' : v.dueInKm <= DUE_SOON_BUFFER ? 'text-yellow-400' : 'text-gray-300'}>
                                  {v.dueInKm <= 0 ? `${fmt(Math.abs(v.dueInKm))} overdue` : fmt(v.dueInKm)}
                                </span>
                              ) : <span className="text-gray-600">-</span>}
                            </td>
                            <td className="px-4 py-3"><StatusBadge status={v.status} /></td>
                            <td className="px-4 py-3">
                              <button
                                onClick={() => setModalVehicle(v)}
                                className="flex items-center gap-1.5 px-3 py-1.5 bg-green-900/30 hover:bg-green-800/50 border border-green-800 text-green-400 hover:text-green-300 rounded-lg text-xs font-medium transition-colors"
                              >
                                <Wrench size={11} />
                                Schedule
                              </button>
                            </td>
                          </motion.tr>
                        ))}
                      </tbody>
                    </table>
                  </div>

                  {/* Pagination */}
                  {totalPages > 1 && (
                    <div className="flex items-center justify-between px-4 py-3 border-t border-gray-800 bg-gray-950">
                      <span className="text-xs text-gray-500">
                        {(page - 1) * PAGE_SIZE + 1}-{Math.min(page * PAGE_SIZE, filteredVehicles.length)} of {filteredVehicles.length}
                      </span>
                      <div className="flex gap-2">
                        <button disabled={page === 1} onClick={() => setPage(p => p - 1)} className="p-1.5 rounded bg-gray-800 hover:bg-gray-700 disabled:opacity-30 transition-colors">
                          <ChevronDown size={13} className="rotate-90" />
                        </button>
                        <button disabled={page === totalPages} onClick={() => setPage(p => p + 1)} className="p-1.5 rounded bg-gray-800 hover:bg-gray-700 disabled:opacity-30 transition-colors">
                          <ChevronDown size={13} className="-rotate-90" />
                        </button>
                      </div>
                    </div>
                  )}
                </div>

                {/* Wear Balance Alert Panel */}
                {(() => {
                  const imbalanced = filteredVehicles.filter(v => v.wearImbalance != null && v.wearImbalance > WEAR_IMBALANCE_MM)
                  if (!imbalanced.length) return null
                  return (
                    <div className="bg-orange-900/20 border border-orange-800 rounded-xl p-5">
                      <div className="flex items-center gap-2 text-orange-400 font-semibold text-sm mb-3">
                        <AlertTriangle size={15} />
                        {imbalanced.length} Vehicle{imbalanced.length !== 1 ? 's' : ''} with Unbalanced Tyre Wear (&gt; {WEAR_IMBALANCE_MM}mm steer-drive difference)
                      </div>
                      <div className="flex flex-wrap gap-2">
                        {imbalanced.map(v => (
                          <button
                            key={v.asset}
                            onClick={() => setDrawerVehicle(v)}
                            className="flex items-center gap-2 px-3 py-1.5 bg-orange-900/30 border border-orange-700 rounded-lg text-xs text-orange-300 hover:text-orange-200 transition-colors"
                          >
                            <Truck size={11} />
                            {v.asset}
                            <span className="text-orange-500">Δ{v.wearImbalance.toFixed(1)}mm</span>
                          </button>
                        ))}
                      </div>
                    </div>
                  )
                })()}
              </motion.div>
            )}

            {/* ═══════════════════════════════════════════════════════════════ */}
            {/* TAB: Charts                                                     */}
            {/* ═══════════════════════════════════════════════════════════════ */}
            {activeTab === 'charts' && (
              <motion.div key="charts" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="space-y-6">
                <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
                  {/* Rotation Activity Trend */}
                  <div className="card">
                    <div className="flex items-center justify-between mb-4">
                      <h2 className="text-sm font-semibold text-white flex items-center gap-2">
                        <TrendingUp size={15} className="text-green-400" />
                        Monthly Rotation Activity
                      </h2>
                      <span className="text-xs text-gray-500">Last 12 months · Detected rotations</span>
                    </div>
                    {trendChartData ? (
                      <div className="h-64">
                        <Line
                          data={trendChartData}
                          options={{
                            ...CHART_DEFAULTS,
                            scales: {
                              ...CHART_DEFAULTS.scales,
                              y: { ...CHART_DEFAULTS.scales.y, min: 0, ticks: { ...CHART_DEFAULTS.scales.y.ticks, precision: 0 } },
                            },
                          }}
                        />
                      </div>
                    ) : (
                      <div className="h-64 flex items-center justify-center text-gray-500 text-sm">No rotation events detected in the last 12 months</div>
                    )}
                  </div>

                  {/* Site Compliance */}
                  <div className="card">
                    <div className="flex items-center justify-between mb-4">
                      <h2 className="text-sm font-semibold text-white flex items-center gap-2">
                        <Building2 size={15} className="text-blue-400" />
                        Site Compliance Comparison
                      </h2>
                    </div>
                    {siteChartData ? (
                      <div className="h-64">
                        <Bar
                          data={siteChartData}
                          options={{
                            ...CHART_DEFAULTS,
                            indexAxis: 'y',
                            scales: {
                              x: { ...CHART_DEFAULTS.scales.x, min: 0, max: 100, ticks: { ...CHART_DEFAULTS.scales.x.ticks, callback: v => `${v}%` } },
                              y: { ...CHART_DEFAULTS.scales.y },
                            },
                            plugins: { ...CHART_DEFAULTS.plugins, legend: { display: false } },
                          }}
                        />
                      </div>
                    ) : (
                      <div className="h-64 flex items-center justify-center text-gray-500 text-sm">No site data available</div>
                    )}
                  </div>
                </div>

                {/* Status Distribution */}
                <div className="card">
                  <h2 className="text-sm font-semibold text-white mb-4 flex items-center gap-2">
                    <Layers size={15} className="text-purple-400" />
                    Fleet Status Distribution
                  </h2>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                    {Object.entries(STATUS_CFG).map(([status, cfg]) => {
                      const count = analytics.vehicles.filter(v => v.status === status).length
                      const pct   = analytics.total > 0 ? Math.round((count / analytics.total) * 100) : 0
                      return (
                        <div key={status} className={`rounded-xl border ${cfg.border} ${cfg.bg} p-4`}>
                          <div className={`text-2xl font-bold ${cfg.color}`}>{count}</div>
                          <div className="text-xs text-gray-400 mt-1">{status}</div>
                          <div className="mt-2 h-1.5 rounded-full bg-gray-700">
                            <div className={`h-full rounded-full ${cfg.dot}`} style={{ width: `${pct}%` }} />
                          </div>
                          <div className="text-xs text-gray-500 mt-1">{pct}%</div>
                        </div>
                      )
                    })}
                  </div>
                </div>
              </motion.div>
            )}

            {/* ═══════════════════════════════════════════════════════════════ */}
            {/* TAB: Tyre Life Impact                                           */}
            {/* ═══════════════════════════════════════════════════════════════ */}
            {activeTab === 'impact' && (
              <motion.div key="impact" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="space-y-6">
                <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
                  {/* Life comparison chart */}
                  <div className="card">
                    <h2 className="text-sm font-semibold text-white mb-4 flex items-center gap-2">
                      <BarChart3 size={15} className="text-green-400" />
                      Tyre Life: Rotated vs Non-Rotated
                    </h2>
                    {impactChartData ? (
                      <div className="h-64">
                        <Bar
                          data={impactChartData}
                          options={{
                            ...CHART_DEFAULTS,
                            plugins: { ...CHART_DEFAULTS.plugins, legend: { display: false } },
                            scales: {
                              ...CHART_DEFAULTS.scales,
                              y: { ...CHART_DEFAULTS.scales.y, ticks: { ...CHART_DEFAULTS.scales.y.ticks, callback: v => `${(v / 1000).toFixed(0)}k` } },
                            },
                          }}
                        />
                      </div>
                    ) : (
                      <div className="h-64 flex items-center justify-center text-gray-500 text-sm">Insufficient removal records to compare tyre life</div>
                    )}
                  </div>

                  {/* Impact metrics */}
                  <div className="card space-y-4">
                    <h2 className="text-sm font-semibold text-white flex items-center gap-2">
                      <DollarSign size={15} className="text-yellow-400" />
                      Rotation Impact Analysis
                    </h2>
                    {analytics.avgLifeWith && analytics.avgLifeWithout ? (
                      <>
                        <div className="grid grid-cols-2 gap-4">
                          <div className="bg-green-900/20 border border-green-800 rounded-lg p-4">
                            <div className="text-xs text-green-400 mb-1">With Regular Rotation</div>
                            <div className="text-xl font-bold text-green-300">{fmt(analytics.avgLifeWith)} km</div>
                            <div className="text-xs text-gray-400 mt-1">avg tyre life</div>
                          </div>
                          <div className="bg-red-900/20 border border-red-800 rounded-lg p-4">
                            <div className="text-xs text-red-400 mb-1">No Rotation Detected</div>
                            <div className="text-xl font-bold text-red-300">{fmt(analytics.avgLifeWithout)} km</div>
                            <div className="text-xs text-gray-400 mt-1">avg tyre life</div>
                          </div>
                        </div>
                        {analytics.avgLifeWith > analytics.avgLifeWithout && (
                          <div className="bg-blue-900/20 border border-blue-800 rounded-lg p-4">
                            <div className="text-sm font-medium text-blue-300 mb-1 flex items-center gap-2">
                              <TrendingUp size={14} />
                              {fmt(analytics.avgLifeWith - analytics.avgLifeWithout)} km longer life with rotation
                            </div>
                            <div className="text-xs text-gray-400">
                              +{Math.round(((analytics.avgLifeWith - analytics.avgLifeWithout) / analytics.avgLifeWithout) * 100)}% improvement ·
                              Saves approx {activeCurrency} {fmt(Math.round(((analytics.avgLifeWith - analytics.avgLifeWithout) / analytics.avgLifeWith) * analytics.effCost))} per tyre
                            </div>
                          </div>
                        )}
                      </>
                    ) : (
                      <div className="flex items-center gap-2 text-gray-500 text-sm py-6 justify-center">
                        <Info size={14} />
                        Tyre removal (km_at_removal) data required for life comparison
                      </div>
                    )}

                    {/* Cost savings breakdown */}
                    <div className="border-t border-gray-800 pt-4 space-y-2">
                      <div className="text-xs text-gray-400 font-medium">Estimated Annual Savings</div>
                      <div className="flex items-center justify-between text-sm">
                        <span className="text-gray-400">Fleet size</span>
                        <span className="text-white">{analytics.total} vehicles</span>
                      </div>
                      <div className="flex items-center justify-between text-sm">
                        <span className="text-gray-400">Avg tyre cost</span>
                        <span className="text-white">{activeCurrency} {fmt(analytics.effCost)}</span>
                      </div>
                      <div className="flex items-center justify-between text-sm">
                        <span className="text-gray-400">Rotation benefit factor</span>
                        <span className="text-white">30%</span>
                      </div>
                      <div className="flex items-center justify-between text-sm font-semibold border-t border-gray-800 pt-2">
                        <span className="text-gray-300">Total est. savings</span>
                        <span className="text-green-400">{activeCurrency} {fmt(analytics.costSavings)}</span>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Position Wear Balance Analysis */}
                <div className="card">
                  <h2 className="text-sm font-semibold text-white mb-4 flex items-center gap-2">
                    <Gauge size={15} className="text-orange-400" />
                    Position Wear Balance Analysis
                    <span className="text-xs text-gray-500 font-normal ml-2">Vehicles with &gt; {WEAR_IMBALANCE_MM}mm steer-drive imbalance</span>
                  </h2>
                  {(() => {
                    const imbalanced = analytics.vehicles.filter(v => v.wearImbalance != null && v.wearImbalance > WEAR_IMBALANCE_MM)
                      .sort((a, b) => b.wearImbalance - a.wearImbalance)
                      .slice(0, 20)
                    if (!imbalanced.length) return (
                      <div className="text-center py-8 text-green-400 text-sm flex items-center justify-center gap-2">
                        <CheckCircle size={16} />
                        All vehicles within acceptable wear balance range
                      </div>
                    )
                    return (
                      <div className="overflow-x-auto">
                        <table className="w-full text-sm">
                          <thead>
                            <tr className="border-b border-gray-800">
                              {['Asset', 'Site', 'Steer Tread', 'Drive Tread', 'Imbalance', 'Priority'].map(h => (
                                <th key={h} className="text-left text-xs text-gray-500 font-medium pb-2 pr-4">{h}</th>
                              ))}
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-gray-800">
                            {imbalanced.map(v => (
                              <tr key={v.asset} className="hover:bg-gray-800/30 transition-colors">
                                <td className="py-2.5 pr-4">
                                  <button onClick={() => setDrawerVehicle(v)} className="text-blue-400 hover:text-blue-300 font-medium flex items-center gap-1.5">
                                    <Truck size={12} /> {v.asset}
                                  </button>
                                </td>
                                <td className="py-2.5 pr-4 text-gray-300">{v.site}</td>
                                <td className="py-2.5 pr-4 text-blue-400">{v.steerTread?.toFixed(1) ?? '-'} mm</td>
                                <td className="py-2.5 pr-4 text-red-400">{v.driveTread?.toFixed(1) ?? '-'} mm</td>
                                <td className="py-2.5 pr-4">
                                  <span className={`font-semibold ${v.wearImbalance > 6 ? 'text-red-400' : 'text-orange-400'}`}>
                                    Δ{v.wearImbalance.toFixed(1)} mm
                                  </span>
                                </td>
                                <td className="py-2.5 pr-4">
                                  <button
                                    onClick={() => setModalVehicle(v)}
                                    className="text-xs px-2 py-1 rounded bg-orange-900/30 border border-orange-700 text-orange-400 hover:text-orange-300 transition-colors"
                                  >
                                    Schedule Rotation
                                  </button>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )
                  })()}
                </div>
              </motion.div>
            )}

            {/* ═══════════════════════════════════════════════════════════════ */}
            {/* TAB: Upcoming Schedule                                          */}
            {/* ═══════════════════════════════════════════════════════════════ */}
            {activeTab === 'schedule' && (
              <motion.div key="schedule" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="space-y-5">

                <div className="flex items-center justify-between">
                  <h2 className="text-sm font-semibold text-white flex items-center gap-2">
                    <Calendar size={15} className="text-blue-400" />
                    Scheduled Rotations ({schedules.length})
                  </h2>
                  <div className="flex gap-2">
                    <button
                      onClick={() => {
                        const upcomingVehicles = analytics.vehicles.filter(v => v.status === 'Overdue' || v.status === 'Due Soon')
                        const today = new Date()
                        const newEntries = upcomingVehicles
                          .filter(v => !schedules.find(s => s.asset === v.asset && s.status === 'Open'))
                          .map((v, i) => ({
                            asset: v.asset,
                            site: v.site,
                            scheduledDate: (() => { const d = new Date(today); d.setDate(d.getDate() + 3 + i * 2); return d.toISOString().slice(0, 10) })(),
                            priority: v.status === 'Overdue' ? 'Critical' : 'High',
                            notes: `Auto-scheduled. ${v.status === 'Overdue' ? `Overdue by ${fmt(v.sinceLastKm - interval)} km.` : `Due in ${fmt(v.dueInKm)} km.`}`,
                            currentKm: v.currentKm,
                            status: 'Open',
                          }))
                        createSchedules(newEntries)
                      }}
                      disabled={schedBusy}
                      className="btn-primary gap-2"
                    >
                      <RotateCcw size={13} />
                      Auto-Schedule Overdue & Due Soon
                    </button>
                  </div>
                </div>

                {schedError ? (
                  <div className="bg-red-900/20 border border-red-800 rounded-xl p-8 text-center space-y-3">
                    <AlertOctagon size={28} className="text-red-400 mx-auto" />
                    <p className="text-red-300 font-medium">Failed to load schedule</p>
                    <p className="text-red-400/70 text-sm">{schedError}</p>
                    <button onClick={fetchSchedules} className="px-4 py-2 bg-red-700 hover:bg-red-600 text-white rounded-lg text-sm transition-colors">
                      Retry
                    </button>
                  </div>
                ) : schedLoading ? (
                  <div className="card p-12 text-center">
                    <RotateCcw size={32} className="text-blue-400 animate-spin mx-auto mb-3" />
                    <p className="text-gray-400 text-sm">Loading scheduled rotations...</p>
                  </div>
                ) : schedules.length === 0 ? (
                  <div className="card p-12 text-center">
                    <Calendar size={40} className="text-gray-600 mx-auto mb-3" />
                    <p className="text-gray-400 font-medium">No rotations scheduled yet</p>
                    <p className="text-gray-500 text-sm mt-1">Click "Schedule" on overdue vehicles or use auto-schedule above.</p>
                  </div>
                ) : (
                  <>
                    {/* Group by priority */}
                    {['Critical', 'High', 'Medium', 'Low'].map(priority => {
                      const group = schedules.filter(s => s.priority === priority && s.status === 'Open')
                      if (!group.length) return null
                      const prioColors = {
                        Critical: 'text-red-400 border-red-800 bg-red-900/20',
                        High:     'text-orange-400 border-orange-800 bg-orange-900/20',
                        Medium:   'text-yellow-400 border-yellow-800 bg-yellow-900/20',
                        Low:      'text-blue-400 border-blue-800 bg-blue-900/20',
                      }
                      return (
                        <div key={priority} className={`border rounded-xl overflow-hidden ${prioColors[priority]}`}>
                          <div className={`px-5 py-3 flex items-center gap-2 text-sm font-semibold border-b ${prioColors[priority]}`}>
                            <AlertOctagon size={13} />
                            {priority} Priority ({group.length})
                          </div>
                          <div className="divide-y divide-gray-800/50">
                            {group.sort((a, b) => new Date(a.scheduledDate) - new Date(b.scheduledDate)).map(s => (
                              <div key={s.id} className="flex items-center gap-4 px-5 py-3 bg-gray-900 hover:bg-gray-800/50 transition-colors">
                                <div className="flex-1 grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm">
                                  <div>
                                    <div className="text-xs text-gray-500">Asset</div>
                                    <div className="text-white font-medium flex items-center gap-1.5">
                                      <Truck size={12} className="text-blue-400" /> {s.asset}
                                    </div>
                                  </div>
                                  <div>
                                    <div className="text-xs text-gray-500">Site</div>
                                    <div className="text-gray-300">{s.site}</div>
                                  </div>
                                  <div>
                                    <div className="text-xs text-gray-500">Scheduled Date</div>
                                    <div className="text-gray-300">{fmtDate(s.scheduledDate)}</div>
                                  </div>
                                  <div>
                                    <div className="text-xs text-gray-500">Notes</div>
                                    <div className="text-gray-400 text-xs truncate max-w-xs">{s.notes || '-'}</div>
                                  </div>
                                </div>
                                <div className="flex items-center gap-2 flex-shrink-0">
                                  <button
                                    onClick={() => updateScheduleStatus(s.id, 'Completed')}
                                    disabled={schedBusy}
                                    className="p-1.5 bg-green-900/30 hover:bg-green-800/50 border border-green-800 text-green-400 rounded-lg transition-colors disabled:opacity-50"
                                    title="Mark completed"
                                  >
                                    <CheckCircle size={13} />
                                  </button>
                                  <button
                                    onClick={() => removeSchedule(s.id)}
                                    disabled={schedBusy}
                                    className="p-1.5 bg-gray-800 hover:bg-red-900/30 border border-gray-700 hover:border-red-700 text-gray-400 hover:text-red-400 rounded-lg transition-colors disabled:opacity-50"
                                    title="Remove"
                                  >
                                    <X size={13} />
                                  </button>
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>
                      )
                    })}

                    {/* Completed */}
                    {schedules.filter(s => s.status === 'Completed').length > 0 && (
                      <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
                        <div className="px-5 py-3 text-sm font-semibold text-gray-400 border-b border-gray-800 flex items-center gap-2">
                          <CheckCircle size={13} className="text-green-400" />
                          Completed ({schedules.filter(s => s.status === 'Completed').length})
                        </div>
                        <div className="divide-y divide-gray-800/50">
                          {schedules.filter(s => s.status === 'Completed').map(s => (
                            <div key={s.id} className="flex items-center gap-4 px-5 py-3 opacity-60">
                              <div className="flex-1 grid grid-cols-1 sm:grid-cols-3 gap-3 text-sm">
                                <div className="flex items-center gap-1.5 text-gray-400">
                                  <Truck size={12} /> {s.asset}
                                </div>
                                <div className="text-gray-500">{s.site}</div>
                                <div className="text-gray-500">{fmtDate(s.scheduledDate)}</div>
                              </div>
                              <button onClick={() => removeSchedule(s.id)} disabled={schedBusy} className="p-1.5 text-gray-600 hover:text-gray-400 transition-colors disabled:opacity-50">
                                <X size={12} />
                              </button>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </>
                )}
              </motion.div>
            )}
            </AnimatePresence>
          </>
        )}

      {/* ── Drawers / Modals ─────────────────────────────────────────────────── */}
      {drawerVehicle && (
        <RotationDrawer vehicle={drawerVehicle} onClose={() => setDrawerVehicle(null)} />
      )}
      {modalVehicle && (
        <ScheduleModal
          vehicle={modalVehicle}
          onClose={() => setModalVehicle(null)}
          onSave={entry => createSchedules([entry])}
        />
      )}
    </div>
  )
}
