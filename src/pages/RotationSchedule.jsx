// ─────────────────────────────────────────────────────────────────────────────
// RotationSchedule.jsx - Tyre Rotation Compliance Tracker · /rotation
// All figures come from src/lib/rotationScheduleAnalytics.js.
// ─────────────────────────────────────────────────────────────────────────────
import { useState, useEffect, useMemo, useCallback } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  Chart as ChartJS,
  CategoryScale, LinearScale, BarElement, LineElement, PointElement,
  ArcElement, Title, Tooltip, Legend, Filler,
} from 'chart.js'
import { Bar, Line } from 'react-chartjs-2'
import {
  RotateCcw, AlertTriangle, CheckCircle, TrendingUp,
  FileText, RefreshCw, X, Search, Building2, Truck, Layers,
  DollarSign, Settings2, Calendar, ArrowRight, Info,
  AlertOctagon, Gauge, Activity, Wrench,
  FileSpreadsheet, BarChart3, Target, Lock, ShieldCheck, HelpCircle,
} from 'lucide-react'
import { supabase } from '../lib/supabase'
import * as rotations from '../lib/api/rotations'
import { useSettings } from '../contexts/SettingsContext'
import { useTenant } from '../contexts/TenantContext'
import {
  resolvePdfBrand, pdfHeader, pdfFooter, pdfEmptyState, pdfTableTheme,
  exportSheetsToExcel, reportFileName, reportDateLabel,
} from '../lib/exportUtils'
import PageHeader from '../components/ui/PageHeader'
import Card, { CardHeader } from '../components/ui/Card'
import Modal from '../components/ui/Modal'
import EnterpriseTable from '../components/ui/EnterpriseTable'
import EntityApprovalPanel from '../components/workflow/EntityApprovalPanel'
import EmptyState from '../components/EmptyState'
import { formatDate } from '../lib/formatters'
import { toUserMessage } from '../lib/safeError'
import { loadAutoTable } from '../lib/pdfEngine'
import { colorAt, withAlpha } from '../lib/reportColors'
import {
  buildRotationAnalytics, filterVehicles, autoScheduleEntries, scheduleSummary, normPos,
  DEFAULT_INTERVAL, MIN_INTERVAL, MAX_INTERVAL, DUE_SOON_BUFFER, WEAR_IMBALANCE_MM, LOW_TREAD_MM,
  STATUSES, URGENCY_ORDER, PRIORITIES,
} from '../lib/rotationScheduleAnalytics'

ChartJS.register(
  CategoryScale, LinearScale, BarElement, LineElement, PointElement,
  ArcElement, Title, Tooltip, Legend, Filler,
)

const CHART_DEFAULTS = {
  responsive: true,
  maintainAspectRatio: false,
  plugins: {
    legend: { labels: { color: 'var(--text-muted)', boxWidth: 12, font: { size: 11 } } },
    tooltip: {
      backgroundColor: 'var(--panel)',
      borderColor: 'var(--hairline)',
      borderWidth: 1,
      titleColor: 'var(--text-primary)',
      bodyColor: 'var(--text-secondary)',
    },
  },
  scales: {
    x: { ticks: { color: 'var(--text-muted)', font: { size: 11 } }, grid: { color: 'var(--panel-2)' } },
    y: { ticks: { color: 'var(--text-muted)', font: { size: 11 } }, grid: { color: 'var(--panel-2)' } },
  },
}

// Semantic status colours (the colour carries meaning; each badge also carries
// the status word and a distinct icon, so colour is never the only signal).
const STATUS_CFG = {
  'On Schedule': { color: 'text-green-400', bg: 'bg-green-900/30', border: 'border-green-700', bar: 'bg-green-500', Icon: CheckCircle },
  'Due Soon': { color: 'text-yellow-400', bg: 'bg-yellow-900/30', border: 'border-yellow-700', bar: 'bg-yellow-500', Icon: AlertTriangle },
  Overdue: { color: 'text-red-400', bg: 'bg-red-900/30', border: 'border-red-700', bar: 'bg-red-500', Icon: AlertOctagon },
  Unmeasured: { color: 'text-sky-300', bg: 'bg-sky-900/30', border: 'border-sky-700', bar: 'bg-sky-500', Icon: HelpCircle },
  'No History': { color: 'text-[var(--text-muted)]', bg: 'bg-[var(--input-bg)]', border: 'border-[var(--input-border)]', bar: 'bg-[var(--text-dim)]', Icon: Info },
}
const PRIORITY_TONE = {
  Critical: 'text-red-400', High: 'text-orange-400', Medium: 'text-yellow-400', Low: 'text-[var(--text-secondary)]',
}

const BTN = 'inline-flex items-center justify-center gap-2 min-h-[44px] px-3 py-2 bg-[var(--input-bg)] hover:bg-[var(--input-bg-hover)] border border-[var(--input-border)] rounded-lg text-[var(--text-secondary)] text-sm transition-colors disabled:opacity-40 focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]'
const ICON_BTN = 'inline-flex items-center justify-center w-11 h-11 bg-[var(--input-bg)] hover:bg-[var(--input-bg-hover)] border border-[var(--input-border)] rounded-lg text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors disabled:opacity-40 disabled:cursor-not-allowed focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]'
const FIELD = 'min-h-[44px] w-full bg-[var(--input-bg)] border border-[var(--input-border)] rounded-lg px-3 py-2 text-[var(--text-primary)] text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]'

// ── Helpers (honest: null renders N/A) ────────────────────────────────────────
function fmt(n, dec = 0) {
  if (n == null || !Number.isFinite(Number(n))) return 'N/A'
  return Number(n).toLocaleString('en-US', { minimumFractionDigits: dec, maximumFractionDigits: dec })
}
function fmtDate(d) {
  if (!d) return 'N/A'
  return formatDate(d, 'All', { day: '2-digit', month: 'short', year: 'numeric' })
}
const fmtKm = (n) => (n == null ? 'N/A' : `${fmt(n)} km`)

function KpiCard({ icon: Icon, label, value, sub, tone = 'text-[var(--text-primary)]' }) {
  return (
    <div className="rounded-xl border border-[var(--input-border)] bg-[var(--surface-1)] p-4 flex flex-col gap-2 min-w-0">
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs text-[var(--text-muted)] uppercase tracking-wider">{label}</span>
        <Icon size={16} className="text-[var(--text-muted)] shrink-0" aria-hidden="true" />
      </div>
      <div className={`text-2xl font-bold tabular-nums truncate ${tone}`}>{value}</div>
      {sub && <div className="text-xs text-[var(--text-muted)]">{sub}</div>}
    </div>
  )
}

function StatusBadge({ status }) {
  const cfg = STATUS_CFG[status] || STATUS_CFG['No History']
  const { Icon } = cfg
  return (
    <span className={`inline-flex items-center gap-1.5 text-xs px-2 py-1 rounded-full border ${cfg.bg} ${cfg.border} ${cfg.color}`}>
      <Icon size={11} aria-hidden="true" />
      {status}
    </span>
  )
}

