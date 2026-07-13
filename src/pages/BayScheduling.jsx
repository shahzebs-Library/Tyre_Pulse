/**
 * BayScheduling (route /bay-scheduling) — Bay Scheduling / Workshop Capacity.
 * Plans and tracks which workshop bay each job occupies and for how long,
 * turning raw schedule rows into capacity intelligence: bay utilisation,
 * technician load, job-overrun tracking, and double-booking conflict detection.
 * Every row is org-isolated and country-scoped.
 *
 * Runs on the new `bay_schedules` table (V184). Real data, KPI tiles, a per-bay
 * load/utilisation breakdown, a scheduling-conflict warning strip,
 * search + status/priority/job-type/bay filters, create/edit modal, delete
 * confirm, Excel/PDF export, and loading/empty/error/not-provisioned states.
 * All roll-up logic lives in the pure `src/lib/bayScheduling.js` helpers; "now"
 * is computed once here and injected so the page stays deterministic per render.
 */
import { useState, useEffect, useMemo, useCallback } from 'react'
import {
  Wrench, CheckCircle2, AlertTriangle, Gauge, Search, X, Filter,
  FileSpreadsheet, FileText, Plus, Pencil, Trash2, PlayCircle, Timer,
  Layers, Building2, CalendarDays, Users, TrendingUp,
} from 'lucide-react'
import PageHeader from '../components/ui/PageHeader'
import { useSettings } from '../contexts/SettingsContext'
import {
  listBaySchedules, createBaySchedule, updateBaySchedule, deleteBaySchedule,
} from '../lib/api/bayScheduling'
import {
  summariseBays, perBayLoad, conflictsForBay, bayUtilization, overrunMinutes,
  forecastCapacity, perTechnicianLoad, technicianConflicts, WORKING_HOURS_PER_DAY,
} from '../lib/bayScheduling'
import { exportToExcel, exportToPdf } from '../lib/exportUtils'

const EMPTY_FORM = {
  bay_name: '', workshop_site: '', asset_no: '', job_type: '', technician: '',
  scheduled_start: '', scheduled_end: '', actual_start: '', actual_end: '',
  estimated_min: '', priority: 'normal', status: 'scheduled', work_order_ref: '', notes: '',
}

const JOB_TYPES = [
  { v: 'tyre_change', l: 'Tyre change' }, { v: 'rotation', l: 'Rotation' },
  { v: 'repair', l: 'Repair' }, { v: 'inspection', l: 'Inspection' },
  { v: 'service', l: 'Service' }, { v: 'alignment', l: 'Alignment' }, { v: 'other', l: 'Other' },
]
const PRIORITIES = [
  { v: 'low', l: 'Low' }, { v: 'normal', l: 'Normal' },
  { v: 'high', l: 'High' }, { v: 'urgent', l: 'Urgent' },
]
const STATUSES = [
  { v: 'scheduled', l: 'Scheduled' }, { v: 'in_progress', l: 'In progress' },
  { v: 'completed', l: 'Completed' }, { v: 'delayed', l: 'Delayed' }, { v: 'cancelled', l: 'Cancelled' },
]
const JOB_TYPE_LABEL = Object.fromEntries(JOB_TYPES.map((j) => [j.v, j.l]))
const MS_DAY = 86_400_000
const DEFAULT_OVERLOAD_PCT = 90 // mirrors DEFAULT_CAPACITY_CONFIG.overloadThresholdPct

const STATUS_BADGE = {
  scheduled: 'bg-sky-900/30 text-sky-300 border-sky-800/50',
  in_progress: 'bg-indigo-900/30 text-indigo-300 border-indigo-800/50',
  completed: 'bg-green-900/30 text-green-300 border-green-800/50',
  delayed: 'bg-amber-900/30 text-amber-300 border-amber-800/50',
  cancelled: 'bg-gray-700/30 text-gray-400 border-gray-600/50',
}
const PRIORITY_BADGE = {
  low: 'bg-gray-700/30 text-gray-300 border-gray-600/50',
  normal: 'bg-sky-900/30 text-sky-300 border-sky-800/50',
  high: 'bg-orange-900/30 text-orange-300 border-orange-800/50',
  urgent: 'bg-red-900/30 text-red-300 border-red-800/50',
}

const fmtLabel = (v) => (v == null || v === '' ? '—' : String(v).replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()))

