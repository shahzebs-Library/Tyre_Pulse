/**
 * ShiftScheduling (route /shifts) — rosters driver / technician shifts: who works,
 * in what role, on which date, from when to when, at which site, with a status
 * lifecycle (scheduled → completed / absent / cancelled). Full CRUD, KPI tiles,
 * status/role/search filters, delete-confirm, and Excel/PDF export. Runs on the
 * new `shifts` table (V149); degrades to a migration hint when it isn't present.
 */
import { useState, useEffect, useMemo, useCallback } from 'react'
import {
  CalendarClock, Calendar, Clock, User, Users, Plus, Pencil, Trash2, Search,
  X, Filter, Save, Loader2, AlertTriangle, FileSpreadsheet, FileText, MapPin,
  CheckCircle2,
} from 'lucide-react'
import PageHeader from '../components/ui/PageHeader'
import { useSettings } from '../contexts/SettingsContext'
import { listShifts, createShift, updateShift, deleteShift, SHIFT_STATUS_VALUES } from '../lib/api/shifts'
import { summarizeShifts } from '../lib/shifts'
import { exportToExcel, exportToPdf } from '../lib/exportUtils'
import { toUserMessage } from '../lib/safeError'

const STATUS_META = {
  scheduled: { label: 'Scheduled', cls: 'bg-sky-900/40 text-sky-300 border border-sky-700/50', icon: Calendar },
  completed: { label: 'Completed', cls: 'bg-green-900/40 text-green-300 border border-green-700/50', icon: CheckCircle2 },
  absent: { label: 'Absent', cls: 'bg-amber-900/40 text-amber-300 border border-amber-700/50', icon: AlertTriangle },
  cancelled: { label: 'Cancelled', cls: 'bg-[var(--input-bg)] text-[var(--text-dim)] border border-[var(--input-border)]', icon: X },
}

const ROLE_SUGGESTIONS = ['Driver', 'Technician', 'Supervisor', 'Foreman', 'Inspector', 'Fitter', 'Helper']

const EMPTY_FORM = {
  person_name: '', role: '', shift_date: '', start_time: '', end_time: '', site: '', status: 'scheduled', notes: '',
}

function isMissingRelation(err) {
  const m = String(err?.message || '').toLowerCase()
  return m.includes('does not exist') || m.includes('relation') || m.includes('schema cache') || m.includes('could not find the table')
}
function fmtDate(v) {
  if (!v) return '—'
  const d = new Date(v)
  return Number.isNaN(d.getTime()) ? String(v) : d.toLocaleDateString()
}
function fmtTimeRange(a, b) {
  if (!a && !b) return '—'
  return `${a || '—'} – ${b || '—'}`
}