// ── Rotation History Drawer ────────────────────────────────────────────────────
// DELIBERATELY NOT `Modal`: a full-height right-hand rail on the
// `tp-drawer-panel` contract (`.fixed.inset-0 > .tp-drawer-panel`), which
// `dialogFit.test.jsx` pins. Same call WorkOrders and RepairRequests made.
function RotationDrawer({ vehicle, onClose }) {
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const tyreColumns = useMemo(() => [
    { id: 'serial', header: 'Serial', accessorFn: (t) => t.serial_number || t.serial_no || '', cell: ({ getValue }) => <span className="font-mono">{getValue() || 'N/A'}</span> },
    { id: 'position', header: 'Position', accessorFn: (t) => normPos(t.position) },
    { id: 'brand', header: 'Brand', accessorFn: (t) => t.brand || '', cell: ({ getValue }) => getValue() || 'N/A' },
    {
      id: 'tread', header: 'Tread (mm)', accessorFn: (t) => { const n = Number(t.tread_depth); return Number.isFinite(n) && t.tread_depth !== null && t.tread_depth !== '' ? n : -1 },
      meta: { align: 'right' },
      cell: ({ getValue }) => {
        const v = getValue()
        if (v < 0) return <span className="text-[var(--text-dim)]">N/A</span>
        return <span className={`tabular-nums font-medium ${v < LOW_TREAD_MM ? 'text-red-400' : ''}`}>{v.toFixed(1)}{v < LOW_TREAD_MM ? ' low' : ''}</span>
      },
    },
    { id: 'km', header: 'Fitted km', accessorFn: (t) => Number(t.km_at_fitment) || -1, meta: { align: 'right' }, cell: ({ getValue }) => <span className="tabular-nums">{getValue() < 0 ? 'N/A' : fmt(getValue())}</span> },
  ], [])

  if (!vehicle) return null
  const treadPositions = ['Steer', 'Drive', 'Trailer', 'Lift', 'Tag']

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
          role="dialog"
          aria-modal="true"
          aria-labelledby="rotation-drawer-title"
          initial={{ x: '100%' }}
          animate={{ x: 0 }}
          exit={{ x: '100%' }}
          transition={{ type: 'spring', damping: 30, stiffness: 300 }}
          className="tp-drawer-panel w-full max-w-2xl h-full bg-[var(--surface-1)] border-l border-[var(--input-border)] overflow-y-auto"
          onClick={e => e.stopPropagation()}
        >
          <div className="flex items-center justify-between gap-3 p-4 sm:p-6 border-b border-[var(--input-border)] sticky top-0 bg-[var(--surface-1)] z-10">
            <div className="min-w-0">
              <h2 id="rotation-drawer-title" className="flex items-center gap-2 text-[var(--text-primary)] font-semibold text-lg">
                <Truck size={18} className="text-[var(--text-muted)]" aria-hidden="true" />
                {vehicle.asset}
              </h2>
              <div className="text-sm text-[var(--text-muted)] mt-0.5 flex flex-wrap items-center gap-2">
                {vehicle.site}, rotation history <StatusBadge status={vehicle.status} />
              </div>
            </div>
            <button type="button" onClick={onClose} aria-label="Close rotation history" className={ICON_BTN}>
              <X size={18} aria-hidden="true" />
            </button>
          </div>

          <div className="p-4 sm:p-6 space-y-6">
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm">
              {[
                ['Latest odometer', fmtKm(vehicle.currentKm)],
                ['Last rotation', fmtDate(vehicle.lastRotationDate)],
                ['Since rotation', fmtKm(vehicle.sinceLastKm)],
                ['Rotations', fmt(vehicle.totalRotations)],
              ].map(([k, v]) => (
                <div key={k} className="bg-[var(--input-bg)] rounded-lg p-3">
                  <div className="text-xs text-[var(--text-muted)]">{k}</div>
                  <div className="font-semibold tabular-nums text-[var(--text-primary)]">{v}</div>
                </div>
              ))}
            </div>

            <Card>
              <CardHeader title="Tread depth by position" icon={Gauge} />
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                {treadPositions.map(pos => {
                  const depths = vehicle.treadByPos?.[pos]
                  const avg = depths ? depths.reduce((s, v) => s + v, 0) / depths.length : null
                  const isLow = avg != null && avg < LOW_TREAD_MM
                  return (
                    <div key={pos} className="bg-[var(--input-bg)] rounded-lg p-3">
                      <div className="text-xs text-[var(--text-muted)] mb-1">{pos}</div>
                      {avg != null ? (
                        <>
                          <div className={`text-lg font-bold tabular-nums ${isLow ? 'text-red-400' : 'text-[var(--text-primary)]'}`}>
                            {avg.toFixed(1)} mm{isLow ? ' low' : ''}
                          </div>
                          <div className="mt-2 h-1.5 rounded-full bg-[var(--input-border)]" aria-hidden="true">
                            <div className={`h-full rounded-full ${isLow ? 'bg-red-500' : 'bg-green-500'}`} style={{ width: `${Math.min(100, (avg / 12) * 100)}%` }} />
                          </div>
                        </>
                      ) : (
                        <div className="text-sm text-[var(--text-muted)]">Not measured</div>
                      )}
                    </div>
                  )
                })}
              </div>
              {vehicle.wearImbalance != null && vehicle.wearImbalance > WEAR_IMBALANCE_MM && (
                <div role="status" className="mt-3 flex items-center gap-2 text-xs text-orange-400 bg-orange-900/20 border border-orange-800 rounded-lg px-3 py-2">
                  <AlertTriangle size={13} aria-hidden="true" />
                  Steer to drive tread imbalance of {vehicle.wearImbalance.toFixed(1)} mm. Rotation recommended.
                </div>
              )}
            </Card>

            <Card>
              <CardHeader title="Detected rotation events" icon={RotateCcw} />
              {vehicle.rotationEvents.length === 0 ? (
                <div className="text-center py-6 text-[var(--text-muted)] text-sm">No rotation detected for this vehicle. A rotation shows up when the same serial is recorded at a different axle group.</div>
              ) : (
                <ol className="space-y-3">
                  {vehicle.rotationEvents.map((ev, i) => (
                    <li key={i} className="flex items-start gap-3">
                      <div className="mt-1 flex-shrink-0 w-6 h-6 rounded-full bg-[var(--input-bg)] border border-[var(--input-border)] flex items-center justify-center">
                        <RotateCcw size={11} className="text-[var(--text-muted)]" aria-hidden="true" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-sm text-[var(--text-primary)] font-medium font-mono">{ev.serial}</span>
                          <span className="text-xs text-[var(--text-muted)]">{fmtDate(ev.date)}</span>
                        </div>
                        <div className="flex items-center gap-2 mt-1 text-xs">
                          <span className="px-2 py-0.5 rounded border border-[var(--input-border)] bg-[var(--input-bg)]">{ev.from}</span>
                          <ArrowRight size={12} className="text-[var(--text-muted)]" aria-label="moved to" />
                          <span className="px-2 py-0.5 rounded border border-[var(--input-border)] bg-[var(--input-bg)]">{ev.to}</span>
                          <span className="text-[var(--text-muted)]">{ev.km != null ? `at ${fmt(ev.km)} km` : 'odometer not recorded'}</span>
                        </div>
                      </div>
                    </li>
                  ))}
                </ol>
              )}
            </Card>

            <Card>
              <CardHeader title={`Active tyres (${vehicle.activeTyreCount})`} icon={Layers} />
              <EnterpriseTable
                columns={tyreColumns}
                data={vehicle.activeTyres}
                getRowId={(t) => String(t.id)}
                enableGlobalFilter={false}
                enableColumnFilters={false}
                enableColumnVisibility={false}
                enableExport={false}
                initialPageSize={25}
                pageSizeOptions={[25, 50]}
                emptyMessage="No active tyres with a serial on this vehicle"
              />
            </Card>
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  )
}