function fmtDateTime(v) {
  if (!v) return '—'
  const d = new Date(v)
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })
}
function fmtMin(v) {
  if (v == null) return '—'
  const n = Math.round(v)
  if (Math.abs(n) < 60) return `${n} min`
  const h = Math.floor(Math.abs(n) / 60)
  const m = Math.abs(n) % 60
  return `${n < 0 ? '-' : ''}${h}h${m ? ` ${m}m` : ''}`
}
// datetime-local expects "YYYY-MM-DDTHH:mm" in local time.
function toLocalInput(v) {
  if (!v) return ''
  const d = new Date(v)
  if (Number.isNaN(d.getTime())) return ''
  const off = d.getTimezoneOffset()
  return new Date(d.getTime() - off * 60000).toISOString().slice(0, 16)
}

function isMissingRelation(err) {
  const m = String(err?.message || '').toLowerCase()
  return m.includes('does not exist') || m.includes('relation') ||
    m.includes('schema cache') || m.includes('could not find the table')
}

export default function BayScheduling() {
  const { activeCountry } = useSettings()
  const nowMs = useMemo(() => Date.now(), []) // computed once per mount; injected into pure fns
  const [rows, setRows] = useState(null)
  const [error, setError] = useState('')
  const [notProvisioned, setNotProvisioned] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [updatedAt, setUpdatedAt] = useState(null)

  const [search, setSearch] = useState('')
  const [bayFilter, setBayFilter] = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  const [priorityFilter, setPriorityFilter] = useState('')
  const [jobTypeFilter, setJobTypeFilter] = useState('')

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
      const data = await listBaySchedules({ country: activeCountry })
      setRows(Array.isArray(data) ? data : [])
      setUpdatedAt(new Date())
    } catch (err) {
      if (isMissingRelation(err)) setNotProvisioned(true)
      else setError(err?.message || 'Could not load bay schedules.')
      setRows([])
    } finally {
      setRefreshing(false)
    }
  }, [activeCountry])

  useEffect(() => { load() }, [load])

  const summary = useMemo(() => summariseBays(rows || [], nowMs), [rows, nowMs])
  const conflicts = useMemo(() => conflictsForBay(rows || []), [rows])

  // Per-bay load enriched with a "today" utilisation figure (00:00 → +24h).
  const bayLoad = useMemo(() => {
    const dayStart = Math.floor(nowMs / MS_DAY) * MS_DAY
    const dayEnd = dayStart + MS_DAY
    return perBayLoad(rows || []).map((b) => ({
      ...b,
      utilization: bayUtilization(rows || [], b.bay_name, dayStart, dayEnd),
    }))
  }, [rows, nowMs])

  // Forward 7-day capacity forecast + technician-load roll-up (pure helpers).
  const forecast = useMemo(() => forecastCapacity(rows || [], nowMs), [rows, nowMs])
  const techLoad = useMemo(() => perTechnicianLoad(rows || []), [rows])
  const techConflicts = useMemo(() => technicianConflicts(rows || []), [rows])

  const completedToday = useMemo(() => {
    const dayStart = Math.floor(nowMs / MS_DAY) * MS_DAY
    return (rows || []).filter((r) => {
      if (r.status !== 'completed') return false
      const t = new Date(r.actual_end || r.scheduled_end || r.created_at).getTime()
      return Number.isFinite(t) && t >= dayStart && t < dayStart + MS_DAY
    }).length
  }, [rows, nowMs])

  const bayOptions = useMemo(
    () => [...new Set((rows || []).map((r) => r.bay_name).filter(Boolean))].sort(),
    [rows],
  )

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return (rows || []).filter((r) => {
      if (bayFilter && r.bay_name !== bayFilter) return false
      if (statusFilter && r.status !== statusFilter) return false
      if (priorityFilter && r.priority !== priorityFilter) return false
      if (jobTypeFilter && r.job_type !== jobTypeFilter) return false
      if (q) {
        const hay = `${r.bay_name || ''} ${r.workshop_site || ''} ${r.asset_no || ''} ${r.technician || ''} ${r.work_order_ref || ''} ${r.notes || ''}`.toLowerCase()
        if (!hay.includes(q)) return false
      }
      return true
    })
  }, [rows, search, bayFilter, statusFilter, priorityFilter, jobTypeFilter])

  // ── KPIs ─────────────────────────────────────────────────────────────────
  const kpis = [
    { label: 'Total jobs', value: summary.totalJobs, icon: Layers, tone: 'text-[var(--text-primary)]' },
    { label: 'In progress', value: summary.inProgressCount, icon: PlayCircle, tone: 'text-indigo-400' },
    { label: 'Completed today', value: completedToday, icon: CheckCircle2, tone: 'text-green-400' },
    { label: 'Delayed', value: summary.delayedCount, icon: AlertTriangle, tone: summary.delayedCount > 0 ? 'text-amber-400' : 'text-[var(--text-primary)]' },
    { label: 'Avg overrun', value: summary.avgOverrunMin == null ? '—' : fmtMin(summary.avgOverrunMin), icon: Timer, tone: (summary.avgOverrunMin ?? 0) > 0 ? 'text-red-400' : 'text-green-400' },
    { label: 'Active bays', value: summary.activeBays, icon: Building2, tone: 'text-sky-400' },
  ]

  // ── Export ───────────────────────────────────────────────────────────────
  const EXPORT_COLS = ['bay_name', 'workshop_site', 'asset_no', 'job_type', 'technician', 'scheduled_start', 'scheduled_end', 'estimated_min', 'overrun_min', 'priority', 'status', 'work_order_ref']
  const EXPORT_HEADERS = ['Bay', 'Site', 'Asset', 'Job type', 'Technician', 'Scheduled start', 'Scheduled end', 'Est. min', 'Overrun min', 'Priority', 'Status', 'Work order']
  const exportRows = filtered.map((r) => {
    const ov = overrunMinutes(r)
    return {
      bay_name: r.bay_name || '', workshop_site: r.workshop_site || '', asset_no: r.asset_no || '',
      job_type: JOB_TYPE_LABEL[r.job_type] || r.job_type || '', technician: r.technician || '',
      scheduled_start: r.scheduled_start || '', scheduled_end: r.scheduled_end || '',
      estimated_min: r.estimated_min ?? '', overrun_min: ov == null ? '' : Math.round(ov),
      priority: fmtLabel(r.priority), status: fmtLabel(r.status), work_order_ref: r.work_order_ref || '',
    }
  })

  // ── Modal ────────────────────────────────────────────────────────────────
  const openCreate = () => { setEditing(null); setForm(EMPTY_FORM); setFormError(''); setShowModal(true) }
  const openEdit = (r) => {
    setEditing(r)
    setForm({
      bay_name: r.bay_name || '', workshop_site: r.workshop_site || '', asset_no: r.asset_no || '',
      job_type: r.job_type || '', technician: r.technician || '',
      scheduled_start: toLocalInput(r.scheduled_start), scheduled_end: toLocalInput(r.scheduled_end),
      actual_start: toLocalInput(r.actual_start), actual_end: toLocalInput(r.actual_end),
      estimated_min: r.estimated_min ?? '', priority: r.priority || 'normal',
      status: r.status || 'scheduled', work_order_ref: r.work_order_ref || '', notes: r.notes || '',
    })
    setFormError(''); setShowModal(true)
  }
  const closeModal = () => { if (!saving) { setShowModal(false); setEditing(null) } }
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }))

  const submit = useCallback(async (e) => {
    e?.preventDefault?.()
    setFormError('')
    if (!form.bay_name.trim()) { setFormError('A bay name is required.'); return }
    if (form.scheduled_start && form.scheduled_end && new Date(form.scheduled_end) <= new Date(form.scheduled_start)) {
      setFormError('Scheduled end must be after the scheduled start.'); return
    }
    if (form.estimated_min !== '' && Number(form.estimated_min) < 0) {
      setFormError('Estimated minutes cannot be negative.'); return
    }
    setSaving(true)
    try {
      const payload = {
        ...form,
        estimated_min: form.estimated_min === '' ? null : form.estimated_min,
        country: activeCountry !== 'All' ? activeCountry : null,
      }
      if (editing) await updateBaySchedule(editing.id, payload)
      else await createBaySchedule(payload)
      setShowModal(false); setEditing(null)
      await load()
    } catch (err) {
      setFormError(err?.message || 'Could not save the schedule.')
    } finally {
      setSaving(false)
    }
  }, [form, editing, activeCountry, load])

  const doDelete = useCallback(async () => {
    if (!confirmDelete) return
    setDeleting(true)
    try {
      await deleteBaySchedule(confirmDelete.id)
      setConfirmDelete(null)
      await load()
    } catch (err) {
      setError(err?.message || 'Could not delete the schedule.')
    } finally {
      setDeleting(false)
    }
  }, [confirmDelete, load])

  const clearFilters = () => { setSearch(''); setBayFilter(''); setStatusFilter(''); setPriorityFilter(''); setJobTypeFilter('') }
  const hasFilters = search || bayFilter || statusFilter || priorityFilter || jobTypeFilter

  return (
    <div className="space-y-6">
      <PageHeader
        title="Bay Scheduling"
        subtitle="Plan and track workshop bay capacity — utilisation, technician load, job overruns, and double-booking conflicts across every bay."
        icon={Wrench}
        onRefresh={load}
        refreshing={refreshing}
        updatedAt={updatedAt}
        actions={
          <div className="flex items-center gap-2">
            <button onClick={() => exportToExcel(exportRows, EXPORT_COLS, EXPORT_HEADERS, 'bay_schedules')} className="btn-secondary text-sm inline-flex items-center gap-1.5" disabled={!filtered.length}>
              <FileSpreadsheet size={14} /> Excel
            </button>
            <button onClick={() => exportToPdf(exportRows, EXPORT_COLS.map((k, i) => ({ key: k, header: EXPORT_HEADERS[i] })), 'Bay Scheduling', 'bay_schedules', 'landscape')} className="btn-secondary text-sm inline-flex items-center gap-1.5" disabled={!filtered.length}>
              <FileText size={14} /> PDF
            </button>
            <button onClick={openCreate} className="btn-primary text-sm inline-flex items-center gap-1.5" disabled={notProvisioned}>
              <Plus size={14} /> Schedule job
            </button>
          </div>
        }
      />

      {notProvisioned && (
        <div className="card border border-amber-800/50 flex items-start gap-3">
          <AlertTriangle size={18} className="text-amber-400 mt-0.5 shrink-0" />
          <div>
            <p className="text-amber-300 font-medium">Bay scheduling isn’t enabled on this database yet.</p>
            <p className="text-[var(--text-muted)] text-sm mt-1">
              Apply <span className="font-mono text-[var(--text-primary)]">MIGRATIONS_V184_BAY_SCHEDULES.sql</span>, then reload.
            </p>
          </div>
        </div>
      )}

      {error && (
        <div className="card border border-red-800/50 flex items-start gap-3">
          <AlertTriangle size={18} className="text-red-400 mt-0.5 shrink-0" />
          <div><p className="text-red-300 font-medium">Couldn’t load bay schedules.</p><p className="text-[var(--text-muted)] text-sm mt-1">{error}</p></div>
        </div>
      )}

      {/* Conflict warning strip */}
      {conflicts.length > 0 && (
        <div className="card border border-red-800/50 bg-red-950/20">
          <div className="flex items-start gap-3">
            <AlertTriangle size={18} className="text-red-400 mt-0.5 shrink-0" />
            <div className="flex-1 min-w-0">
              <p className="text-red-300 font-medium">
                {conflicts.length} scheduling conflict{conflicts.length === 1 ? '' : 's'} detected — a bay is double-booked.
              </p>
              <div className="mt-2 flex flex-col gap-1.5">
                {conflicts.slice(0, 5).map((c, i) => (
                  <div key={i} className="text-sm text-[var(--text-secondary)] flex flex-wrap items-center gap-x-2 gap-y-0.5">
                    <span className="font-semibold text-[var(--text-primary)]">{c.a.bay_name}</span>
                    <span className="text-[var(--text-muted)]">·</span>
                    <span>{c.a.asset_no || fmtLabel(c.a.job_type)} ({fmtDateTime(c.a.scheduled_start)})</span>
                    <span className="text-red-400 font-medium">overlaps</span>
                    <span>{c.b.asset_no || fmtLabel(c.b.job_type)} ({fmtDateTime(c.b.scheduled_start)})</span>
                  </div>
                ))}
                {conflicts.length > 5 && <p className="text-xs text-[var(--text-muted)]">+ {conflicts.length - 5} more…</p>}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* KPI tiles */}
      <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-3">
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

      {/* Per-bay load / utilisation */}
      <div className="card">
        <h3 className="text-sm font-semibold text-[var(--text-primary)] mb-3 flex items-center gap-2">
          <Gauge size={15} /> Bay load &amp; utilisation <span className="text-[var(--text-muted)] font-normal">(today · vs {WORKING_HOURS_PER_DAY}h working day)</span>
        </h3>
        {rows === null ? (
          <div className="h-20 bg-[var(--input-bg)] rounded animate-pulse" />
        ) : bayLoad.length === 0 ? (
          <p className="text-sm text-[var(--text-muted)]">No bays scheduled yet.</p>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {bayLoad.slice(0, 12).map((b) => {
              const util = Math.round(b.utilization)
              const bar = util >= 90 ? 'bg-red-500' : util >= 70 ? 'bg-amber-500' : 'bg-green-500'
              return (
                <div key={b.bay_name} className="rounded-lg border border-[var(--input-border)] bg-[var(--input-bg)]/40 p-3">
                  <div className="flex items-center justify-between">
                    <p className="text-sm font-semibold text-[var(--text-primary)] truncate flex items-center gap-1.5">
                      <Building2 size={13} className="text-sky-400 shrink-0" /> {b.bay_name}
                    </p>
                    <span className="text-xs font-semibold text-[var(--text-secondary)]">{util}%</span>
                  </div>
                  <div className="mt-2 h-1.5 w-full rounded-full bg-[var(--input-bg)] overflow-hidden">
                    <div className={`h-full rounded-full ${bar}`} style={{ width: `${util}%` }} />
                  </div>
                  <div className="mt-2 flex items-center justify-between text-[11px] text-[var(--text-muted)]">
                    <span>{b.jobs} job{b.jobs === 1 ? '' : 's'}</span>
                    <span>{fmtMin(b.busyMin)} booked</span>
                    <span className="text-green-400">{b.completed} done</span>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* Technician double-booking strip (across different bays) */}
      {techConflicts.length > 0 && (
        <div className="card border border-amber-800/50 bg-amber-950/20">
          <div className="flex items-start gap-3">
            <Users size={18} className="text-amber-400 mt-0.5 shrink-0" />
            <div className="flex-1 min-w-0">
              <p className="text-amber-300 font-medium">
                {techConflicts.length} technician double-booking{techConflicts.length === 1 ? '' : 's'} — a technician is assigned to overlapping jobs in different bays.
              </p>
              <div className="mt-2 flex flex-col gap-1.5">
                {techConflicts.slice(0, 5).map((c, i) => (
                  <div key={i} className="text-sm text-[var(--text-secondary)] flex flex-wrap items-center gap-x-2 gap-y-0.5">
                    <span className="font-semibold text-[var(--text-primary)]">{c.technician}</span>
                    <span className="text-[var(--text-muted)]">·</span>
                    <span>{c.a.bay_name} ({fmtDateTime(c.a.scheduled_start)})</span>
                    <span className="text-amber-400 font-medium">overlaps</span>
                    <span>{c.b.bay_name} ({fmtDateTime(c.b.scheduled_start)})</span>
                  </div>
                ))}
                {techConflicts.length > 5 && <p className="text-xs text-[var(--text-muted)]">+ {techConflicts.length - 5} more…</p>}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Capacity forecast (next 7 days) + technician load */}
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
        {/* Forecast */}
        <div className="card xl:col-span-2">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-semibold text-[var(--text-primary)] flex items-center gap-2">
              <CalendarDays size={15} /> Capacity forecast <span className="text-[var(--text-muted)] font-normal">(next 7 days)</span>
            </h3>
            {rows !== null && (
              <span className="text-[11px] text-[var(--text-muted)] flex items-center gap-1.5">
                <TrendingUp size={12} /> {forecast.avgDaily}/day avg · {forecast.activeBays} bay{forecast.activeBays === 1 ? '' : 's'} · ~{forecast.slotsPerDay} slots/day
              </span>
            )}
          </div>
          {rows === null ? (
            <div className="h-24 bg-[var(--input-bg)] rounded animate-pulse" />
          ) : forecast.activeBays === 0 ? (
            <p className="text-sm text-[var(--text-muted)]">No active bays yet — schedule jobs to project capacity.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-[var(--input-border)] text-left text-xs uppercase tracking-wider text-[var(--text-muted)]">
                    {['Day', 'Date', 'Scheduled', 'Expected', 'Capacity', 'Utilisation', ''].map((h, i) => (
                      <th key={i} className="px-3 py-2 font-semibold whitespace-nowrap">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {forecast.days.map((d) => {
                    const util = Math.round(d.utilPct)
                    const bar = d.overloaded ? 'bg-red-500' : util >= 70 ? 'bg-amber-500' : 'bg-green-500'
                    return (
                      <tr key={d.date} className={`border-b border-[var(--input-border)]/50 ${d.overloaded ? 'bg-red-950/20' : ''}`}>
                        <td className="px-3 py-2.5 font-medium text-[var(--text-primary)]">{d.dayName}</td>
                        <td className="px-3 py-2.5 text-[var(--text-secondary)] whitespace-nowrap">{d.date}</td>
                        <td className="px-3 py-2.5 text-[var(--text-secondary)]">{d.scheduled}</td>
                        <td className="px-3 py-2.5 text-[var(--text-secondary)]">{d.expected}</td>
                        <td className="px-3 py-2.5 text-[var(--text-muted)]">{d.slotsPerDay}</td>
                        <td className="px-3 py-2.5">
                          <div className="flex items-center gap-2">
                            <div className="h-1.5 w-16 rounded-full bg-[var(--input-bg)] overflow-hidden shrink-0">
                              <div className={`h-full rounded-full ${bar}`} style={{ width: `${Math.min(100, util)}%` }} />
                            </div>
                            <span className={`text-xs font-semibold ${d.overloaded ? 'text-red-400' : 'text-[var(--text-secondary)]'}`}>{util}%</span>
                          </div>
                        </td>
                        <td className="px-3 py-2.5">
                          {d.overloaded && (
                            <span className="px-2 py-0.5 rounded-full text-[11px] font-semibold border bg-red-900/30 text-red-300 border-red-800/50 whitespace-nowrap">Overloaded</span>
                          )}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
              <p className="mt-2 text-[11px] text-[var(--text-muted)]">
                Capacity = active bays × {WORKING_HOURS_PER_DAY}h working day ÷ avg job length ({forecast.avgJobHours}h). Expected = max(scheduled, 30-day daily average). Days above {DEFAULT_OVERLOAD_PCT}% utilisation are flagged overloaded.
              </p>
            </div>
          )}
        </div>

        {/* Technician load */}
        <div className="card">
          <h3 className="text-sm font-semibold text-[var(--text-primary)] mb-3 flex items-center gap-2">
            <Users size={15} /> Technician load <span className="text-[var(--text-muted)] font-normal">(vs {WORKING_HOURS_PER_DAY}h day)</span>
          </h3>
          {rows === null ? (
            <div className="h-24 bg-[var(--input-bg)] rounded animate-pulse" />
          ) : techLoad.length === 0 ? (
            <p className="text-sm text-[var(--text-muted)]">No technicians assigned yet.</p>
          ) : (
            <div className="flex flex-col gap-2.5">
              {techLoad.slice(0, 10).map((t) => {
                const util = Math.round(t.utilPct)
                const bar = util >= 90 ? 'bg-red-500' : util >= 70 ? 'bg-amber-500' : 'bg-green-500'
                return (
                  <div key={t.technician} className="rounded-lg border border-[var(--input-border)] bg-[var(--input-bg)]/40 p-2.5">
                    <div className="flex items-center justify-between">
                      <p className="text-sm font-medium text-[var(--text-primary)] truncate">{t.technician}</p>
                      <span className="text-xs font-semibold text-[var(--text-secondary)]">{util}%</span>
                    </div>
                    <div className="mt-1.5 h-1.5 w-full rounded-full bg-[var(--input-bg)] overflow-hidden">
                      <div className={`h-full rounded-full ${bar}`} style={{ width: `${Math.min(100, util)}%` }} />
                    </div>
                    <div className="mt-1.5 flex items-center justify-between text-[11px] text-[var(--text-muted)]">
                      <span>{t.jobs} job{t.jobs === 1 ? '' : 's'}</span>
                      <span>{fmtMin(t.bookedMin)} booked</span>
                      <span className="text-green-400">{t.completed} done</span>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </div>

      {/* Filters */}
      <div className="card space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative flex-1 min-w-[200px]">
            <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" />
            <input className="input pl-9 w-full" placeholder="Search bay, site, asset, technician, work order…" value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
          <select className="input" value={bayFilter} onChange={(e) => setBayFilter(e.target.value)} aria-label="Bay">
            <option value="">All bays</option>
            {bayOptions.map((b) => <option key={b} value={b}>{b}</option>)}
          </select>
          <select className="input" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} aria-label="Status">
            <option value="">All statuses</option>
            {STATUSES.map((s) => <option key={s.v} value={s.v}>{s.l}</option>)}
          </select>
          <select className="input" value={priorityFilter} onChange={(e) => setPriorityFilter(e.target.value)} aria-label="Priority">
            <option value="">All priorities</option>
            {PRIORITIES.map((p) => <option key={p.v} value={p.v}>{p.l}</option>)}
          </select>
          <select className="input" value={jobTypeFilter} onChange={(e) => setJobTypeFilter(e.target.value)} aria-label="Job type">
            <option value="">All job types</option>
            {JOB_TYPES.map((j) => <option key={j.v} value={j.v}>{j.l}</option>)}
          </select>
          {hasFilters && <button onClick={clearFilters} className="btn-secondary text-sm inline-flex items-center gap-1.5"><X size={14} /> Clear</button>}
          <span className="text-xs text-[var(--text-muted)] ml-auto">{filtered.length} of {summary.totalJobs}</span>
        </div>
      </div>

      {/* Table */}
      <div className="card overflow-hidden !p-0">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[var(--input-border)] text-left text-xs uppercase tracking-wider text-[var(--text-muted)]">
                {['Bay', 'Asset / Job', 'Technician', 'Scheduled', 'Est.', 'Overrun', 'Priority', 'Status', ''].map((h, i) => <th key={i} className="px-4 py-3 font-semibold whitespace-nowrap">{h}</th>)}
              </tr>
            </thead>
            <tbody>
              {rows === null ? (
                [0, 1, 2, 3, 4].map((i) => <tr key={i} className="border-b border-[var(--input-border)]/50"><td colSpan={9} className="px-4 py-3"><div className="h-4 bg-[var(--input-bg)] rounded animate-pulse" /></td></tr>)
              ) : filtered.length === 0 ? (
                <tr><td colSpan={9} className="px-4 py-12 text-center text-[var(--text-muted)]">
                  <Filter size={22} className="mx-auto mb-2 opacity-60" />
                  {rows.length === 0 && !notProvisioned ? 'No jobs scheduled yet — schedule your first job.' : 'No jobs match these filters.'}
                </td></tr>
              ) : (
                filtered.slice(0, 500).map((r) => {
                  const ov = overrunMinutes(r)
                  const overrun = ov != null && ov > 0
                  return (
                    <tr key={r.id} className={`border-b border-[var(--input-border)]/50 hover:bg-[var(--input-bg)]/40 ${overrun ? 'bg-red-950/10' : ''}`}>
                      <td className="px-4 py-2.5">
                        <p className="font-medium text-[var(--text-primary)]">{r.bay_name || '—'}</p>
                        {r.workshop_site && <p className="text-[11px] text-[var(--text-muted)]">{r.workshop_site}</p>}
                      </td>
                      <td className="px-4 py-2.5">
                        <p className="text-[var(--text-primary)]">{r.asset_no || '—'}</p>
                        <p className="text-[11px] text-[var(--text-muted)]">{fmtLabel(r.job_type)}</p>
                      </td>
                      <td className="px-4 py-2.5 text-[var(--text-secondary)]">{r.technician || '—'}</td>
                      <td className="px-4 py-2.5 text-[var(--text-secondary)] whitespace-nowrap">{fmtDateTime(r.scheduled_start)}</td>
                      <td className="px-4 py-2.5 text-[var(--text-secondary)] whitespace-nowrap">{r.estimated_min == null || r.estimated_min === '' ? '—' : fmtMin(Number(r.estimated_min))}</td>
                      <td className={`px-4 py-2.5 whitespace-nowrap font-medium ${ov == null ? 'text-[var(--text-muted)]' : ov > 0 ? 'text-red-400' : 'text-green-400'}`}>
                        {ov == null ? '—' : `${ov > 0 ? '+' : ''}${fmtMin(ov)}`}
                      </td>
                      <td className="px-4 py-2.5">
                        {r.priority ? <span className={`px-2 py-0.5 rounded-full text-[11px] font-semibold border ${PRIORITY_BADGE[r.priority] || ''}`}>{fmtLabel(r.priority)}</span> : '—'}
                      </td>
                      <td className="px-4 py-2.5">
                        {r.status ? <span className={`px-2 py-0.5 rounded-full text-[11px] font-semibold border ${STATUS_BADGE[r.status] || ''}`}>{fmtLabel(r.status)}</span> : '—'}
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
              <h3 className="text-lg font-bold text-[var(--text-primary)]">{editing ? 'Edit scheduled job' : 'Schedule a job'}</h3>
              <button onClick={closeModal} className="text-[var(--text-muted)] hover:text-[var(--text-primary)]"><X size={18} /></button>
            </div>
            <form onSubmit={submit} className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="label">Bay name</label>
                  <input className="input w-full" placeholder="e.g. Bay 3" value={form.bay_name} maxLength={120} onChange={(e) => set('bay_name', e.target.value)} />
                </div>
                <div>
                  <label className="label">Workshop site (optional)</label>
                  <input className="input w-full" placeholder="e.g. Riyadh workshop" value={form.workshop_site} maxLength={200} onChange={(e) => set('workshop_site', e.target.value)} />
                </div>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="label">Asset number (optional)</label>
                  <input className="input w-full" placeholder="e.g. TRK-1042" value={form.asset_no} maxLength={120} onChange={(e) => set('asset_no', e.target.value)} />
                </div>
                <div>
                  <label className="label">Job type</label>
                  <select className="input w-full" value={form.job_type} onChange={(e) => set('job_type', e.target.value)}>
                    <option value="">Select…</option>
                    {JOB_TYPES.map((j) => <option key={j.v} value={j.v}>{j.l}</option>)}
                  </select>
                </div>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="label">Technician (optional)</label>
                  <input className="input w-full" placeholder="e.g. A. Rahman" value={form.technician} maxLength={160} onChange={(e) => set('technician', e.target.value)} />
                </div>
                <div>
                  <label className="label">Work order ref (optional)</label>
                  <input className="input w-full" placeholder="e.g. WO-2048" value={form.work_order_ref} maxLength={120} onChange={(e) => set('work_order_ref', e.target.value)} />
                </div>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="label">Scheduled start</label>
                  <input className="input w-full" type="datetime-local" value={form.scheduled_start} onChange={(e) => set('scheduled_start', e.target.value)} />
                </div>
                <div>
                  <label className="label">Scheduled end</label>
                  <input className="input w-full" type="datetime-local" value={form.scheduled_end} onChange={(e) => set('scheduled_end', e.target.value)} />
                </div>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="label">Actual start (optional)</label>
                  <input className="input w-full" type="datetime-local" value={form.actual_start} onChange={(e) => set('actual_start', e.target.value)} />
                </div>
                <div>
                  <label className="label">Actual end (optional)</label>
                  <input className="input w-full" type="datetime-local" value={form.actual_end} onChange={(e) => set('actual_end', e.target.value)} />
                </div>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div>
                  <label className="label">Estimated (min)</label>
                  <input className="input w-full" type="number" step="1" min="0" placeholder="90" value={form.estimated_min} onChange={(e) => set('estimated_min', e.target.value)} />
                </div>
                <div>
                  <label className="label">Priority</label>
                  <select className="input w-full" value={form.priority} onChange={(e) => set('priority', e.target.value)}>
                    {PRIORITIES.map((p) => <option key={p.v} value={p.v}>{p.l}</option>)}
                  </select>
                </div>
                <div>
                  <label className="label">Status</label>
                  <select className="input w-full" value={form.status} onChange={(e) => set('status', e.target.value)}>
                    {STATUSES.map((s) => <option key={s.v} value={s.v}>{s.l}</option>)}
                  </select>
                </div>
              </div>
              <div>
                <label className="label">Notes (optional)</label>
                <textarea className="input w-full min-h-[80px] resize-y" placeholder="e.g. awaiting parts, customer waiting" value={form.notes} maxLength={8000} onChange={(e) => set('notes', e.target.value)} />
              </div>

              {formError && (
                <div className="flex items-start gap-2 text-sm text-red-300 bg-red-900/20 border border-red-800/50 rounded-lg px-3 py-2">
                  <AlertTriangle size={15} className="mt-0.5 shrink-0" /> {formError}
                </div>
              )}

              <div className="flex items-center justify-end gap-2 pt-1">
                <button type="button" onClick={closeModal} className="btn-secondary text-sm" disabled={saving}>Cancel</button>
                <button type="submit" className="btn-primary text-sm inline-flex items-center gap-1.5 disabled:opacity-60" disabled={saving}>
                  {saving ? 'Saving…' : editing ? 'Save changes' : 'Schedule job'}
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
                <h3 className="text-[var(--text-primary)] font-semibold">Delete this scheduled job?</h3>
                <p className="text-sm text-[var(--text-muted)] mt-1">
                  {confirmDelete.bay_name || 'Job'} · {confirmDelete.asset_no || fmtLabel(confirmDelete.job_type)} · {fmtDateTime(confirmDelete.scheduled_start)}. This can’t be undone.
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
