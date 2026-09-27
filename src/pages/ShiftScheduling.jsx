/**
 * ShiftScheduling (route /shifts) - rosters driver / technician shifts: who
 * works, in what role, on which date, from when to when, at which site, with a
 * status lifecycle (scheduled, completed, absent, cancelled).
 *
 * Runs on the `shifts` table (V149); degrades to a migration hint when it is
 * not present. KPI strip (today, upcoming, attendance, rostered hours, past
 * shifts never closed out), a 14-day coverage chart, hours by role, filters +
 * search + date range, a sortable EnterpriseTable roster, create/edit, delete,
 * and Excel/PDF export. Derived figures live in the pure
 * `src/lib/shiftSchedulingAnalytics.js`.
 */
import { useState, useEffect, useMemo, useCallback } from 'react'
import { Chart as ChartJS, CategoryScale, LinearScale, BarElement, Tooltip, Legend } from 'chart.js'
import { Bar } from 'react-chartjs-2'
import {
  CalendarClock, Calendar, Clock, User, Users, Plus, Pencil, Trash2, Search,
  X, Save, Loader2, AlertTriangle, FileSpreadsheet, FileText, MapPin,
  CheckCircle2, History, CalendarDays, Hourglass,
} from 'lucide-react'
import PageHeader from '../components/ui/PageHeader'
import EnterpriseTable from '../components/ui/EnterpriseTable'
import Modal from '../components/ui/Modal'
import { useSettings } from '../contexts/SettingsContext'
import { listShifts, createShift, updateShift, deleteShift, SHIFT_STATUS_VALUES } from '../lib/api/shifts'
import {
  EMPTY_SHIFT_FILTERS, TIMING_KEYS, TIMING_LABEL, enrichShifts, filterShifts, shiftKpis,
  coverageNextDays, hoursByRole, roleOptions, siteOptions, activeShiftFilterCount,
  shiftExportRows, SHIFT_EXPORT_COLUMNS, statusLabel,
} from '../lib/shiftSchedulingAnalytics'
import { colorAt } from '../lib/reportColors'
import { exportToExcel, exportToPdf, reportFileName } from '../lib/exportUtils'
import { toUserMessage } from '../lib/safeError'
import { isMissingRelation } from '../lib/api/_client'

ChartJS.register(CategoryScale, LinearScale, BarElement, Tooltip, Legend)

// Semantic status tints with an icon, so colour is never the only signal.
const STATUS_META = {
  scheduled: { cls: 'bg-sky-500/15 text-sky-300 border border-sky-500/40', icon: Calendar },
  completed: { cls: 'bg-green-500/15 text-green-300 border border-green-500/40', icon: CheckCircle2 },
  absent: { cls: 'bg-amber-500/15 text-amber-300 border border-amber-500/40', icon: AlertTriangle },
  cancelled: { cls: 'bg-[var(--input-bg)] text-[var(--text-dim)] border border-[var(--input-border)]', icon: X },
}
const ROLE_SUGGESTIONS = ['Driver', 'Technician', 'Supervisor', 'Foreman', 'Inspector', 'Fitter', 'Helper']
const EMPTY_FORM = {
  person_name: '', role: '', shift_date: '', start_time: '', end_time: '', site: '', status: 'scheduled', notes: '',
}
const ICON_BTN = 'inline-flex items-center justify-center w-11 h-11 rounded-lg text-[var(--text-muted)] hover:bg-[var(--input-bg)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--accent)]'

function fmtDate(v) {
  if (!v) return 'N/A'
  const d = new Date(v)
  return Number.isNaN(d.getTime()) ? String(v) : d.toLocaleDateString()
}
function fmtTimeRange(a, b) {
  if (!a && !b) return 'N/A'
  return `${a || 'N/A'} to ${b || 'N/A'}`
}