// ─── Create / Edit modal ──────────────────────────────────────────────────────
function ShiftModal({ open, initial, onClose, onSaved, activeCountry }) {
  const editing = !!initial?.id
  const [form, setForm] = useState(EMPTY_FORM)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!open) return
    setError('')
    setForm(
      initial?.id
        ? {
            person_name: initial.person_name || '',
            role: initial.role || '',
            shift_date: initial.shift_date || '',
            start_time: initial.start_time || '',
            end_time: initial.end_time || '',
            site: initial.site || '',
            status: initial.status || 'scheduled',
            notes: initial.notes || '',
          }
        : EMPTY_FORM,
    )
  }, [open, initial])

  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }))

  const submit = useCallback(
    async (e) => {
      e?.preventDefault?.()
      setError('')
      if (!form.person_name.trim()) { setError('Please enter the person’s name.'); return }
      setBusy(true)
      try {
        const country = activeCountry && activeCountry !== 'All' ? activeCountry : null
        if (editing) {
          await updateShift(initial.id, { ...form })
        } else {
          await createShift({ ...form, country })
        }
        onSaved?.()
        onClose?.()
      } catch (err) {
        setError(toUserMessage(err, 'Could not save the shift. Please try again.'))
      } finally {
        setBusy(false)
      }
    },
    [form, editing, initial, activeCountry, onSaved, onClose],
  )

  if (!open) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70" onMouseDown={onClose}>
      <form
        onSubmit={submit}
        onMouseDown={(e) => e.stopPropagation()}
        className="w-full max-w-2xl max-h-[90vh] overflow-y-auto rounded-xl bg-[var(--card-bg)] border border-[var(--input-border)] shadow-2xl"
      >
        <div className="flex items-center justify-between px-6 py-4 border-b border-[var(--input-border)] sticky top-0 bg-[var(--card-bg)] z-10">
          <h3 className="text-lg font-semibold text-[var(--text-primary)] flex items-center gap-2">
            <CalendarClock size={18} className="text-[var(--brand-bright)]" />
            {editing ? 'Edit shift' : 'Schedule shift'}
          </h3>
          <button type="button" onClick={onClose} className="text-[var(--text-muted)] hover:text-[var(--text-primary)]" aria-label="Close">
            <X size={20} />
          </button>
        </div>

        <div className="p-6 space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="label">Person <span className="text-red-400">*</span></label>
              <input className="input w-full" placeholder="e.g. Ahmed Khan" value={form.person_name} maxLength={160} onChange={(e) => set('person_name', e.target.value)} />
            </div>
            <div>
              <label className="label">Role</label>
              <input className="input w-full" placeholder="Driver, Technician…" list="shift-role-list" value={form.role} maxLength={120} onChange={(e) => set('role', e.target.value)} />
              <datalist id="shift-role-list">
                {ROLE_SUGGESTIONS.map((r) => <option key={r} value={r} />)}
              </datalist>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div>
              <label className="label">Shift date</label>
              <input type="date" className="input w-full" value={form.shift_date} onChange={(e) => set('shift_date', e.target.value)} />
            </div>
            <div>
              <label className="label">Start time</label>
              <input type="time" className="input w-full" value={form.start_time} onChange={(e) => set('start_time', e.target.value)} />
            </div>
            <div>
              <label className="label">End time</label>
              <input type="time" className="input w-full" value={form.end_time} onChange={(e) => set('end_time', e.target.value)} />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="label">Site</label>
              <input className="input w-full" placeholder="Depot / branch" value={form.site} maxLength={120} onChange={(e) => set('site', e.target.value)} />
            </div>
            <div>
              <label className="label">Status</label>
              <select className="input w-full" value={form.status} onChange={(e) => set('status', e.target.value)}>
                {SHIFT_STATUS_VALUES.map((s) => <option key={s} value={s}>{STATUS_META[s]?.label || s}</option>)}
              </select>
            </div>
          </div>

          <div>
            <label className="label">Notes</label>
            <textarea className="input w-full min-h-[90px] resize-y" placeholder="Optional — coverage, handover, or special instructions." value={form.notes} maxLength={4000} onChange={(e) => set('notes', e.target.value)} />
          </div>

          {error && (
            <div className="flex items-start gap-2 text-sm text-red-300 bg-red-900/20 border border-red-800/50 rounded-lg px-3 py-2">
              <AlertTriangle size={15} className="mt-0.5 shrink-0" /> {error}
            </div>
          )}
        </div>

        <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-[var(--input-border)] sticky bottom-0 bg-[var(--card-bg)]">
          <button type="button" onClick={onClose} className="btn-secondary text-sm">Cancel</button>
          <button type="submit" disabled={busy} className="btn-primary text-sm inline-flex items-center gap-2 disabled:opacity-60">
            {busy ? <Loader2 size={15} className="animate-spin" /> : <Save size={15} />}
            {editing ? 'Save changes' : 'Schedule shift'}
          </button>
        </div>
      </form>
    </div>
  )
}

