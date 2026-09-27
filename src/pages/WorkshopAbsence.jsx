/**
 * WorkshopAbsence (route /workshop-absence) - manager / HR view of workshop
 * attendance: who is present, absent or late, roster vs check-in evidence, for a
 * date range and site.
 *
 * Evidence-based (no fabrication): absence is only asserted for a ROSTERED shift
 * (shifts table) whose start has passed with no matching check-in
 * (workshop_attendance). All maths live in the pure, unit-tested workshopAbsence
 * engine (classification, summary, register rows, filters, insights); this page
 * is presentation + orchestration only. Honest loading / empty / error states:
 * a failed read renders N/A and a Retry, never zeros. Read-only, self-gated to
 * Admin / Manager / Director + super admin. Light + dark via var(--*) tokens.
 */
import { useState, useEffect, useMemo, useCallback } from 'react'
import {
  Chart as ChartJS, CategoryScale, LinearScale, BarElement,
  Tooltip, Legend,
} from 'chart.js'
import { Bar } from 'react-chartjs-2'
import {
  CalendarCheck2, Filter, X, UserCheck, UserX, Clock, Percent,
  BarChart3, Users, AlertTriangle, ShieldAlert, FileSpreadsheet, FileText,
  Search, Palmtree, Repeat, MapPin, RefreshCw,
} from 'lucide-react'
import PageHeader from '../components/ui/PageHeader'
import EnterpriseTable from '../components/ui/EnterpriseTable'
import { useSettings } from '../contexts/SettingsContext'
import { useAuth } from '../contexts/AuthContext'
import { loadAbsenceData, enrichAttendanceWithNames, distinctSites } from '../lib/api/workshopAbsence'
import {
  summarizeAttendance, attendanceDetailRows, filterDetailRows, personRows,
  absenceInsights, ATTENDANCE_STATUS_LABEL,
} from '../lib/workshopAbsence'
import { colorAt, withAlpha } from '../lib/reportColors'
import { compareValues } from '../lib/consoleTable'
import { exportToExcel, exportToPdf, reportFileName, reportDateLabel } from '../lib/exportUtils'
import { toUserMessage } from '../lib/safeError'
import useLatestRequest from '../lib/useLatestRequest'
import { isMissingRelation } from '../lib/api/_client'

ChartJS.register(CategoryScale, LinearScale, BarElement, Tooltip, Legend)

const VIEW_ROLES = new Set(['Admin', 'Manager', 'Director'])

// Status pill tones (semantic, deliberately not palettized). The label is
// always printed, so colour is never the only signal.
const STATUS_TONE = {
  present: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30',
  late: 'bg-amber-500/15 text-amber-400 border-amber-500/30',
  absent: 'bg-red-500/15 text-red-400 border-red-500/30',
  scheduled: 'bg-sky-500/15 text-sky-400 border-sky-500/30',
  leave: 'bg-violet-500/15 text-violet-400 border-violet-500/30',
  cancelled: 'bg-[var(--input-bg)] text-[var(--text-muted)] border-[var(--input-border)]',
}

// chartVarPlugin resolves var(--token) colours per theme at draw time.
const TICK = { color: 'var(--text-muted)', font: { size: 10 } }
const AXIS_STACKED = {
  x: { stacked: true, grid: { display: false }, ticks: TICK },
  y: { stacked: true, beginAtZero: true, grid: { color: 'var(--panel-2)' }, ticks: { ...TICK, precision: 0 } },
}
const AXIS_PLAIN = {
  x: { grid: { display: false }, ticks: TICK },
  y: { beginAtZero: true, grid: { color: 'var(--panel-2)' }, ticks: { ...TICK, precision: 0 } },
}
const LEGEND = { position: 'bottom', labels: { color: 'var(--text-secondary)', font: { size: 11 }, boxWidth: 12 } }

