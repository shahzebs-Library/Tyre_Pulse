/**
 * Equipment (route /equipment) — Tool & Equipment Registry.
 *
 * Registers workshop tools and equipment (tyre changers, balancers, torque
 * wrenches, jacks, gauges …) with serial, assigned site, condition, calibration
 * due date and lifecycle status. Full CRUD with role-gated writes (Admin /
 * Manager / Director), KPI tiles, status + type + search filters, calibration
 * highlighting, Excel/PDF export, and loading / empty / error states.
 *
 * Runs on the `equipment` table (V150). Pure KPI logic lives in
 * `src/lib/equipment.js`; Supabase access is behind `src/lib/api/equipment.js`.
 */
import { useState, useEffect, useMemo, useCallback } from 'react'
import {
  Wrench, Plus, Pencil, Trash2, Search, X, Save, Loader2,
  AlertTriangle, FileSpreadsheet, FileText, PackageCheck, CalendarClock,
  BarChart2, PieChart, Activity, Gauge, ShieldAlert, MapPin, Layers,
  CheckCircle2, Clock, ClipboardCheck, RefreshCw,
} from 'lucide-react'
import {
  Chart as ChartJS, CategoryScale, LinearScale, BarElement,
  ArcElement, Tooltip, Legend,
} from 'chart.js'
import { Bar, Doughnut } from 'react-chartjs-2'
import PageHeader from '../components/ui/PageHeader'
import { useSettings } from '../contexts/SettingsContext'
import { useAuth } from '../contexts/AuthContext'
import {
  listAllEquipment, createEquipment, updateEquipment, deleteEquipment,
} from '../lib/api/equipment'
import {
  summarizeEquipment, equipmentAnalytics, equipmentAttention,
  calibrationState, ageOnRecordYears, EQUIPMENT_STATUSES,
} from '../lib/equipment'
import { colorAt, withAlpha, ACCENTS } from '../lib/reportColors'
import { toUserMessage } from '../lib/safeError'
import { exportToExcel, exportToPdf, reportFileName } from '../lib/exportUtils'
import EnterpriseTable from '../components/ui/EnterpriseTable'
import { filterEquipment, distinctValues } from '../lib/equipmentAnalytics'
import { isMissingRelation } from '../lib/api/_client'

ChartJS.register(CategoryScale, LinearScale, BarElement, ArcElement, Tooltip, Legend)

const WRITE_ROLES = ['Admin', 'Manager', 'Director']

const STATUS_META = {
  available: { label: 'Available', cls: 'bg-green-900/40 text-green-300 border border-green-700/50' },
  in_use: { label: 'In use', cls: 'bg-sky-900/40 text-sky-300 border border-sky-700/50' },
  maintenance: { label: 'Maintenance', cls: 'bg-amber-900/40 text-amber-300 border border-amber-700/50' },
  retired: { label: 'Retired', cls: 'bg-[var(--input-bg)] text-[var(--text-dim)] border border-[var(--input-border)]' },
}

const EMPTY_FORM = {
  name: '', equipment_type: '', serial_no: '', site: '',
  condition: '', calibration_due: '', status: 'available', notes: '',
}

function fmtDate(v) {
  if (!v) return 'N/A'
  const d = new Date(v)
  return Number.isNaN(d.getTime()) ? 'N/A' : d.toLocaleDateString()
}

const CAL_META = {
  overdue: { label: 'Overdue', cls: 'bg-red-900/40 text-red-300 border border-red-700/50' },
  due_soon: { label: 'Due soon', cls: 'bg-amber-900/40 text-amber-300 border border-amber-700/50' },
  ok: { label: 'OK', cls: 'bg-green-900/40 text-green-300 border border-green-700/50' },
  none: { label: 'N/A', cls: 'bg-[var(--input-bg)] text-[var(--text-dim)] border border-[var(--input-border)]' },
}

function fmtYears(v) {
  if (v == null || !Number.isFinite(v)) return 'N/A'
  if (v < 1) return `${Math.round(v * 12)}m`
  return `${v.toFixed(1)}y`
}


