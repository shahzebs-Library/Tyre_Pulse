/**
 * HoursOfService (route /hours-of-service) - Hours of Service (ELD) / Driver
 * Duty Status. Captures time-series driver duty-status segments (off duty,
 * sleeper berth, driving, on duty), whether entered manually, imported from an
 * ERP, or read off an Electronic Logging Device (ELD). Driver-hours history is
 * the backbone of fatigue-risk, safety, and HOS compliance reporting, so every
 * log is org-isolated and country-scoped.
 *
 * Runs on the `hos_logs` table (V172). The HOS limits and the per-driver-day
 * roll-up live in `src/lib/hosLogs.js`; everything the page derives on top
 * (window, filters, scorecard, duty mix, KPIs) lives in the pure, tested
 * `src/lib/hoursOfServiceAnalytics.js`. Every figure on the page covers the
 * logs matching the current filters, and the page says so.
 */
import { useState, useEffect, useMemo, useCallback } from 'react'
import {
  Clock, Users, Timer, ShieldAlert, ShieldCheck, AlertTriangle, Search, X,
  FileSpreadsheet, FileText, Plus, Pencil, Trash2, CalendarClock, Gauge, RefreshCw,
} from 'lucide-react'
import PageHeader from '../components/ui/PageHeader'
import StatTile from '../components/ui/StatTile'
import Modal from '../components/ui/Modal'
import EnterpriseTable from '../components/ui/EnterpriseTable'
import { useSettings } from '../contexts/SettingsContext'
import {
  listHosLogs, createHosLog, updateHosLog, deleteHosLog,
} from '../lib/api/hosLogs'
import {
  filterHosLogs, dutyMix, driverScorecard, complianceRows, hosKpis, fmtHoursMinutes,
  DUTY_LABELS, DUTY_STATUSES, WINDOW_OPTIONS, DAILY_DRIVE_LIMIT_MIN, DAILY_DUTY_LIMIT_MIN,
} from '../lib/hoursOfServiceAnalytics'
import { exportToExcel, exportToPdf, reportFileName, reportDateLabel } from '../lib/exportUtils'
import { colorAt } from '../lib/reportColors'
import { toUserMessage } from '../lib/safeError'
import { isMissingRelation } from '../lib/api/_client'

const EMPTY_FORM = {
  driver_name: '', asset_no: '', log_date: '', duty_status: 'driving',
  start_time: '', end_time: '', duration_min: '', distance_km: '',
  location: '', remarks: '', violation: false, violation_type: '', notes: '',
}

const DUTY_OPTIONS = DUTY_STATUSES.map((value) => ({ value, label: DUTY_LABELS[value] }))

// Semantic duty tints; the text label always carries the meaning.
const DUTY_BADGE = {
  off_duty: 'bg-[var(--input-bg)] text-[var(--text-secondary)] border-[var(--input-border)]',
  sleeper: 'bg-indigo-900/30 text-indigo-300 border-indigo-700/50',
  driving: 'bg-sky-900/30 text-sky-300 border-sky-700/50',
  on_duty: 'bg-amber-900/30 text-amber-300 border-amber-700/50',
}
const SHORT_DUTY = { off_duty: 'Off duty', sleeper: 'Sleeper', driving: 'Driving', on_duty: 'On duty' }

const fmtMin = (v) => (v == null || v === '' ? 'N/A' : `${Number(v).toLocaleString()} min`)
const fmtKm = (v) => (v == null || v === '' ? 'N/A' : `${Number(v).toLocaleString()} km`)
const fmtPct = (v) => (v == null ? 'N/A' : `${v}%`)

function fmtDate(v) {
  if (!v) return 'N/A'
  const d = new Date(v)
  return Number.isNaN(d.getTime()) ? 'N/A' : d.toLocaleDateString()
}

/** ISO string to a datetime-local input value (local time, no seconds). */
function toLocalInput(v) {
  if (!v) return ''
  const d = new Date(v)
  if (Number.isNaN(d.getTime())) return ''
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16)
}

