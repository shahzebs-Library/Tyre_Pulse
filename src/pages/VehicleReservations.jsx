/**
 * VehicleReservations (route /vehicle-reservations) — Vehicle Reservations /
 * Motor Pool Booking. Captures bookings of shared pool vehicles per requester
 * over a [start, end) window, whether entered manually, imported from an ERP,
 * or raised from a self-service portal. Detecting double-bookings (same asset,
 * overlapping windows) and tracking what is currently out is the backbone of
 * pool utilisation and availability, so every reservation is org-isolated and
 * country-scoped.
 *
 * Runs on the new `vehicle_reservations` table (V175). Real data, KPI tiles,
 * a conflicts warning strip, create/edit modal, filters, search, delete
 * confirm, Excel/PDF export, and loading/empty/error states throughout. The
 * conflict, duration and KPI roll-ups live in the pure
 * `src/lib/vehicleReservations.js` helpers.
 */
import { useState, useEffect, useMemo, useCallback } from 'react'
import {
  CalendarClock, CalendarCheck, Car, LogOut, AlertTriangle, Search, X, Filter,
  FileSpreadsheet, FileText, Plus, Pencil, Trash2, MapPin, Clock,
} from 'lucide-react'
import PageHeader from '../components/ui/PageHeader'
import { useSettings } from '../contexts/SettingsContext'
import {
  listVehicleReservations, createVehicleReservation,
  updateVehicleReservation, deleteVehicleReservation,
} from '../lib/api/vehicleReservations'
import { summariseReservations, findConflicts, durationHours } from '../lib/vehicleReservations'
import { exportToExcel, exportToPdf } from '../lib/exportUtils'
import { toUserMessage } from '../lib/safeError'

const EMPTY_FORM = {
  reference: '', asset_no: '', requester_name: '', department: '', purpose: '',
  start_at: '', end_at: '', pickup_location: '', return_location: '',
  expected_km: '', status: 'requested', approved_by: '', notes: '',
}

const STATUS_OPTIONS = ['requested', 'approved', 'out', 'returned', 'cancelled']

const STATUS_BADGE = {
  requested: { label: 'Requested', cls: 'bg-sky-900/40 text-sky-300 border-sky-800/50' },
  approved: { label: 'Approved', cls: 'bg-indigo-900/40 text-indigo-300 border-indigo-800/50' },
  out: { label: 'Out', cls: 'bg-amber-900/40 text-amber-300 border-amber-800/50' },
  returned: { label: 'Returned', cls: 'bg-green-900/40 text-green-300 border-green-800/50' },
  cancelled: { label: 'Cancelled', cls: 'bg-slate-800/60 text-slate-400 border-slate-700/50' },
}