// ── Schedule Rotation Modal ────────────────────────────────────────────────────
function ScheduleModal({ vehicle, onClose, onSave }) {
  const [notes, setNotes] = useState('')
  const [date, setDate] = useState(() => {
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
      site: vehicle.site,
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

  // One guarded close for every path (Escape, backdrop, X, Cancel).
  const close = () => { if (!saving) onClose() }

  return (
    <Modal
      open
      onClose={close}
      size="md"
      title={
        <span className="flex items-center gap-2">
          <RotateCcw size={16} className="text-[var(--text-muted)]" aria-hidden="true" />
          Schedule rotation for {vehicle?.asset}
        </span>
      }
      footer={
        <>
          <button type="button" onClick={close} disabled={saving} className="btn-secondary flex-1">
            Cancel
          </button>
          <button type="button" onClick={handleSave} disabled={saving || !date} className="btn-primary flex-1">
            {saving ? 'Saving' : 'Save to schedule'}
          </button>
        </>
      }
    >
      <div className="space-y-4">
        <div>
          <label htmlFor="rot-date" className="block text-xs text-[var(--text-muted)] mb-1.5">Scheduled date</label>
          <input id="rot-date" type="date" value={date} onChange={e => setDate(e.target.value)} className={FIELD} />
        </div>
        <div>
          <label htmlFor="rot-priority" className="block text-xs text-[var(--text-muted)] mb-1.5">Priority</label>
          <select id="rot-priority" value={priority} onChange={e => setPriority(e.target.value)} className={FIELD}>
            {PRIORITIES.map(p => <option key={p} value={p}>{p}</option>)}
          </select>
        </div>
        <div>
          <label htmlFor="rot-notes" className="block text-xs text-[var(--text-muted)] mb-1.5">Notes</label>
          <textarea
            id="rot-notes"
            value={notes}
            onChange={e => setNotes(e.target.value)}
            rows={3}
            placeholder="Optional workshop notes"
            className={`${FIELD} resize-none`}
          />
        </div>
        <dl className="bg-[var(--input-bg)] rounded-lg p-3 grid grid-cols-2 gap-3 text-xs">
          <div><dt className="text-[var(--text-muted)]">Latest odometer</dt><dd className="text-[var(--text-primary)] font-medium">{fmtKm(vehicle?.currentKm)}</dd></div>
          <div><dt className="text-[var(--text-muted)]">Site</dt><dd className="text-[var(--text-primary)] font-medium">{vehicle?.site}</dd></div>
          <div><dt className="text-[var(--text-muted)]">Status</dt><dd><StatusBadge status={vehicle?.status} /></dd></div>
          <div><dt className="text-[var(--text-muted)]">Since last rotation</dt><dd className="text-[var(--text-primary)] font-medium">{fmtKm(vehicle?.sinceLastKm)}</dd></div>
        </dl>
      </div>
    </Modal>
  )
}

const TABS = [
  { id: 'status', label: 'Rotation status', icon: Truck },
  { id: 'charts', label: 'Compliance charts', icon: BarChart3 },
  { id: 'impact', label: 'Tyre life impact', icon: TrendingUp },
  { id: 'schedule', label: 'Upcoming schedule', icon: Calendar },
]

// ── Main Component ─────────────────────────────────────────────────────────────
export default function RotationSchedule() {
  const { appSettings, activeCurrency, activeCountry } = useSettings()
  const { branding } = useTenant()
  const company = branding?.legal_name || branding?.display_name || appSettings?.company_name || 'TyrePulse'

  const [records, setRecords] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [interval, setInterval] = useState(DEFAULT_INTERVAL)
  const [search, setSearch] = useState('')
  const [siteFilter, setSiteFilter] = useState('All')
  const [statusFilter, setStatusFilter] = useState('All')
  const [drawerVehicle, setDrawerVehicle] = useState(null)
  const [modalVehicle, setModalVehicle] = useState(null)
  const [schedules, setSchedules] = useState([])
  const [schedLoading, setSchedLoading] = useState(true)
  const [schedError, setSchedError] = useState(null)
  const [schedBusy, setSchedBusy] = useState(false)
  const [pendingRemoveId, setPendingRemoveId] = useState(null)
  const [schedStatusFilter, setSchedStatusFilter] = useState('Open')
  // Approval-engine gate: while the open schedule's workflow is active or
  // locked, completing it is blocked.
  const [detailSchedule, setDetailSchedule] = useState(null)
  const [wfLocked, setWfLocked] = useState(false)
  useEffect(() => { setWfLocked(false) }, [detailSchedule?.id])
  useEffect(() => {
    if (!detailSchedule) return undefined
    const onKey = (e) => { if (e.key === 'Escape') setDetailSchedule(null) }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [detailSchedule])
  const [activeTab, setActiveTab] = useState('status')

  // ── Data fetch ─────────────────────────────────────────────────────────────
  const fetchData = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const data = await rotations.listRotationRecords({ country: activeCountry })
      setRecords(data || [])
    } catch (e) {
      setError(toUserMessage(e, 'Failed to load rotation data'))
    } finally {
      setLoading(false)
    }
  }, [activeCountry])

  useEffect(() => { fetchData() }, [fetchData])

  // DB rows are snake_case; the UI and exports consume a camelCase shape.
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
      setSchedError(toUserMessage(e, 'Failed to load schedule'))
    } finally {
      setSchedLoading(false)
    }
  }, [activeCountry, mapRow])

  useEffect(() => { fetchSchedules() }, [fetchSchedules])

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
      setSchedError(toUserMessage(e, 'Failed to save schedule'))
    } finally {
      setSchedBusy(false)
    }
  }, [activeCountry, fetchSchedules])

  const updateScheduleStatus = useCallback(async (id, status) => {
    if (detailSchedule?.id === id && wfLocked) {
      setSchedError('This rotation is locked. An approval is in progress for it.')
      return
    }
    setSchedBusy(true)
    setSchedError(null)
    try {
      await rotations.updateRotation(id, { status, updated_at: new Date().toISOString() })
      await fetchSchedules()
    } catch (e) {
      setSchedError(toUserMessage(e, 'Failed to update schedule'))
    } finally {
      setSchedBusy(false)
    }
  }, [fetchSchedules, detailSchedule?.id, wfLocked])

  // Opens the confirmation dialog; the delete itself runs in confirmRemoveSchedule.
  const removeSchedule = useCallback((id) => {
    setPendingRemoveId(id)
  }, [])

  const confirmRemoveSchedule = useCallback(async () => {
    const id = pendingRemoveId
    if (!id) return
    setSchedBusy(true)
    setSchedError(null)
    try {
      await rotations.deleteRotation(id)
      await fetchSchedules()
    } catch (e) {
      setSchedError(toUserMessage(e, 'Failed to remove schedule'))
    } finally {
      setSchedBusy(false)
      setPendingRemoveId(null)
    }
  }, [fetchSchedules, pendingRemoveId])

  // ── Analytics (single engine) ──────────────────────────────────────────────
  const analytics = useMemo(() => buildRotationAnalytics(records, interval), [records, interval])
  const sites = useMemo(() => ['All', ...[...new Set(analytics.vehicles.map(v => v.site))].sort()], [analytics])
  const filteredVehicles = useMemo(
    () => filterVehicles(analytics.vehicles, { site: siteFilter, status: statusFilter, search }),
    [analytics, siteFilter, statusFilter, search],
  )
  const filtersActive = siteFilter !== 'All' || statusFilter !== 'All' || !!search.trim()
  const schedSummary = useMemo(() => scheduleSummary(schedules), [schedules])
  const visibleSchedules = useMemo(
    () => (schedStatusFilter === 'All' ? schedules : schedules.filter(s => s.status === schedStatusFilter)),
    [schedules, schedStatusFilter],
  )

  // ── Charts ─────────────────────────────────────────────────────────────────
  const trendChartData = useMemo(() => (analytics.hasMonthlyRotations ? {
    labels: analytics.monthly.map(m => m.label),
    datasets: [{
      label: 'Rotations performed',
      data: analytics.monthly.map(m => m.count),
      borderColor: colorAt(0),
      backgroundColor: withAlpha(colorAt(0), 0.15),
      fill: true,
      tension: 0.35,
      pointRadius: 4,
      pointBackgroundColor: colorAt(0),
    }],
  } : null), [analytics])

  const siteChartData = useMemo(() => {
    const sc = analytics.siteCompliance.filter(s => s.pct != null)
    if (!sc.length) return null
    return {
      labels: sc.map(s => s.site),
      datasets: [{
        label: 'Compliance %',
        data: sc.map(s => s.pct),
        backgroundColor: sc.map(s => (s.pct >= 90 ? '#10b981' : s.pct >= 70 ? '#f59e0b' : '#ef4444')),
        borderRadius: 4,
      }],
    }
  }, [analytics])

  const impactChartData = useMemo(() => (analytics.avgLifeWith && analytics.avgLifeWithout ? {
    labels: ['Rotated tyres', 'Never rotated'],
    datasets: [{
      label: 'Average tyre life (km)',
      data: [analytics.avgLifeWith, analytics.avgLifeWithout],
      backgroundColor: [withAlpha(colorAt(0), 0.85), withAlpha(colorAt(1), 0.85)],
      borderRadius: 6,
    }],
  } : null), [analytics])

  // ── Table columns ──────────────────────────────────────────────────────────
  const statusColumns = useMemo(() => [
    {
      id: 'asset', header: 'Asset', accessorFn: (v) => v.asset,
      cell: ({ row }) => (
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); setDrawerVehicle(row.original) }}
          className="inline-flex items-center gap-2 min-h-[36px] font-medium text-[var(--accent)] hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] rounded"
        >
          <Truck size={13} aria-hidden="true" /> {row.original.asset}
        </button>
      ),
    },
    { id: 'site', header: 'Site', accessorFn: (v) => v.site, meta: { filterVariant: 'select' } },
    { id: 'tyres', header: 'Active tyres', accessorFn: (v) => v.activeTyreCount, meta: { align: 'right' }, cell: ({ getValue }) => <span className="tabular-nums">{fmt(getValue())}</span> },
    { id: 'last', header: 'Last rotation', accessorFn: (v) => v.lastRotationDate || '', meta: { exportValue: (v) => fmtDate(v.lastRotationDate) }, cell: ({ row }) => <span className="text-xs">{fmtDate(row.original.lastRotationDate)}</span> },
    {
      id: 'since', header: 'Since last (km)', accessorFn: (v) => v.sinceLastKm ?? -1, meta: { align: 'right', exportValue: (v) => v.sinceLastKm ?? 'N/A' },
      cell: ({ row }) => {
        const v = row.original.sinceLastKm
        if (v == null) return <span className="text-[var(--text-dim)]">N/A</span>
        return <span className={`tabular-nums ${v >= interval ? 'text-red-400 font-medium' : ''}`}>{fmt(v)}</span>
      },
    },
    {
      id: 'dueIn', header: 'Due in (km)', accessorFn: (v) => v.dueInKm ?? Number.MAX_SAFE_INTEGER, meta: { align: 'right', exportValue: (v) => v.dueInKm ?? 'N/A' },
      cell: ({ row }) => {
        const v = row.original.dueInKm
        if (v == null) return <span className="text-[var(--text-dim)]">N/A</span>
        return (
          <span className={`tabular-nums ${v <= 0 ? 'text-red-400 font-medium' : v <= DUE_SOON_BUFFER ? 'text-yellow-400' : ''}`}>
            {v <= 0 ? `${fmt(Math.abs(v))} overdue` : fmt(v)}
          </span>
        )
      },
    },
    { id: 'status', header: 'Status', accessorFn: (v) => URGENCY_ORDER[v.status] ?? 9, meta: { exportValue: (v) => v.status }, cell: ({ row }) => <StatusBadge status={row.original.status} /> },
    {
      id: 'imbalance', header: 'Wear imbalance', accessorFn: (v) => v.wearImbalance ?? -1, meta: { align: 'right', exportValue: (v) => (v.wearImbalance != null ? v.wearImbalance.toFixed(1) : 'N/A') },
      cell: ({ row }) => {
        const v = row.original.wearImbalance
        if (v == null) return <span className="text-[var(--text-dim)]">N/A</span>
        return <span className={`tabular-nums ${v > WEAR_IMBALANCE_MM ? 'text-orange-400 font-semibold' : ''}`}>{v.toFixed(1)} mm</span>
      },
    },
    {
      id: 'action', header: '', enableSorting: false, meta: { export: false },
      cell: ({ row }) => (
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); setModalVehicle(row.original) }}
          className="inline-flex items-center gap-1.5 min-h-[36px] px-3 py-1.5 border border-[var(--input-border)] rounded-lg text-xs font-medium text-[var(--text-secondary)] hover:bg-[var(--input-bg-hover)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
        >
          <Wrench size={11} aria-hidden="true" /> Schedule
        </button>
      ),
    },
  ], [interval])

  const imbalanceColumns = useMemo(() => [
    { id: 'asset', header: 'Asset', accessorFn: (v) => v.asset },
    { id: 'site', header: 'Site', accessorFn: (v) => v.site },
    { id: 'steer', header: 'Steer tread', accessorFn: (v) => v.steerTread ?? -1, meta: { align: 'right' }, cell: ({ row }) => <span className="tabular-nums">{row.original.steerTread != null ? `${row.original.steerTread.toFixed(1)} mm` : 'N/A'}</span> },
    { id: 'drive', header: 'Drive tread', accessorFn: (v) => v.driveTread ?? -1, meta: { align: 'right' }, cell: ({ row }) => <span className="tabular-nums">{row.original.driveTread != null ? `${row.original.driveTread.toFixed(1)} mm` : 'N/A'}</span> },
    {
      id: 'imbalance', header: 'Imbalance', accessorFn: (v) => v.wearImbalance, meta: { align: 'right' },
      cell: ({ row }) => <span className={`tabular-nums font-semibold ${row.original.wearImbalance > 6 ? 'text-red-400' : 'text-orange-400'}`}>{row.original.wearImbalance.toFixed(1)} mm{row.original.wearImbalance > 6 ? ' severe' : ''}</span>,
    },
    { id: 'status', header: 'Status', accessorFn: (v) => v.status, cell: ({ row }) => <StatusBadge status={row.original.status} /> },
    {
      id: 'action', header: '', enableSorting: false, meta: { export: false },
      cell: ({ row }) => (
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); setModalVehicle(row.original) }}
          className="inline-flex items-center gap-1.5 min-h-[36px] px-3 py-1.5 border border-[var(--input-border)] rounded-lg text-xs text-[var(--text-secondary)] hover:bg-[var(--input-bg-hover)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
        >
          <Wrench size={11} aria-hidden="true" /> Schedule rotation
        </button>
      ),
    },
  ], [])

  const scheduleColumns = useMemo(() => [
    { id: 'asset', header: 'Asset', accessorFn: (s) => s.asset || '' },
    { id: 'site', header: 'Site', accessorFn: (s) => s.site || '', cell: ({ getValue }) => getValue() || 'N/A' },
    { id: 'date', header: 'Scheduled date', accessorFn: (s) => s.scheduledDate || '', meta: { exportValue: (s) => fmtDate(s.scheduledDate) }, cell: ({ row }) => fmtDate(row.original.scheduledDate) },
    {
      id: 'priority', header: 'Priority', accessorFn: (s) => PRIORITIES.indexOf(s.priority), meta: { exportValue: (s) => s.priority },
      cell: ({ row }) => <span className={`font-semibold ${PRIORITY_TONE[row.original.priority] ?? ''}`}>{row.original.priority || 'N/A'}</span>,
    },
    { id: 'status', header: 'Status', accessorFn: (s) => s.status || '' },
    { id: 'km', header: 'Odometer', accessorFn: (s) => Number(s.currentKm) || -1, meta: { align: 'right', exportValue: (s) => s.currentKm ?? 'N/A' }, cell: ({ row }) => <span className="tabular-nums">{fmtKm(row.original.currentKm != null ? Number(row.original.currentKm) : null)}</span> },
    { id: 'notes', header: 'Notes', accessorFn: (s) => s.notes || '', cell: ({ getValue }) => <span className="text-xs text-[var(--text-muted)] line-clamp-2">{getValue() || 'None'}</span> },
    {
      id: 'actions', header: '', enableSorting: false, meta: { export: false },
      cell: ({ row }) => {
        const s = row.original
        const rowLocked = wfLocked && detailSchedule?.id === s.id
        return (
          <div className="flex items-center justify-end gap-2">
            <button type="button" onClick={(e) => { e.stopPropagation(); setDetailSchedule(s) }} aria-label={`Open approval for ${s.asset}`} title="Approval" className={ICON_BTN}>
              <ShieldCheck size={14} aria-hidden="true" />
            </button>
            {s.status !== 'Completed' && (
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); updateScheduleStatus(s.id, 'Completed') }}
                disabled={schedBusy || rowLocked}
                aria-label={rowLocked ? `${s.asset} is locked in approval` : `Mark rotation for ${s.asset} completed`}
                title={rowLocked ? 'Locked, in approval' : 'Mark completed'}
                className={ICON_BTN}
              >
                {rowLocked ? <Lock size={14} aria-hidden="true" /> : <CheckCircle size={14} aria-hidden="true" />}
              </button>
            )}
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); removeSchedule(s.id) }}
              disabled={schedBusy}
              aria-label={`Remove scheduled rotation for ${s.asset}`}
              title="Remove"
              className={ICON_BTN}
            >
              <X size={14} aria-hidden="true" />
            </button>
          </div>
        )
      },
    },
  ], [wfLocked, detailSchedule?.id, schedBusy, updateScheduleStatus, removeSchedule])

  // ── Export (filtered vehicles + the schedule) ──────────────────────────────
  const fileBase = reportFileName('TyrePulse Rotation Compliance', activeCountry !== 'All' ? activeCountry : null, reportDateLabel())

  async function exportExcel() {
    await exportSheetsToExcel([
      {
        name: 'Rotation Status',
        note: `${filteredVehicles.length} of ${analytics.total} vehicles, current filters, interval ${fmt(interval)} km`,
        columns: ['asset', 'site', 'tyres', 'last', 'lastKm', 'since', 'due', 'status', 'rotations', 'imbalance'],
        headers: ['Asset', 'Site', 'Active Tyres', 'Last Rotation Date', 'Last Rotation (km)', 'Since Last (km)', 'Due In (km)', 'Status', 'Total Rotations', 'Wear Imbalance (mm)'],
        rows: filteredVehicles.map(v => ({
          asset: v.asset,
          site: v.site,
          tyres: v.activeTyreCount,
          last: fmtDate(v.lastRotationDate),
          lastKm: v.lastRotationKm ?? 'N/A',
          since: v.sinceLastKm ?? 'N/A',
          due: v.dueInKm ?? 'N/A',
          status: v.status,
          rotations: v.totalRotations,
          imbalance: v.wearImbalance != null ? v.wearImbalance.toFixed(1) : 'N/A',
        })),
      },
      {
        name: 'Rotation Schedule',
        note: `${schedules.length} scheduled rotations`,
        columns: ['asset', 'site', 'date', 'priority', 'status', 'notes'],
        headers: ['Asset', 'Site', 'Scheduled Date', 'Priority', 'Status', 'Notes'],
        rows: schedules.map(s => ({ asset: s.asset, site: s.site, date: s.scheduledDate, priority: s.priority, status: s.status, notes: s.notes || '' })),
      },
    ], fileBase, {
      title: 'Tyre Rotation Compliance',
      company,
      meta: {
        'Rotation interval (km)': fmt(interval),
        'Fleet compliance': analytics.compliancePct != null ? `${analytics.compliancePct}%` : 'N/A',
      },
      notes: [
        'A rotation is detected when the same serial is recorded at a different axle group.',
        'Unmeasured = rotations found but no odometer reading to measure distance since.',
      ],
    })
  }

  async function exportPdf() {
    const { default: jsPDF } = await import('jspdf')
    const autoTable = await loadAutoTable()
    const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' })
    const brand = await resolvePdfBrand(branding)
    const filename = `${fileBase}.pdf`
    const title = 'Tyre Rotation Compliance Report'
    const subtitle = `Interval: ${fmt(interval)} km, fleet: ${analytics.total} vehicles${filtersActive ? `, ${filteredVehicles.length} shown after filters` : ''}`

    if (filteredVehicles.length === 0) {
      pdfHeader(doc, title, subtitle, company, brand)
      pdfEmptyState(doc, 'No vehicles match the selected filters', 'Adjust the site or status filter and export again.')
      pdfFooter(doc, 1, 1, company, brand)
      doc.save(filename)
      return
    }

    doc.setTextColor(55, 65, 81)
    doc.setFontSize(8)
    const kpis = [
      ['Compliance', analytics.compliancePct != null ? `${analytics.compliancePct}%` : 'N/A'],
      ['Overdue', String(analytics.overdue)],
      ['Avg Interval', analytics.avgInterval ? `${fmt(analytics.avgInterval)} km` : 'N/A'],
      ['Life value at risk', analytics.lifeValueTotal != null ? `${activeCurrency} ${fmt(analytics.lifeValueTotal)}` : 'N/A'],
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
        fmt(v.sinceLastKm),
        fmt(v.dueInKm),
        v.status, v.totalRotations,
      ]),
      didParseCell: data => {
        if (data.section === 'body' && data.column.index === 6) {
          const s = data.cell.raw
          if (s === 'Overdue') { data.cell.styles.textColor = [239, 68, 68] }
          if (s === 'Due Soon') { data.cell.styles.textColor = [245, 158, 11] }
          if (s === 'On Schedule') { data.cell.styles.textColor = [16, 185, 129] }
        }
      },
      didDrawPage: () => pdfHeader(doc, title, subtitle, company, brand),
    })

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
  const noData = !loading && !error && analytics.total === 0
  const exportDisabled = loading || !!error || noData

  return (
    <div className="space-y-6 min-w-0">
      <PageHeader
        title="Rotation Compliance Tracker"
        subtitle="Which vehicles are due a tyre rotation, what rotation is worth, and the workshop schedule"
        icon={RotateCcw}
        actions={
          <div className="flex items-center gap-2 flex-wrap">
            <button type="button" onClick={() => { fetchData(); fetchSchedules() }} disabled={loading} className={BTN}>
              <RefreshCw size={15} className={loading ? 'animate-spin' : ''} aria-hidden="true" /> Refresh
            </button>
            <button type="button" onClick={exportExcel} disabled={exportDisabled} className={BTN}>
              <FileSpreadsheet size={14} aria-hidden="true" /> Excel
            </button>
            <button type="button" onClick={exportPdf} disabled={exportDisabled} className={BTN}>
              <FileText size={14} aria-hidden="true" /> PDF report
            </button>
          </div>
        }
      />

      <Card>
        <div className="flex flex-col sm:flex-row sm:items-center gap-4">
          <label htmlFor="rot-interval-range" className="flex items-center gap-2 text-sm font-medium text-[var(--text-primary)] min-w-max">
            <Settings2 size={15} className="text-[var(--text-muted)]" aria-hidden="true" />
            Rotation interval
          </label>
          <div className="flex-1 flex items-center gap-4">
            <input
              id="rot-interval-range"
              type="range"
              min={MIN_INTERVAL}
              max={MAX_INTERVAL}
              step={1000}
              value={interval}
              onChange={e => setInterval(Number(e.target.value))}
              className="flex-1 accent-[var(--accent)] h-2 rounded-full cursor-pointer"
            />
            <input
              type="number"
              aria-label="Rotation interval in km"
              min={MIN_INTERVAL}
              max={MAX_INTERVAL}
              step={1000}
              value={interval}
              onChange={e => {
                const v = Math.max(MIN_INTERVAL, Math.min(MAX_INTERVAL, Number(e.target.value) || MIN_INTERVAL))
                setInterval(v)
              }}
              className={`${FIELD} w-28 text-right`}
            />
            <span className="text-sm text-[var(--text-muted)] min-w-max">km</span>
          </div>
          <div className="flex items-center gap-1 text-xs text-[var(--text-muted)]">
            <Info size={11} aria-hidden="true" />
            <span>Every figure below recalculates for this interval</span>
          </div>
        </div>
      </Card>

      {loading ? (
        <Card>
          <div className="flex flex-col items-center justify-center py-16 gap-3" role="status">
            <RotateCcw size={32} className="text-[var(--text-muted)] animate-spin" aria-hidden="true" />
            <p className="text-[var(--text-muted)] text-sm">Loading rotation data</p>
          </div>
        </Card>
      ) : error ? (
        <div role="alert" className="bg-red-900/20 border border-red-800 rounded-2xl p-6 text-center space-y-3">
          <AlertOctagon size={32} className="text-red-400 mx-auto" aria-hidden="true" />
          <p className="text-red-300 font-medium">Failed to load rotation data</p>
          <p className="text-red-300/80 text-sm">{error}</p>
          <button type="button" onClick={fetchData} className={BTN}><RefreshCw size={14} aria-hidden="true" /> Retry</button>
        </div>
      ) : noData ? (
        <Card>
          <EmptyState
            illustration="module/tyres"
            icon={RotateCcw}
            title="No tyre records found"
            description="Rotation compliance is built from tyre records with an asset and a serial. None exist for this country yet."
          />
        </Card>
      ) : (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-5 gap-4">
            <KpiCard
              icon={Target}
              label="Fleet compliance"
              value={analytics.compliancePct != null ? `${analytics.compliancePct}%` : 'N/A'}
              sub={`${analytics.compliant} of ${analytics.total} vehicles on schedule`}
              tone={analytics.compliancePct == null ? '' : analytics.compliancePct >= 90 ? 'text-green-400' : analytics.compliancePct >= 70 ? 'text-yellow-400' : 'text-red-400'}
            />
            <KpiCard
              icon={AlertTriangle}
              label="Overdue"
              value={fmt(analytics.overdue)}
              sub={`${fmt(analytics.dueSoon)} more due within ${fmt(DUE_SOON_BUFFER)} km`}
              tone={analytics.overdue === 0 ? 'text-green-400' : 'text-red-400'}
            />
            <KpiCard
              icon={HelpCircle}
              label="Cannot measure"
              value={fmt(analytics.unmeasured + analytics.noHistory)}
              sub={`${fmt(analytics.noHistory)} never rotated, ${fmt(analytics.unmeasured)} without odometer`}
            />
            <KpiCard
              icon={Activity}
              label="Avg rotation interval"
              value={analytics.avgInterval ? `${fmt(analytics.avgInterval)} km` : 'N/A'}
              sub={analytics.intervalSamples ? `from ${fmt(analytics.intervalSamples)} measured gaps, target ${fmt(interval)} km` : `target ${fmt(interval)} km`}
            />
            <KpiCard
              icon={DollarSign}
              label="Tyre life value at risk"
              value={analytics.lifeValueTotal != null ? `${activeCurrency} ${fmt(analytics.lifeValueTotal)}` : 'N/A'}
              sub={analytics.lifeValueTotal != null ? `${fmt(analytics.tyresAtRisk)} tyres on vehicles not on schedule` : 'needs measured life with and without rotation, plus prices'}
            />
          </div>

          <div role="tablist" aria-label="Rotation views" className="flex gap-1 bg-[var(--surface-1)] border border-[var(--input-border)] rounded-xl p-1.5 overflow-x-auto">
            {TABS.map(t => (
              <button
                key={t.id}
                type="button"
                role="tab"
                aria-selected={activeTab === t.id}
                onClick={() => setActiveTab(t.id)}
                className={`flex items-center gap-2 min-h-[44px] px-4 py-2 rounded-lg text-sm font-medium whitespace-nowrap transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] ${
                  activeTab === t.id ? 'bg-[var(--accent)] text-white' : 'text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--input-bg)]'
                }`}
              >
                <t.icon size={14} aria-hidden="true" />
                {t.label}
                {t.id === 'schedule' && schedSummary.open > 0 && <span className="text-xs tabular-nums">({schedSummary.open})</span>}
              </button>
            ))}
          </div>

          {activeTab === 'status' && (
            <div className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <label className="relative">
                  <span className="sr-only">Search asset or site</span>
                  <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" aria-hidden="true" />
                  <input type="search" value={search} onChange={e => setSearch(e.target.value)} placeholder="Search asset or site" className={`${FIELD} pl-9`} />
                </label>
                <select aria-label="Filter by site" value={siteFilter} onChange={e => setSiteFilter(e.target.value)} className={FIELD}>
                  {sites.map(s => <option key={s} value={s}>{s === 'All' ? 'All sites' : s}</option>)}
                </select>
                <select aria-label="Filter by status" value={statusFilter} onChange={e => setStatusFilter(e.target.value)} className={FIELD}>
                  <option value="All">All statuses</option>
                  {STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
                </select>
              </div>
              <p className="text-xs text-[var(--text-muted)]" aria-live="polite">
                {filteredVehicles.length.toLocaleString()} of {analytics.total.toLocaleString()} vehicles shown. The Excel and PDF exports cover exactly these.
              </p>

              <EnterpriseTable
                columns={statusColumns}
                data={filteredVehicles}
                getRowId={(v) => v.asset}
                enableGlobalFilter={false}
                enableExport={false}
                viewKey="rotation-status"
                onRowClick={(v) => setDrawerVehicle(v)}
                emptyMessage={filtersActive ? 'No vehicles match the current filters' : 'No vehicles found'}
              />

              {(() => {
                const imbalanced = filteredVehicles.filter(v => v.wearImbalance != null && v.wearImbalance > WEAR_IMBALANCE_MM)
                if (!imbalanced.length) return null
                return (
                  <div className="bg-orange-900/20 border border-orange-800 rounded-xl p-4">
                    <div className="flex items-center gap-2 text-orange-400 font-semibold text-sm mb-3">
                      <AlertTriangle size={15} aria-hidden="true" />
                      {imbalanced.length} vehicle{imbalanced.length !== 1 ? 's' : ''} with unbalanced tyre wear (more than {WEAR_IMBALANCE_MM} mm steer to drive)
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {imbalanced.map(v => (
                        <button
                          key={v.asset}
                          type="button"
                          onClick={() => setDrawerVehicle(v)}
                          className="inline-flex items-center gap-2 min-h-[44px] px-3 py-1.5 bg-[var(--surface-1)] border border-orange-700 rounded-lg text-xs text-[var(--text-secondary)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
                        >
                          <Truck size={11} aria-hidden="true" />
                          {v.asset}
                          <span className="text-orange-400 tabular-nums">{v.wearImbalance.toFixed(1)} mm</span>
                        </button>
                      ))}
                    </div>
                  </div>
                )
              })()}
            </div>
          )}

          {activeTab === 'charts' && (
            <div className="space-y-6">
              <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
                <Card>
                  <CardHeader title="Monthly rotation activity" icon={TrendingUp} level={2} actions={<span className="text-xs text-[var(--text-muted)]">Last 12 months, detected rotations</span>} />
                  {trendChartData ? (
                    <div className="h-64" role="img" aria-label={`Rotations detected per month, ${analytics.monthly.reduce((s, m) => s + m.count, 0)} in the last 12 months`}>
                      <Line
                        data={trendChartData}
                        options={{
                          ...CHART_DEFAULTS,
                          scales: { ...CHART_DEFAULTS.scales, y: { ...CHART_DEFAULTS.scales.y, min: 0, ticks: { ...CHART_DEFAULTS.scales.y.ticks, precision: 0 } } },
                        }}
                      />
                    </div>
                  ) : (
                    <div className="h-64 flex items-center justify-center text-[var(--text-muted)] text-sm text-center">No rotation detected in the last 12 months</div>
                  )}
                </Card>

                <Card>
                  <CardHeader title="Site compliance comparison" icon={Building2} level={2} />
                  {siteChartData ? (
                    <div className="h-64" role="img" aria-label="Share of vehicles on schedule, by site">
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
                    <div className="h-64 flex items-center justify-center text-[var(--text-muted)] text-sm">No site data available</div>
                  )}
                </Card>
              </div>

              <Card>
                <CardHeader title="Fleet status distribution" icon={Layers} level={2} />
                <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-5 gap-4">
                  {analytics.statusDistribution.map(({ status, count, pct }) => {
                    const cfg = STATUS_CFG[status]
                    return (
                      <button
                        key={status}
                        type="button"
                        onClick={() => { setStatusFilter(status); setActiveTab('status') }}
                        className={`text-left rounded-xl border ${cfg.border} ${cfg.bg} p-4 min-h-[44px] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]`}
                        aria-label={`${status}: ${count} vehicles. Show them.`}
                      >
                        <div className={`text-2xl font-bold tabular-nums ${cfg.color}`}>{count}</div>
                        <div className="text-xs text-[var(--text-muted)] mt-1">{status}</div>
                        <div className="mt-2 h-1.5 rounded-full bg-[var(--input-border)]" aria-hidden="true">
                          <div className={`h-full rounded-full ${cfg.bar}`} style={{ width: `${pct ?? 0}%` }} />
                        </div>
                        <div className="text-xs text-[var(--text-muted)] mt-1">{pct != null ? `${pct}%` : 'N/A'}</div>
                      </button>
                    )
                  })}
                </div>
              </Card>
            </div>
          )}

          {activeTab === 'impact' && (
            <div className="space-y-6">
              <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
                <Card>
                  <CardHeader title="Tyre life, rotated against never rotated" icon={BarChart3} level={2} />
                  {impactChartData ? (
                    <div className="h-64" role="img" aria-label={`Rotated tyres average ${fmt(analytics.avgLifeWith)} km, never rotated ${fmt(analytics.avgLifeWithout)} km`}>
                      <Bar
                        data={impactChartData}
                        options={{
                          ...CHART_DEFAULTS,
                          plugins: { ...CHART_DEFAULTS.plugins, legend: { display: false } },
                          scales: { ...CHART_DEFAULTS.scales, y: { ...CHART_DEFAULTS.scales.y, ticks: { ...CHART_DEFAULTS.scales.y.ticks, callback: v => `${(v / 1000).toFixed(0)}k` } } },
                        }}
                      />
                    </div>
                  ) : (
                    <div className="h-64 flex items-center justify-center text-[var(--text-muted)] text-sm text-center px-4">Not enough removed tyres with a fitment and removal odometer to compare tyre life</div>
                  )}
                </Card>

                <Card className="space-y-4">
                  <CardHeader title="Rotation impact analysis" icon={DollarSign} iconTone="warn" level={2} className="!mb-0" />
                  {analytics.avgLifeWith && analytics.avgLifeWithout ? (
                    <>
                      <dl className="grid grid-cols-2 gap-4">
                        <div className="bg-[var(--input-bg)] border border-[var(--input-border)] rounded-lg p-4">
                          <dt className="text-xs text-[var(--text-muted)] mb-1">Rotated tyres ({fmt(analytics.withSamples)})</dt>
                          <dd className="text-xl font-bold tabular-nums">{fmtKm(analytics.avgLifeWith)}</dd>
                        </div>
                        <div className="bg-[var(--input-bg)] border border-[var(--input-border)] rounded-lg p-4">
                          <dt className="text-xs text-[var(--text-muted)] mb-1">Never rotated ({fmt(analytics.withoutSamples)})</dt>
                          <dd className="text-xl font-bold tabular-nums">{fmtKm(analytics.avgLifeWithout)}</dd>
                        </div>
                      </dl>
                      <p className="text-sm text-[var(--text-secondary)]">
                        {analytics.avgLifeWith > analytics.avgLifeWithout
                          ? `Rotated tyres last ${fmt(analytics.avgLifeWith - analytics.avgLifeWithout)} km (${Math.round(((analytics.avgLifeWith - analytics.avgLifeWithout) / analytics.avgLifeWithout) * 100)}%) longer on this fleet.`
                          : 'On this fleet, rotated tyres do not yet last longer than never-rotated ones, so no saving is claimed.'}
                      </p>
                    </>
                  ) : (
                    <div className="flex items-center gap-2 text-[var(--text-muted)] text-sm py-6 justify-center text-center">
                      <Info size={14} aria-hidden="true" />
                      Removal odometer data is needed for a life comparison
                    </div>
                  )}

                  <dl className="border-t border-[var(--input-border)] pt-4 space-y-2 text-sm">
                    <div className="text-xs text-[var(--text-muted)] font-medium">Tyre life value at risk</div>
                    <div className="flex items-center justify-between"><dt className="text-[var(--text-muted)]">Average tyre price (priced rows)</dt><dd className="tabular-nums">{analytics.avgCost != null ? `${activeCurrency} ${fmt(analytics.avgCost)}` : 'N/A'}</dd></div>
                    <div className="flex items-center justify-between"><dt className="text-[var(--text-muted)]">Value lost per unrotated tyre</dt><dd className="tabular-nums">{analytics.lifeValuePerTyre != null ? `${activeCurrency} ${fmt(analytics.lifeValuePerTyre)}` : 'N/A'}</dd></div>
                    <div className="flex items-center justify-between"><dt className="text-[var(--text-muted)]">Tyres on vehicles not on schedule</dt><dd className="tabular-nums">{fmt(analytics.tyresAtRisk)}</dd></div>
                    <div className="flex items-center justify-between font-semibold border-t border-[var(--input-border)] pt-2">
                      <dt className="text-[var(--text-secondary)]">Total value at risk</dt>
                      <dd className="tabular-nums text-green-400">{analytics.lifeValueTotal != null ? `${activeCurrency} ${fmt(analytics.lifeValueTotal)}` : 'N/A'}</dd>
                    </div>
                    <p className="text-xs text-[var(--text-dim)]">Per tyre: (1 minus never-rotated life divided by rotated life) times the average price. Measured from this fleet, not an assumed factor.</p>
                  </dl>
                </Card>
              </div>

              <Card>
                <CardHeader
                  title="Position wear balance"
                  description={`Vehicles with more than ${WEAR_IMBALANCE_MM} mm steer to drive imbalance`}
                  icon={Gauge}
                  iconTone="warn"
                  level={2}
                />
                {analytics.imbalanced.length === 0 ? (
                  <div className="text-center py-8 text-[var(--text-muted)] text-sm flex items-center justify-center gap-2">
                    <CheckCircle size={16} className="text-green-400" aria-hidden="true" />
                    Every vehicle with steer and drive tread readings is within the balance range
                  </div>
                ) : (
                  <EnterpriseTable
                    columns={imbalanceColumns}
                    data={analytics.imbalanced}
                    getRowId={(v) => v.asset}
                    enableColumnFilters={false}
                    searchPlaceholder="Search asset or site"
                    exportFileName={reportFileName('TyrePulse Rotation Wear Imbalance', reportDateLabel())}
                    reportMeta={{ title: 'Position wear balance', company }}
                    onRowClick={(v) => setDrawerVehicle(v)}
                    emptyMessage="No imbalanced vehicles"
                  />
                )}
              </Card>
            </div>
          )}

          {activeTab === 'schedule' && (
            <div className="space-y-5">
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <KpiCard icon={Calendar} label="Open" value={fmt(schedSummary.open)} sub={`${fmt(schedSummary.byPriority.Critical)} critical, ${fmt(schedSummary.byPriority.High)} high`} />
                <KpiCard icon={AlertTriangle} label="Past date" value={fmt(schedSummary.late)} sub="open with a date already passed" tone={schedSummary.late ? 'text-red-400' : ''} />
                <KpiCard icon={CheckCircle} label="Completed" value={fmt(schedSummary.completed)} />
                <KpiCard icon={AlertOctagon} label="Needs scheduling" value={fmt(autoScheduleEntries(analytics.vehicles, schedules, interval).length)} sub="overdue or due soon, nothing open" />
              </div>

              <div className="flex flex-wrap items-center justify-between gap-3">
                <select aria-label="Filter schedule by status" value={schedStatusFilter} onChange={e => setSchedStatusFilter(e.target.value)} className={`${FIELD} w-auto`}>
                  <option value="Open">Open</option>
                  <option value="Completed">Completed</option>
                  <option value="All">All</option>
                </select>
                <button
                  type="button"
                  onClick={() => createSchedules(autoScheduleEntries(analytics.vehicles, schedules, interval))}
                  disabled={schedBusy || autoScheduleEntries(analytics.vehicles, schedules, interval).length === 0}
                  className="btn-primary gap-2 min-h-[44px]"
                >
                  <RotateCcw size={13} aria-hidden="true" />
                  Auto-schedule overdue and due soon
                </button>
              </div>

              {schedError ? (
                <div role="alert" className="bg-red-900/20 border border-red-800 rounded-xl p-6 text-center space-y-3">
                  <AlertOctagon size={28} className="text-red-400 mx-auto" aria-hidden="true" />
                  <p className="text-red-300 font-medium">Schedule action failed</p>
                  <p className="text-red-300/80 text-sm">{schedError}</p>
                  <button type="button" onClick={fetchSchedules} className={BTN}><RefreshCw size={14} aria-hidden="true" /> Retry</button>
                </div>
              ) : (
                <EnterpriseTable
                  columns={scheduleColumns}
                  data={visibleSchedules}
                  getRowId={(s) => String(s.id)}
                  loading={schedLoading}
                  enableColumnFilters={false}
                  searchPlaceholder="Search scheduled rotations"
                  exportFileName={reportFileName('TyrePulse Rotation Schedule', reportDateLabel())}
                  reportMeta={{ title: 'Rotation schedule', company }}
                  emptyMessage={schedStatusFilter === 'Open'
                    ? 'No open rotations scheduled. Use Schedule on a vehicle, or auto-schedule above.'
                    : 'No scheduled rotations in this view'}
                />
              )}
            </div>
          )}
        </>
      )}

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

      <Modal
        open={!!pendingRemoveId}
        onClose={schedBusy ? undefined : () => setPendingRemoveId(null)}
        title="Remove scheduled rotation"
        size="sm"
        footer={(
          <>
            <button type="button" onClick={() => setPendingRemoveId(null)} disabled={schedBusy} className="btn-secondary disabled:opacity-50">
              Cancel
            </button>
            <button type="button" onClick={confirmRemoveSchedule} disabled={schedBusy}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-red-600 hover:bg-red-500 text-white text-sm font-semibold disabled:opacity-50">
              {schedBusy ? 'Removing...' : 'Remove'}
            </button>
          </>
        )}
      >
        <p className="text-sm text-[var(--text-secondary)]">Remove this scheduled rotation?</p>
      </Modal>

      {/* Scheduled Rotation Approval rail (tyre_rotation entity). NOT `Modal`
          for the same tp-drawer-panel reason as RotationDrawer above. */}
      <AnimatePresence>
        {detailSchedule && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 bg-black/60 flex justify-end"
            onClick={() => setDetailSchedule(null)}
          >
            <motion.div
              role="dialog"
              aria-modal="true"
              aria-labelledby="rotation-approval-title"
              initial={{ x: '100%' }}
              animate={{ x: 0 }}
              exit={{ x: '100%' }}
              transition={{ type: 'spring', damping: 30, stiffness: 300 }}
              className="tp-drawer-panel w-full max-w-lg h-full bg-[var(--surface-1)] border-l border-[var(--input-border)] overflow-y-auto"
              onClick={e => e.stopPropagation()}
            >
              <div className="flex items-center justify-between gap-3 p-4 sm:p-6 border-b border-[var(--input-border)] sticky top-0 bg-[var(--surface-1)] z-10">
                <div className="min-w-0">
                  <h2 id="rotation-approval-title" className="flex items-center gap-2 text-[var(--text-primary)] font-semibold text-lg">
                    <RotateCcw size={18} className="text-[var(--text-muted)]" aria-hidden="true" />
                    {detailSchedule.asset}
                  </h2>
                  <div className="text-sm text-[var(--text-muted)] mt-0.5">
                    {[detailSchedule.site, fmtDate(detailSchedule.scheduledDate), detailSchedule.priority].filter(Boolean).join(', ')}
                  </div>
                </div>
                <button type="button" onClick={() => setDetailSchedule(null)} aria-label="Close rotation approval" className={ICON_BTN}>
                  <X size={18} aria-hidden="true" />
                </button>
              </div>

              <div className="p-4 sm:p-6 space-y-4">
                <EntityApprovalPanel
                  entityType="tyre_rotation"
                  entityId={detailSchedule.id}
                  entityLabel={detailSchedule.asset || detailSchedule.id}
                  context={{
                    asset_no: detailSchedule.asset,
                    due_date: detailSchedule.scheduledDate,
                    priority: detailSchedule.priority,
                    status: detailSchedule.status,
                    cost: Number(detailSchedule.currentKm) || 0,
                    site: detailSchedule.site,
                  }}
                  onStateChange={(st) => setWfLocked(!!(st?.isActive || st?.isLocked))}
                  title="Rotation Approval"
                />

                {wfLocked && (
                  <div role="status" className="flex items-center gap-1.5 text-xs text-[var(--accent)] bg-[var(--input-bg)] border border-[var(--input-border)] rounded-lg px-3 py-2">
                    <Lock size={12} aria-hidden="true" />
                    Locked, in approval. Completing this rotation is disabled until the workflow finishes.
                  </div>
                )}

                <button
                  type="button"
                  onClick={() => updateScheduleStatus(detailSchedule.id, 'Completed')}
                  disabled={schedBusy || wfLocked || detailSchedule.status === 'Completed'}
                  className="btn-primary w-full min-h-[44px] gap-2 disabled:opacity-40 disabled:cursor-not-allowed"
                  title={wfLocked ? 'Locked, in approval' : 'Mark rotation completed'}
                >
                  {wfLocked ? <Lock size={14} aria-hidden="true" /> : <CheckCircle size={14} aria-hidden="true" />}
                  {detailSchedule.status === 'Completed' ? 'Completed' : 'Mark Completed'}
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