function DutyBadge({ status }) {
  if (!DUTY_BADGE[status]) return <span className="text-[var(--text-muted)]">N/A</span>
  return (
    <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium ${DUTY_BADGE[status]}`}>
      {SHORT_DUTY[status]}
    </span>
  )
}

function BreachBadge({ over }) {
  return over ? (
    <span className="inline-flex items-center gap-1 rounded-full border border-red-700/50 bg-red-900/30 px-2 py-0.5 text-xs font-medium text-red-300">
      <ShieldAlert size={12} aria-hidden="true" /> Over hours
    </span>
  ) : (
    <span className="inline-flex items-center gap-1 rounded-full border border-green-700/40 bg-green-900/20 px-2 py-0.5 text-xs font-medium text-green-300">
      <ShieldCheck size={12} aria-hidden="true" /> Compliant
    </span>
  )
}

const ICON_BTN = 'inline-flex items-center justify-center min-w-[44px] min-h-[44px] rounded-lg text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--input-bg)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand)]'

export default function HoursOfService() {
  const { activeCountry } = useSettings()
  const [rows, setRows] = useState(null)
  const [error, setError] = useState('')
  const [actionError, setActionError] = useState('')
  const [notProvisioned, setNotProvisioned] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [updatedAt, setUpdatedAt] = useState(null)
  const [nowMs, setNowMs] = useState(() => Date.now())

  const [windowSel, setWindowSel] = useState('all')
  const [driverFilter, setDriverFilter] = useState('')
  const [dutyFilter, setDutyFilter] = useState('')
  const [violationsOnly, setViolationsOnly] = useState(false)
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
      setNowMs(Date.now())
    } catch (err) {
      if (isMissingRelation(err)) { setNotProvisioned(true); setRows([]) }
      else { setError(toUserMessage(err, 'Could not load hours-of-service logs.')); setRows(null) }
    } finally {
      setRefreshing(false)
    }
  }, [activeCountry])

  useEffect(() => { load() }, [load])

  const loading = rows === null && !error
  const all = useMemo(() => rows || [], [rows])

  const driverOptions = useMemo(
    () => [...new Set(all.map((r) => r.driver_name).filter(Boolean))].sort(),
    [all],
  )

  const filtered = useMemo(() => filterHosLogs(all, {
    window: windowSel, now: nowMs, driver: driverFilter, duty: dutyFilter, violationsOnly, search,
  }), [all, windowSel, nowMs, driverFilter, dutyFilter, violationsOnly, search])

  const kpis = useMemo(() => hosKpis(filtered), [filtered])
  const mix = useMemo(() => dutyMix(filtered), [filtered])
  const scorecard = useMemo(() => driverScorecard(filtered), [filtered])
  const compliance = useMemo(() => complianceRows(filtered), [filtered])

  const hasFilters = windowSel !== 'all' || driverFilter || dutyFilter || violationsOnly || search
  const clearFilters = () => {
    setWindowSel('all'); setDriverFilter(''); setDutyFilter(''); setViolationsOnly(false); setSearch('')
  }

  // ── Export ───────────────────────────────────────────────────────────────
  const EXPORT_COLS = ['driver_name', 'asset_no', 'log_date', 'duty_status', 'start_time', 'end_time', 'duration_min', 'distance_km', 'location', 'violation', 'violation_type', 'remarks']
  const EXPORT_HEADERS = ['Driver', 'Asset', 'Log date', 'Duty status', 'Start', 'End', 'Duration (min)', 'Distance (km)', 'Location', 'Violation', 'Violation type', 'Remarks']
  const exportRows = () => filtered.map((r) => ({
    driver_name: r.driver_name || '', asset_no: r.asset_no || '',
    log_date: r.log_date || '', duty_status: DUTY_LABELS[r.duty_status] || r.duty_status || '',
    start_time: r.start_time || '', end_time: r.end_time || '',
    duration_min: r.duration_min ?? '', distance_km: r.distance_km ?? '',
    location: r.location || '', violation: r.violation ? 'Yes' : 'No',
    violation_type: r.violation_type || '', remarks: r.remarks || '',
  }))
  const fileName = () => reportFileName('TyrePulse Hours of Service', activeCountry !== 'All' ? activeCountry : null, reportDateLabel())
  const doExcel = async () => {
    setActionError('')
    try { await exportToExcel(exportRows(), EXPORT_COLS, EXPORT_HEADERS, fileName()) }
    catch (e) { setActionError(toUserMessage(e, 'Could not export. Try again.')) }
  }
  const doPdf = async () => {
    setActionError('')
    try { await exportToPdf(exportRows(), EXPORT_COLS.map((k, i) => ({ key: k, header: EXPORT_HEADERS[i] })), 'Hours of Service', fileName(), 'landscape') }
    catch (e) { setActionError(toUserMessage(e, 'Could not export. Try again.')) }
  }

  // ── Modal ────────────────────────────────────────────────────────────────
  const openCreate = () => { setEditing(null); setForm(EMPTY_FORM); setFormError(''); setShowModal(true) }
  const openEdit = useCallback((r) => {
    setEditing(r)
    setForm({
      driver_name: r.driver_name || '', asset_no: r.asset_no || '',
      log_date: r.log_date || '', duty_status: r.duty_status || 'driving',
      start_time: toLocalInput(r.start_time), end_time: toLocalInput(r.end_time),
      duration_min: r.duration_min ?? '', distance_km: r.distance_km ?? '',
      location: r.location || '', remarks: r.remarks || '',
      violation: !!r.violation, violation_type: r.violation_type || '', notes: r.notes || '',
    })
    setFormError(''); setShowModal(true)
  }, [])
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
      setFormError(toUserMessage(err, 'Could not save the log.'))
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
      setActionError(toUserMessage(err, 'Could not delete the log.'))
      setConfirmDelete(null)
    } finally {
      setDeleting(false)
    }
  }, [confirmDelete, load])

  // ── Table columns ───────────────────────────────────────────────────────
  const logColumns = useMemo(() => [
    { id: 'driver', header: 'Driver', accessorFn: (r) => r.driver_name || '', cell: ({ row }) => <span className="font-medium text-[var(--text-primary)]">{row.original.driver_name || 'N/A'}</span> },
    { id: 'asset', header: 'Asset', accessorFn: (r) => r.asset_no || '', cell: ({ row }) => row.original.asset_no || 'N/A' },
    { id: 'date', header: 'Date', accessorFn: (r) => r.log_date || '', cell: ({ row }) => fmtDate(row.original.log_date), meta: { exportValue: (r) => r.log_date || '' } },
    { id: 'status', header: 'Status', accessorFn: (r) => DUTY_LABELS[r.duty_status] || '', cell: ({ row }) => <DutyBadge status={row.original.duty_status} /> },
    { id: 'duration', header: 'Duration', accessorFn: (r) => Number(r.duration_min) || null, cell: ({ row }) => fmtMin(row.original.duration_min), meta: { align: 'right' } },
    { id: 'distance', header: 'Distance', accessorFn: (r) => Number(r.distance_km) || null, cell: ({ row }) => fmtKm(row.original.distance_km), meta: { align: 'right' } },
    { id: 'location', header: 'Location', accessorFn: (r) => r.location || '', cell: ({ row }) => row.original.location || 'N/A' },
    {
      id: 'flag', header: 'Violation', accessorFn: (r) => (r.violation ? r.violation_type || 'Violation' : ''),
      cell: ({ row }) => (row.original.violation ? (
        <span className="inline-flex items-center gap-1 rounded-full border border-red-700/50 bg-red-900/30 px-2 py-0.5 text-xs font-medium text-red-300" title={row.original.violation_type || 'Violation'}>
          <ShieldAlert size={12} aria-hidden="true" /> {row.original.violation_type ? String(row.original.violation_type).slice(0, 24) : 'Violation'}
        </span>
      ) : <span className="text-[var(--text-muted)]">None</span>),
    },
    {
      id: 'actions', header: '', enableSorting: false, meta: { export: false },
      cell: ({ row }) => (
        <div className="flex items-center justify-end gap-1">
          <button type="button" onClick={() => openEdit(row.original)} className={ICON_BTN} aria-label={`Edit log for ${row.original.driver_name || 'driver'}`}><Pencil size={15} /></button>
          <button type="button" onClick={() => setConfirmDelete(row.original)} className={`${ICON_BTN} hover:!text-red-400`} aria-label={`Delete log for ${row.original.driver_name || 'driver'}`}><Trash2 size={15} /></button>
        </div>
      ),
    },
  ], [openEdit])

  const complianceColumns = useMemo(() => [
    { id: 'driver', header: 'Driver', accessorFn: (d) => d.driver_name, cell: ({ row }) => <span className="font-medium text-[var(--text-primary)]">{row.original.driver_name}</span> },
    { id: 'date', header: 'Date', accessorFn: (d) => d.log_date, cell: ({ row }) => fmtDate(row.original.log_date) },
    {
      id: 'driving', header: 'Driving', accessorFn: (d) => d.drivingMin, meta: { align: 'right', exportValue: (d) => d.drivingMin },
      cell: ({ row }) => <span className={`tabular-nums font-semibold ${row.original.drivingMin > DAILY_DRIVE_LIMIT_MIN ? 'text-red-400' : 'text-[var(--text-primary)]'}`}>{fmtHoursMinutes(row.original.drivingMin)}</span>,
    },
    {
      id: 'driveHeadroom', header: 'Drive headroom', accessorFn: (d) => d.driveHeadroomMin, meta: { align: 'right', exportValue: (d) => d.driveHeadroomMin },
      cell: ({ row }) => <span className="tabular-nums">{fmtHoursMinutes(row.original.driveHeadroomMin)}</span>,
    },
    {
      id: 'onDuty', header: 'On-duty window', accessorFn: (d) => d.onDutyMin, meta: { align: 'right', exportValue: (d) => d.onDutyMin },
      cell: ({ row }) => <span className={`tabular-nums font-semibold ${row.original.onDutyMin > DAILY_DUTY_LIMIT_MIN ? 'text-red-400' : 'text-[var(--text-primary)]'}`}>{fmtHoursMinutes(row.original.onDutyMin)}</span>,
    },
    { id: 'status', header: 'Status', accessorFn: (d) => (d.overHours ? 'Over hours' : 'Compliant'), cell: ({ row }) => <BreachBadge over={row.original.overHours} /> },
  ], [])

  const scorecardColumns = useMemo(() => [
    { id: 'driver', header: 'Driver', accessorFn: (d) => d.driver_name, cell: ({ row }) => <span className="font-medium text-[var(--text-primary)]">{row.original.driver_name}</span> },
    { id: 'days', header: 'Driver-days', accessorFn: (d) => d.days, meta: { align: 'right' } },
    { id: 'breach', header: 'Breach days', accessorFn: (d) => d.breachDays, meta: { align: 'right' }, cell: ({ row }) => <span className={row.original.breachDays > 0 ? 'text-red-400 font-semibold' : ''}>{row.original.breachDays}</span> },
    { id: 'rate', header: 'Compliance', accessorFn: (d) => d.complianceRate, meta: { align: 'right' }, cell: ({ row }) => fmtPct(row.original.complianceRate) },
    { id: 'hours', header: 'Driving hours', accessorFn: (d) => d.drivingHours, meta: { align: 'right' }, cell: ({ row }) => `${row.original.drivingHours.toLocaleString()} h` },
    { id: 'avg', header: 'Avg per day', accessorFn: (d) => d.avgDailyDrivingMin, meta: { align: 'right' }, cell: ({ row }) => fmtHoursMinutes(row.original.avgDailyDrivingMin) },
    { id: 'violations', header: 'Flagged violations', accessorFn: (d) => d.violations, meta: { align: 'right' } },
  ], [])

  const mixTotal = mix.reduce((a, m) => a + m.minutes, 0)

  return (
    <div className="space-y-6">
      <PageHeader
        title="Hours of Service"
        subtitle="Driver duty-status logs (ELD) per driver over time: the compliance basis for fatigue-risk, safety and HOS reporting."
        icon={Clock}
        onRefresh={load}
        refreshing={refreshing}
        updatedAt={updatedAt}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" onClick={doExcel} className="btn-secondary text-sm inline-flex items-center gap-1.5 min-h-[44px]" disabled={!filtered.length}>
              <FileSpreadsheet size={14} aria-hidden="true" /> Excel
            </button>
            <button type="button" onClick={doPdf} className="btn-secondary text-sm inline-flex items-center gap-1.5 min-h-[44px]" disabled={!filtered.length}>
              <FileText size={14} aria-hidden="true" /> PDF
            </button>
            <button type="button" onClick={openCreate} className="btn-primary text-sm inline-flex items-center gap-1.5 min-h-[44px]" disabled={notProvisioned || !!error}>
              <Plus size={14} aria-hidden="true" /> Log duty status
            </button>
          </div>
        }
      />

      {notProvisioned && (
        <div className="card border border-amber-800/50 flex items-start gap-3" role="status">
          <AlertTriangle size={18} className="text-amber-400 mt-0.5 shrink-0" aria-hidden="true" />
          <div>
            <p className="text-amber-300 font-medium">Hours-of-service logging is not enabled on this database yet.</p>
            <p className="text-[var(--text-muted)] text-sm mt-1">
              Apply <span className="font-mono text-[var(--text-primary)]">MIGRATIONS_V172_HOS_LOGS.sql</span>, then reload.
            </p>
          </div>
        </div>
      )}

      {error && (
        <div className="card border border-red-800/50 flex flex-wrap items-start gap-3" role="alert">
          <AlertTriangle size={18} className="text-red-400 mt-0.5 shrink-0" aria-hidden="true" />
          <div className="flex-1 min-w-[200px]">
            <p className="text-red-300 font-medium">Could not load hours-of-service logs.</p>
            <p className="text-[var(--text-muted)] text-sm mt-1">{error} Nothing below is a reading of your data until this loads.</p>
          </div>
          <button type="button" onClick={load} className="btn-secondary text-sm inline-flex items-center gap-1.5 min-h-[44px]">
            <RefreshCw size={14} aria-hidden="true" /> Retry
          </button>
        </div>
      )}

      {actionError && (
        <div className="card border border-red-800/50 flex items-start gap-3" role="alert">
          <AlertTriangle size={18} className="text-red-400 mt-0.5 shrink-0" aria-hidden="true" />
          <p className="flex-1 text-sm text-red-300">{actionError}</p>
          <button type="button" onClick={() => setActionError('')} className={ICON_BTN} aria-label="Dismiss message"><X size={15} /></button>
        </div>
      )}

      {/* Filters */}
      <section className="card space-y-3" aria-label="Filters">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
          <div className="sm:col-span-2 lg:col-span-2">
            <label htmlFor="hos-search" className="label">Search</label>
            <div className="relative">
              <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" aria-hidden="true" />
              <input id="hos-search" className="input pl-9 w-full min-h-[44px]" placeholder="Driver, asset, location, remarks" value={search} onChange={(e) => setSearch(e.target.value)} />
            </div>
          </div>
          <div>
            <label htmlFor="hos-window" className="label">Period</label>
            <select id="hos-window" className="input w-full min-h-[44px]" value={windowSel} onChange={(e) => setWindowSel(e.target.value)}>
              {WINDOW_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </div>
          <div>
            <label htmlFor="hos-driver" className="label">Driver</label>
            <select id="hos-driver" className="input w-full min-h-[44px]" value={driverFilter} onChange={(e) => setDriverFilter(e.target.value)}>
              <option value="">All drivers</option>
              {driverOptions.map((d) => <option key={d} value={d}>{d}</option>)}
            </select>
          </div>
          <div>
            <label htmlFor="hos-duty" className="label">Duty status</label>
            <select id="hos-duty" className="input w-full min-h-[44px]" value={dutyFilter} onChange={(e) => setDutyFilter(e.target.value)}>
              <option value="">All statuses</option>
              {DUTY_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <label className="inline-flex items-center gap-2 min-h-[44px] cursor-pointer text-sm text-[var(--text-secondary)]">
            <input type="checkbox" className="h-4 w-4 accent-red-500" checked={violationsOnly} onChange={(e) => setViolationsOnly(e.target.checked)} />
            Flagged violations only
          </label>
          {hasFilters && (
            <button type="button" onClick={clearFilters} className="btn-secondary text-sm inline-flex items-center gap-1.5 min-h-[44px]">
              <X size={14} aria-hidden="true" /> Clear filters
            </button>
          )}
          <span className="text-xs text-[var(--text-muted)] ml-auto" aria-live="polite">
            {rows === null ? 'Not loaded' : `Figures below cover ${filtered.length.toLocaleString()} of ${all.length.toLocaleString()} logs`}
          </span>
        </div>
      </section>

      {/* KPI strip */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        <StatTile label="Logs" value={rows === null ? 'N/A' : kpis.totalLogs.toLocaleString()} icon={Clock} sub={`${kpis.driverDays} driver-days`} index={0} />
        <StatTile label="Drivers" value={rows === null ? 'N/A' : kpis.distinctDrivers} icon={Users} tone="info" index={1} />
        <StatTile label="Driving hours" value={rows === null ? 'N/A' : kpis.drivingHours.toLocaleString()} unit="h" icon={Timer} index={2} />
        <StatTile label="Compliance" value={rows === null ? 'N/A' : fmtPct(kpis.complianceRate)} icon={ShieldCheck} tone={kpis.complianceRate != null && kpis.complianceRate < 90 ? 'warn' : 'accent'} sub="driver-days within limits" index={3} />
        <StatTile label="Breach days" value={rows === null ? 'N/A' : kpis.breachDays} icon={ShieldAlert} tone={kpis.breachDays > 0 ? 'crit' : 'neutral'} sub={`${kpis.violationsCount} flagged violations`} index={4} />
        <StatTile label="Duration recorded" value={rows === null ? 'N/A' : fmtPct(kpis.durationCoverage)} icon={Gauge} sub="logs with a usable duration" index={5} />
      </div>

      {/* Duty mix */}
      <section className="card space-y-3" aria-labelledby="hos-mix-title">
        <h3 id="hos-mix-title" className="text-sm font-semibold text-[var(--text-primary)] flex items-center gap-2">
          <Timer size={15} aria-hidden="true" /> Duty-status mix
        </h3>
        {loading ? (
          <div className="h-6 bg-[var(--input-bg)] rounded animate-pulse" />
        ) : mixTotal === 0 ? (
          <p className="text-sm text-[var(--text-muted)]">No logged duration in this selection, so the mix cannot be measured.</p>
        ) : (
          <>
            <div className="flex h-4 w-full overflow-hidden rounded-full bg-[var(--input-bg)]" role="img"
              aria-label={mix.map((m) => `${m.label} ${Math.round((m.share || 0) * 100)}%`).join(', ')}>
              {mix.map((m, i) => (m.minutes > 0 ? (
                <div key={m.status} style={{ width: `${(m.share || 0) * 100}%`, background: colorAt(i) }} />
              ) : null))}
            </div>
            <ul className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
              {mix.map((m, i) => (
                <li key={m.status} className="flex items-center gap-2 text-[var(--text-secondary)]">
                  <span className="inline-block h-2.5 w-2.5 rounded-sm shrink-0" style={{ background: colorAt(i) }} aria-hidden="true" />
                  <span className="truncate">{m.label}</span>
                  <span className="ml-auto tabular-nums text-[var(--text-primary)]">{fmtHoursMinutes(m.minutes)}</span>
                </li>
              ))}
            </ul>
          </>
        )}
      </section>

      {/* Driver scorecard */}
      <section className="space-y-2" aria-labelledby="hos-scorecard-title">
        <h3 id="hos-scorecard-title" className="text-sm font-semibold text-[var(--text-primary)] flex items-center gap-2">
          <Users size={15} aria-hidden="true" /> Driver scorecard
          <span className="text-xs font-normal text-[var(--text-muted)]">worst first</span>
        </h3>
        <EnterpriseTable
          columns={scorecardColumns}
          data={scorecard}
          getRowId={(d) => d.driver_name}
          loading={loading}
          error={error || null}
          onRetry={load}
          enableGlobalFilter={false}
          enableColumnFilters={false}
          exportFileName={reportFileName('TyrePulse HOS Driver Scorecard', reportDateLabel())}
          initialPageSize={10}
          pageSizeOptions={[10, 25, 50]}
          emptyMessage={all.length === 0 ? 'No duty-status logs yet.' : 'No dated driver-days match these filters.'}
        />
      </section>

      {/* Driver-day compliance */}
      <section className="space-y-2" aria-labelledby="hos-compliance-title">
        <h3 id="hos-compliance-title" className="text-sm font-semibold text-[var(--text-primary)] flex flex-wrap items-center gap-2">
          <CalendarClock size={15} aria-hidden="true" /> Driver-day compliance
          <span className="text-xs font-normal text-[var(--text-muted)]">
            limits: {DAILY_DRIVE_LIMIT_MIN / 60}h driving, {DAILY_DUTY_LIMIT_MIN / 60}h on-duty window
          </span>
        </h3>
        <EnterpriseTable
          columns={complianceColumns}
          data={compliance}
          getRowId={(d) => `${d.driver_name}-${d.log_date}`}
          loading={loading}
          error={error || null}
          onRetry={load}
          enableGlobalFilter={false}
          enableColumnFilters={false}
          exportFileName={reportFileName('TyrePulse HOS Driver Day Compliance', reportDateLabel())}
          emptyMessage={all.length === 0 ? 'No duty-status logs yet.' : 'No dated driver-days match these filters.'}
        />
      </section>

      {/* Log register */}
      <section className="space-y-2" aria-labelledby="hos-log-title">
        <h3 id="hos-log-title" className="text-sm font-semibold text-[var(--text-primary)] flex items-center gap-2">
          <Clock size={15} aria-hidden="true" /> Duty-status log
        </h3>
        <EnterpriseTable
          columns={logColumns}
          data={filtered}
          getRowId={(r) => String(r.id)}
          loading={loading}
          error={error || null}
          onRetry={load}
          enableGlobalFilter={false}
          enableColumnFilters={false}
          enableExport={false}
          viewKey="hours-of-service"
          emptyMessage={all.length === 0 && !notProvisioned ? 'No duty-status logs yet. Log the first entry.' : 'No logs match these filters.'}
        />
      </section>

      {/* Create / Edit */}
      <Modal
        open={showModal}
        onClose={closeModal}
        title={editing ? 'Edit duty-status log' : 'Log duty status'}
        size="lg"
        footer={(
          <div className="flex items-center justify-end gap-2">
            <button type="button" onClick={closeModal} className="btn-secondary text-sm min-h-[44px]" disabled={saving}>Cancel</button>
            <button type="submit" form="hos-form" className="btn-primary text-sm min-h-[44px] disabled:opacity-60" disabled={saving}>
              {saving ? 'Saving...' : editing ? 'Save changes' : 'Log duty status'}
            </button>
          </div>
        )}
      >
        <form id="hos-form" onSubmit={submit} className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label htmlFor="hos-f-driver" className="label">Driver name *</label>
              <input id="hos-f-driver" className="input w-full" required placeholder="e.g. J. Rivera" value={form.driver_name} maxLength={200} onChange={(e) => set('driver_name', e.target.value)} />
            </div>
            <div>
              <label htmlFor="hos-f-asset" className="label">Asset number (optional)</label>
              <input id="hos-f-asset" className="input w-full" placeholder="e.g. TRK-1042" value={form.asset_no} maxLength={120} onChange={(e) => set('asset_no', e.target.value)} />
            </div>
            <div>
              <label htmlFor="hos-f-date" className="label">Log date</label>
              <input id="hos-f-date" className="input w-full" type="date" value={form.log_date} onChange={(e) => set('log_date', e.target.value)} />
              <p className="text-[11px] text-[var(--text-muted)] mt-1">Leave blank to use today.</p>
            </div>
            <div>
              <label htmlFor="hos-f-duty" className="label">Duty status</label>
              <select id="hos-f-duty" className="input w-full" value={form.duty_status} onChange={(e) => set('duty_status', e.target.value)}>
                {DUTY_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </div>
            <div>
              <label htmlFor="hos-f-start" className="label">Start time (optional)</label>
              <input id="hos-f-start" className="input w-full" type="datetime-local" value={form.start_time} onChange={(e) => set('start_time', e.target.value)} />
            </div>
            <div>
              <label htmlFor="hos-f-end" className="label">End time (optional)</label>
              <input id="hos-f-end" className="input w-full" type="datetime-local" value={form.end_time} onChange={(e) => set('end_time', e.target.value)} />
            </div>
            <div>
              <label htmlFor="hos-f-dur" className="label">Duration (min)</label>
              <input id="hos-f-dur" className="input w-full" type="number" step="1" min="0" inputMode="numeric" placeholder="480" value={form.duration_min} onChange={(e) => set('duration_min', e.target.value)} />
            </div>
            <div>
              <label htmlFor="hos-f-km" className="label">Distance (km, optional)</label>
              <input id="hos-f-km" className="input w-full" type="number" step="1" min="0" inputMode="numeric" placeholder="620" value={form.distance_km} onChange={(e) => set('distance_km', e.target.value)} />
            </div>
          </div>
          <div>
            <label htmlFor="hos-f-loc" className="label">Location (optional)</label>
            <input id="hos-f-loc" className="input w-full" placeholder="e.g. Riyadh to Dammam corridor" value={form.location} maxLength={200} onChange={(e) => set('location', e.target.value)} />
          </div>
          <div>
            <label htmlFor="hos-f-remarks" className="label">Remarks (optional)</label>
            <textarea id="hos-f-remarks" className="input w-full min-h-[70px] resize-y" placeholder="e.g. pre-trip inspection, rest break at 14:00" value={form.remarks} maxLength={8000} onChange={(e) => set('remarks', e.target.value)} />
          </div>
          <fieldset className="rounded-lg border border-[var(--input-border)] bg-[var(--input-bg)]/40 p-3 space-y-3">
            <legend className="sr-only">Violation</legend>
            <label className="flex items-center gap-2 cursor-pointer select-none min-h-[44px]">
              <input type="checkbox" className="h-4 w-4 accent-red-500" checked={form.violation} onChange={(e) => set('violation', e.target.checked)} />
              <span className="text-sm font-medium text-[var(--text-primary)] inline-flex items-center gap-1.5">
                <ShieldAlert size={14} className="text-red-400" aria-hidden="true" /> Flag as HOS violation
              </span>
            </label>
            {form.violation && (
              <div>
                <label htmlFor="hos-f-vtype" className="label">Violation type</label>
                <input id="hos-f-vtype" className="input w-full" placeholder="e.g. 11-hour driving, 14-hour window" value={form.violation_type} maxLength={200} onChange={(e) => set('violation_type', e.target.value)} />
              </div>
            )}
          </fieldset>
          <div>
            <label htmlFor="hos-f-notes" className="label">Notes (optional)</label>
            <textarea id="hos-f-notes" className="input w-full min-h-[60px] resize-y" placeholder="Internal notes" value={form.notes} maxLength={8000} onChange={(e) => set('notes', e.target.value)} />
          </div>
          {formError && (
            <div className="flex items-start gap-2 text-sm text-red-300 bg-red-900/20 border border-red-800/50 rounded-lg px-3 py-2" role="alert">
              <AlertTriangle size={15} className="mt-0.5 shrink-0" aria-hidden="true" /> {formError}
            </div>
          )}
        </form>
      </Modal>

      {/* Delete confirm */}
      <Modal
        open={!!confirmDelete}
        onClose={() => !deleting && setConfirmDelete(null)}
        title="Delete this log?"
        size="sm"
        footer={(
          <div className="flex items-center justify-end gap-2">
            <button type="button" onClick={() => setConfirmDelete(null)} className="btn-secondary text-sm min-h-[44px]" disabled={deleting}>Cancel</button>
            <button type="button" onClick={doDelete} className="btn-danger text-sm inline-flex items-center gap-1.5 min-h-[44px] disabled:opacity-60" disabled={deleting}>
              <Trash2 size={14} aria-hidden="true" /> {deleting ? 'Deleting...' : 'Delete'}
            </button>
          </div>
        )}
      >
        {confirmDelete && (
          <p className="text-sm text-[var(--text-muted)]">
            {confirmDelete.driver_name || 'Log'}, {DUTY_LABELS[confirmDelete.duty_status] || 'N/A'}, {fmtDate(confirmDelete.log_date)}. This cannot be undone.
          </p>
        )}
      </Modal>
    </div>
  )
}