function Kpi({ label, value, icon: Icon, tone, sub, loading }) {
  return (
    <div className="card">
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs text-[var(--text-muted)]">{label}</p>
        <Icon size={16} className={tone} aria-hidden="true" />
      </div>
      <p className={`text-3xl font-bold mt-1 tabular-nums ${tone}`}>
        {loading ? <span className="inline-block h-8 w-16 rounded bg-[var(--input-bg)] animate-pulse" aria-label="Loading" /> : (value ?? 'N/A')}
      </p>
      {sub && !loading && <p className="text-[11px] text-[var(--text-dim)] mt-0.5">{sub}</p>}
    </div>
  )
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
  const close = () => { if (!busy) onClose?.() }

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

  return (
    <Modal
      open={open}
      onClose={close}
      title={editing ? 'Edit shift' : 'Schedule shift'}
      size="lg"
      footer={(
        <>
          <button type="button" onClick={close} className="btn-secondary text-sm min-h-[44px]" disabled={busy}>Cancel</button>
          <button type="submit" form="shift-form" disabled={busy} className="btn-primary text-sm inline-flex items-center gap-2 min-h-[44px] disabled:opacity-60">
            {busy ? <Loader2 size={15} className="animate-spin" aria-hidden="true" /> : <Save size={15} aria-hidden="true" />}
            {editing ? 'Save changes' : 'Schedule shift'}
          </button>
        </>
      )}
    >
      <form id="shift-form" onSubmit={submit} className="space-y-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <label className="block"><span className="label">Person <span className="text-red-400" aria-hidden="true">*</span></span>
            <input className="input w-full min-h-[44px]" placeholder="e.g. Ahmed Khan" value={form.person_name} maxLength={160} required onChange={(e) => set('person_name', e.target.value)} />
          </label>
          <label className="block"><span className="label">Role</span>
            <input className="input w-full min-h-[44px]" placeholder="Driver, Technician" list="shift-role-list" value={form.role} maxLength={120} onChange={(e) => set('role', e.target.value)} />
            <datalist id="shift-role-list">
              {ROLE_SUGGESTIONS.map((r) => <option key={r} value={r} />)}
            </datalist>
          </label>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <label className="block"><span className="label">Shift date</span>
            <input type="date" className="input w-full min-h-[44px]" value={form.shift_date} onChange={(e) => set('shift_date', e.target.value)} />
          </label>
          <label className="block"><span className="label">Start time</span>
            <input type="time" className="input w-full min-h-[44px]" value={form.start_time} onChange={(e) => set('start_time', e.target.value)} />
          </label>
          <label className="block"><span className="label">End time</span>
            <input type="time" className="input w-full min-h-[44px]" value={form.end_time} onChange={(e) => set('end_time', e.target.value)} />
            <span className="block text-[11px] text-[var(--text-muted)] mt-1">An end before the start runs past midnight.</span>
          </label>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <label className="block"><span className="label">Site</span>
            <input className="input w-full min-h-[44px]" placeholder="Depot or branch" value={form.site} maxLength={120} onChange={(e) => set('site', e.target.value)} />
          </label>
          <label className="block"><span className="label">Status</span>
            <select className="input w-full min-h-[44px]" value={form.status} onChange={(e) => set('status', e.target.value)}>
              {SHIFT_STATUS_VALUES.map((s) => <option key={s} value={s}>{statusLabel(s)}</option>)}
            </select>
          </label>
        </div>

        <label className="block"><span className="label">Notes</span>
          <textarea className="input w-full min-h-[90px] resize-y" placeholder="Optional: coverage, handover, or special instructions." value={form.notes} maxLength={4000} onChange={(e) => set('notes', e.target.value)} />
        </label>

        {error && (
          <div className="flex items-start gap-2 text-sm text-red-300 bg-red-500/10 border border-red-500/40 rounded-lg px-3 py-2" role="alert">
            <AlertTriangle size={15} className="mt-0.5 shrink-0" aria-hidden="true" /> {error}
          </div>
        )}
      </form>
    </Modal>
  )
}

