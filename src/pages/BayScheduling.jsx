/**
 * BayScheduling (route /bay-scheduling): Bay Scheduling / Workshop Capacity.
 * Plans and tracks which workshop bay each job occupies and for how long,
 * turning raw schedule rows into capacity intelligence: bay utilisation,
 * technician load, job-overrun tracking, and double-booking conflict detection.
 * Every row is org-isolated and country-scoped.
 *
 * Runs on the `bay_schedules` table (V184). Layout: a KPI strip, the conflict
 * alerts (always visible, because a double-booking is actionable wherever you
 * are), then two tabs, Capacity (bay load, 7-day forecast, technician load) and
 * Job register (search, filters, sortable table, create/edit/delete).
 *
 * Bay maths lives in src/lib/bayScheduling.js; page-level answers (local
 * "today", KPIs with honest nulls, filters, exports) live in the pure
 * src/lib/baySchedulingAnalytics.js. "now" is computed once per mount and
 * injected so the page is deterministic per render. The service degrades a
 * missing table to [], so provisioning is confirmed with probeRelation rather
 * than by reading an empty list as "not installed".
 */
import { useState, useEffect, useMemo, useCallback } from 'react'
import {
  Wrench, CheckCircle2, AlertTriangle, Gauge, X, FileSpreadsheet, FileText,
  Plus, Pencil, Trash2, PlayCircle, Timer, Layers, Building2, CalendarDays,
  Users, TrendingUp, ListChecks, RotateCcw, Search, Clock,
} from 'lucide-react'
import PageHeader from '../components/ui/PageHeader'
import Card from '../components/ui/Card'
import Modal from '../components/ui/Modal'
import StatTile from '../components/ui/StatTile'
import { Skeleton } from '../components/ui/Skeleton'
import EnterpriseTable from '../components/ui/EnterpriseTable'
import { useSettings } from '../contexts/SettingsContext'
import {
  listBaySchedules, createBaySchedule, updateBaySchedule, deleteBaySchedule,
} from '../lib/api/bayScheduling'
import {
  conflictsForBay, overrunMinutes, forecastCapacity, perTechnicianLoad,
  technicianConflicts, WORKING_HOURS_PER_DAY,
} from '../lib/bayScheduling'
import {
  JOB_TYPES, PRIORITIES, STATUSES, JOB_TYPE_LABEL, READ_LIMIT, fmtLabel, fmtMin,
  bayLoadToday, bayKpis, bayOptions, filterJobs, conflictJobIds, jobExportRows, utilBand,
} from '../lib/baySchedulingAnalytics'
import { exportToExcel, exportToPdf, reportFileName } from '../lib/exportUtils'
import { toUserMessage } from '../lib/safeError'
import { isMissingRelation, probeRelation } from '../lib/api/_client'

const EMPTY_FORM = {
  bay_name: '', workshop_site: '', asset_no: '', job_type: '', technician: '',
  scheduled_start: '', scheduled_end: '', actual_start: '', actual_end: '',
  estimated_min: '', priority: 'normal', status: 'scheduled', work_order_ref: '', notes: '',
}
const DEFAULT_OVERLOAD_PCT = 90 // mirrors DEFAULT_CAPACITY_CONFIG.overloadThresholdPct
const FOCUS = 'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:ring-offset-1'

const STATUS_BADGE = {
  scheduled: 'text-sky-500 border-sky-500/40',
  in_progress: 'text-indigo-400 border-indigo-500/40',
  completed: 'text-green-500 border-green-500/40',
  delayed: 'text-amber-500 border-amber-500/40',
  cancelled: 'text-[var(--text-muted)] border-[var(--input-border)]',
}
const PRIORITY_BADGE = {
  low: 'text-[var(--text-muted)] border-[var(--input-border)]',
  normal: 'text-sky-500 border-sky-500/40',
  high: 'text-orange-500 border-orange-500/40',
  urgent: 'text-red-400 border-red-500/40',
}
const BAR = { high: 'bg-red-500', busy: 'bg-amber-500', ok: 'bg-green-500', none: 'bg-[var(--input-border)]' }

function fmtDateTime(v) {
  if (!v) return 'N/A'
  const d = new Date(v)
  return Number.isNaN(d.getTime()) ? 'N/A' : d.toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })
}
// datetime-local expects "YYYY-MM-DDTHH:mm" in local time.
function toLocalInput(v) {
  if (!v) return ''
  const d = new Date(v)
  if (Number.isNaN(d.getTime())) return ''
  const off = d.getTimezoneOffset()
  return new Date(d.getTime() - off * 60000).toISOString().slice(0, 16)
}

