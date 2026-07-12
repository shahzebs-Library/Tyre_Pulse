/**
 * HoursOfService (route /hours-of-service) — Hours of Service (ELD) / Driver
 * Duty Status. Captures time-series driver duty-status segments (off duty,
 * sleeper berth, driving, on duty), whether entered manually, imported from an
 * ERP, or read off an Electronic Logging Device (ELD). Driver-hours history is
 * the backbone of fatigue-risk, safety, and HOS compliance reporting, so every
 * log is org-isolated and country-scoped.
 *
 * Runs on the new `hos_logs` table (V172). Real data, KPI tiles, per-driver-day
 * compliance table (flags over-hours breaches), create/edit modal with a
 * violation toggle, filters, search, delete confirm, Excel/PDF export, and
 * loading/empty/error states throughout. Per-driver-day roll-ups and the fleet
 * KPI summary live in the pure `src/lib/hosLogs.js` helpers.
 */
import { useState, useEffect, useMemo, useCallback } from 'react'
import {
  Clock, Users, Timer, ShieldAlert, AlertTriangle, Search, X, Filter,
  FileSpreadsheet, FileText, Plus, Pencil, Trash2, CalendarClock,
} from 'lucide-react'
import PageHeader from '../components/ui/PageHeader'
import { useSettings } from '../contexts/SettingsContext'
import {
  listHosLogs, createHosLog, updateHosLog, deleteHosLog,
} from '../lib/api/hosLogs'
import {
  summariseHos, driverDaySummary, DAILY_DRIVE_LIMIT_MIN, DAILY_DUTY_LIMIT_MIN,
} from '../lib/hosLogs'
import { exportToExcel, exportToPdf } from '../lib/exportUtils'

const EMPTY_FORM = {
  driver_name: '', asset_no: '', log_date: '', duty_status: 'driving',
  start_time: '', end_time: '', duration_min: '', distance_km: '',
  location: '', remarks: '', violation: false, violation_type: '', notes: '',
}

const DUTY_OPTIONS = [
  { value: 'off_duty', label: 'Off duty' },
  { value: 'sleeper', label: 'Sleeper berth' },
  { value: 'driving', label: 'Driving' },
  { value: 'on_duty', label: 'On duty (not driving)' },
]

const DUTY_META = {
  off_duty: { label: 'Off duty', cls: 'bg-slate-700/40 text-slate-300 border-slate-600/50' },
  sleeper: { label: 'Sleeper', cls: 'bg-indigo-900/30 text-indigo-300 border-indigo-700/50' },
  driving: { label: 'Driving', cls: 'bg-sky-900/30 text-sky-300 border-sky-700/50' },
  on_duty: { label: 'On duty', cls: 'bg-amber-900/30 text-amber-300 border-amber-700/50' },
}

const fmtHm = (min) => {
  const n = Number(min)
  if (!Number.isFinite(n) || n <= 0) return '0h 00m'
  const h = Math.floor(n / 60)
  const m = Math.round(n % 60)
  return `${h}h ${String(m).padStart(2, '0')}m`
}

const fmtMin = (v) => (v == null || v === '' ? '—' : `${Number(v).toLocaleString()} min`)
const fmtKm = (v) => (v == null || v === '' ? '—' : `${Number(v).toLocaleString()} km`)

function fmtDate(v) {
  if (!v) return '—'
  const d = new Date(v)
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleDateString()
}