// Local calendar dates. toISOString() is UTC and rolls the day back or forward
// for anyone not on UTC, so a "Today" filter would read yesterday.
function isoLocal(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
const todayISO = () => isoLocal(new Date())
function daysAgo(n) {
  const d = new Date()
  d.setDate(d.getDate() - n)
  return isoLocal(d)
}
function firstOfMonth() {
  const d = new Date()
  return isoLocal(new Date(d.getFullYear(), d.getMonth(), 1))
}
function fmtDate(v) {
  if (!v) return 'N/A'
  const d = new Date(v)
  return Number.isNaN(d.getTime()) ? String(v).slice(0, 10) : d.toLocaleDateString()
}
function fmtNum(v) {
  const n = Number(v)
  return v != null && Number.isFinite(n) ? n.toLocaleString() : 'N/A'
}
function fmtRate(r) {
  return r == null ? 'N/A' : `${Math.round(r * 100)}%`
}
const sortCompare = (a, b, id) => compareValues(a.getValue(id), b.getValue(id))

function StatusPill({ status }) {
  return (
    <span className={`inline-block text-[11px] px-2 py-0.5 rounded-full border ${STATUS_TONE[status] || STATUS_TONE.cancelled}`}>
      {ATTENDANCE_STATUS_LABEL[status] || status || 'N/A'}
    </span>
  )
}

export default function WorkshopAbsence() {
  const { activeCountry, activeCurrency } = useSettings()
  const { profile, isSuperAdmin } = useAuth()
  const canView = isSuperAdmin === true || VIEW_ROLES.has(profile?.role)

  const [data, setData] = useState({ shifts: [], attendance: [], staff: [] })
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState('')
  const [missing, setMissing] = useState(false)
  const [updatedAt, setUpdatedAt] = useState(null)

  const [filters, setFilters] = useState({ from: daysAgo(7), to: todayISO(), site: 'All' })
  const setFilter = (k, v) => setFilters((f) => ({ ...f, [k]: v }))
  const [statusFilter, setStatusFilter] = useState('')
  const [query, setQuery] = useState('')
  const resetFilters = () => {
    setFilters({ from: daysAgo(7), to: todayISO(), site: 'All' })
    setStatusFilter('')
    setQuery('')
  }

  // Changing the date range or site refetches without waiting for the load
  // already in flight. If the earlier one finishes last it marks the PREVIOUS
  // window's attendance under the new filters, so someone reads as absent for a
  // day nobody asked about.
  const latestLoad = useLatestRequest()

  const load = useCallback(async () => {
    const stale = latestLoad.begin()
    setRefreshing(true)
    setError('')
    try {
      const res = await loadAbsenceData({
        from: filters.from || undefined,
        to: filters.to || undefined,
        site: filters.site,
        country: activeCountry,
      })
      if (stale()) return
      setMissing(false)
      setData(res)
      setUpdatedAt(new Date())
    } catch (err) {
      // A superseded load must not raise a banner over data that loaded fine.
      if (stale()) return
      if (isMissingRelation(err)) { setMissing(true); setData({ shifts: [], attendance: [], staff: [] }) }
      else setError(toUserMessage(err, 'Could not load attendance data.'))
    } finally {
      // Clearing these from a stale load would make the newer one look finished.
      if (!stale()) {
        setLoading(false)
        setRefreshing(false)
      }
    }
  }, [filters.from, filters.to, filters.site, activeCountry, latestLoad])

  useEffect(() => { setLoading(true); load() }, [load])

  // Resolve attendance user_id -> person name, then summarise (single pure pass).
  const enriched = useMemo(
    () => enrichAttendanceWithNames(data.attendance, data.staff),
    [data.attendance, data.staff],
  )
  const summary = useMemo(
    () => summarizeAttendance({
      shifts: data.shifts,
      attendance: enriched,
      from: filters.from || undefined,
      to: filters.to || undefined,
    }),
    [data.shifts, enriched, filters.from, filters.to],
  )
  const insights = useMemo(() => absenceInsights(summary), [summary])
  const people = useMemo(() => personRows(summary.byPerson), [summary.byPerson])

  const siteOptions = useMemo(() => distinctSites(data.shifts, data.attendance), [data.shifts, data.attendance])
  const hasRoster = summary.rostered > 0
  // A failed or unprovisioned read is not a measurement: every figure reads N/A.
  const unknown = !!error || missing

  // ── Charts ──────────────────────────────────────────────────────────────────
  const dayData = useMemo(() => {
    const rows = summary.byDay
    const present = colorAt(1)
    const late = colorAt(2)
    const absent = colorAt(3)
    return {
      labels: rows.map((r) => r.date.slice(5)),
      datasets: [
        { label: 'Present', data: rows.map((r) => r.present - r.late), backgroundColor: withAlpha(present, 0.85), borderColor: present, borderWidth: 1 },
        { label: 'Late', data: rows.map((r) => r.late), backgroundColor: withAlpha(late, 0.85), borderColor: late, borderWidth: 1 },
        { label: 'Absent', data: rows.map((r) => r.absent), backgroundColor: withAlpha(absent, 0.85), borderColor: absent, borderWidth: 1 },
      ],
    }
  }, [summary.byDay])

  const siteData = useMemo(() => {
    const rows = summary.bySite.slice(0, 12)
    const present = colorAt(1)
    const absent = colorAt(3)
    return {
      labels: rows.map((r) => r.site),
      datasets: [
        { label: 'Present', data: rows.map((r) => r.present), backgroundColor: withAlpha(present, 0.85), borderColor: present, borderWidth: 1, borderRadius: 3 },
        { label: 'Absent', data: rows.map((r) => r.absent), backgroundColor: withAlpha(absent, 0.85), borderColor: absent, borderWidth: 1, borderRadius: 3 },
      ],
    }
  }, [summary.bySite])

  const stackedOpts = { responsive: true, maintainAspectRatio: false, plugins: { legend: LEGEND }, scales: AXIS_STACKED }
  const groupedOpts = { responsive: true, maintainAspectRatio: false, plugins: { legend: LEGEND }, scales: AXIS_PLAIN }

  const kpis = [
    { label: 'Present', value: fmtNum(summary.present), sub: 'checked in (incl. late)', icon: UserCheck, status: 'present' },
    { label: 'Absent', value: fmtNum(summary.absent), sub: 'rostered, no check-in', icon: UserX, status: 'absent' },
    { label: 'Late', value: fmtNum(summary.late), sub: `${fmtRate(insights.lateRate)} of those present`, icon: Clock, status: 'late' },
    { label: 'Attendance rate', value: fmtRate(summary.attendanceRate), sub: 'present / (present + absent)', icon: Percent, status: '' },
    { label: 'On leave', value: fmtNum(summary.onLeave), sub: 'approved, not counted absent', icon: Palmtree, status: 'leave' },
    { label: 'Repeat absentees', value: fmtNum(insights.repeatAbsentees.length), sub: 'absent on 2+ rostered shifts', icon: Repeat, status: 'absent' },
  ]

  // ── Register rows (engine) + page filters ─────────────────────────────────
  const detailRows = useMemo(() => attendanceDetailRows(summary.detail), [summary.detail])
  const filteredDetail = useMemo(
    () => filterDetailRows(detailRows, { status: statusFilter, query }),
    [detailRows, statusFilter, query],
  )

  // ── Exports: the whole filtered register, never a page ────────────────────
  const EXPORT_COLS = ['date', 'person', 'site', 'rostered', 'checkIn', 'statusLabel']
  const EXPORT_HEADERS = ['Date', 'Person', 'Site', 'Rostered Shift', 'Check In', 'Status']
  const exportRows = () => filteredDetail.map((r) => ({
    date: r.date || 'N/A',
    person: r.person,
    site: r.site || 'N/A',
    rostered: r.rostered || 'N/A',
    checkIn: r.checkIn || 'N/A',
    statusLabel: r.statusLabel || 'N/A',
  }))
  const exportExcel = async () => {
    try {
      const name = reportFileName('Workshop Attendance', reportDateLabel())
      await exportToExcel(exportRows(), EXPORT_COLS, EXPORT_HEADERS, name, 'Attendance', { title: 'Workshop Attendance', currency: activeCurrency })
    } catch (err) {
      setError(toUserMessage(err, 'Could not export. Try again.'))
    }
  }
  const exportPdf = async () => {
    try {
      const name = reportFileName('Workshop Attendance', reportDateLabel())
      await exportToPdf(
        exportRows(),
        EXPORT_COLS.map((k, i) => ({ key: k, header: EXPORT_HEADERS[i] })),
        'Workshop Attendance Report',
        name,
        'landscape',
        '',
        { currency: activeCurrency },
      )
    } catch (err) {
      setError(toUserMessage(err, 'Could not export. Try again.'))
    }
  }

  // ── Table columns ─────────────────────────────────────────────────────────
  const personColumns = useMemo(() => [
    { accessorKey: 'person', header: 'Person', sortingFn: sortCompare, cell: ({ getValue }) => <span className="text-[var(--text-primary)] font-medium">{getValue()}</span> },
    { accessorKey: 'scheduled', header: 'Scheduled', sortingFn: sortCompare, meta: { align: 'right' }, cell: ({ getValue }) => fmtNum(getValue()) },
    { accessorKey: 'present', header: 'Present', sortingFn: sortCompare, meta: { align: 'right' }, cell: ({ getValue }) => fmtNum(getValue()) },
    {
      accessorKey: 'absent', header: 'Absent', sortingFn: sortCompare, meta: { align: 'right' },
      cell: ({ getValue }) => <span className={getValue() > 0 ? 'text-red-400 font-semibold' : ''}>{fmtNum(getValue())}</span>,
    },
    { accessorKey: 'late', header: 'Late', sortingFn: sortCompare, meta: { align: 'right' }, cell: ({ getValue }) => fmtNum(getValue()) },
    {
      id: 'rate', accessorFn: (r) => (r.rate == null ? undefined : r.rate), header: 'Rate', sortingFn: sortCompare, sortUndefined: 'last', meta: { align: 'right', exportValue: (r) => fmtRate(r.rate) },
      cell: ({ getValue }) => fmtRate(getValue()),
    },
    {
      id: 'lastSeen', header: 'Last seen', sortingFn: sortCompare, sortUndefined: 'last',
      accessorFn: (r) => r.lastSeen || undefined,
      cell: ({ getValue }) => fmtDate(getValue()),
    },
  ], [])

  const registerColumns = useMemo(() => [
    { id: 'date', accessorFn: (r) => r.date || undefined, header: 'Date', sortingFn: sortCompare, sortUndefined: 'last', cell: ({ getValue }) => fmtDate(getValue()) },
    { accessorKey: 'person', header: 'Person', sortingFn: sortCompare, cell: ({ getValue }) => <span className="text-[var(--text-primary)]">{getValue()}</span> },
    { id: 'site', accessorFn: (r) => r.site || undefined, header: 'Site', sortingFn: sortCompare, sortUndefined: 'last', cell: ({ getValue }) => getValue() || 'N/A' },
    { id: 'rostered', accessorFn: (r) => r.rostered || undefined, header: 'Rostered shift', enableSorting: false, cell: ({ getValue }) => getValue() || 'N/A' },
    { id: 'checkIn', accessorFn: (r) => r.checkIn || undefined, header: 'Check in', sortingFn: sortCompare, sortUndefined: 'last', cell: ({ getValue }) => getValue() || 'N/A' },
    {
      accessorKey: 'status', header: 'Status', sortingFn: sortCompare,
      meta: { exportValue: (r) => r.statusLabel },
      cell: ({ getValue }) => <StatusPill status={getValue()} />,
    },
  ], [])

  const controlCls = 'w-full min-h-[44px] rounded-lg bg-[var(--input-bg)] border border-[var(--input-border)] px-3 py-2 text-sm text-[var(--text-primary)] focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500'
  const chipCls = 'min-h-[44px] text-xs px-3 rounded-lg bg-[var(--input-bg)] border border-[var(--input-border)] hover:border-blue-600/50 text-[var(--text-secondary)] focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500'

  const quickRanges = [
    { id: '7', label: 'Last 7 days', from: daysAgo(7), to: todayISO() },
    { id: '30', label: 'Last 30 days', from: daysAgo(30), to: todayISO() },
    { id: 'month', label: 'This month', from: firstOfMonth(), to: todayISO() },
    { id: 'today', label: 'Today', from: todayISO(), to: todayISO() },
  ]
  const filtersActive = filters.site !== 'All' || statusFilter || query

  if (!canView) {
    return (
      <div className="space-y-6">
        <PageHeader title="Absence & Attendance" subtitle="Workshop attendance reporting." icon={CalendarCheck2} />
        <div className="card border border-amber-800/50 flex items-start gap-3" role="alert">
          <ShieldAlert size={18} className="text-amber-400 mt-0.5 shrink-0" aria-hidden="true" />
          <div>
            <p className="text-amber-400 font-medium">You do not have access to attendance reporting.</p>
            <p className="text-[var(--text-muted)] text-sm mt-1">This view is limited to Admin, Manager and Director roles.</p>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Absence & Attendance"
        subtitle="Who is present, absent or late in the workshop, roster vs check-in evidence, by day and site. Absence is only counted for a rostered shift with no matching check-in."
        icon={CalendarCheck2}
        onRefresh={load}
        refreshing={refreshing}
        updatedAt={updatedAt}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <button onClick={exportExcel} disabled={unknown || filteredDetail.length === 0} className="btn-secondary min-h-[44px] text-sm inline-flex items-center gap-1.5 disabled:opacity-50">
              <FileSpreadsheet size={14} aria-hidden="true" /> Excel
            </button>
            <button onClick={exportPdf} disabled={unknown || filteredDetail.length === 0} className="btn-secondary min-h-[44px] text-sm inline-flex items-center gap-1.5 disabled:opacity-50">
              <FileText size={14} aria-hidden="true" /> PDF
            </button>
          </div>
        }
      />

      {missing && (
        <div className="card border border-amber-800/50 flex items-start gap-3" role="status">
          <AlertTriangle size={18} className="text-amber-400 mt-0.5 shrink-0" aria-hidden="true" />
          <div>
            <p className="text-amber-400 font-medium">Attendance tracking is not enabled on this database yet.</p>
            <p className="text-[var(--text-muted)] text-sm mt-1">
              The <span className="font-mono text-[var(--text-primary)]">workshop_attendance</span> and <span className="font-mono text-[var(--text-primary)]">shifts</span> tables must exist, then reload.
            </p>
          </div>
        </div>
      )}

      {error && (
        <div className="card border border-red-800/50 flex items-start gap-3" role="alert">
          <AlertTriangle size={18} className="text-red-400 mt-0.5 shrink-0" aria-hidden="true" />
          <div className="flex-1">
            <p className="text-red-400 font-medium">Attendance could not be loaded, so no figure below is a measurement.</p>
            <p className="text-[var(--text-muted)] text-sm mt-1">{error}</p>
          </div>
          <button onClick={load} className="btn-secondary min-h-[44px] text-sm inline-flex items-center gap-1.5">
            <RefreshCw size={14} aria-hidden="true" /> Retry
          </button>
        </div>
      )}

      {/* Filters */}
      <section className="card space-y-3" aria-label="Filters">
        <div className="flex flex-wrap items-center gap-2 text-[var(--text-secondary)]">
          <Filter size={15} aria-hidden="true" /> <h2 className="text-sm font-medium">Filters</h2>
          <div className="ms-auto flex flex-wrap gap-1.5">
            {quickRanges.map((q) => {
              const on = filters.from === q.from && filters.to === q.to
              return (
                <button
                  key={q.id}
                  onClick={() => setFilters((f) => ({ ...f, from: q.from, to: q.to }))}
                  aria-pressed={on}
                  className={`${chipCls} ${on ? 'border-blue-500 text-[var(--text-primary)]' : ''}`}
                >
                  {q.label}
                </button>
              )
            })}
          </div>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-6 gap-3">
          <label className="text-xs text-[var(--text-muted)] space-y-1 lg:col-span-2">
            <span>Search person, site or status</span>
            <span className="relative block">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" aria-hidden="true" />
              <input type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="e.g. Ahmed or NHC" className={`${controlCls} pl-9`} />
            </span>
          </label>
          <label className="text-xs text-[var(--text-muted)] space-y-1">
            <span>From</span>
            <input type="date" value={filters.from} onChange={(e) => setFilter('from', e.target.value)} className={controlCls} />
          </label>
          <label className="text-xs text-[var(--text-muted)] space-y-1">
            <span>To</span>
            <input type="date" value={filters.to} onChange={(e) => setFilter('to', e.target.value)} className={controlCls} />
          </label>
          <label className="text-xs text-[var(--text-muted)] space-y-1">
            <span>Site</span>
            <select value={filters.site} onChange={(e) => setFilter('site', e.target.value)} className={controlCls}>
              <option value="All">All sites</option>
              {siteOptions.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </label>
          <label className="text-xs text-[var(--text-muted)] space-y-1">
            <span>Status</span>
            <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className={controlCls}>
              <option value="">All statuses</option>
              {Object.entries(ATTENDANCE_STATUS_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          </label>
        </div>
        {filtersActive && (
          <div className="flex flex-wrap items-center gap-2 text-xs text-[var(--text-muted)]">
            <span>Register shows {filteredDetail.length} of {detailRows.length} rostered shifts.</span>
            <button onClick={resetFilters} className={`${chipCls} inline-flex items-center gap-1.5`}>
              <X size={14} aria-hidden="true" /> Reset filters
            </button>
          </div>
        )}
      </section>

      {/* KPI tiles. Each status tile also filters the register. */}
      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
        {kpis.map((k) => {
          const Icon = k.icon
          const active = k.status && statusFilter === k.status
          const body = (
            <>
              <div className="flex items-center justify-between">
                <p className="text-xs text-[var(--text-muted)]">{k.label}</p>
                <Icon size={15} className="text-[var(--text-muted)]" aria-hidden="true" />
              </div>
              <p className="text-2xl font-bold text-[var(--text-primary)] mt-1 tabular-nums">{loading ? '...' : unknown ? 'N/A' : k.value}</p>
              <p className="text-[11px] text-[var(--text-muted)] mt-0.5">{k.sub}</p>
            </>
          )
          return k.status ? (
            <button
              key={k.label}
              type="button"
              onClick={() => setStatusFilter(active ? '' : k.status)}
              aria-pressed={!!active}
              className={`card text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 ${active ? 'ring-2 ring-blue-500' : ''}`}
            >
              {body}
            </button>
          ) : <div key={k.label} className="card">{body}</div>
        })}
      </div>

      {!loading && !unknown && hasRoster && (insights.worstSite || insights.repeatAbsentees.length > 0) && (
        <div className="card flex flex-wrap items-start gap-4 text-sm" role="note">
          {insights.worstSite && (
            <p className="flex items-center gap-2 text-[var(--text-secondary)]">
              <MapPin size={15} className="text-red-400 shrink-0" aria-hidden="true" />
              Most absences: <span className="font-semibold text-[var(--text-primary)]">{insights.worstSite.site}</span> ({fmtNum(insights.worstSite.absent)})
            </p>
          )}
          {insights.repeatAbsentees.length > 0 && (
            <p className="flex items-center gap-2 text-[var(--text-secondary)]">
              <Repeat size={15} className="text-amber-400 shrink-0" aria-hidden="true" />
              Repeat absentees: <span className="text-[var(--text-primary)]">{insights.repeatAbsentees.slice(0, 5).join(', ')}{insights.repeatAbsentees.length > 5 ? ` and ${insights.repeatAbsentees.length - 5} more` : ''}</span>
            </p>
          )}
        </div>
      )}

      {loading ? (
        <div className="card" aria-busy="true"><div className="space-y-2">{[0, 1, 2, 3, 4].map((i) => <div key={i} className="h-9 bg-[var(--input-bg)] rounded animate-pulse" />)}</div></div>
      ) : unknown ? null : !hasRoster ? (
        <div className="card py-12 text-center text-[var(--text-muted)]">
          <CalendarCheck2 size={30} className="mx-auto mb-2 opacity-50" aria-hidden="true" />
          <p className="text-sm">No roster or attendance in this range.</p>
          <p className="text-xs mt-1">Schedule shifts (Shift Scheduling) and capture check-ins to populate this report.</p>
        </div>
      ) : (
        <>
          {/* Charts */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <section className="card" aria-labelledby="wa-day">
              <div className="flex items-center gap-2 mb-3">
                <BarChart3 size={16} className="text-[var(--text-secondary)]" aria-hidden="true" />
                <h3 id="wa-day" className="font-semibold text-[var(--text-primary)]">Daily present vs absent</h3>
              </div>
              <div className="h-[260px]" role="img" aria-label={`Daily attendance over ${summary.byDay.length} days: ${summary.present} present, ${summary.absent} absent, ${summary.late} late.`}>
                {summary.byDay.length === 0 ? <EmptyChart /> : <Bar data={dayData} options={stackedOpts} />}
              </div>
            </section>
            <section className="card" aria-labelledby="wa-site">
              <div className="flex items-center gap-2 mb-3">
                <BarChart3 size={16} className="text-[var(--text-secondary)]" aria-hidden="true" />
                <h3 id="wa-site" className="font-semibold text-[var(--text-primary)]">By site</h3>
              </div>
              <div className="h-[260px]" role="img" aria-label={`Attendance across ${summary.bySite.length} sites.${insights.worstSite ? ` Most absences at ${insights.worstSite.site}.` : ''}`}>
                {summary.bySite.length === 0 ? <EmptyChart /> : <Bar data={siteData} options={groupedOpts} />}
              </div>
            </section>
          </div>

          {/* By person */}
          <section className="card" aria-labelledby="wa-person">
            <div className="flex items-center gap-2 mb-3">
              <Users size={16} className="text-[var(--text-secondary)]" aria-hidden="true" />
              <h3 id="wa-person" className="font-semibold text-[var(--text-primary)]">By person</h3>
              <span className="text-[11px] text-[var(--text-muted)]">{people.length} rostered</span>
            </div>
            <EnterpriseTable
              columns={personColumns}
              data={people}
              getRowId={(r) => r.person}
              enableColumnFilters={false}
              enableExport={false}
              enableKeyboard={false}
              initialPageSize={25}
              searchPlaceholder="Search people"
              emptyMessage="No rostered people in this range."
            />
          </section>

          {/* Detailed attendance / absentee register */}
          <section className="card" aria-labelledby="wa-register">
            <div className="flex flex-wrap items-center gap-2 mb-3">
              <CalendarCheck2 size={16} className="text-[var(--text-secondary)]" aria-hidden="true" />
              <h3 id="wa-register" className="font-semibold text-[var(--text-primary)]">Attendance register</h3>
              <span className="text-[11px] text-[var(--text-muted)]">{filteredDetail.length} of {detailRows.length} shifts</span>
            </div>
            <EnterpriseTable
              columns={registerColumns}
              data={filteredDetail}
              getRowId={(r) => r.id}
              enableGlobalFilter={false}
              enableColumnFilters={false}
              enableExport={false}
              initialPageSize={50}
              emptyMessage={filtersActive ? 'No shifts match these filters.' : 'No rostered shifts in this range.'}
            />
          </section>
        </>
      )}
    </div>
  )
}

function EmptyChart({ hint = 'No data for the selected filters.' }) {
  return (
    <div className="h-full flex flex-col items-center justify-center text-[var(--text-muted)]">
      <CalendarCheck2 size={26} className="opacity-40 mb-2" aria-hidden="true" />
      <p className="text-xs">{hint}</p>
    </div>
  )
}