// ─── Create / edit modal ──────────────────────────────────────────────────────
function EquipmentModal({ initial, onClose, onSaved }) {
  const { activeCountry } = useSettings() || {}
  const editing = Boolean(initial?.id)
  const [form, setForm] = useState(() => ({ ...EMPTY_FORM, ...(initial || {}) }))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }))

  const submit = useCallback(async (e) => {
    e?.preventDefault?.()
    setError('')
    if (!form.name.trim()) { setError('Please enter an equipment name.'); return }
    setBusy(true)
    try {
      const payload = {
        name: form.name,
        equipment_type: form.equipment_type,
        serial_no: form.serial_no,
        site: form.site,
        condition: form.condition,
        calibration_due: form.calibration_due || null,
        status: form.status,
        notes: form.notes,
      }
      let row
      if (editing) {
        row = await updateEquipment(initial.id, payload)
      } else {
        row = await createEquipment({
          ...payload,
          country: activeCountry && activeCountry !== 'All' ? activeCountry : null,
        })
      }
      onSaved(row, editing)
    } catch (err) {
      setError(toUserMessage(err, 'Could not save this equipment record.'))
    } finally {
      setBusy(false)
    }
  }, [form, editing, initial, activeCountry, onSaved])

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70" onClick={onClose}>
      <div className="card w-full max-w-2xl max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-bold text-[var(--text-primary)] flex items-center gap-2">
            <Wrench size={18} className="text-[var(--brand-bright)]" />
            {editing ? 'Edit equipment' : 'Register equipment'}
          </h2>
          <button type="button" onClick={onClose} aria-label="Close" className="min-w-[44px] min-h-[44px] inline-flex items-center justify-center text-[var(--text-muted)] hover:text-[var(--text-primary)]"><X size={18} /></button>
        </div>

        <form onSubmit={submit} className="space-y-4">
          <div>
            <label className="label">Name <span className="text-red-400">*</span></label>
            <input className="input w-full" placeholder="e.g. Hydraulic bottle jack 20T" value={form.name} maxLength={200} onChange={(e) => set('name', e.target.value)} autoFocus />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="label" htmlFor="eq-equipment_type">Type</label>
              <input id="eq-equipment_type" className="input w-full" placeholder="e.g. Torque wrench, Balancer" value={form.equipment_type} maxLength={120} onChange={(e) => set('equipment_type', e.target.value)} />
            </div>
            <div>
              <label className="label" htmlFor="eq-serial_no">Serial number</label>
              <input id="eq-serial_no" className="input w-full" placeholder="Manufacturer serial" value={form.serial_no} maxLength={120} onChange={(e) => set('serial_no', e.target.value)} />
            </div>
            <div>
              <label className="label" htmlFor="eq-site">Assigned site</label>
              <input id="eq-site" className="input w-full" placeholder="Workshop / depot" value={form.site} maxLength={200} onChange={(e) => set('site', e.target.value)} />
            </div>
            <div>
              <label className="label" htmlFor="eq-condition">Condition</label>
              <input id="eq-condition" className="input w-full" placeholder="e.g. Good, Fair, Needs repair" value={form.condition} maxLength={120} onChange={(e) => set('condition', e.target.value)} />
            </div>
            <div>
              <label className="label" htmlFor="eq-calibration_due">Calibration due</label>
              <input id="eq-calibration_due" type="date" className="input w-full" value={form.calibration_due || ''} onChange={(e) => set('calibration_due', e.target.value)} />
            </div>
            <div>
              <label className="label" htmlFor="eq-status">Status</label>
              <select id="eq-status" className="input w-full" value={form.status} onChange={(e) => set('status', e.target.value)}>
                {EQUIPMENT_STATUSES.map((s) => <option key={s} value={s}>{STATUS_META[s]?.label || s}</option>)}
              </select>
            </div>
          </div>

          <div>
            <label className="label" htmlFor="eq-notes">Notes</label>
            <textarea id="eq-notes" className="input w-full min-h-[90px] resize-y" placeholder="Maintenance history, accessories, location detail..." value={form.notes} maxLength={4000} onChange={(e) => set('notes', e.target.value)} />
          </div>

          {error && (
            <div className="flex items-start gap-2 text-sm text-red-300 bg-red-900/20 border border-red-800/50 rounded-lg px-3 py-2">
              <AlertTriangle size={15} className="mt-0.5 shrink-0" /> {error}
            </div>
          )}

          <div className="flex items-center justify-end gap-2 pt-1">
            <button type="button" onClick={onClose} className="btn-secondary text-sm">Cancel</button>
            <button type="submit" disabled={busy} className="btn-primary text-sm inline-flex items-center gap-2 disabled:opacity-60">
              {busy ? <Loader2 size={15} className="animate-spin" /> : <Save size={15} />}
              {busy ? 'Saving...' : editing ? 'Save changes' : 'Register'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

// ─── Delete confirm ───────────────────────────────────────────────────────────
function DeleteConfirm({ item, onCancel, onConfirm }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const go = async () => {
    setBusy(true); setError('')
    try { await onConfirm() } catch (err) { setError(toUserMessage(err, 'Delete failed.')); setBusy(false) }
  }
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70" onClick={onCancel}>
      <div className="card w-full max-w-md" onClick={(e) => e.stopPropagation()}>
        <h2 className="text-lg font-bold text-[var(--text-primary)] flex items-center gap-2">
          <Trash2 size={18} className="text-red-400" /> Delete equipment
        </h2>
        <p className="text-sm text-[var(--text-secondary)] mt-3">
          Delete <span className="font-semibold text-[var(--text-primary)]">{item.name}</span>? This cannot be undone.
        </p>
        {error && <p className="text-xs text-red-300 mt-2">{error}</p>}
        <div className="flex items-center justify-end gap-2 mt-5">
          <button type="button" onClick={onCancel} className="btn-secondary text-sm">Cancel</button>
          <button type="button" onClick={go} disabled={busy} className="btn-primary text-sm inline-flex items-center gap-2 !bg-red-600 hover:!bg-red-500 disabled:opacity-60">
            {busy ? <Loader2 size={15} className="animate-spin" /> : <Trash2 size={15} />} Delete
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── Analytics helpers ────────────────────────────────────────────────────────
function ChartCard({ title, icon: Icon, caption, children }) {
  return (
    <div className="rounded-xl border border-[var(--input-border)] bg-[var(--input-bg)]/30 p-3">
      <div className="flex items-center justify-between mb-2">
        <p className="text-xs font-semibold text-[var(--text-secondary)] flex items-center gap-1.5">
          {Icon && <Icon size={13} className="text-[var(--text-muted)]" />} {title}
        </p>
        {caption && <span className="text-[11px] text-[var(--text-dim)]">{caption}</span>}
      </div>
      <div className="h-52">{children}</div>
    </div>
  )
}

function AttentionList({ title, icon: Icon, tone, items, onOpen, emptyLabel }) {
  return (
    <div className="rounded-xl border border-[var(--input-border)] p-3">
      <p className={`text-xs font-semibold flex items-center gap-1.5 ${tone}`}>
        <Icon size={14} /> {title} <span className="text-[var(--text-dim)] font-normal">({items.length})</span>
      </p>
      {items.length === 0 ? (
        <p className="text-xs text-[var(--text-muted)] mt-2 flex items-center gap-1.5">
          <CheckCircle2 size={13} className="text-green-400" /> {emptyLabel}
        </p>
      ) : (
        <ul className="mt-2 space-y-1.5 max-h-56 overflow-y-auto">
          {items.slice(0, 25).map((r) => (
            <li key={r.id} className={`text-xs flex items-start justify-between gap-2 ${onOpen ? 'cursor-pointer hover:text-[var(--text-primary)]' : ''}`} onClick={onOpen ? () => onOpen(r) : undefined}>
              <span className="min-w-0">
                <span className="font-medium text-[var(--text-secondary)] truncate">{r.name || 'Unnamed'}</span>
                {r.site ? <span className="text-[var(--text-dim)]"> - {r.site}</span> : null}
              </span>
              <span className="text-[var(--text-dim)] shrink-0 text-right">{r.reason}</span>
            </li>
          ))}
          {items.length > 25 && <li className="text-[11px] text-[var(--text-dim)]">and {items.length - 25} more</li>}
        </ul>
      )}
    </div>
  )
}

function NeedsAttention({ attention, onOpen }) {
  const { overdue, dueSoon, dataQuality } = attention
  const clean = overdue.length === 0 && dueSoon.length === 0 && dataQuality.length === 0
  return (
    <div className="card space-y-3">
      <h2 className="text-sm font-semibold text-[var(--text-primary)] flex items-center gap-2">
        <ShieldAlert size={16} className="text-amber-400" /> Needs attention
      </h2>
      {clean ? (
        <p className="text-sm text-[var(--text-muted)] flex items-center gap-2">
          <CheckCircle2 size={15} className="text-green-400" /> All calibrations current and no data-quality issues.
        </p>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <AttentionList title="Calibration overdue" icon={ShieldAlert} tone="text-red-300" items={overdue} onOpen={onOpen} emptyLabel="Nothing overdue." />
          <AttentionList title="Due soon (30d)" icon={CalendarClock} tone="text-amber-300" items={dueSoon} onOpen={onOpen} emptyLabel="Nothing due soon." />
          <AttentionList title="Data-quality flags" icon={AlertTriangle} tone="text-amber-300" items={dataQuality} onOpen={onOpen} emptyLabel="Records complete." />
        </div>
      )}
    </div>
  )
}

// ─── Page ─────────────────────────────────────────────────────────────────────
export default function Equipment() {
  const { activeCountry } = useSettings()
  const { profile } = useAuth() || {}
  const canWrite = WRITE_ROLES.includes(profile?.role)

  const [rows, setRows] = useState(null)
  const [error, setError] = useState('')
  const [missing, setMissing] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [updatedAt, setUpdatedAt] = useState(null)

  const [statusFilter, setStatusFilter] = useState('all')
  const [typeFilter, setTypeFilter] = useState('')
  const [siteFilter, setSiteFilter] = useState('')
  const [calFilter, setCalFilter] = useState('all')
  const [search, setSearch] = useState('')

  const [modal, setModal] = useState(null)   // { item } | null
  const [toDelete, setToDelete] = useState(null)

  const [showAnalytics, setShowAnalytics] = useState(true)

  const load = useCallback(async () => {
    setRefreshing(true); setError(''); setMissing(false)
    try {
      const data = await listAllEquipment({ country: activeCountry })
      setRows(Array.isArray(data) ? data : [])
      setUpdatedAt(new Date())
    } catch (err) {
      if (isMissingRelation(err)) { setMissing(true); setRows([]) }
      else { setError(toUserMessage(err, 'Could not load equipment.')); setRows([]) }
    } finally {
      setRefreshing(false)
    }
  }, [activeCountry])

  useEffect(() => { load() }, [load])

  // Freeze "now" per successful data load so summaries stay stable between renders.
  const now = updatedAt?.getTime() ?? 0
  const summary = useMemo(() => summarizeEquipment(rows || [], now), [rows, now])
  const analytics = useMemo(() => equipmentAnalytics(rows || [], now), [rows, now])
  const attention = useMemo(() => equipmentAttention(rows || [], now), [rows, now])

  const loading = rows === null
  // A failed read is not "no equipment": figures read N/A until a retry works.
  const unknown = loading || !!error

  const typeOptions = useMemo(() => distinctValues(rows || [], 'equipment_type'), [rows])
  const siteOptions = useMemo(() => distinctValues(rows || [], 'site'), [rows])

  const filtered = useMemo(
    () => filterEquipment(rows || [], { status: statusFilter, type: typeFilter, site: siteFilter, calibration: calFilter, search }, now),
    [rows, statusFilter, typeFilter, siteFilter, calFilter, search, now],
  )

  const onSaved = useCallback((row, editing) => {
    setModal(null)
    if (!row) { load(); return }
    setRows((prev) => {
      const list = prev || []
      return editing ? list.map((r) => (r.id === row.id ? { ...r, ...row } : r)) : [row, ...list]
    })
    setUpdatedAt(new Date())
  }, [load])

  // Errors propagate to DeleteConfirm, which shows them next to the button.
  const confirmDelete = useCallback(async () => {
    if (!toDelete) return
    await deleteEquipment(toDelete.id)
    setRows((prev) => (prev || []).filter((r) => r.id !== toDelete.id))
    setToDelete(null)
  }, [toDelete])

  const clearFilters = () => { setStatusFilter('all'); setTypeFilter(''); setSiteFilter(''); setCalFilter('all'); setSearch('') }
  const hasFilters = statusFilter !== 'all' || typeFilter || siteFilter || calFilter !== 'all' || search

  // Export (includes computed age on record + calibration status)
  const EXPORT_COLS = ['name', 'equipment_type', 'serial_no', 'site', 'condition', 'calibration_due', 'calibration_status', 'age_on_record', 'status']
  const EXPORT_HEADERS = ['Name', 'Type', 'Serial', 'Site', 'Condition', 'Calibration due', 'Calibration status', 'Age on record', 'Status']
  // The register pages AND sorts across the whole filtered set; exports cover it in full.
  const columns = useMemo(() => [
    { id: 'name', header: 'Name', accessorFn: (r) => r.name || 'N/A', size: 180,
      cell: ({ row }) => <span className="font-medium text-[var(--text-primary)]">{row.original.name || 'N/A'}</span> },
    { id: 'equipment_type', header: 'Type', accessorFn: (r) => r.equipment_type || 'N/A', size: 130 },
    { id: 'serial_no', header: 'Serial', accessorFn: (r) => r.serial_no || 'N/A', size: 130,
      cell: ({ row }) => <span className="font-mono text-xs">{row.original.serial_no || 'N/A'}</span> },
    { id: 'site', header: 'Site', accessorFn: (r) => r.site || 'N/A', size: 110 },
    { id: 'condition', header: 'Condition', accessorFn: (r) => r.condition || 'N/A', size: 120 },
    { id: 'age', header: 'Age on record', accessorFn: (r) => ageOnRecordYears(r, now), sortUndefined: 'last', size: 120, meta: { align: 'right', exportValue: (r) => fmtYears(ageOnRecordYears(r, now)) },
      cell: ({ row }) => fmtYears(ageOnRecordYears(row.original, now)) },
    { id: 'calibration_due', header: 'Calibration due', accessorFn: (r) => r.calibration_due || '', size: 170,
      cell: ({ row }) => {
        const r = row.original
        const cs = calibrationState(r, now)
        const cm = CAL_META[cs]
        return r.calibration_due ? (
          <span className="inline-flex items-center gap-2">
            <span className={cs === 'overdue' ? 'text-red-300 font-medium' : 'text-[var(--text-secondary)]'}>{fmtDate(r.calibration_due)}</span>
            {cs !== 'none' && cs !== 'ok' && <span className={`badge text-[10px] px-1.5 py-0.5 rounded ${cm.cls}`}>{cm.label}</span>}
          </span>
        ) : <span className="text-[var(--text-muted)]">N/A</span>
      } },
    { id: 'status', header: 'Status', accessorFn: (r) => STATUS_META[r.status]?.label || r.status || 'N/A', size: 120,
      cell: ({ row }) => { const st = STATUS_META[row.original.status] || STATUS_META.available; return <span className={`badge text-[11px] px-2 py-0.5 rounded ${st.cls}`}>{st.label}</span> } },
    ...(canWrite ? [{
      id: 'actions', header: '', enableSorting: false, size: 110, meta: { export: false, align: 'right' },
      cell: ({ row }) => (
        <div className="flex items-center justify-end gap-1">
          <button type="button" onClick={(e) => { e.stopPropagation(); setModal({ item: row.original }) }} className="min-w-[44px] min-h-[44px] inline-flex items-center justify-center rounded-lg text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--input-bg)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--brand-bright)]" aria-label={`Edit ${row.original.name || 'equipment'}`}><Pencil size={14} /></button>
          <button type="button" onClick={(e) => { e.stopPropagation(); setToDelete(row.original) }} className="min-w-[44px] min-h-[44px] inline-flex items-center justify-center rounded-lg text-[var(--text-muted)] hover:text-red-400 hover:bg-[var(--input-bg)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-red-400" aria-label={`Delete ${row.original.name || 'equipment'}`}><Trash2 size={14} /></button>
        </div>
      ),
    }] : []),
  ], [now, canWrite])

  const exportRows = filtered.map((r) => ({
    name: r.name || '', equipment_type: r.equipment_type || '', serial_no: r.serial_no || '',
    site: r.site || '', condition: r.condition || '', calibration_due: r.calibration_due || '',
    calibration_status: CAL_META[calibrationState(r, now)]?.label || 'N/A',
    age_on_record: fmtYears(ageOnRecordYears(r, now)),
    status: STATUS_META[r.status]?.label || r.status || '',
  }))
  const exportFile = reportFileName('Equipment Registry', activeCountry)

  const availPct = analytics.availability.availabilityPct
  const kpis = [
    { label: 'Total equipment', value: summary.total, icon: Wrench, tone: 'text-[var(--text-primary)]' },
    { label: 'Available now', value: summary.available, icon: PackageCheck, tone: 'text-green-400' },
    { label: 'In maintenance', value: summary.maintenance, icon: Gauge, tone: 'text-amber-400' },
    { label: 'Availability', value: availPct == null ? 'N/A' : `${Math.round(availPct)}%`, icon: Activity, tone: 'text-sky-400', hint: 'Operational share of non-retired assets' },
    { label: 'Calibration overdue', value: analytics.calibration.overdue, icon: ShieldAlert, tone: 'text-red-400' },
    { label: 'Due soon (30d)', value: analytics.calibration.dueSoon, icon: CalendarClock, tone: 'text-amber-400' },
    { label: 'Categories', value: analytics.types, icon: Layers, tone: 'text-[var(--text-primary)]' },
    { label: 'Data-quality flags', value: analytics.dataQuality.flagged, icon: AlertTriangle, tone: analytics.dataQuality.flagged ? 'text-amber-400' : 'text-green-400' },
  ]

  // ── Chart data (non-semantic fills from the report palette; status/calibration semantic) ──
  const CHART_OPTS = {
    responsive: true, maintainAspectRatio: false,
    plugins: { legend: { labels: { color: 'var(--text-secondary)', boxWidth: 12, font: { size: 11 } } } },
    scales: {
      x: { ticks: { color: 'var(--text-muted)', font: { size: 10 } }, grid: { color: 'var(--panel-2)' } },
      y: { beginAtZero: true, ticks: { color: 'var(--text-muted)', precision: 0 }, grid: { color: 'var(--panel-2)' } },
    },
  }
  const NO_SCALE = {
    responsive: true, maintainAspectRatio: false,
    plugins: { legend: { position: 'bottom', labels: { color: 'var(--text-secondary)', boxWidth: 12, font: { size: 11 } } } },
  }

  const topCategories = analytics.byCategory.slice(0, 8)
  const categoryChart = {
    labels: topCategories.map((c) => c.label),
    datasets: [{ data: topCategories.map((c) => c.count), backgroundColor: topCategories.map((_, i) => colorAt(i)), borderWidth: 0 }],
  }
  const STATUS_ORDER = ['available', 'in_use', 'maintenance', 'retired']
  const STATUS_FILL = { available: ACCENTS.good, in_use: ACCENTS.info, maintenance: ACCENTS.watch, retired: ACCENTS.neutral }
  const statusChart = {
    labels: STATUS_ORDER.map((s) => STATUS_META[s]?.label || s),
    datasets: [{ label: 'Equipment', data: STATUS_ORDER.map((s) => analytics.byStatus[s] || 0), backgroundColor: STATUS_ORDER.map((s) => withAlpha(STATUS_FILL[s], 0.85)), borderRadius: 4 }],
  }
  const ageChart = {
    labels: analytics.ageBands.map((b) => b.band),
    datasets: [{ label: 'Assets', data: analytics.ageBands.map((b) => b.count), backgroundColor: analytics.ageBands.map((_, i) => withAlpha(colorAt(i), 0.85)), borderRadius: 4 }],
  }
  const CAL_ORDER = ['overdue', 'due_soon', 'ok', 'none']
  const CAL_FILL = { overdue: ACCENTS.risk, due_soon: ACCENTS.watch, ok: ACCENTS.good, none: ACCENTS.neutral }
  const calMap = { overdue: analytics.calibration.overdue, due_soon: analytics.calibration.dueSoon, ok: analytics.calibration.ok, none: analytics.calibration.none }
  const calibrationChart = {
    labels: CAL_ORDER.map((k) => CAL_META[k].label),
    datasets: [{ data: CAL_ORDER.map((k) => calMap[k]), backgroundColor: CAL_ORDER.map((k) => CAL_FILL[k]), borderWidth: 0 }],
  }
  const hasData = (rows?.length || 0) > 0

  return (
    <div className="space-y-6">
      <PageHeader
        title="Tool & Equipment Registry"
        subtitle="Workshop tools & equipment - serial, assigned site, condition, calibration and lifecycle status."
        icon={Wrench}
        onRefresh={load}
        refreshing={refreshing}
        updatedAt={updatedAt}
        actions={
          <div className="flex items-center gap-2">
            <button onClick={async () => { try { await exportToExcel(exportRows, EXPORT_COLS, EXPORT_HEADERS, exportFile) } catch (e) { setError(toUserMessage(e, 'Could not export. Try again.')) } }} className="btn-secondary text-sm inline-flex items-center gap-1.5" disabled={!filtered.length}>
              <FileSpreadsheet size={14} /> Excel
            </button>
            <button onClick={async () => { try { await exportToPdf(exportRows, EXPORT_COLS.map((k, i) => ({ key: k, header: EXPORT_HEADERS[i] })), 'Tool & Equipment Registry', exportFile, 'landscape') } catch (e) { setError(toUserMessage(e, 'Could not export. Try again.')) } }} className="btn-secondary text-sm inline-flex items-center gap-1.5" disabled={!filtered.length}>
              <FileText size={14} /> PDF
            </button>
            {canWrite && (
              <button onClick={() => setModal({ item: null })} className="btn-primary text-sm inline-flex items-center gap-1.5">
                <Plus size={14} /> Register
              </button>
            )}
          </div>
        }
      />

      {missing && (
        <div className="card border border-amber-800/50 flex items-start gap-3">
          <AlertTriangle size={18} className="text-amber-400 mt-0.5 shrink-0" />
          <div>
            <p className="text-amber-300 font-medium">The equipment registry is not enabled on this database yet.</p>
            <p className="text-[var(--text-muted)] text-sm mt-1">
              Apply <span className="font-mono text-[var(--text-primary)]">MIGRATIONS_V150_EQUIPMENT.sql</span>, then reload.
            </p>
          </div>
        </div>
      )}

      {error && (
        <div role="alert" className="card border border-red-800/50 flex items-start justify-between gap-3">
          <div className="flex items-start gap-3">
            <AlertTriangle size={18} className="text-red-400 mt-0.5 shrink-0" aria-hidden="true" />
            <div><p className="text-red-300 font-medium">Could not load equipment.</p><p className="text-[var(--text-muted)] text-sm mt-1">{error}</p></div>
          </div>
          <button type="button" onClick={load} className="btn-secondary text-sm inline-flex items-center gap-1.5 shrink-0 min-h-[44px]"><RefreshCw size={14} aria-hidden="true" /> Retry</button>
        </div>
      )}

      {/* KPI tiles */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {kpis.map((k) => {
          const Icon = k.icon
          return (
            <div key={k.label} className="card" title={k.hint || ''}>
              <div className="flex items-center justify-between">
                <p className="text-xs text-[var(--text-muted)]">{k.label}</p>
                <Icon size={16} className={k.tone} aria-hidden="true" />
              </div>
              <p className={`text-2xl lg:text-3xl font-bold mt-1 ${k.tone}`}>{unknown ? 'N/A' : k.value}</p>
            </div>
          )
        })}
      </div>

      {/* Needs attention */}
      {!unknown && !missing && (
        <NeedsAttention
          attention={attention}
          onOpen={canWrite ? (r) => setModal({ item: r }) : null}
        />
      )}

      {/* Analytics */}
      {!unknown && !missing && (
        <div className="card space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-[var(--text-primary)] flex items-center gap-2">
              <BarChart2 size={16} className="text-[var(--brand-bright)]" /> Fleet analytics
            </h2>
            <button type="button" onClick={() => setShowAnalytics((v) => !v)} className="btn-secondary text-xs min-h-[44px]" aria-expanded={showAnalytics}>
              {showAnalytics ? 'Hide' : 'Show'}
            </button>
          </div>

          {!hasData ? (
            <p className="text-sm text-[var(--text-muted)] py-6 text-center">
              No equipment registered yet, so there is nothing to chart. Register an item to see analytics.
            </p>
          ) : showAnalytics && (
            <>
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                <ChartCard title="By category" icon={PieChart} caption={`${analytics.types} categorised`}>
                  <Doughnut data={categoryChart} options={NO_SCALE} />
                </ChartCard>
                <ChartCard title="By status" icon={Activity}>
                  <Bar data={statusChart} options={CHART_OPTS} />
                </ChartCard>
                <ChartCard title="Age on record" icon={Clock} caption={`Avg ${fmtYears(analytics.avgAgeYears)} on record`}>
                  <Bar data={ageChart} options={CHART_OPTS} />
                </ChartCard>
                <ChartCard title="Calibration status" icon={ClipboardCheck} caption={`${analytics.calibration.tracked} tracked`}>
                  <Doughnut data={calibrationChart} options={NO_SCALE} />
                </ChartCard>
              </div>

              {analytics.bySite.length > 0 && (
                <div>
                  <p className="text-xs uppercase tracking-wider text-[var(--text-muted)] mb-2 flex items-center gap-1.5">
                    <MapPin size={13} /> By site
                  </p>
                  <div className="flex flex-wrap gap-2">
                    {analytics.bySite.slice(0, 12).map((s, i) => (
                      <span key={s.label} className="inline-flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-lg bg-[var(--input-bg)] border border-[var(--input-border)]">
                        <span className="inline-block w-2 h-2 rounded-full" style={{ background: colorAt(i) }} />
                        <span className="text-[var(--text-secondary)]">{s.label}</span>
                        <span className="font-semibold text-[var(--text-primary)]">{s.count}</span>
                      </span>
                    ))}
                  </div>
                </div>
              )}
              <p className="text-[11px] text-[var(--text-dim)]">
                Age is measured from the date an asset was entered on record (registry tenure), not
                its in-service life. Purchase cost, purchase date and warranty are not tracked on the
                equipment record, so value / depreciation and warranty analytics are not shown.
              </p>
            </>
          )}
        </div>
      )}

      {/* Filters */}
      <div className="card space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative flex-1 min-w-[200px]">
            <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" />
            <input className="input pl-9 w-full" aria-label="Search equipment" placeholder="Search name, serial, type, site..." value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
          <select className="input" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} aria-label="Status">
            <option value="all">All statuses</option>
            {EQUIPMENT_STATUSES.map((s) => <option key={s} value={s}>{STATUS_META[s]?.label || s}</option>)}
          </select>
          <select className="input" value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)} aria-label="Type">
            <option value="">All types</option>
            {typeOptions.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
          <select className="input" value={siteFilter} onChange={(e) => setSiteFilter(e.target.value)} aria-label="Site">
            <option value="">All sites</option>
            {siteOptions.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
          <select className="input" value={calFilter} onChange={(e) => setCalFilter(e.target.value)} aria-label="Calibration">
            <option value="all">All calibration states</option>
            {['overdue', 'due_soon', 'ok', 'none'].map((k) => <option key={k} value={k}>{k === 'none' ? 'Not tracked' : CAL_META[k].label}</option>)}
          </select>
          {hasFilters && <button type="button" onClick={clearFilters} className="btn-secondary text-sm inline-flex items-center gap-1.5 min-h-[44px]"><X size={14} aria-hidden="true" /> Clear</button>}
          <span className="text-xs text-[var(--text-muted)] ml-auto">{filtered.length} of {summary.total}</span>
        </div>
      </div>

      {/* Register */}
      <EnterpriseTable
        columns={columns}
        data={filtered}
        getRowId={(r) => String(r.id)}
        loading={loading}
        error={error || null}
        onRetry={load}
        enableGlobalFilter={false}
        enableExport={false}
        viewKey="equipment-registry"
        initialPageSize={25}
        emptyMessage={(rows || []).length === 0 ? 'No equipment registered yet.' : 'No equipment matches these filters.'}
        emptyIcon={<Wrench size={22} className="opacity-60" aria-hidden="true" />}
        onRowClick={canWrite ? (r) => setModal({ item: r }) : undefined}
      />

      {modal && <EquipmentModal initial={modal.item} onClose={() => setModal(null)} onSaved={onSaved} />}
      {toDelete && <DeleteConfirm item={toDelete} onCancel={() => setToDelete(null)} onConfirm={confirmDelete} />}
    </div>
  )
}