// ─── Page ─────────────────────────────────────────────────────────────────────
export default function ShiftScheduling() {
  const { activeCountry } = useSettings()
  const [rows, setRows] = useState(null)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [missing, setMissing] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [updatedAt, setUpdatedAt] = useState(null)
  const [nowMs, setNowMs] = useState(() => Date.now())

  const [filters, setFilters] = useState(EMPTY_SHIFT_FILTERS)
  const setFilter = (k, v) => setFilters((f) => ({ ...f, [k]: v }))

  const [modal, setModal] = useState({ open: false, initial: null })
  const [toDelete, setToDelete] = useState(null)
  const [deleting, setDeleting] = useState(false)

  const load = useCallback(async () => {
    setRefreshing(true); setError(''); setMissing(false)
    try {
      const data = await listShifts({ country: activeCountry })
      setRows(Array.isArray(data) ? data : [])
      setUpdatedAt(new Date())
      setNowMs(Date.now())
    } catch (err) {
      if (isMissingRelation(err)) { setMissing(true); setRows([]) }
      else { setError(toUserMessage(err, 'Could not load shifts.')); setRows([]) }
    } finally {
      setRefreshing(false)
    }
  }, [activeCountry])

  useEffect(() => { load() }, [load])

  const loading = rows === null
  const failed = Boolean(error) || missing
  const now = useMemo(() => new Date(nowMs), [nowMs])
  const enriched = useMemo(() => enrichShifts(rows || [], now), [rows, now])
  const kpi = useMemo(() => shiftKpis(enriched), [enriched])
  const roles = useMemo(() => roleOptions(rows || []), [rows])
  const sites = useMemo(() => siteOptions(rows || []), [rows])
  const filtered = useMemo(() => filterShifts(enriched, filters), [enriched, filters])
  const coverage = useMemo(() => coverageNextDays(filtered, now, 14), [filtered, now])
  const roleHours = useMemo(() => hoursByRole(filtered), [filtered])
  const filterCount = activeShiftFilterCount(filters)

  const kv = (v) => (failed ? null : v)
  const kpis = [
    { label: 'Total shifts', value: kv(kpi.total), icon: CalendarClock, tone: 'text-[var(--text-primary)]', sub: failed ? null : `${kpi.people} people rostered` },
    { label: 'On shift today', value: kv(kpi.today), icon: Clock, tone: 'text-sky-400' },
    { label: 'Upcoming', value: kv(kpi.upcoming), icon: CalendarDays, tone: 'text-[var(--brand-bright)]', sub: 'Scheduled after today' },
    { label: 'Attendance', value: failed || kpi.attendanceRate == null ? null : `${kpi.attendanceRate}%`, icon: CheckCircle2, tone: 'text-green-400', sub: failed || kpi.absenceRate == null ? 'No shifts closed out yet' : `${kpi.byStatus.absent} absent, ${kpi.absenceRate}%` },
    { label: 'Rostered hours', value: failed || kpi.rosteredHours == null ? null : kpi.rosteredHours.toLocaleString(), icon: Hourglass, tone: 'text-violet-400', sub: failed ? null : `${kpi.timedShifts} shifts with start and end` },
    { label: 'Past, not closed out', value: kv(kpi.openPast), icon: History, tone: kpi.openPast ? 'text-amber-400' : 'text-green-400', sub: 'Past date, still marked scheduled' },
  ]

  const doExport = async (kind) => {
    const out = shiftExportRows(filtered)
    const keys = SHIFT_EXPORT_COLUMNS.map(([k]) => k)
    const headers = SHIFT_EXPORT_COLUMNS.map(([, h]) => h)
    const name = reportFileName('TyrePulse Shift Schedule')
    try {
      if (kind === 'excel') await exportToExcel(out, keys, headers, name)
      else await exportToPdf(out, keys.map((k, i) => ({ key: k, header: headers[i] })), 'Shift Schedule', name, 'landscape')
    } catch (e) { setNotice(toUserMessage(e, 'Could not export. Try again.')) }
  }

  const confirmDelete = useCallback(async () => {
    if (!toDelete) return
    setDeleting(true)
    try {
      await deleteShift(toDelete.id)
      setToDelete(null)
      await load()
    } catch (err) {
      setNotice(toUserMessage(err, 'Could not delete the shift.'))
      setToDelete(null)
    } finally {
      setDeleting(false)
    }
  }, [toDelete, load])

  const openEdit = useCallback((r) => setModal({ open: true, initial: r }), [])

  const columns = useMemo(() => [
    {
      id: 'person', header: 'Person', accessorFn: (r) => r.person_name || '', size: 180,
      cell: ({ getValue }) => (
        <span className="flex items-center gap-2">
          <span className="w-7 h-7 rounded-full bg-[var(--input-bg)] border border-[var(--input-border)] flex items-center justify-center shrink-0" aria-hidden="true">
            <User size={13} className="text-[var(--brand-bright)]" />
          </span>
          <span className="font-medium text-[var(--text-primary)]">{getValue() || 'N/A'}</span>
        </span>
      ),
    },
    { id: 'role', header: 'Role', accessorFn: (r) => r.role || '', size: 120, cell: ({ getValue }) => getValue() || 'N/A' },
    {
      id: 'date', header: 'Date', accessorFn: (r) => r._day || '', size: 130,
      cell: ({ row }) => (
        <span className="whitespace-nowrap">
          {fmtDate(row.original.shift_date)}
          <span className="block text-[11px] text-[var(--text-muted)]">{TIMING_LABEL[row.original._timing]}</span>
        </span>
      ),
    },
    { id: 'hours', header: 'Hours', accessorFn: (r) => r._hours, size: 150, sortUndefined: 'last', cell: ({ row }) => (
      <span className="whitespace-nowrap">
        {fmtTimeRange(row.original.start_time, row.original.end_time)}
        {row.original._hours != null && <span className="block text-[11px] text-[var(--text-muted)]">{row.original._hours} h</span>}
      </span>
    ) },
    {
      id: 'site', header: 'Site', accessorFn: (r) => r.site || '', size: 130,
      cell: ({ getValue }) => (getValue() ? <span className="inline-flex items-center gap-1"><MapPin size={12} className="text-[var(--text-muted)]" aria-hidden="true" />{getValue()}</span> : 'N/A'),
    },
    {
      id: 'status', header: 'Status', accessorFn: (r) => r._statusLabel, size: 150,
      cell: ({ row }) => {
        const r = row.original
        const st = STATUS_META[r.status] || STATUS_META.scheduled
        const StatusIcon = st.icon
        return (
          <span className="inline-flex flex-col items-start gap-1">
            <span className={`text-[11px] px-2 py-0.5 rounded inline-flex items-center gap-1 ${st.cls}`}>
              <StatusIcon size={11} aria-hidden="true" /> {r._statusLabel}
            </span>
            {r._openPast && <span className="text-[11px] text-amber-400">Not closed out</span>}
          </span>
        )
      },
    },
    {
      id: 'actions', header: '', enableSorting: false, size: 110, meta: { export: false },
      cell: ({ row }) => (
        <div className="flex items-center justify-end gap-1">
          <button type="button" onClick={(e) => { e.stopPropagation(); openEdit(row.original) }} className={`${ICON_BTN} hover:text-[var(--text-primary)]`} aria-label={`Edit shift for ${row.original.person_name || 'person'}`}><Pencil size={15} /></button>
          <button type="button" onClick={(e) => { e.stopPropagation(); setToDelete(row.original) }} className={`${ICON_BTN} hover:text-red-400`} aria-label={`Delete shift for ${row.original.person_name || 'person'}`}><Trash2 size={15} /></button>
        </div>
      ),
    },
  ], [openEdit])

  const coverageChart = {
    labels: coverage.map((c) => c.day.slice(5)),
    datasets: [{ label: 'Shifts', data: coverage.map((c) => c.shifts), backgroundColor: coverage.map((c) => (c.shifts ? colorAt(0) : colorAt(3))), borderRadius: 4, maxBarThickness: 26 }],
  }
  const coverageOpts = {
    responsive: true, maintainAspectRatio: false,
    plugins: { legend: { display: false } },
    scales: {
      x: { ticks: { color: 'var(--text-muted)' }, grid: { display: false } },
      y: { beginAtZero: true, ticks: { color: 'var(--text-muted)', precision: 0 }, grid: { color: 'var(--panel-2)' } },
    },
  }
  const roleChart = {
    labels: roleHours.map((r) => r.role),
    datasets: [{ label: 'Hours', data: roleHours.map((r) => r.hours), backgroundColor: roleHours.map((_, i) => colorAt(i)), borderRadius: 4, maxBarThickness: 26 }],
  }
  const roleOpts = {
    responsive: true, maintainAspectRatio: false, indexAxis: 'y',
    plugins: { legend: { display: false } },
    scales: {
      x: { beginAtZero: true, ticks: { color: 'var(--text-muted)' }, grid: { color: 'var(--panel-2)' }, title: { display: true, text: 'hours', color: 'var(--text-muted)' } },
      y: { ticks: { color: 'var(--text-secondary)' }, grid: { display: false } },
    },
  }
  const gapDays = coverage.filter((c) => c.shifts === 0).length
  const unavailable = <div className="h-full flex items-center justify-center text-sm text-[var(--text-muted)]">Unavailable: the roster could not be loaded.</div>

  return (
    <div className="space-y-6">
      <PageHeader
        title="Shift Scheduling"
        subtitle="Roster driver and technician shifts: person, role, date, hours, site and status across the fleet."
        icon={CalendarClock}
        onRefresh={load}
        refreshing={refreshing}
        updatedAt={updatedAt}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" onClick={() => doExport('excel')} className="btn-secondary text-sm inline-flex items-center gap-1.5 min-h-[44px]" disabled={!filtered.length}>
              <FileSpreadsheet size={14} aria-hidden="true" /> Excel
            </button>
            <button type="button" onClick={() => doExport('pdf')} className="btn-secondary text-sm inline-flex items-center gap-1.5 min-h-[44px]" disabled={!filtered.length}>
              <FileText size={14} aria-hidden="true" /> PDF
            </button>
            <button type="button" onClick={() => setModal({ open: true, initial: null })} className="btn-primary text-sm inline-flex items-center gap-1.5 min-h-[44px]" disabled={missing}>
              <Plus size={14} aria-hidden="true" /> Schedule shift
            </button>
          </div>
        }
      />

      {missing && (
        <div className="card border border-amber-500/40 flex items-start gap-3" role="status">
          <AlertTriangle size={18} className="text-amber-400 mt-0.5 shrink-0" aria-hidden="true" />
          <div>
            <p className="text-amber-300 font-medium">Shift scheduling is not enabled on this database yet.</p>
            <p className="text-[var(--text-muted)] text-sm mt-1">
              Apply <span className="font-mono text-[var(--text-primary)]">MIGRATIONS_V149_SHIFTS.sql</span>, then reload.
            </p>
          </div>
        </div>
      )}

      {error && (
        <div className="card border border-red-500/40 flex flex-wrap items-start justify-between gap-3" role="alert">
          <div className="flex items-start gap-3">
            <AlertTriangle size={18} className="text-red-400 mt-0.5 shrink-0" aria-hidden="true" />
            <div>
              <p className="text-red-300 font-medium">Could not load shifts.</p>
              <p className="text-[var(--text-muted)] text-sm mt-1">{error} The figures below are unavailable until the roster loads.</p>
            </div>
          </div>
          <button type="button" onClick={load} className="btn-secondary text-sm min-h-[44px]" disabled={refreshing}>Retry</button>
        </div>
      )}

      {notice && (
        <div className="card border border-amber-500/40 flex items-start justify-between gap-3" role="status">
          <p className="text-sm text-amber-300">{notice}</p>
          <button type="button" onClick={() => setNotice('')} className={ICON_BTN} aria-label="Dismiss message"><X size={15} /></button>
        </div>
      )}

      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
        {kpis.map((k) => <Kpi key={k.label} {...k} loading={loading} />)}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="card lg:col-span-2">
          <h2 className="text-sm font-semibold text-[var(--text-primary)] mb-1 flex items-center gap-1.5"><CalendarDays size={15} aria-hidden="true" /> Coverage, next 14 days</h2>
          <p className="text-xs text-[var(--text-muted)] mb-3">
            Scheduled, completed and absent shifts per day in this view.{!failed && !loading && gapDays > 0 ? ` ${gapDays} of 14 days have no shift rostered.` : ''}
          </p>
          <div className="h-64">
            {loading ? <div className="w-full h-full bg-[var(--input-bg)] rounded animate-pulse" />
              : failed ? unavailable
                : (
                  <div className="h-full" role="img" aria-label={coverage.map((c) => `${c.day}: ${c.shifts} shifts`).join('; ')}>
                    <Bar data={coverageChart} options={coverageOpts} />
                  </div>
                )}
          </div>
        </div>
        <div className="card">
          <h2 className="text-sm font-semibold text-[var(--text-primary)] mb-3 flex items-center gap-1.5"><Users size={15} aria-hidden="true" /> Rostered hours by role</h2>
          <div className="h-64">
            {loading ? <div className="w-full h-full bg-[var(--input-bg)] rounded animate-pulse" />
              : failed ? unavailable
                : roleHours.length ? (
                  <div className="h-full" role="img" aria-label={roleHours.map((r) => `${r.role} ${r.hours} hours`).join(', ')}>
                    <Bar data={roleChart} options={roleOpts} />
                  </div>
                ) : <div className="h-full flex items-center justify-center text-sm text-[var(--text-muted)] text-center px-4">No shifts with start and end times in this view.</div>}
          </div>
        </div>
      </div>

      {/* Filters */}
      <div className="card">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-[minmax(200px,2fr)_1fr_1fr_1fr_1fr_1fr_1fr] gap-3 items-end">
          <label className="block">
            <span className="text-xs text-[var(--text-secondary)]">Search</span>
            <div className="relative mt-1">
              <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" aria-hidden="true" />
              <input className="input pl-9 w-full min-h-[44px]" placeholder="Person, role, site, notes" value={filters.search} onChange={(e) => setFilter('search', e.target.value)} />
            </div>
          </label>
          <label className="block">
            <span className="text-xs text-[var(--text-secondary)]">Status</span>
            <select className="input w-full mt-1 min-h-[44px]" value={filters.status} onChange={(e) => setFilter('status', e.target.value)}>
              <option value="all">All statuses</option>
              {SHIFT_STATUS_VALUES.map((s) => <option key={s} value={s}>{statusLabel(s)}</option>)}
            </select>
          </label>
          <label className="block">
            <span className="text-xs text-[var(--text-secondary)]">Role</span>
            <select className="input w-full mt-1 min-h-[44px]" value={filters.role} onChange={(e) => setFilter('role', e.target.value)}>
              <option value="">All roles</option>
              {roles.map((r) => <option key={r} value={r}>{r}</option>)}
            </select>
          </label>
          <label className="block">
            <span className="text-xs text-[var(--text-secondary)]">Site</span>
            <select className="input w-full mt-1 min-h-[44px]" value={filters.site} onChange={(e) => setFilter('site', e.target.value)}>
              <option value="">All sites</option>
              {sites.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </label>
          <label className="block">
            <span className="text-xs text-[var(--text-secondary)]">When</span>
            <select className="input w-full mt-1 min-h-[44px]" value={filters.timing} onChange={(e) => setFilter('timing', e.target.value)}>
              <option value="all">Any time</option>
              {TIMING_KEYS.map((k) => <option key={k} value={k}>{TIMING_LABEL[k]}</option>)}
            </select>
          </label>
          <label className="block">
            <span className="text-xs text-[var(--text-secondary)]">From</span>
            <input type="date" className="input w-full mt-1 min-h-[44px]" value={filters.from} onChange={(e) => setFilter('from', e.target.value)} />
          </label>
          <label className="block">
            <span className="text-xs text-[var(--text-secondary)]">To</span>
            <input type="date" className="input w-full mt-1 min-h-[44px]" value={filters.to} onChange={(e) => setFilter('to', e.target.value)} />
          </label>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-2 mt-3">
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => setFilter('openPastOnly', !filters.openPastOnly)}
              aria-pressed={filters.openPastOnly}
              className={`text-sm inline-flex items-center gap-1.5 px-3 min-h-[44px] rounded-lg border ${filters.openPastOnly ? 'bg-brand-subtle text-brand-bright border-[var(--accent)]' : 'border-[var(--input-border)] text-[var(--text-muted)] hover:text-[var(--text-primary)]'}`}
            >
              <History size={14} aria-hidden="true" /> Not closed out
            </button>
            <span className="text-xs text-[var(--text-muted)]" aria-live="polite">{filtered.length} of {kpi.total} shifts</span>
          </div>
          {filterCount > 0 && (
            <button type="button" onClick={() => setFilters(EMPTY_SHIFT_FILTERS)} className="btn-secondary text-sm inline-flex items-center gap-1.5 min-h-[44px]">
              <X size={14} aria-hidden="true" /> Clear filters
            </button>
          )}
        </div>
      </div>

      <EnterpriseTable
        columns={columns}
        data={filtered}
        getRowId={(r) => String(r.id)}
        loading={loading}
        enableGlobalFilter={false}
        enableExport={false}
        initialPageSize={25}
        viewKey="shift-schedule"
        onRowClick={(r) => openEdit(r)}
        emptyMessage={
          failed ? 'The roster is unavailable.'
            : kpi.total === 0 ? 'No shifts scheduled yet. Use Schedule shift to roster your first driver or technician.'
              : 'No shifts match these filters.'
        }
      />

      <ShiftModal
        open={modal.open}
        initial={modal.initial}
        activeCountry={activeCountry}
        onClose={() => setModal({ open: false, initial: null })}
        onSaved={load}
      />

      <Modal
        open={Boolean(toDelete)}
        onClose={() => { if (!deleting) setToDelete(null) }}
        title="Delete this shift?"
        size="sm"
        footer={(
          <>
            <button type="button" onClick={() => setToDelete(null)} className="btn-secondary text-sm min-h-[44px]" disabled={deleting}>Cancel</button>
            <button type="button" onClick={confirmDelete} disabled={deleting} className="btn-danger text-sm inline-flex items-center gap-2 min-h-[44px] disabled:opacity-60">
              {deleting ? <Loader2 size={15} className="animate-spin" aria-hidden="true" /> : <Trash2 size={15} aria-hidden="true" />} Delete
            </button>
          </>
        )}
      >
        {toDelete && (
          <p className="text-sm text-[var(--text-muted)]">
            {toDelete.person_name}{toDelete.shift_date ? `, ${fmtDate(toDelete.shift_date)}` : ''}. This action cannot be undone.
          </p>
        )}
      </Modal>
    </div>
  )
}