function fmtTime(v) {
  if (!v) return '—'
  const d = new Date(v)
  return Number.isNaN(d.getTime())
    ? '—'
    : d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

/** ISO string → value for a datetime-local input (local time, no seconds). */
function toLocalInput(v) {
  if (!v) return ''
  const d = new Date(v)
  if (Number.isNaN(d.getTime())) return ''
  const off = d.getTimezoneOffset()
  const local = new Date(d.getTime() - off * 60000)
  return local.toISOString().slice(0, 16)
}

function dutyBadge(status) {
  const meta = DUTY_META[status]
  if (!meta) return <span className="text-[var(--text-muted)]">—</span>
  return (
    <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium ${meta.cls}`}>
      {meta.label}
    </span>
  )
}

function isMissingRelation(err) {
  const m = String(err?.message || '').toLowerCase()
  return m.includes('does not exist') || m.includes('relation') ||
    m.includes('schema cache') || m.includes('could not find the table')
}

export default function HoursOfService() {
  const { activeCountry } = useSettings()
  const [rows, setRows] = useState(null)
  const [error, setError] = useState('')
  const [notProvisioned, setNotProvisioned] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [updatedAt, setUpdatedAt] = useState(null)

  const [driverFilter, setDriverFilter] = useState('')
  const [dutyFilter, setDutyFilter] = useState('')
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
      const data = await listHosLogs({ country: activeCountry })
      setRows(Array.isArray(data) ? data : [])
      setUpdatedAt(new Date())
    } catch (err) {
      if (isMissingRelation(err)) setNotProvisioned(true)
      else setError(err?.message || 'Could not load hours-of-service logs.')
      setRows([])
    } finally {
      setRefreshing(false)
    }
  }, [activeCountry])

  useEffect(() => { load() }, [load])

  const summary = useMemo(() => summariseHos(rows || []), [rows])
  const daySummary = useMemo(() => driverDaySummary(rows || []), [rows])

  const driverOptions = useMemo(
    () => [...new Set((rows || []).map((r) => r.driver_name).filter(Boolean))].sort(),
    [rows],
  )

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return (rows || []).filter((r) => {
      if (driverFilter && r.driver_name !== driverFilter) return false
      if (dutyFilter && r.duty_status !== dutyFilter) return false
      if (q) {
        const hay = `${r.driver_name || ''} ${r.asset_no || ''} ${r.location || ''} ${r.remarks || ''} ${r.violation_type || ''} ${r.notes || ''}`.toLowerCase()
        if (!hay.includes(q)) return false
      }
      return true
    })
  }, [rows, driverFilter, dutyFilter, search])

  // Compliance roll-up sorted worst-first (breaches on top, then most driving).
  const compliance = useMemo(
    () =>
      daySummary
        .slice()
        .sort((a, b) =>
          Number(b.overHours) - Number(a.overHours) || b.drivingMin - a.drivingMin),
    [daySummary],
  )

  // ── KPIs ─────────────────────────────────────────────────────────────────
  const kpis = [
    { label: 'Logs recorded', value: summary.totalLogs, icon: Clock, tone: 'text-[var(--text-primary)]' },
    { label: 'Drivers tracked', value: summary.distinctDrivers, icon: Users, tone: 'text-sky-400' },
    { label: 'Driving hours', value: `${summary.drivingHours.toLocaleString()} h`, icon: Timer, tone: 'text-amber-400' },
    { label: 'Violations', value: summary.violationsCount, icon: ShieldAlert, tone: summary.violationsCount > 0 ? 'text-red-400' : 'text-green-400' },
  ]

  // ── Export ───────────────────────────────────────────────────────────────
  const EXPORT_COLS = ['driver_name', 'asset_no', 'log_date', 'duty_status', 'start_time', 'end_time', 'duration_min', 'distance_km', 'location', 'violation', 'violation_type', 'remarks']
  const EXPORT_HEADERS = ['Driver', 'Asset', 'Log date', 'Duty status', 'Start', 'End', 'Duration (min)', 'Distance (km)', 'Location', 'Violation', 'Violation type', 'Remarks']
  const exportRows = filtered.map((r) => ({
    driver_name: r.driver_name || '', asset_no: r.asset_no || '',
    log_date: r.log_date || '', duty_status: DUTY_META[r.duty_status]?.label || r.duty_status || '',
    start_time: r.start_time || '', end_time: r.end_time || '',
    duration_min: r.duration_min ?? '', distance_km: r.distance_km ?? '',
    location: r.location || '', violation: r.violation ? 'Yes' : 'No',
    violation_type: r.violation_type || '', remarks: r.remarks || '',
  }))

  // ── Modal ────────────────────────────────────────────────────────────────
  const openCreate = () => {
    setEditing(null); setForm(EMPTY_FORM); setFormError(''); setShowModal(true)
  }
  const openEdit = (r) => {
    setEditing(r)
    setForm({
      driver_name: r.driver_name || '', asset_no: r.asset_no || '',
      log_date: r.log_date || '', duty_status: r.duty_status || 'driving',
      start_time: toLocalInput(r.start_time), end_time: toLocalInput(r.end_time),
      duration_min: r.duration_min ?? '', distance_km: r.distance_km ?? '',
      location: r.location || '', remarks: r.remarks || '',
      violation: !!r.violation, violation_type: r.violation_type || '',
      notes: r.notes || '',
    })
    setFormError(''); setShowModal(true)
  }
  const closeModal = () => { if (!saving) { setShowModal(false); setEditing(null) } }
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }))

  const submit = useCallback(async (e) => {
    e?.preventDefault?.()
    setFormError('')
    if (!form.driver_name.trim()) { setFormError('A driver name is required.'); return }
    setSaving(true)
    try {
      const payload = {
        ...form,
        start_time: form.start_time ? new Date(form.start_time).toISOString() : null,
        end_time: form.end_time ? new Date(form.end_time).toISOString() : null,
        country: activeCountry !== 'All' ? activeCountry : null,
      }
      if (editing) await updateHosLog(editing.id, payload)
      else await createHosLog(payload)
      setShowModal(false); setEditing(null)
      await load()
    } catch (err) {
      setFormError(err?.message || 'Could not save the log.')
    } finally {
      setSaving(false)
    }
  }, [form, editing, activeCountry, load])

  const doDelete = useCallback(async () => {
    if (!confirmDelete) return
    setDeleting(true)
    try {
      await deleteHosLog(confirmDelete.id)
      setConfirmDelete(null)
      await load()
    } catch (err) {
      setError(err?.message || 'Could not delete the log.')
    } finally {
      setDeleting(false)
    }
  }, [confirmDelete, load])

  const clearFilters = () => { setDriverFilter(''); setDutyFilter(''); setSearch('') }
  const hasFilters = driverFilter || dutyFilter || search

  return (
    <div className="space-y-6">
      <PageHeader
        title="Hours of Service"
        subtitle="Capture and track driver duty-status logs (ELD) per driver over time — the compliance basis for fatigue-risk, safety, and HOS reporting."
        icon={Clock}
        onRefresh={load}
        refreshing={refreshing}
        updatedAt={updatedAt}
        actions={
          <div className="flex items-center gap-2">
            <button onClick={() => exportToExcel(exportRows, EXPORT_COLS, EXPORT_HEADERS, 'hours_of_service')} className="btn-secondary text-sm inline-flex items-center gap-1.5" disabled={!filtered.length}>
              <FileSpreadsheet size={14} /> Excel
            </button>
            <button onClick={() => exportToPdf(exportRows, EXPORT_COLS.map((k, i) => ({ key: k, header: EXPORT_HEADERS[i] })), 'Hours of Service', 'hours_of_service', 'landscape')} className="btn-secondary text-sm inline-flex items-center gap-1.5" disabled={!filtered.length}>
              <FileText size={14} /> PDF
            </button>
            <button onClick={openCreate} className="btn-primary text-sm inline-flex items-center gap-1.5" disabled={notProvisioned}>
              <Plus size={14} /> Log duty status
            </button>
          </div>
        }
      />

      {notProvisioned && (
        <div className="card border border-amber-800/50 flex items-start gap-3">
          <AlertTriangle size={18} className="text-amber-400 mt-0.5 shrink-0" />
          <div>
            <p className="text-amber-300 font-medium">Hours-of-service logging isn’t enabled on this database yet.</p>
            <p className="text-[var(--text-muted)] text-sm mt-1">
              Apply <span className="font-mono text-[var(--text-primary)]">MIGRATIONS_V172_HOS_LOGS.sql</span>, then reload.
            </p>
          </div>
        </div>
      )}

      {error && (
        <div className="card border border-red-800/50 flex items-start gap-3">
          <AlertTriangle size={18} className="text-red-400 mt-0.5 shrink-0" />
          <div><p className="text-red-300 font-medium">Couldn’t load hours-of-service logs.</p><p className="text-[var(--text-muted)] text-sm mt-1">{error}</p></div>
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

      {/* Per-driver-day compliance */}
      <div className="card overflow-hidden">
        <h3 className="text-sm font-semibold text-[var(--text-primary)] mb-3 flex items-center gap-2">
          <CalendarClock size={15} /> Driver-day compliance
          <span className="text-xs font-normal text-[var(--text-muted)]">
            (limits: {DAILY_DRIVE_LIMIT_MIN / 60}h driving · {DAILY_DUTY_LIMIT_MIN / 60}h on-duty window)
          </span>
        </h3>
        {rows === null ? (
          <div className="h-16 bg-[var(--input-bg)] rounded animate-pulse" />
        ) : compliance.length === 0 ? (
          <p className="text-sm text-[var(--text-muted)]">No duty-status logs yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[var(--input-border)] text-left text-xs uppercase tracking-wider text-[var(--text-muted)]">
                  {['Driver', 'Date', 'Driving', 'On-duty window', 'Status'].map((h, i) => <th key={i} className="px-3 py-2 font-semibold whitespace-nowrap">{h}</th>)}
                </tr>
              </thead>
              <tbody>
                {compliance.slice(0, 50).map((d) => (
                  <tr key={`${d.driver_name}-${d.log_date}`} className={`border-b border-[var(--input-border)]/50 ${d.overHours ? 'bg-red-900/10' : ''}`}>
                    <td className="px-3 py-2 font-medium text-[var(--text-primary)]">{d.driver_name}</td>
                    <td className="px-3 py-2 text-[var(--text-secondary)] whitespace-nowrap">{fmtDate(d.log_date)}</td>
                    <td className={`px-3 py-2 font-semibold whitespace-nowrap ${d.drivingMin > DAILY_DRIVE_LIMIT_MIN ? 'text-red-400' : 'text-[var(--text-primary)]'}`}>{fmtHm(d.drivingMin)}</td>
                    <td className={`px-3 py-2 font-semibold whitespace-nowrap ${d.onDutyMin > DAILY_DUTY_LIMIT_MIN ? 'text-red-400' : 'text-[var(--text-primary)]'}`}>{fmtHm(d.onDutyMin)}</td>
                    <td className="px-3 py-2">
                      {d.overHours ? (
                        <span className="inline-flex items-center gap-1 rounded-full border border-red-700/50 bg-red-900/30 px-2 py-0.5 text-xs font-medium text-red-300">
                          <ShieldAlert size={12} /> Over hours
                        </span>
                      ) : (
                        <span className="inline-flex items-center rounded-full border border-green-700/40 bg-green-900/20 px-2 py-0.5 text-xs font-medium text-green-300">
                          Compliant
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {compliance.length > 50 && <p className="px-1 py-2 text-xs text-[var(--text-muted)]">Showing worst 50 driver-days — refine filters or export for the full set.</p>}
          </div>
        )}
      </div>

      {/* Filters */}
      <div className="card space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative flex-1 min-w-[200px]">
            <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" />
            <input className="input pl-9 w-full" placeholder="Search driver, asset, location, remarks…" value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
          <select className="input" value={driverFilter} onChange={(e) => setDriverFilter(e.target.value)} aria-label="Driver">
            <option value="">All drivers</option>
            {driverOptions.map((d) => <option key={d} value={d}>{d}</option>)}
          </select>
          <select className="input" value={dutyFilter} onChange={(e) => setDutyFilter(e.target.value)} aria-label="Duty status">
            <option value="">All statuses</option>
            {DUTY_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
          {hasFilters && <button onClick={clearFilters} className="btn-secondary text-sm inline-flex items-center gap-1.5"><X size={14} /> Clear</button>}
          <span className="text-xs text-[var(--text-muted)] ml-auto">{filtered.length} of {summary.totalLogs}</span>
        </div>
      </div>

      {/* Table */}
      <div className="card overflow-hidden !p-0">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[var(--input-border)] text-left text-xs uppercase tracking-wider text-[var(--text-muted)]">
                {['Driver', 'Asset', 'Date', 'Status', 'Duration', 'Distance', 'Location', 'Flag', ''].map((h, i) => <th key={i} className="px-4 py-3 font-semibold whitespace-nowrap">{h}</th>)}
              </tr>
            </thead>
            <tbody>
              {rows === null ? (
                [0, 1, 2, 3, 4].map((i) => <tr key={i} className="border-b border-[var(--input-border)]/50"><td colSpan={9} className="px-4 py-3"><div className="h-4 bg-[var(--input-bg)] rounded animate-pulse" /></td></tr>)
              ) : filtered.length === 0 ? (
                <tr><td colSpan={9} className="px-4 py-12 text-center text-[var(--text-muted)]">
                  <Filter size={22} className="mx-auto mb-2 opacity-60" />
                  {rows.length === 0 && !notProvisioned ? 'No duty-status logs yet — log your first entry.' : 'No logs match these filters.'}
                </td></tr>
              ) : (
                filtered.slice(0, 500).map((r) => (
                  <tr key={r.id} className="border-b border-[var(--input-border)]/50 hover:bg-[var(--input-bg)]/40">
                    <td className="px-4 py-2.5 font-medium text-[var(--text-primary)]">{r.driver_name || '—'}</td>
                    <td className="px-4 py-2.5 text-[var(--text-secondary)]">{r.asset_no || '—'}</td>
                    <td className="px-4 py-2.5 text-[var(--text-secondary)] whitespace-nowrap">{fmtDate(r.log_date)}</td>
                    <td className="px-4 py-2.5">{dutyBadge(r.duty_status)}</td>
                    <td className="px-4 py-2.5 text-[var(--text-secondary)] whitespace-nowrap">{fmtMin(r.duration_min)}</td>
                    <td className="px-4 py-2.5 text-[var(--text-secondary)] whitespace-nowrap">{fmtKm(r.distance_km)}</td>
                    <td className="px-4 py-2.5 text-[var(--text-secondary)]">{r.location || '—'}</td>
                    <td className="px-4 py-2.5">
                      {r.violation ? (
                        <span className="inline-flex items-center gap-1 rounded-full border border-red-700/50 bg-red-900/30 px-2 py-0.5 text-xs font-medium text-red-300" title={r.violation_type || 'Violation'}>
                          <ShieldAlert size={12} /> {r.violation_type ? String(r.violation_type).slice(0, 18) : 'Violation'}
                        </span>
                      ) : (
                        <span className="text-[var(--text-muted)]">—</span>
                      )}
                    </td>
                    <td className="px-4 py-2.5">
                      <div className="flex items-center justify-end gap-1">
                        <button onClick={() => openEdit(r)} className="p-1.5 rounded hover:bg-[var(--input-bg)] text-[var(--text-muted)] hover:text-[var(--text-primary)]" aria-label="Edit"><Pencil size={14} /></button>
                        <button onClick={() => setConfirmDelete(r)} className="p-1.5 rounded hover:bg-red-900/30 text-[var(--text-muted)] hover:text-red-400" aria-label="Delete"><Trash2 size={14} /></button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
        {filtered.length > 500 && <p className="px-4 py-2 text-xs text-[var(--text-muted)] border-t border-[var(--input-border)]">Showing first 500 — refine filters or export for the full set.</p>}
      </div>

      {/* Create / Edit modal */}
      {showModal && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/70 p-4" onClick={closeModal}>
          <div className="card w-full max-w-lg max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-bold text-[var(--text-primary)]">{editing ? 'Edit duty-status log' : 'Log duty status'}</h3>
              <button onClick={closeModal} className="text-[var(--text-muted)] hover:text-[var(--text-primary)]"><X size={18} /></button>
            </div>
            <form onSubmit={submit} className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="label">Driver name</label>
                  <input className="input w-full" placeholder="e.g. J. Rivera" value={form.driver_name} maxLength={200} onChange={(e) => set('driver_name', e.target.value)} />
                </div>
                <div>
                  <label className="label">Asset number (optional)</label>
                  <input className="input w-full" placeholder="e.g. TRK-1042" value={form.asset_no} maxLength={120} onChange={(e) => set('asset_no', e.target.value)} />
                </div>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="label">Log date</label>
                  <input className="input w-full" type="date" value={form.log_date} onChange={(e) => set('log_date', e.target.value)} />
                  <p className="text-[11px] text-[var(--text-muted)] mt-1">Leave blank to use today.</p>
                </div>
                <div>
                  <label className="label">Duty status</label>
                  <select className="input w-full" value={form.duty_status} onChange={(e) => set('duty_status', e.target.value)}>
                    {DUTY_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                  </select>
                </div>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="label">Start time (optional)</label>
                  <input className="input w-full" type="datetime-local" value={form.start_time} onChange={(e) => set('start_time', e.target.value)} />
                </div>
                <div>
                  <label className="label">End time (optional)</label>
                  <input className="input w-full" type="datetime-local" value={form.end_time} onChange={(e) => set('end_time', e.target.value)} />
                </div>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="label">Duration (min)</label>
                  <input className="input w-full" type="number" step="1" min="0" placeholder="480" value={form.duration_min} onChange={(e) => set('duration_min', e.target.value)} />
                </div>
                <div>
                  <label className="label">Distance (km, optional)</label>
                  <input className="input w-full" type="number" step="1" min="0" placeholder="620" value={form.distance_km} onChange={(e) => set('distance_km', e.target.value)} />
                </div>
              </div>
              <div>
                <label className="label">Location (optional)</label>
                <input className="input w-full" placeholder="e.g. Riyadh — Dammam corridor" value={form.location} maxLength={200} onChange={(e) => set('location', e.target.value)} />
              </div>
              <div>
                <label className="label">Remarks (optional)</label>
                <textarea className="input w-full min-h-[70px] resize-y" placeholder="e.g. pre-trip inspection, rest break at 14:00" value={form.remarks} maxLength={8000} onChange={(e) => set('remarks', e.target.value)} />
              </div>

              {/* Violation toggle */}
              <div className="rounded-lg border border-[var(--input-border)] bg-[var(--input-bg)]/40 p-3 space-y-3">
                <label className="flex items-center gap-2 cursor-pointer select-none">
                  <input type="checkbox" className="h-4 w-4 accent-red-500" checked={form.violation} onChange={(e) => set('violation', e.target.checked)} />
                  <span className="text-sm font-medium text-[var(--text-primary)] inline-flex items-center gap-1.5">
                    <ShieldAlert size={14} className="text-red-400" /> Flag as HOS violation
                  </span>
                </label>
                {form.violation && (
                  <input className="input w-full" placeholder="Violation type (e.g. 11-hour driving, 14-hour window)" value={form.violation_type} maxLength={200} onChange={(e) => set('violation_type', e.target.value)} />
                )}
              </div>

              <div>
                <label className="label">Notes (optional)</label>
                <textarea className="input w-full min-h-[60px] resize-y" placeholder="Internal notes" value={form.notes} maxLength={8000} onChange={(e) => set('notes', e.target.value)} />
              </div>

              {formError && (
                <div className="flex items-start gap-2 text-sm text-red-300 bg-red-900/20 border border-red-800/50 rounded-lg px-3 py-2">
                  <AlertTriangle size={15} className="mt-0.5 shrink-0" /> {formError}
                </div>
              )}

              <div className="flex items-center justify-end gap-2 pt-1">
                <button type="button" onClick={closeModal} className="btn-secondary text-sm" disabled={saving}>Cancel</button>
                <button type="submit" className="btn-primary text-sm inline-flex items-center gap-1.5 disabled:opacity-60" disabled={saving}>
                  {saving ? 'Saving…' : editing ? 'Save changes' : 'Log duty status'}
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
                <h3 className="text-[var(--text-primary)] font-semibold">Delete this log?</h3>
                <p className="text-sm text-[var(--text-muted)] mt-1">
                  {confirmDelete.driver_name || 'Log'} · {DUTY_META[confirmDelete.duty_status]?.label || '—'} · {fmtDate(confirmDelete.log_date)}. This can’t be undone.
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