function UtilBar({ pct, label }) {
  const band = utilBand(pct)
  return (
    <div className="flex items-center gap-2" role="img" aria-label={`${label}: ${Number.isFinite(pct) ? `${pct}%` : 'not measured'}, ${band.label}`}>
      <div className="h-1.5 flex-1 rounded-full bg-[var(--input-bg)] overflow-hidden">
        <div className={`h-full rounded-full ${BAR[band.key]}`} style={{ width: `${Math.max(0, Math.min(100, Number(pct) || 0))}%` }} />
      </div>
      <span className="text-[11px] text-[var(--text-muted)] whitespace-nowrap">{band.label}</span>
    </div>
  )
}

function Heading({ icon: Icon, children, qualifier }) {
  // Hand-rolled on purpose: the qualifier names the working-day denominator
  // the percentages are read against, and must not be truncated away.
  return (
    <h2 className="text-sm font-semibold text-[var(--text-primary)] mb-3 flex flex-wrap items-center gap-2">
      <Icon size={15} aria-hidden="true" /> {children}
      {qualifier && <span className="text-[var(--text-muted)] font-normal">{qualifier}</span>}
    </h2>
  )
}

export default function BayScheduling() {
  const { activeCountry } = useSettings()
  const nowMs = useMemo(() => Date.now(), []) // computed once per mount; injected into pure fns
  const [rows, setRows] = useState(null)
  const [error, setError] = useState('')
  const [notProvisioned, setNotProvisioned] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [updatedAt, setUpdatedAt] = useState(null)
  const [tab, setTab] = useState('capacity')

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
  const [deleteError, setDeleteError] = useState('')

  const load = useCallback(async () => {
    setRefreshing(true); setError(''); setNotProvisioned(false)
    try {
      const data = await listBaySchedules({ country: activeCountry, limit: READ_LIMIT })
      const list = Array.isArray(data) ? data : []
      setRows(list)
      setUpdatedAt(new Date())
      if (list.length === 0) {
        // The service degrades a missing table to [], so an empty list proves
        // nothing. Only a DEFINITE missing relation shows the banner.
        const { exists, checked } = await probeRelation('bay_schedules')
        if (checked && !exists) setNotProvisioned(true)
      }
    } catch (err) {
      if (isMissingRelation(err)) setNotProvisioned(true)
      else setError(toUserMessage(err, 'Could not load bay schedules.'))
      setRows([])
    } finally {
      setRefreshing(false)
    }
  }, [activeCountry])

  useEffect(() => { load() }, [load])

  const list = useMemo(() => rows || [], [rows])
  const k = useMemo(() => bayKpis(list, nowMs), [list, nowMs])
  const conflicts = useMemo(() => conflictsForBay(list), [list])
  const conflictIds = useMemo(() => conflictJobIds(list), [list])
  const bayLoad = useMemo(() => bayLoadToday(list, nowMs), [list, nowMs])
  const forecast = useMemo(() => forecastCapacity(list, nowMs), [list, nowMs])
  const techLoad = useMemo(() => perTechnicianLoad(list), [list])
  const techConflicts = useMemo(() => technicianConflicts(list), [list])
  const bays = useMemo(() => bayOptions(list), [list])
  const filtered = useMemo(
    () => filterJobs(list, { bay: bayFilter, status: statusFilter, priority: priorityFilter, jobType: jobTypeFilter, search }),
    [list, search, bayFilter, statusFilter, priorityFilter, jobTypeFilter],
  )
  const loading = rows === null
  const failed = !!error

  const na = (v) => (failed ? 'N/A' : v)
  const tiles = [
    { label: 'Total jobs', value: na(k.totalJobs.toLocaleString()), sub: k.capped ? `Latest ${READ_LIMIT} loaded` : `${k.live} open`, icon: Layers },
    { label: 'In progress', value: na(String(k.inProgressCount)), sub: `${k.scheduledToday} scheduled today`, icon: PlayCircle, tone: 'info' },
    { label: 'Completed today', value: na(String(k.completedToday)), icon: CheckCircle2, tone: 'accent' },
    { label: 'Delayed', value: na(String(k.delayedCount)), sub: k.delayedCount > 0 ? 'Needs attention' : 'None delayed', icon: AlertTriangle, tone: k.delayedCount > 0 ? 'warn' : 'neutral' },
    { label: 'Avg overrun', value: na(fmtMin(k.avgOverrunMin)), sub: k.avgOverrunMin == null ? 'No measured jobs' : k.avgOverrunMin > 0 ? 'Running late' : 'Ahead of plan', icon: Timer, tone: (k.avgOverrunMin ?? 0) > 0 ? 'crit' : 'neutral' },
    { label: 'On-time rate', value: na(k.onTimePct == null ? 'N/A' : `${k.onTimePct}%`), sub: `${k.onTimeMeasured} measured jobs`, icon: Clock, tone: 'neutral' },
    { label: 'Active bays', value: na(String(k.activeBays)), sub: `${k.conflicts} double-booking${k.conflicts === 1 ? '' : 's'}`, icon: Building2, tone: k.conflicts ? 'crit' : 'info' },
  ]

  // ── Export ───────────────────────────────────────────────────────────────
  const EXPORT_COLS = ['bay_name', 'workshop_site', 'asset_no', 'job_type', 'technician', 'scheduled_start', 'scheduled_end', 'estimated_min', 'overrun_min', 'priority', 'status', 'work_order_ref']
  const EXPORT_HEADERS = ['Bay', 'Site', 'Asset', 'Job type', 'Technician', 'Scheduled start', 'Scheduled end', 'Est. min', 'Overrun min', 'Priority', 'Status', 'Work order']
  const exportRows = useMemo(() => jobExportRows(filtered), [filtered])
  const fileBase = reportFileName('Bay Scheduling', activeCountry !== 'All' ? activeCountry : '')

  // ── Modal ────────────────────────────────────────────────────────────────
  const openCreate = () => { setEditing(null); setForm(EMPTY_FORM); setFormError(''); setShowModal(true) }
  const openEdit = useCallback((r) => {
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
  }, [])
  const closeModal = () => { if (!saving) { setShowModal(false); setEditing(null) } }
  const closeDelete = () => { if (!deleting) setConfirmDelete(null) }
  const set = (key, v) => setForm((f) => ({ ...f, [key]: v }))

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
      setFormError(toUserMessage(err, 'Could not save the schedule.'))
    } finally {
      setSaving(false)
    }
  }, [form, editing, activeCountry, load])

  const doDelete = useCallback(async () => {
    if (!confirmDelete) return
    setDeleting(true); setDeleteError('')
    try {
      await deleteBaySchedule(confirmDelete.id)
      setConfirmDelete(null)
      await load()
    } catch (err) {
      setDeleteError(toUserMessage(err, 'Could not delete the schedule.'))
    } finally {
      setDeleting(false)
    }
  }, [confirmDelete, load])

  const clearFilters = () => { setSearch(''); setBayFilter(''); setStatusFilter(''); setPriorityFilter(''); setJobTypeFilter('') }
  const hasFilters = search || bayFilter || statusFilter || priorityFilter || jobTypeFilter

  // ── Tables ───────────────────────────────────────────────────────────────
  const jobColumns = useMemo(() => [
    {
      id: 'bay', header: 'Bay', accessorFn: (r) => r.bay_name || '',
      cell: ({ row }) => (
        <div>
          <p className="font-medium text-[var(--text-primary)] inline-flex items-center gap-1">
            {row.original.bay_name || 'N/A'}
            {conflictIds.has(row.original.id) && <span className="text-[10px] px-1.5 py-0.5 rounded border border-red-500/40 text-red-400">Double-booked</span>}
          </p>
          {row.original.workshop_site && <p className="text-[11px] text-[var(--text-muted)]">{row.original.workshop_site}</p>}
        </div>
      ),
    },
    {
      id: 'asset', header: 'Asset / Job', accessorFn: (r) => r.asset_no || '',
      cell: ({ row }) => (
        <div>
          <p className="text-[var(--text-primary)]">{row.original.asset_no || 'N/A'}</p>
          <p className="text-[11px] text-[var(--text-muted)]">{JOB_TYPE_LABEL[row.original.job_type] || fmtLabel(row.original.job_type)}</p>
        </div>
      ),
    },
    { id: 'tech', header: 'Technician', accessorFn: (r) => r.technician || 'N/A' },
    { id: 'start', header: 'Scheduled', accessorFn: (r) => r.scheduled_start || '', cell: ({ getValue }) => <span className="whitespace-nowrap">{fmtDateTime(getValue())}</span> },
    { id: 'est', header: 'Est.', accessorFn: (r) => (r.estimated_min == null || r.estimated_min === '' ? null : Number(r.estimated_min)), meta: { align: 'right' }, cell: ({ getValue }) => <span className="whitespace-nowrap tabular-nums">{fmtMin(getValue())}</span> },
    {
      id: 'overrun', header: 'Overrun', accessorFn: (r) => overrunMinutes(r), meta: { align: 'right' },
      cell: ({ getValue }) => {
        const ov = getValue()
        return <span className={`whitespace-nowrap tabular-nums font-medium ${ov == null ? 'text-[var(--text-muted)]' : ov > 0 ? 'text-red-400' : 'text-green-500'}`}>{ov == null ? 'N/A' : `${ov > 0 ? '+' : ''}${fmtMin(ov)}`}</span>
      },
    },
    { id: 'priority', header: 'Priority', accessorFn: (r) => fmtLabel(r.priority), cell: ({ row }) => (row.original.priority ? <span className={`px-2 py-0.5 rounded-full text-[11px] font-semibold border ${PRIORITY_BADGE[row.original.priority] || ''}`}>{fmtLabel(row.original.priority)}</span> : 'N/A') },
    { id: 'status', header: 'Status', accessorFn: (r) => fmtLabel(r.status), cell: ({ row }) => (row.original.status ? <span className={`px-2 py-0.5 rounded-full text-[11px] font-semibold border ${STATUS_BADGE[row.original.status] || ''}`}>{fmtLabel(row.original.status)}</span> : 'N/A') },
    {
      id: 'actions', header: '', enableSorting: false, meta: { export: false },
      cell: ({ row }) => (
        <div className="flex items-center justify-end gap-1">
          <button type="button" onClick={() => openEdit(row.original)} className={`inline-flex items-center justify-center min-h-[44px] min-w-[44px] rounded hover:bg-[var(--input-bg)] text-[var(--text-muted)] hover:text-[var(--text-primary)] ${FOCUS}`} aria-label={`Edit job in ${row.original.bay_name || 'bay'}`}><Pencil size={14} aria-hidden="true" /></button>
          <button type="button" onClick={() => { setDeleteError(''); setConfirmDelete(row.original) }} className={`inline-flex items-center justify-center min-h-[44px] min-w-[44px] rounded hover:bg-red-500/10 text-[var(--text-muted)] hover:text-red-400 ${FOCUS}`} aria-label={`Delete job in ${row.original.bay_name || 'bay'}`}><Trash2 size={14} aria-hidden="true" /></button>
        </div>
      ),
    },
  ], [conflictIds, openEdit])

  const forecastColumns = useMemo(() => [
    { id: 'day', header: 'Day', accessorFn: (d) => d.dayName, enableSorting: false, cell: ({ getValue }) => <span className="font-medium text-[var(--text-primary)]">{getValue()}</span> },
    { id: 'date', header: 'Date', accessorFn: (d) => d.date, cell: ({ getValue }) => <span className="whitespace-nowrap">{getValue()}</span> },
    { id: 'scheduled', header: 'Scheduled', accessorFn: (d) => d.scheduled, meta: { align: 'right' } },
    { id: 'expected', header: 'Expected', accessorFn: (d) => d.expected, meta: { align: 'right' } },
    { id: 'capacity', header: 'Capacity', accessorFn: (d) => d.slotsPerDay, meta: { align: 'right' } },
    {
      id: 'util', header: 'Utilisation', accessorFn: (d) => d.utilPct,
      cell: ({ row }) => (
        <div className="flex items-center gap-2 min-w-[9rem]">
          <span className={`text-xs font-semibold tabular-nums w-12 ${row.original.overloaded ? 'text-red-400' : 'text-[var(--text-secondary)]'}`}>{Math.round(row.original.utilPct)}%</span>
          <UtilBar pct={Math.round(row.original.utilPct)} label={`${row.original.dayName} utilisation`} />
        </div>
      ),
    },
  ], [])

  return (
    <div className="space-y-6">
      <PageHeader
        title="Bay Scheduling"
        subtitle="Plan and track workshop bay capacity: utilisation, technician load, job overruns and double-booking conflicts across every bay."
        icon={Wrench}
        onRefresh={load}
        refreshing={refreshing}
        updatedAt={updatedAt}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" onClick={async () => { try { await exportToExcel(exportRows, EXPORT_COLS, EXPORT_HEADERS, fileBase, 'Bay schedule', { title: 'Bay Scheduling' }) } catch (e) { setError(toUserMessage(e, 'Could not export. Try again.')) } }} className={`btn-secondary text-sm inline-flex items-center gap-1.5 min-h-[44px] ${FOCUS}`} disabled={!filtered.length}>
              <FileSpreadsheet size={14} aria-hidden="true" /> Excel
            </button>
            <button type="button" onClick={async () => { try { await exportToPdf(exportRows, EXPORT_COLS.map((key, i) => ({ key, header: EXPORT_HEADERS[i] })), 'Bay Scheduling', fileBase, 'landscape') } catch (e) { setError(toUserMessage(e, 'Could not export. Try again.')) } }} className={`btn-secondary text-sm inline-flex items-center gap-1.5 min-h-[44px] ${FOCUS}`} disabled={!filtered.length}>
              <FileText size={14} aria-hidden="true" /> PDF
            </button>
            <button type="button" onClick={openCreate} className={`btn-primary text-sm inline-flex items-center gap-1.5 min-h-[44px] ${FOCUS}`} disabled={notProvisioned}>
              <Plus size={14} aria-hidden="true" /> Schedule job
            </button>
          </div>
        }
      />

      {notProvisioned && (
        <Card tone="warn" className="items-start gap-3" style={{ flexDirection: 'row' }}>
          <AlertTriangle size={18} className="text-amber-400 mt-0.5 shrink-0" aria-hidden="true" />
          <div>
            <p className="text-[var(--text-primary)] font-medium">Bay scheduling is not enabled on this database yet.</p>
            <p className="text-[var(--text-muted)] text-sm mt-1">
              Apply <span className="font-mono text-[var(--text-primary)]">MIGRATIONS_V184_BAY_SCHEDULES.sql</span>, then reload.
            </p>
          </div>
        </Card>
      )}

      {error && (
        <Card tone="crit" role="alert">
          <div className="flex flex-wrap items-start gap-3">
            <AlertTriangle size={18} className="text-red-400 mt-0.5 shrink-0" aria-hidden="true" />
            <div className="flex-1 min-w-[12rem]"><p className="text-red-400 font-medium">Could not load bay schedules.</p><p className="text-[var(--text-muted)] text-sm mt-1">{error}</p></div>
            <button type="button" onClick={load} className={`btn-secondary text-sm inline-flex items-center gap-1.5 min-h-[44px] ${FOCUS}`}><RotateCcw size={14} aria-hidden="true" /> Retry</button>
          </div>
        </Card>
      )}

      {k.capped && !failed && (
        <p className="text-xs text-[var(--text-muted)]">Showing the latest {READ_LIMIT} scheduled jobs. Older jobs are not loaded, so totals and averages cover this window only.</p>
      )}

      <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-7 gap-3">
        {tiles.map((t, i) => (
          loading
            ? <div key={t.label} className="card !p-4 space-y-3"><Skeleton className="h-3 w-2/3" /><Skeleton className="h-7 w-1/2" /><Skeleton className="h-2.5 w-3/4" /></div>
            : <StatTile key={t.label} index={i} {...t} />
        ))}
      </div>

      {conflicts.length > 0 && (
        <Card tone="crit">
          <div className="flex items-start gap-3">
            <AlertTriangle size={18} className="text-red-400 mt-0.5 shrink-0" aria-hidden="true" />
            <div className="flex-1 min-w-0">
              <p className="text-red-400 font-medium">
                {conflicts.length} scheduling conflict{conflicts.length === 1 ? '' : 's'} detected. A bay is double-booked.
              </p>
              <ul className="mt-2 flex flex-col gap-1.5">
                {conflicts.slice(0, 5).map((c, i) => (
                  <li key={i} className="text-sm text-[var(--text-secondary)] flex flex-wrap items-center gap-x-2 gap-y-0.5">
                    <span className="font-semibold text-[var(--text-primary)]">{c.a.bay_name}:</span>
                    <span>{c.a.asset_no || fmtLabel(c.a.job_type)} ({fmtDateTime(c.a.scheduled_start)})</span>
                    <span className="text-red-400 font-medium">overlaps</span>
                    <span>{c.b.asset_no || fmtLabel(c.b.job_type)} ({fmtDateTime(c.b.scheduled_start)})</span>
                  </li>
                ))}
              </ul>
              {conflicts.length > 5 && <p className="text-xs text-[var(--text-muted)] mt-1">and {conflicts.length - 5} more. Flagged "Double-booked" in the job register.</p>}
            </div>
          </div>
        </Card>
      )}

      {techConflicts.length > 0 && (
        <Card tone="warn">
          <div className="flex items-start gap-3">
            <Users size={18} className="text-amber-400 mt-0.5 shrink-0" aria-hidden="true" />
            <div className="flex-1 min-w-0">
              <p className="text-[var(--text-primary)] font-medium">
                {techConflicts.length} technician double-booking{techConflicts.length === 1 ? '' : 's'}. A technician is assigned to overlapping jobs in different bays.
              </p>
              <ul className="mt-2 flex flex-col gap-1.5">
                {techConflicts.slice(0, 5).map((c, i) => (
                  <li key={i} className="text-sm text-[var(--text-secondary)] flex flex-wrap items-center gap-x-2 gap-y-0.5">
                    <span className="font-semibold text-[var(--text-primary)]">{c.technician}:</span>
                    <span>{c.a.bay_name} ({fmtDateTime(c.a.scheduled_start)})</span>
                    <span className="text-amber-500 font-medium">overlaps</span>
                    <span>{c.b.bay_name} ({fmtDateTime(c.b.scheduled_start)})</span>
                  </li>
                ))}
              </ul>
              {techConflicts.length > 5 && <p className="text-xs text-[var(--text-muted)] mt-1">and {techConflicts.length - 5} more.</p>}
            </div>
          </div>
        </Card>
      )}

      <div role="tablist" aria-label="Bay scheduling sections" className="flex gap-1 overflow-x-auto border-b border-[var(--input-border)]">
        {[
          { key: 'capacity', label: 'Capacity', icon: Gauge },
          { key: 'register', label: 'Job register', icon: ListChecks, count: loading ? null : filtered.length },
        ].map((t) => {
          const Icon = t.icon
          const active = tab === t.key
          return (
            <button key={t.key} type="button" role="tab" aria-selected={active} onClick={() => setTab(t.key)}
              className={`inline-flex items-center gap-1.5 min-h-[44px] px-4 text-sm font-medium border-b-2 -mb-px whitespace-nowrap transition-colors ${FOCUS} ${active ? 'border-[var(--accent)] text-[var(--text-primary)]' : 'border-transparent text-[var(--text-muted)] hover:text-[var(--text-secondary)]'}`}>
              <Icon size={15} aria-hidden="true" /> {t.label}
              {t.count != null && <span className="ml-1 text-[10px] px-1.5 py-0.5 rounded-full bg-[var(--input-bg)] text-[var(--text-secondary)] tabular-nums">{t.count}</span>}
            </button>
          )
        })}
      </div>

      {tab === 'capacity' && (
        <div className="space-y-4">
          <Card>
            <Heading icon={Gauge} qualifier={`(today, vs a ${WORKING_HOURS_PER_DAY}h working day)`}>Bay load and utilisation</Heading>
            {loading ? (
              <Skeleton className="h-20 w-full" />
            ) : failed ? (
              <p className="text-sm text-[var(--text-muted)]">Bay load could not be calculated because the schedule did not load.</p>
            ) : bayLoad.length === 0 ? (
              <p className="text-sm text-[var(--text-muted)]">No bays scheduled yet. Schedule a job to see bay load.</p>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                {bayLoad.slice(0, 12).map((b) => (
                  <div key={b.bay_name} className="rounded-lg border border-[var(--input-border)] p-3">
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-sm font-semibold text-[var(--text-primary)] truncate flex items-center gap-1.5">
                        <Building2 size={13} className="text-[var(--text-muted)] shrink-0" aria-hidden="true" /> {b.bay_name}
                      </p>
                      <span className="text-xs font-semibold text-[var(--text-secondary)] tabular-nums">{b.utilization}%</span>
                    </div>
                    <div className="mt-2"><UtilBar pct={b.utilization} label={`${b.bay_name} utilisation today`} /></div>
                    <div className="mt-2 flex items-center justify-between text-[11px] text-[var(--text-muted)]">
                      <span>{b.jobs} job{b.jobs === 1 ? '' : 's'}</span>
                      <span>{fmtMin(b.busyMin)} booked</span>
                      <span>{b.completed} done</span>
                    </div>
                  </div>
                ))}
              </div>
            )}
            {bayLoad.length > 12 && <p className="text-xs text-[var(--text-muted)] mt-2">Showing the 12 busiest of {bayLoad.length} bays.</p>}
          </Card>

          <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
            <Card className="xl:col-span-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <Heading icon={CalendarDays} qualifier="(next 7 days)">Capacity forecast</Heading>
                {!loading && !failed && (
                  <span className="text-[11px] text-[var(--text-muted)] flex items-center gap-1.5 mb-3">
                    <TrendingUp size={12} aria-hidden="true" /> {forecast.avgDaily} per day avg, {forecast.activeBays} bay{forecast.activeBays === 1 ? '' : 's'}, about {forecast.slotsPerDay} slots per day
                  </span>
                )}
              </div>
              {loading ? (
                <Skeleton className="h-24 w-full" />
              ) : forecast.activeBays === 0 && !failed ? (
                <p className="text-sm text-[var(--text-muted)]">No active bays yet. Schedule jobs to project capacity.</p>
              ) : (
                <>
                  <EnterpriseTable
                    columns={forecastColumns}
                    data={failed ? [] : forecast.days}
                    getRowId={(d) => d.date}
                    error={failed ? 'The forecast could not be calculated because the schedule did not load.' : null}
                    onRetry={load}
                    enableGlobalFilter={false}
                    enableColumnFilters={false}
                    enableColumnVisibility={false}
                    exportFileName={reportFileName('Bay Capacity Forecast')}
                    reportMeta={{ title: 'Bay capacity forecast (next 7 days)' }}
                    pageSizeOptions={[7]}
                    initialPageSize={7}
                    emptyMessage="No forecast days."
                  />
                  <p className="mt-2 text-[11px] text-[var(--text-muted)]">
                    Capacity = active bays times a {WORKING_HOURS_PER_DAY}h working day divided by average job length ({forecast.avgJobHours}h). Expected = the larger of scheduled jobs and the 30-day daily average. Days above {DEFAULT_OVERLOAD_PCT}% utilisation are marked Overloaded.
                  </p>
                </>
              )}
            </Card>

            <Card>
              <Heading icon={Users} qualifier={`(vs a ${WORKING_HOURS_PER_DAY}h day)`}>Technician load</Heading>
              {loading ? (
                <Skeleton className="h-24 w-full" />
              ) : failed ? (
                <p className="text-sm text-[var(--text-muted)]">Technician load could not be calculated because the schedule did not load.</p>
              ) : techLoad.length === 0 ? (
                <p className="text-sm text-[var(--text-muted)]">No technicians assigned yet.</p>
              ) : (
                <ul className="flex flex-col gap-2.5">
                  {techLoad.slice(0, 10).map((t) => (
                    <li key={t.technician} className="rounded-lg border border-[var(--input-border)] p-2.5">
                      <div className="flex items-center justify-between gap-2">
                        <p className="text-sm font-medium text-[var(--text-primary)] truncate">{t.technician}</p>
                        <span className="text-xs font-semibold text-[var(--text-secondary)] tabular-nums">{Math.round(t.utilPct)}%</span>
                      </div>
                      <div className="mt-1.5"><UtilBar pct={Math.round(t.utilPct)} label={`${t.technician} load`} /></div>
                      <div className="mt-1.5 flex items-center justify-between text-[11px] text-[var(--text-muted)]">
                        <span>{t.jobs} job{t.jobs === 1 ? '' : 's'}</span>
                        <span>{fmtMin(t.bookedMin)} booked</span>
                        <span>{t.completed} done</span>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
              {techLoad.length > 10 && <p className="text-xs text-[var(--text-muted)] mt-2">Showing the 10 most loaded of {techLoad.length} technicians.</p>}
            </Card>
          </div>
        </div>
      )}

      {tab === 'register' && (
        <Card>
          <div className="flex flex-wrap items-end gap-2 mb-3">
            <div className="relative flex-1 min-w-[12rem]">
              <label htmlFor="bay-search" className="sr-only">Search jobs</label>
              <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" aria-hidden="true" />
              <input id="bay-search" className={`input pl-9 w-full min-h-[44px] ${FOCUS}`} placeholder="Search bay, site, asset, technician, work order" value={search} onChange={(e) => setSearch(e.target.value)} />
            </div>
            <label htmlFor="bay-f-bay" className="sr-only">Bay</label>
            <select id="bay-f-bay" className={`input min-h-[44px] ${FOCUS}`} value={bayFilter} onChange={(e) => setBayFilter(e.target.value)}>
              <option value="">All bays</option>
              {bays.map((b) => <option key={b} value={b}>{b}</option>)}
            </select>
            <label htmlFor="bay-f-status" className="sr-only">Status</label>
            <select id="bay-f-status" className={`input min-h-[44px] ${FOCUS}`} value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
              <option value="">All statuses</option>
              {STATUSES.map((s) => <option key={s.v} value={s.v}>{s.l}</option>)}
            </select>
            <label htmlFor="bay-f-priority" className="sr-only">Priority</label>
            <select id="bay-f-priority" className={`input min-h-[44px] ${FOCUS}`} value={priorityFilter} onChange={(e) => setPriorityFilter(e.target.value)}>
              <option value="">All priorities</option>
              {PRIORITIES.map((p) => <option key={p.v} value={p.v}>{p.l}</option>)}
            </select>
            <label htmlFor="bay-f-type" className="sr-only">Job type</label>
            <select id="bay-f-type" className={`input min-h-[44px] ${FOCUS}`} value={jobTypeFilter} onChange={(e) => setJobTypeFilter(e.target.value)}>
              <option value="">All job types</option>
              {JOB_TYPES.map((j) => <option key={j.v} value={j.v}>{j.l}</option>)}
            </select>
            {hasFilters && <button type="button" onClick={clearFilters} className={`btn-secondary text-sm inline-flex items-center gap-1.5 min-h-[44px] ${FOCUS}`}><X size={14} aria-hidden="true" /> Clear</button>}
            <span className="text-xs text-[var(--text-muted)] ml-auto self-center" aria-live="polite">{filtered.length} of {k.totalJobs}</span>
          </div>
          <EnterpriseTable
            columns={jobColumns}
            data={filtered}
            getRowId={(r) => String(r.id)}
            loading={loading}
            error={failed ? error : null}
            onRetry={load}
            enableGlobalFilter={false}
            enableExport={false}
            viewKey="bay-schedule-register"
            emptyMessage={list.length === 0 && !notProvisioned ? 'No jobs scheduled yet. Schedule your first job.' : 'No jobs match these filters.'}
            initialPageSize={25}
          />
        </Card>
      )}

      {showModal && (
        <Modal open onClose={closeModal} size="md" title={editing ? 'Edit scheduled job' : 'Schedule a job'}>
          <form onSubmit={submit} className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="label" htmlFor="bs-bay">Bay name (required)</label>
                <input id="bs-bay" className="input w-full min-h-[44px]" placeholder="e.g. Bay 3" value={form.bay_name} maxLength={120} onChange={(e) => set('bay_name', e.target.value)} />
              </div>
              <div>
                <label className="label" htmlFor="bs-site">Workshop site (optional)</label>
                <input id="bs-site" className="input w-full min-h-[44px]" placeholder="e.g. Riyadh workshop" value={form.workshop_site} maxLength={200} onChange={(e) => set('workshop_site', e.target.value)} />
              </div>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="label" htmlFor="bs-asset">Asset number (optional)</label>
                <input id="bs-asset" className="input w-full min-h-[44px]" placeholder="e.g. TRK-1042" value={form.asset_no} maxLength={120} onChange={(e) => set('asset_no', e.target.value)} />
              </div>
              <div>
                <label className="label" htmlFor="bs-type">Job type</label>
                <select id="bs-type" className="input w-full min-h-[44px]" value={form.job_type} onChange={(e) => set('job_type', e.target.value)}>
                  <option value="">Select...</option>
                  {JOB_TYPES.map((j) => <option key={j.v} value={j.v}>{j.l}</option>)}
                </select>
              </div>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="label" htmlFor="bs-tech">Technician (optional)</label>
                <input id="bs-tech" className="input w-full min-h-[44px]" placeholder="e.g. A. Rahman" value={form.technician} maxLength={160} onChange={(e) => set('technician', e.target.value)} />
              </div>
              <div>
                <label className="label" htmlFor="bs-wo">Work order ref (optional)</label>
                <input id="bs-wo" className="input w-full min-h-[44px]" placeholder="e.g. WO-2048" value={form.work_order_ref} maxLength={120} onChange={(e) => set('work_order_ref', e.target.value)} />
              </div>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="label" htmlFor="bs-sstart">Scheduled start</label>
                <input id="bs-sstart" className="input w-full min-h-[44px]" type="datetime-local" value={form.scheduled_start} onChange={(e) => set('scheduled_start', e.target.value)} />
              </div>
              <div>
                <label className="label" htmlFor="bs-send">Scheduled end</label>
                <input id="bs-send" className="input w-full min-h-[44px]" type="datetime-local" value={form.scheduled_end} onChange={(e) => set('scheduled_end', e.target.value)} />
              </div>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="label" htmlFor="bs-astart">Actual start (optional)</label>
                <input id="bs-astart" className="input w-full min-h-[44px]" type="datetime-local" value={form.actual_start} onChange={(e) => set('actual_start', e.target.value)} />
              </div>
              <div>
                <label className="label" htmlFor="bs-aend">Actual end (optional)</label>
                <input id="bs-aend" className="input w-full min-h-[44px]" type="datetime-local" value={form.actual_end} onChange={(e) => set('actual_end', e.target.value)} />
              </div>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div>
                <label className="label" htmlFor="bs-est">Estimated (min)</label>
                <input id="bs-est" className="input w-full min-h-[44px]" type="number" step="1" min="0" placeholder="90" value={form.estimated_min} onChange={(e) => set('estimated_min', e.target.value)} />
              </div>
              <div>
                <label className="label" htmlFor="bs-priority">Priority</label>
                <select id="bs-priority" className="input w-full min-h-[44px]" value={form.priority} onChange={(e) => set('priority', e.target.value)}>
                  {PRIORITIES.map((p) => <option key={p.v} value={p.v}>{p.l}</option>)}
                </select>
              </div>
              <div>
                <label className="label" htmlFor="bs-status">Status</label>
                <select id="bs-status" className="input w-full min-h-[44px]" value={form.status} onChange={(e) => set('status', e.target.value)}>
                  {STATUSES.map((s) => <option key={s.v} value={s.v}>{s.l}</option>)}
                </select>
              </div>
            </div>
            <div>
              <label className="label" htmlFor="bs-notes">Notes (optional)</label>
              <textarea id="bs-notes" className="input w-full min-h-[80px] resize-y" placeholder="e.g. awaiting parts, customer waiting" value={form.notes} maxLength={8000} onChange={(e) => set('notes', e.target.value)} />
            </div>

            {formError && (
              <div role="alert" className="flex items-start gap-2 text-sm text-red-400 border border-red-500/30 rounded-lg px-3 py-2">
                <AlertTriangle size={15} className="mt-0.5 shrink-0" aria-hidden="true" /> {formError}
              </div>
            )}

            <div className="flex items-center justify-end gap-2 pt-1">
              <button type="button" onClick={closeModal} className="btn-secondary text-sm min-h-[44px]" disabled={saving}>Cancel</button>
              <button type="submit" className="btn-primary text-sm inline-flex items-center gap-1.5 min-h-[44px] disabled:opacity-60" disabled={saving}>
                {saving ? 'Saving...' : editing ? 'Save changes' : 'Schedule job'}
              </button>
            </div>
          </form>
        </Modal>
      )}

      {confirmDelete && (
        <Modal
          open
          onClose={closeDelete}
          size="sm"
          title="Delete this scheduled job?"
          footer={
            <>
              <button type="button" onClick={closeDelete} className="btn-secondary text-sm min-h-[44px]" disabled={deleting}>Cancel</button>
              <button type="button" onClick={doDelete} className="btn-danger text-sm inline-flex items-center gap-1.5 min-h-[44px] disabled:opacity-60" disabled={deleting}>
                <Trash2 size={14} aria-hidden="true" /> {deleting ? 'Deleting...' : 'Delete'}
              </button>
            </>
          }
        >
          <div className="flex items-start gap-3">
            <Trash2 size={18} className="text-red-400 mt-0.5 shrink-0" aria-hidden="true" />
            <p className="text-sm text-[var(--text-muted)]">
              {confirmDelete.bay_name || 'Job'}, {confirmDelete.asset_no || fmtLabel(confirmDelete.job_type)}, {fmtDateTime(confirmDelete.scheduled_start)}. This cannot be undone.
            </p>
          </div>
          {deleteError && <p role="alert" className="mt-3 text-sm text-red-400">{deleteError}</p>}
        </Modal>
      )}
    </div>
  )
}