function StatusBadge({ status }) {
  const s = STATUS_BADGE[status] || { label: status || '—', cls: 'bg-slate-800/60 text-slate-400 border-slate-700/50' }
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-medium border ${s.cls}`}>
      {s.label}
    </span>
  )
}

const fmtKm = (v) =>
  v == null || v === '' ? '—' : `${Number(v).toLocaleString()} km`

function fmtDateTime(v) {
  if (!v) return '—'
  const d = new Date(v)
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleString()
}

function fmtDuration(res) {
  const h = durationHours(res)
  if (h == null) return '—'
  if (h < 24) return `${Math.round(h * 10) / 10} h`
  return `${Math.round((h / 24) * 10) / 10} d`
}

// Convert an ISO/timestamptz value into the value shape a datetime-local input
// expects (YYYY-MM-DDTHH:mm) in local time.
function toLocalInput(v) {
  if (!v) return ''
  const d = new Date(v)
  if (Number.isNaN(d.getTime())) return ''
  const pad = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

function isMissingRelation(err) {
  const m = String(err?.message || '').toLowerCase()
  return m.includes('does not exist') || m.includes('relation') ||
    m.includes('schema cache') || m.includes('could not find the table')
}

export default function VehicleReservations() {
  const { activeCountry } = useSettings()
  const [rows, setRows] = useState(null)
  const [error, setError] = useState('')
  const [notProvisioned, setNotProvisioned] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [updatedAt, setUpdatedAt] = useState(null)

  const [statusFilter, setStatusFilter] = useState('')
  const [assetFilter, setAssetFilter] = useState('')
  const [search, setSearch] = useState('')

  const [showModal, setShowModal] = useState(false)
  const [editing, setEditing] = useState(null)
  const [form, setForm] = useState(EMPTY_FORM)
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState('')
  const [confirmDelete, setConfirmDelete] = useState(null)
  const [deleting, setDeleting] = useState(false)

  const load = useCallback(async () => {
    setRefreshing(true); setError(''); setNotProvisioned(false)
    try {
      const data = await listVehicleReservations({ country: activeCountry })
      setRows(Array.isArray(data) ? data : [])
      setUpdatedAt(new Date())
    } catch (err) {
      if (isMissingRelation(err)) setNotProvisioned(true)
      else setError(toUserMessage(err, 'Could not load vehicle reservations.'))
      setRows([])
    } finally {
      setRefreshing(false)
    }
  }, [activeCountry])

  useEffect(() => { load() }, [load])

  // Compute "now" once per render so the pure helpers stay deterministic.
  const nowMs = Date.now()
  const summary = useMemo(() => summariseReservations(rows || [], nowMs), [rows, nowMs])
  const conflicts = useMemo(() => findConflicts(rows || []), [rows])

  // Ids that participate in at least one double-booking, for row highlighting.
  const conflictIds = useMemo(() => {
    const s = new Set()
    for (const c of conflicts) { s.add(c.a.id); s.add(c.b.id) }
    return s
  }, [conflicts])

  const assetOptions = useMemo(
    () => [...new Set((rows || []).map((r) => r.asset_no).filter(Boolean))].sort(),
    [rows],
  )

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return (rows || []).filter((r) => {
      if (statusFilter && r.status !== statusFilter) return false
      if (assetFilter && r.asset_no !== assetFilter) return false
      if (q) {
        const hay = `${r.asset_no || ''} ${r.reference || ''} ${r.requester_name || ''} ${r.department || ''} ${r.purpose || ''} ${r.pickup_location || ''} ${r.return_location || ''} ${r.notes || ''}`.toLowerCase()
        if (!hay.includes(q)) return false
      }
      return true
    })
  }, [rows, statusFilter, assetFilter, search])

  // ── KPIs ─────────────────────────────────────────────────────────────────
  const kpis = [
    { label: 'Total reservations', value: summary.totalReservations, icon: CalendarClock, tone: 'text-[var(--text-primary)]' },
    { label: 'Currently out', value: summary.activeOutCount, icon: LogOut, tone: 'text-amber-400' },
    { label: 'Upcoming', value: summary.upcomingCount, icon: CalendarCheck, tone: 'text-sky-400' },
    { label: 'Double-bookings', value: summary.conflictCount, icon: AlertTriangle, tone: summary.conflictCount > 0 ? 'text-red-400' : 'text-green-400' },
  ]

  // ── Export ───────────────────────────────────────────────────────────────
  const EXPORT_COLS = ['reference', 'asset_no', 'requester_name', 'department', 'status', 'start_at', 'end_at', 'duration', 'pickup_location', 'return_location', 'expected_km', 'purpose']
  const EXPORT_HEADERS = ['Reference', 'Asset', 'Requester', 'Department', 'Status', 'Start', 'End', 'Duration (h)', 'Pickup', 'Return', 'Expected km', 'Purpose']
  const exportRows = filtered.map((r) => ({
    reference: r.reference || '', asset_no: r.asset_no || '',
    requester_name: r.requester_name || '', department: r.department || '',
    status: r.status || '', start_at: fmtDateTime(r.start_at), end_at: fmtDateTime(r.end_at),
    duration: durationHours(r) == null ? '' : Math.round(durationHours(r) * 10) / 10,
    pickup_location: r.pickup_location || '', return_location: r.return_location || '',
    expected_km: r.expected_km ?? '', purpose: r.purpose || '',
  }))

  // ── Modal ────────────────────────────────────────────────────────────────
  const openCreate = () => {
    setEditing(null); setForm(EMPTY_FORM); setFormError(''); setShowModal(true)
  }
  const openEdit = (r) => {
    setEditing(r)
    setForm({
      reference: r.reference || '', asset_no: r.asset_no || '',
      requester_name: r.requester_name || '', department: r.department || '',
      purpose: r.purpose || '', start_at: toLocalInput(r.start_at), end_at: toLocalInput(r.end_at),
      pickup_location: r.pickup_location || '', return_location: r.return_location || '',
      expected_km: r.expected_km ?? '', status: r.status || 'requested',
      approved_by: r.approved_by || '', notes: r.notes || '',
    })
    setFormError(''); setShowModal(true)
  }
  const closeModal = () => { if (!saving) { setShowModal(false); setEditing(null) } }
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }))

  const submit = useCallback(async (e) => {
    e?.preventDefault?.()
    setFormError('')
    if (!form.asset_no.trim()) { setFormError('An asset number is required.'); return }
    if (form.start_at && form.end_at && new Date(form.end_at).getTime() <= new Date(form.start_at).getTime()) {
      setFormError('The return time must be after the pickup time.'); return
    }
    setSaving(true)
    try {
      const payload = {
        ...form,
        expected_km: form.expected_km === '' ? null : form.expected_km,
        country: activeCountry !== 'All' ? activeCountry : null,
      }
      if (editing) await updateVehicleReservation(editing.id, payload)
      else await createVehicleReservation(payload)
      setShowModal(false); setEditing(null)
      await load()
    } catch (err) {
      setFormError(toUserMessage(err, 'Could not save the reservation.'))
    } finally {
      setSaving(false)
    }
  }, [form, editing, activeCountry, load])

  const doDelete = useCallback(async () => {
    if (!confirmDelete) return
    setDeleting(true)
    try {
      await deleteVehicleReservation(confirmDelete.id)
      setConfirmDelete(null)
      await load()
    } catch (err) {
      setError(toUserMessage(err, 'Could not delete the reservation.'))
    } finally {
      setDeleting(false)
    }
  }, [confirmDelete, load])

  const clearFilters = () => { setStatusFilter(''); setAssetFilter(''); setSearch('') }
  const hasFilters = statusFilter || assetFilter || search

  return (
    <div className="space-y-6">
      <PageHeader
        title="Vehicle Reservations"
        subtitle="Book and track shared motor-pool vehicles — approvals, check-out/return, and automatic double-booking detection for pool utilisation and availability."
        icon={CalendarClock}
        onRefresh={load}
        refreshing={refreshing}
        updatedAt={updatedAt}
        actions={
          <div className="flex items-center gap-2">
            <button onClick={() => exportToExcel(exportRows, EXPORT_COLS, EXPORT_HEADERS, 'vehicle_reservations')} className="btn-secondary text-sm inline-flex items-center gap-1.5" disabled={!filtered.length}>
              <FileSpreadsheet size={14} /> Excel
            </button>
            <button onClick={() => exportToPdf(exportRows, EXPORT_COLS.map((k, i) => ({ key: k, header: EXPORT_HEADERS[i] })), 'Vehicle Reservations', 'vehicle_reservations', 'landscape')} className="btn-secondary text-sm inline-flex items-center gap-1.5" disabled={!filtered.length}>
              <FileText size={14} /> PDF
            </button>
            <button onClick={openCreate} className="btn-primary text-sm inline-flex items-center gap-1.5" disabled={notProvisioned}>
              <Plus size={14} /> New reservation
            </button>
          </div>
        }
      />

      {notProvisioned && (
        <div className="card border border-amber-800/50 flex items-start gap-3">
          <AlertTriangle size={18} className="text-amber-400 mt-0.5 shrink-0" />
          <div>
            <p className="text-amber-300 font-medium">Vehicle reservations aren’t enabled on this database yet.</p>
            <p className="text-[var(--text-muted)] text-sm mt-1">
              Apply <span className="font-mono text-[var(--text-primary)]">MIGRATIONS_V175_VEHICLE_RESERVATIONS.sql</span>, then reload.
            </p>
          </div>
        </div>
      )}

      {error && (
        <div className="card border border-red-800/50 flex items-start gap-3">
          <AlertTriangle size={18} className="text-red-400 mt-0.5 shrink-0" />
          <div><p className="text-red-300 font-medium">Couldn’t load vehicle reservations.</p><p className="text-[var(--text-muted)] text-sm mt-1">{error}</p></div>
        </div>
      )}

      {/* KPI tiles */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {kpis.map((k) => {
          const Icon = k.icon
          return (
            <div key={k.label} className="card">
              <div className="flex items-center justify-between">
                <p className="text-xs text-[var(--text-muted)]">{k.label}</p>
                <Icon size={16} className={k.tone} />
              </div>
              <p className={`text-3xl font-bold mt-1 ${k.tone}`}>{rows === null ? '—' : k.value}</p>
            </div>
          )
        })}
      </div>

      {/* Conflicts / double-booking warning strip */}
      {rows !== null && conflicts.length > 0 && (
        <div className="card border border-red-800/50">
          <div className="flex items-center gap-2 mb-2">
            <AlertTriangle size={16} className="text-red-400 shrink-0" />
            <h3 className="text-sm font-semibold text-red-300">
              {conflicts.length} double-booking{conflicts.length === 1 ? '' : 's'} detected
            </h3>
          </div>
          <p className="text-xs text-[var(--text-muted)] mb-3">Same asset booked over overlapping time windows. Resolve by rescheduling, reassigning a vehicle, or cancelling one booking.</p>
          <div className="space-y-1.5">
            {conflicts.slice(0, 8).map((c, i) => (
              <div key={i} className="flex flex-wrap items-center gap-2 text-xs bg-red-900/15 border border-red-800/40 rounded-lg px-3 py-2">
                <Car size={13} className="text-red-400 shrink-0" />
                <span className="font-semibold text-[var(--text-primary)]">{c.a.asset_no}</span>
                <span className="text-[var(--text-secondary)]">
                  {c.a.requester_name || c.a.reference || 'Reservation'} ({fmtDateTime(c.a.start_at)} → {fmtDateTime(c.a.end_at)})
                </span>
                <span className="text-red-400">overlaps</span>
                <span className="text-[var(--text-secondary)]">
                  {c.b.requester_name || c.b.reference || 'Reservation'} ({fmtDateTime(c.b.start_at)} → {fmtDateTime(c.b.end_at)})
                </span>
              </div>
            ))}
            {conflicts.length > 8 && <p className="text-xs text-[var(--text-muted)]">+{conflicts.length - 8} more conflicting pairs.</p>}
          </div>
        </div>
      )}

      {/* Filters */}
      <div className="card space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative flex-1 min-w-[200px]">
            <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" />
            <input className="input pl-9 w-full" placeholder="Search asset, requester, reference, purpose…" value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
          <select className="input" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} aria-label="Status">
            <option value="">All statuses</option>
            {STATUS_OPTIONS.map((s) => <option key={s} value={s}>{STATUS_BADGE[s]?.label || s}</option>)}
          </select>
          <select className="input" value={assetFilter} onChange={(e) => setAssetFilter(e.target.value)} aria-label="Asset">
            <option value="">All assets</option>
            {assetOptions.map((a) => <option key={a} value={a}>{a}</option>)}
          </select>
          {hasFilters && <button onClick={clearFilters} className="btn-secondary text-sm inline-flex items-center gap-1.5"><X size={14} /> Clear</button>}
          <span className="text-xs text-[var(--text-muted)] ml-auto">{filtered.length} of {summary.totalReservations}</span>
        </div>
      </div>

      {/* Table */}
      <div className="card overflow-hidden !p-0">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[var(--input-border)] text-left text-xs uppercase tracking-wider text-[var(--text-muted)]">
                {['Asset', 'Requester', 'Status', 'Window', 'Duration', 'Pickup / Return', ''].map((h, i) => <th key={i} className="px-4 py-3 font-semibold whitespace-nowrap">{h}</th>)}
              </tr>
            </thead>
            <tbody>
              {rows === null ? (
                [0, 1, 2, 3, 4].map((i) => <tr key={i} className="border-b border-[var(--input-border)]/50"><td colSpan={7} className="px-4 py-3"><div className="h-4 bg-[var(--input-bg)] rounded animate-pulse" /></td></tr>)
              ) : filtered.length === 0 ? (
                <tr><td colSpan={7} className="px-4 py-12 text-center text-[var(--text-muted)]">
                  <Filter size={22} className="mx-auto mb-2 opacity-60" />
                  {rows.length === 0 && !notProvisioned ? 'No reservations yet — create your first booking.' : 'No reservations match these filters.'}
                </td></tr>
              ) : (
                filtered.slice(0, 500).map((r) => {
                  const conflicted = conflictIds.has(r.id)
                  return (
                    <tr key={r.id} className={`border-b border-[var(--input-border)]/50 hover:bg-[var(--input-bg)]/40 ${conflicted ? 'bg-red-900/10' : ''}`}>
                      <td className="px-4 py-2.5 font-medium text-[var(--text-primary)]">
                        <div className="flex items-center gap-1.5">
                          {conflicted && <AlertTriangle size={13} className="text-red-400 shrink-0" title="Double-booked" />}
                          {r.asset_no || '—'}
                        </div>
                        {r.reference && <span className="block text-[11px] text-[var(--text-muted)]">{r.reference}</span>}
                      </td>
                      <td className="px-4 py-2.5 text-[var(--text-secondary)]">
                        {r.requester_name || '—'}
                        {r.department && <span className="block text-[11px] text-[var(--text-muted)]">{r.department}</span>}
                      </td>
                      <td className="px-4 py-2.5"><StatusBadge status={r.status} /></td>
                      <td className="px-4 py-2.5 text-[var(--text-secondary)] whitespace-nowrap">
                        <span className="flex items-center gap-1"><Clock size={12} className="text-[var(--text-muted)]" />{fmtDateTime(r.start_at)}</span>
                        <span className="block text-[11px] text-[var(--text-muted)]">→ {fmtDateTime(r.end_at)}</span>
                      </td>
                      <td className="px-4 py-2.5 text-[var(--text-secondary)] whitespace-nowrap">{fmtDuration(r)}</td>
                      <td className="px-4 py-2.5 text-[var(--text-secondary)]">
                        {(r.pickup_location || r.return_location) ? (
                          <span className="flex items-center gap-1 text-xs"><MapPin size={12} className="text-[var(--text-muted)]" />{r.pickup_location || '—'} → {r.return_location || '—'}</span>
                        ) : '—'}
                      </td>
                      <td className="px-4 py-2.5">
                        <div className="flex items-center justify-end gap-1">
                          <button onClick={() => openEdit(r)} className="p-1.5 rounded hover:bg-[var(--input-bg)] text-[var(--text-muted)] hover:text-[var(--text-primary)]" aria-label="Edit"><Pencil size={14} /></button>
                          <button onClick={() => setConfirmDelete(r)} className="p-1.5 rounded hover:bg-red-900/30 text-[var(--text-muted)] hover:text-red-400" aria-label="Delete"><Trash2 size={14} /></button>
                        </div>
                      </td>
                    </tr>
                  )
                })
              )}
            </tbody>
          </table>
        </div>
        {filtered.length > 500 && <p className="px-4 py-2 text-xs text-[var(--text-muted)] border-t border-[var(--input-border)]">Showing first 500 — refine filters or export for the full set.</p>}
      </div>

      {/* Create / Edit modal */}
      {showModal && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/70 p-4" onClick={closeModal}>
          <div className="card w-full max-w-2xl max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-bold text-[var(--text-primary)]">{editing ? 'Edit reservation' : 'New reservation'}</h3>
              <button onClick={closeModal} className="text-[var(--text-muted)] hover:text-[var(--text-primary)]"><X size={18} /></button>
            </div>
            <form onSubmit={submit} className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="label">Asset number</label>
                  <input className="input w-full" placeholder="e.g. POOL-07" value={form.asset_no} maxLength={120} onChange={(e) => set('asset_no', e.target.value)} />
                </div>
                <div>
                  <label className="label">Reference (optional)</label>
                  <input className="input w-full" placeholder="e.g. RES-2026-014" value={form.reference} maxLength={120} onChange={(e) => set('reference', e.target.value)} />
                </div>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="label">Requester (optional)</label>
                  <input className="input w-full" placeholder="e.g. A. Rahman" value={form.requester_name} maxLength={200} onChange={(e) => set('requester_name', e.target.value)} />
                </div>
                <div>
                  <label className="label">Department (optional)</label>
                  <input className="input w-full" placeholder="e.g. Operations" value={form.department} maxLength={200} onChange={(e) => set('department', e.target.value)} />
                </div>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="label">Pickup (start)</label>
                  <input className="input w-full" type="datetime-local" value={form.start_at} onChange={(e) => set('start_at', e.target.value)} />
                </div>
                <div>
                  <label className="label">Return (end)</label>
                  <input className="input w-full" type="datetime-local" value={form.end_at} onChange={(e) => set('end_at', e.target.value)} />
                </div>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="label">Pickup location (optional)</label>
                  <input className="input w-full" placeholder="e.g. Riyadh depot" value={form.pickup_location} maxLength={200} onChange={(e) => set('pickup_location', e.target.value)} />
                </div>
                <div>
                  <label className="label">Return location (optional)</label>
                  <input className="input w-full" placeholder="e.g. Riyadh depot" value={form.return_location} maxLength={200} onChange={(e) => set('return_location', e.target.value)} />
                </div>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div>
                  <label className="label">Status</label>
                  <select className="input w-full" value={form.status} onChange={(e) => set('status', e.target.value)}>
                    {STATUS_OPTIONS.map((s) => <option key={s} value={s}>{STATUS_BADGE[s]?.label || s}</option>)}
                  </select>
                </div>
                <div>
                  <label className="label">Expected distance (km)</label>
                  <input className="input w-full" type="number" step="1" min="0" placeholder="120" value={form.expected_km} onChange={(e) => set('expected_km', e.target.value)} />
                </div>
                <div>
                  <label className="label">Approved by (optional)</label>
                  <input className="input w-full" placeholder="e.g. Fleet manager" value={form.approved_by} maxLength={200} onChange={(e) => set('approved_by', e.target.value)} />
                </div>
              </div>
              <div>
                <label className="label">Purpose (optional)</label>
                <input className="input w-full" placeholder="e.g. Site inspection run" value={form.purpose} maxLength={500} onChange={(e) => set('purpose', e.target.value)} />
              </div>
              <div>
                <label className="label">Notes (optional)</label>
                <textarea className="input w-full min-h-[80px] resize-y" placeholder="e.g. driver to collect keys from reception" value={form.notes} maxLength={8000} onChange={(e) => set('notes', e.target.value)} />
              </div>

              {formError && (
                <div className="flex items-start gap-2 text-sm text-red-300 bg-red-900/20 border border-red-800/50 rounded-lg px-3 py-2">
                  <AlertTriangle size={15} className="mt-0.5 shrink-0" /> {formError}
                </div>
              )}

              <div className="flex items-center justify-end gap-2 pt-1">
                <button type="button" onClick={closeModal} className="btn-secondary text-sm" disabled={saving}>Cancel</button>
                <button type="submit" className="btn-primary text-sm inline-flex items-center gap-1.5 disabled:opacity-60" disabled={saving}>
                  {saving ? 'Saving…' : editing ? 'Save changes' : 'Create reservation'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Delete confirm */}
      {confirmDelete && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/70 p-4" onClick={() => !deleting && setConfirmDelete(null)}>
          <div className="card w-full max-w-sm" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-start gap-3">
              <div className="w-10 h-10 rounded-full bg-red-900/30 flex items-center justify-center shrink-0"><Trash2 size={18} className="text-red-400" /></div>
              <div>
                <h3 className="text-[var(--text-primary)] font-semibold">Delete this reservation?</h3>
                <p className="text-sm text-[var(--text-muted)] mt-1">
                  {confirmDelete.asset_no || 'Reservation'} · {confirmDelete.requester_name || confirmDelete.reference || '—'} · {fmtDateTime(confirmDelete.start_at)}. This can’t be undone.
                </p>
              </div>
            </div>
            <div className="flex items-center justify-end gap-2 mt-5">
              <button onClick={() => setConfirmDelete(null)} className="btn-secondary text-sm" disabled={deleting}>Cancel</button>
              <button onClick={doDelete} className="btn-danger text-sm inline-flex items-center gap-1.5 disabled:opacity-60" disabled={deleting}>
                <Trash2 size={14} /> {deleting ? 'Deleting…' : 'Delete'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