// ─── Delete confirm ───────────────────────────────────────────────────────────
function DeleteDialog({ shift, onCancel, onConfirm, busy }) {
  if (!shift) return null
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70" onMouseDown={onCancel}>
      <div onMouseDown={(e) => e.stopPropagation()} className="w-full max-w-md rounded-xl bg-[var(--card-bg)] border border-[var(--input-border)] shadow-2xl p-6 space-y-4">
        <div className="flex items-start gap-3">
          <div className="w-10 h-10 rounded-lg bg-red-900/30 border border-red-800/50 flex items-center justify-center shrink-0">
            <Trash2 size={18} className="text-red-400" />
          </div>
          <div>
            <h3 className="text-base font-semibold text-[var(--text-primary)]">Delete this shift?</h3>
            <p className="text-sm text-[var(--text-muted)] mt-1">
              {shift.person_name}{shift.shift_date ? ` · ${fmtDate(shift.shift_date)}` : ''}. This action cannot be undone.
            </p>
          </div>
        </div>
        <div className="flex items-center justify-end gap-3">
          <button onClick={onCancel} className="btn-secondary text-sm">Cancel</button>
          <button onClick={onConfirm} disabled={busy} className="btn-danger text-sm inline-flex items-center gap-2 disabled:opacity-60">
            {busy ? <Loader2 size={15} className="animate-spin" /> : <Trash2 size={15} />} Delete
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── Page ─────────────────────────────────────────────────────────────────────
export default function ShiftScheduling() {
  const { activeCountry } = useSettings()
  const [rows, setRows] = useState(null)
  const [error, setError] = useState('')
  const [missing, setMissing] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [updatedAt, setUpdatedAt] = useState(null)

  const [statusFilter, setStatusFilter] = useState('all')
  const [roleFilter, setRoleFilter] = useState('')
  const [search, setSearch] = useState('')

  const [modal, setModal] = useState({ open: false, initial: null })
  const [toDelete, setToDelete] = useState(null)
  const [deleting, setDeleting] = useState(false)

  const load = useCallback(async () => {
    setRefreshing(true); setError(''); setMissing(false)
    try {
      const data = await listShifts({ country: activeCountry })
      setRows(Array.isArray(data) ? data : [])
      setUpdatedAt(new Date())
    } catch (err) {
      if (isMissingRelation(err)) { setMissing(true); setRows([]) }
      else { setError(toUserMessage(err, 'Could not load shifts.')); setRows([]) }
    } finally {
      setRefreshing(false)
    }
  }, [activeCountry])

  useEffect(() => { load() }, [load])

  const summary = useMemo(() => summarizeShifts(rows || [], Date.now()), [rows])

  const roleOptions = useMemo(
    () => [...new Set((rows || []).map((r) => r.role).filter(Boolean))].sort(),
    [rows],
  )

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return (rows || []).filter((r) => {
      if (statusFilter !== 'all' && r.status !== statusFilter) return false
      if (roleFilter && r.role !== roleFilter) return false
      if (q) {
        const hay = `${r.person_name || ''} ${r.role || ''} ${r.site || ''} ${r.notes || ''}`.toLowerCase()
        if (!hay.includes(q)) return false
      }
      return true
    })
  }, [rows, statusFilter, roleFilter, search])

  const kpis = [
    { label: 'Total shifts', value: summary.total, icon: CalendarClock, tone: 'text-[var(--text-primary)]' },
    { label: 'Scheduled', value: summary.byStatus.scheduled, icon: Calendar, tone: 'text-sky-400' },
    { label: 'Completed', value: summary.byStatus.completed, icon: CheckCircle2, tone: 'text-green-400' },
    { label: 'People rostered', value: summary.distinctPeople, icon: Users, tone: 'text-amber-400' },
  ]

  const EXPORT_COLS = ['person_name', 'role', 'shift_date', 'start_time', 'end_time', 'site', 'status', 'notes']
  const EXPORT_HEADERS = ['Person', 'Role', 'Date', 'Start', 'End', 'Site', 'Status', 'Notes']
  const exportRows = filtered.map((r) => ({
    person_name: r.person_name || '', role: r.role || '', shift_date: r.shift_date || '',
    start_time: r.start_time || '', end_time: r.end_time || '', site: r.site || '',
    status: STATUS_META[r.status]?.label || r.status || '', notes: r.notes || '',
  }))

  const confirmDelete = useCallback(async () => {
    if (!toDelete) return
    setDeleting(true)
    try {
      await deleteShift(toDelete.id)
      setToDelete(null)
      await load()
    } catch (err) {
      setError(toUserMessage(err, 'Could not delete the shift.'))
    } finally {
      setDeleting(false)
    }
  }, [toDelete, load])

  const clearFilters = () => { setStatusFilter('all'); setRoleFilter(''); setSearch('') }
  const hasFilters = statusFilter !== 'all' || roleFilter || search

  return (
    <div className="space-y-6">
      <PageHeader
        title="Shift Scheduling"
        subtitle="Roster driver & technician shifts — person, role, date, hours, site and status across the fleet."
        icon={CalendarClock}
        onRefresh={load}
        refreshing={refreshing}
        updatedAt={updatedAt}
        actions={
          <div className="flex items-center gap-2">
            <button onClick={() => exportToExcel(exportRows, EXPORT_COLS, EXPORT_HEADERS, 'shift_schedule')} className="btn-secondary text-sm inline-flex items-center gap-1.5" disabled={!filtered.length}>
              <FileSpreadsheet size={14} /> Excel
            </button>
            <button onClick={() => exportToPdf(exportRows, EXPORT_COLS.map((k, i) => ({ key: k, header: EXPORT_HEADERS[i] })), 'Shift Schedule', 'shift_schedule', 'landscape')} className="btn-secondary text-sm inline-flex items-center gap-1.5" disabled={!filtered.length}>
              <FileText size={14} /> PDF
            </button>
            <button onClick={() => setModal({ open: true, initial: null })} className="btn-primary text-sm inline-flex items-center gap-1.5">
              <Plus size={14} /> Schedule shift
            </button>
          </div>
        }
      />

      {missing && (
        <div className="card border border-amber-800/50 flex items-start gap-3">
          <AlertTriangle size={18} className="text-amber-400 mt-0.5 shrink-0" />
          <div>
            <p className="text-amber-300 font-medium">Shift scheduling isn’t enabled on this database yet.</p>
            <p className="text-[var(--text-muted)] text-sm mt-1">
              Apply <span className="font-mono text-[var(--text-primary)]">MIGRATIONS_V149_SHIFTS.sql</span>, then reload.
            </p>
          </div>
        </div>
      )}

      {error && (
        <div className="card border border-red-800/50 flex items-start gap-3">
          <AlertTriangle size={18} className="text-red-400 mt-0.5 shrink-0" />
          <div><p className="text-red-300 font-medium">Couldn’t load shifts.</p><p className="text-[var(--text-muted)] text-sm mt-1">{error}</p></div>
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
              {k.label === 'Scheduled' && rows !== null && summary.scheduledToday > 0 && (
                <p className="text-[11px] text-[var(--text-muted)] mt-1 flex items-center gap-1"><Clock size={11} /> {summary.scheduledToday} today</p>
              )}
            </div>
          )
        })}
      </div>

      {/* Filters */}
      <div className="card space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative flex-1 min-w-[200px]">
            <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" />
            <input className="input pl-9 w-full" placeholder="Search person, role, site, notes…" value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
          <select className="input" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} aria-label="Status">
            <option value="all">All statuses</option>
            {SHIFT_STATUS_VALUES.map((s) => <option key={s} value={s}>{STATUS_META[s]?.label || s}</option>)}
          </select>
          <select className="input" value={roleFilter} onChange={(e) => setRoleFilter(e.target.value)} aria-label="Role">
            <option value="">All roles</option>
            {roleOptions.map((r) => <option key={r} value={r}>{r}</option>)}
          </select>
          {hasFilters && <button onClick={clearFilters} className="btn-secondary text-sm inline-flex items-center gap-1.5"><X size={14} /> Clear</button>}
          <span className="text-xs text-[var(--text-muted)] ml-auto">{filtered.length} of {summary.total}</span>
        </div>
      </div>

      {/* Table */}
      <div className="card overflow-hidden !p-0">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[var(--input-border)] text-left text-xs uppercase tracking-wider text-[var(--text-muted)]">
                {['Person', 'Role', 'Date', 'Hours', 'Site', 'Status', ''].map((h, i) => (
                  <th key={i} className={`px-4 py-3 font-semibold whitespace-nowrap ${i === 6 ? 'text-right' : ''}`}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows === null ? (
                [0, 1, 2, 3, 4].map((i) => (
                  <tr key={i} className="border-b border-[var(--input-border)]/50"><td colSpan={7} className="px-4 py-3"><div className="h-4 bg-[var(--input-bg)] rounded animate-pulse" /></td></tr>
                ))
              ) : filtered.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-4 py-12 text-center text-[var(--text-muted)]">
                    {rows.length === 0 && !missing ? (
                      <div className="space-y-2">
                        <CalendarClock size={26} className="mx-auto opacity-60" />
                        <p className="text-[var(--text-primary)] font-medium">No shifts scheduled yet.</p>
                        <p className="text-sm">Use “Schedule shift” to roster your first driver or technician.</p>
                      </div>
                    ) : (
                      <><Filter size={22} className="mx-auto mb-2 opacity-60" />No shifts match these filters.</>
                    )}
                  </td>
                </tr>
              ) : (
                filtered.slice(0, 500).map((r) => {
                  const st = STATUS_META[r.status] || STATUS_META.scheduled
                  const StatusIcon = st.icon
                  return (
                    <tr key={r.id} className="border-b border-[var(--input-border)]/50 hover:bg-[var(--input-bg)]/40">
                      <td className="px-4 py-2.5">
                        <div className="flex items-center gap-2">
                          <div className="w-7 h-7 rounded-full bg-[var(--brand-subtle)] border border-[var(--input-border)] flex items-center justify-center shrink-0">
                            <User size={13} className="text-[var(--brand-bright)]" />
                          </div>
                          <span className="font-medium text-[var(--text-primary)]">{r.person_name || '—'}</span>
                        </div>
                      </td>
                      <td className="px-4 py-2.5 text-[var(--text-secondary)]">{r.role || '—'}</td>
                      <td className="px-4 py-2.5 text-[var(--text-secondary)] whitespace-nowrap">{fmtDate(r.shift_date)}</td>
                      <td className="px-4 py-2.5 text-[var(--text-secondary)] whitespace-nowrap">{fmtTimeRange(r.start_time, r.end_time)}</td>
                      <td className="px-4 py-2.5 text-[var(--text-secondary)]">
                        {r.site ? <span className="inline-flex items-center gap-1"><MapPin size={12} className="text-[var(--text-muted)]" />{r.site}</span> : '—'}
                      </td>
                      <td className="px-4 py-2.5">
                        <span className={`badge text-[11px] px-2 py-0.5 rounded inline-flex items-center gap-1 ${st.cls}`}>
                          <StatusIcon size={11} /> {st.label}
                        </span>
                      </td>
                      <td className="px-4 py-2.5">
                        <div className="flex items-center justify-end gap-1">
                          <button onClick={() => setModal({ open: true, initial: r })} className="p-1.5 rounded hover:bg-[var(--input-bg)] text-[var(--text-muted)] hover:text-[var(--text-primary)]" aria-label="Edit shift" title="Edit">
                            <Pencil size={15} />
                          </button>
                          <button onClick={() => setToDelete(r)} className="p-1.5 rounded hover:bg-red-900/30 text-[var(--text-muted)] hover:text-red-400" aria-label="Delete shift" title="Delete">
                            <Trash2 size={15} />
                          </button>
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

      <ShiftModal
        open={modal.open}
        initial={modal.initial}
        activeCountry={activeCountry}
        onClose={() => setModal({ open: false, initial: null })}
        onSaved={load}
      />
      <DeleteDialog shift={toDelete} onCancel={() => setToDelete(null)} onConfirm={confirmDelete} busy={deleting} />
    </div>
  )
}
