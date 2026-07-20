/**
 * WorkshopAbsence (route /workshop-absence) - manager / HR view of workshop
 * attendance: who is present, absent or late, roster vs check-in evidence, for a
 * date range and site.
 *
 * Evidence-based (no fabrication): absence is only asserted for a ROSTERED shift
 * (shifts table) whose start has passed with no matching check-in
 * (workshop_attendance). All maths live in the pure, unit-tested workshopAbsence
 * engine; this page is presentation + orchestration only. Honest loading / empty
 * / error states. Read-only, self-gated to Admin / Manager / Director + super
 * admin. Light + dark via var(--*) tokens.
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
} from 'lucide-react'
import PageHeader from '../components/ui/PageHeader'
import { useSettings } from '../contexts/SettingsContext'
import { useAuth } from '../contexts/AuthContext'
import { loadAbsenceData, enrichAttendanceWithNames, distinctSites } from '../lib/api/workshopAbsence'
import { summarizeAttendance } from '../lib/workshopAbsence'
import { colorAt, withAlpha } from '../lib/reportColors'
import { exportToExcel, exportToPdf, reportFileName, reportDateLabel } from '../lib/exportUtils'
import { toUserMessage } from '../lib/safeError'

ChartJS.register(CategoryScale, LinearScale, BarElement, Tooltip, Legend)

const VIEW_ROLES = new Set(['Admin', 'Manager', 'Director'])

// Status pill tones (semantic, deliberately not palettized).
const STATUS_TONE = {
  present: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30',
  late: 'bg-amber-500/15 text-amber-300 border-amber-500/30',
  absent: 'bg-red-500/15 text-red-300 border-red-500/30',
  scheduled: 'bg-sky-500/15 text-sky-300 border-sky-500/30',
  leave: 'bg-violet-500/15 text-violet-300 border-violet-500/30',
  cancelled: 'bg-slate-500/15 text-slate-300 border-slate-500/30',
}
const STATUS_LABEL = {
  present: 'Present', late: 'Late', absent: 'Absent',
  scheduled: 'Scheduled', leave: 'On leave', cancelled: 'Cancelled',
}

const AXIS_STACKED = {
  x: { stacked: true, grid: { display: false }, ticks: { color: 'rgba(148,163,184,0.9)', font: { size: 10 } } },
  y: { stacked: true, beginAtZero: true, grid: { color: 'var(--panel-2)' }, ticks: { color: 'rgba(148,163,184,0.9)', font: { size: 10 }, precision: 0 } },
}
const AXIS_PLAIN = {
  x: { grid: { display: false }, ticks: { color: 'rgba(148,163,184,0.9)', font: { size: 10 } } },
  y: { beginAtZero: true, grid: { color: 'var(--panel-2)' }, ticks: { color: 'rgba(148,163,184,0.9)', font: { size: 10 }, precision: 0 } },
}

const todayISO = () => new Date().toISOString().slice(0, 10)
function daysAgo(n) {
  const d = new Date()
  d.setDate(d.getDate() - n)
  return d.toISOString().slice(0, 10)
}
function firstOfMonth() {
  const d = new Date()
  return new Date(d.getFullYear(), d.getMonth(), 1).toISOString().slice(0, 10)
}
function fmtDate(v) {
  if (!v) return 'N/A'
  const d = new Date(v)
  return Number.isNaN(d.getTime()) ? String(v).slice(0, 10) : d.toLocaleDateString()
}
function fmtNum(v) {
  const n = Number(v)
  return Number.isFinite(n) ? n.toLocaleString() : 'N/A'
}
function fmtRate(r) {
  return r == null ? 'N/A' : `${Math.round(r * 100)}%`
}
function isMissingRelation(err) {
  const m = String(err?.message || '').toLowerCase()
  return m.includes('does not exist') || m.includes('relation') || m.includes('schema cache') || m.includes('could not find the table')
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
  const resetFilters = () => setFilters({ from: daysAgo(7), to: todayISO(), site: 'All' })

  const load = useCallback(async () => {
    setRefreshing(true)
    setError('')
    try {
      const res = await loadAbsenceData({
        from: filters.from || undefined,
        to: filters.to || undefined,
        site: filters.site,
        country: activeCountry,
      })
      setData(res)
      setUpdatedAt(new Date())
    } catch (err) {
      if (isMissingRelation(err)) { setMissing(true); setData({ shifts: [], attendance: [], staff: [] }) }
      else setError(toUserMessage(err, 'Could not load attendance data.'))
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }, [filters.from, filters.to, filters.site, activeCountry])

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

  const siteOptions = useMemo(() => distinctSites(data.shifts, data.attendance), [data.shifts, data.attendance])
  const hasRoster = summary.rostered > 0

  // ── Charts ──────────────────────────────────────────────────────────────────
  const dayData = useMemo(() => {
    const rows = summary.byDay
    const present = colorAt(1) // green-ish accent
    const absent = colorAt(3)
    const late = colorAt(2)
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

  const stackedOpts = {
    responsive: true, maintainAspectRatio: false,
    plugins: { legend: { position: 'bottom', labels: { color: 'rgba(148,163,184,0.95)', font: { size: 11 }, boxWidth: 12 } } },
    scales: AXIS_STACKED,
  }
  const groupedOpts = {
    responsive: true, maintainAspectRatio: false,
    plugins: { legend: { position: 'bottom', labels: { color: 'rgba(148,163,184,0.95)', font: { size: 11 }, boxWidth: 12 } } },
    scales: AXIS_PLAIN,
  }

  const kpis = [
    { label: 'Present', value: fmtNum(summary.present), sub: 'checked in (incl. late)', icon: UserCheck },
    { label: 'Absent', value: fmtNum(summary.absent), sub: 'rostered, no check-in', icon: UserX },
    { label: 'Late', value: fmtNum(summary.late), sub: 'after shift start', icon: Clock },
    { label: 'Attendance Rate', value: fmtRate(summary.attendanceRate), sub: 'present / (present + absent)', icon: Percent },
  ]

  // ── Absentee / attendance detail rows (rostered shifts, worst first) ─────────
  const detailRows = useMemo(() => {
    const order = { absent: 0, late: 1, scheduled: 2, present: 3, leave: 4, cancelled: 5 }
    return summary.detail
      .map(({ shift, cls, att }) => ({
        person: shift.person_name || 'Unknown',
        date: shift.shift_date ? String(shift.shift_date).slice(0, 10) : '',
        site: shift.site || '',
        rostered: [shift.start_time, shift.end_time].filter(Boolean).join(' to ') || 'N/A',
        checkIn: att && att.check_in ? String(att.check_in).slice(11, 16) : '',
        status: cls,
      }))
      .sort((a, b) => (order[a.status] ?? 9) - (order[b.status] ?? 9) || b.date.localeCompare(a.date) || a.person.localeCompare(b.person))
  }, [summary.detail])

  // ── Exports ─────────────────────────────────────────────────────────────────
  const EXPORT_COLS = ['date', 'person', 'site', 'rostered', 'checkIn', 'statusLabel']
  const EXPORT_HEADERS = ['Date', 'Person', 'Site', 'Rostered Shift', 'Check In', 'Status']
  const exportRows = () => detailRows.map((r) => ({
    date: r.date,
    person: r.person,
    site: r.site,
    rostered: r.rostered,
    checkIn: r.checkIn || 'N/A',
    statusLabel: STATUS_LABEL[r.status] || r.status,
  }))
  const exportExcel = () => {
    const name = reportFileName('Workshop Attendance', reportDateLabel())
    exportToExcel(exportRows(), EXPORT_COLS, EXPORT_HEADERS, name, 'Attendance', { title: 'Workshop Attendance', currency: activeCurrency })
  }
  const exportPdf = () => {
    const name = reportFileName('Workshop Attendance', reportDateLabel())
    exportToPdf(
      exportRows(),
      EXPORT_COLS.map((k, i) => ({ key: k, header: EXPORT_HEADERS[i] })),
      'Workshop Attendance Report',
      name,
      'landscape',
      '',
      { currency: activeCurrency },
    )
  }

  const inputCls = 'w-full rounded-lg bg-[var(--input-bg)] border border-[var(--input-border)] px-3 py-2 text-sm text-[var(--text-primary)] focus:outline-none focus:border-blue-500'

  const quickRanges = [
    { id: '7', label: 'Last 7 days', from: daysAgo(7), to: todayISO() },
    { id: '30', label: 'Last 30 days', from: daysAgo(30), to: todayISO() },
    { id: 'month', label: 'This month', from: firstOfMonth(), to: todayISO() },
    { id: 'today', label: 'Today', from: todayISO(), to: todayISO() },
  ]

  if (!canView) {
    return (
      <div className="space-y-6">
        <PageHeader title="Absence & Attendance" subtitle="Workshop attendance reporting." icon={CalendarCheck2} />
        <div className="card border border-amber-800/50 flex items-start gap-3">
          <ShieldAlert size={18} className="text-amber-400 mt-0.5 shrink-0" />
          <div>
            <p className="text-amber-300 font-medium">You do not have access to attendance reporting.</p>
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
      />

      {missing && (
        <div className="card border border-amber-800/50 flex items-start gap-3">
          <AlertTriangle size={18} className="text-amber-400 mt-0.5 shrink-0" />
          <div>
            <p className="text-amber-300 font-medium">Attendance tracking is not enabled on this database yet.</p>
            <p className="text-[var(--text-muted)] text-sm mt-1">
              The <span className="font-mono text-[var(--text-primary)]">workshop_attendance</span> and <span className="font-mono text-[var(--text-primary)]">shifts</span> tables must exist, then reload.
            </p>
          </div>
        </div>
      )}

      {error && (
        <div className="card border border-red-800/50 flex items-start gap-3">
          <AlertTriangle size={18} className="text-red-400 mt-0.5 shrink-0" />
          <div>
            <p className="text-red-300 font-medium">Something went wrong.</p>
            <p className="text-[var(--text-muted)] text-sm mt-1">{error}</p>
            <button onClick={load} className="mt-2 text-sm text-blue-400 hover:text-blue-300">Retry</button>
          </div>
        </div>
      )}

      {/* Filters */}
      <div className="card space-y-3">
        <div className="flex items-center gap-2 text-[var(--text-secondary)]">
          <Filter size={15} /> <span className="text-sm font-medium">Filters</span>
          <div className="ml-auto flex flex-wrap gap-1.5">
            {quickRanges.map((q) => (
              <button
                key={q.id}
                onClick={() => setFilters((f) => ({ ...f, from: q.from, to: q.to }))}
                className="text-[11px] px-2.5 py-1 rounded-lg bg-[var(--input-bg)] border border-[var(--input-border)] hover:border-blue-600/50 text-[var(--text-secondary)]"
              >
                {q.label}
              </button>
            ))}
          </div>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          <label className="text-xs text-[var(--text-muted)] space-y-1">
            <span>From</span>
            <input type="date" value={filters.from} onChange={(e) => setFilter('from', e.target.value)} className={inputCls} />
          </label>
          <label className="text-xs text-[var(--text-muted)] space-y-1">
            <span>To</span>
            <input type="date" value={filters.to} onChange={(e) => setFilter('to', e.target.value)} className={inputCls} />
          </label>
          <label className="text-xs text-[var(--text-muted)] space-y-1">
            <span>Site</span>
            <select value={filters.site} onChange={(e) => setFilter('site', e.target.value)} className={inputCls}>
              <option value="All">All sites</option>
              {siteOptions.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </label>
          <div className="flex items-end">
            <button onClick={resetFilters} className="inline-flex items-center gap-1.5 px-3 py-2 text-sm rounded-lg bg-[var(--input-bg)] border border-[var(--input-border)] text-[var(--text-secondary)] hover:text-[var(--text-primary)]">
              <X size={14} /> Reset
            </button>
          </div>
        </div>
      </div>

      {/* KPI tiles */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {kpis.map((k) => {
          const Icon = k.icon
          return (
            <div key={k.label} className="card">
              <div className="flex items-center justify-between">
                <p className="text-xs text-[var(--text-muted)]">{k.label}</p>
                <Icon size={15} className="text-[var(--text-muted)]" />
              </div>
              <p className="text-2xl font-bold text-[var(--text-primary)] mt-1">{loading ? '-' : k.value}</p>
              <p className="text-[10px] text-[var(--text-muted)] mt-0.5">{k.sub}</p>
            </div>
          )
        })}
      </div>

      {loading ? (
        <div className="card"><div className="space-y-2">{[0, 1, 2, 3, 4].map((i) => <div key={i} className="h-9 bg-[var(--input-bg)] rounded animate-pulse" />)}</div></div>
      ) : !hasRoster ? (
        <div className="card py-12 text-center text-[var(--text-muted)]">
          <CalendarCheck2 size={30} className="mx-auto mb-2 opacity-50" />
          <p className="text-sm">No roster or attendance in this range.</p>
          <p className="text-xs mt-1">Schedule shifts (Shift Scheduling) and capture check-ins to populate this report.</p>
        </div>
      ) : (
        <>
          {/* Charts */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <div className="card">
              <div className="flex items-center gap-2 mb-3">
                <BarChart3 size={16} className="text-[var(--text-secondary)]" />
                <h3 className="font-semibold text-[var(--text-primary)]">Daily present vs absent</h3>
              </div>
              <div className="h-[260px]">
                {summary.byDay.length === 0 ? <EmptyChart /> : <Bar data={dayData} options={stackedOpts} />}
              </div>
            </div>
            <div className="card">
              <div className="flex items-center gap-2 mb-3">
                <BarChart3 size={16} className="text-[var(--text-secondary)]" />
                <h3 className="font-semibold text-[var(--text-primary)]">By site</h3>
              </div>
              <div className="h-[260px]">
                {summary.bySite.length === 0 ? <EmptyChart /> : <Bar data={siteData} options={groupedOpts} />}
              </div>
            </div>
          </div>

          {/* By person */}
          <div className="card">
            <div className="flex items-center gap-2 mb-3">
              <Users size={16} className="text-[var(--text-secondary)]" />
              <h3 className="font-semibold text-[var(--text-primary)]">By person</h3>
              <span className="text-[11px] text-[var(--text-muted)]">{summary.byPerson.length} rostered</span>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-[var(--text-muted)] border-b border-[var(--input-border)]">
                    <th className="py-2 pr-3 font-medium">Person</th>
                    <th className="py-2 pr-3 font-medium text-right">Scheduled</th>
                    <th className="py-2 pr-3 font-medium text-right">Present</th>
                    <th className="py-2 pr-3 font-medium text-right">Absent</th>
                    <th className="py-2 pr-3 font-medium text-right">Late</th>
                    <th className="py-2 pr-3 font-medium text-right">Rate</th>
                    <th className="py-2 font-medium">Last seen</th>
                  </tr>
                </thead>
                <tbody>
                  {summary.byPerson.map((p) => {
                    const denom = p.present + p.absent
                    const rate = denom > 0 ? p.present / denom : null
                    return (
                      <tr key={p.person} className="border-b border-[var(--input-border)]/60 hover:bg-[var(--input-bg)]/50">
                        <td className="py-2 pr-3 text-[var(--text-primary)]">{p.person}</td>
                        <td className="py-2 pr-3 text-right text-[var(--text-secondary)]">{fmtNum(p.scheduled)}</td>
                        <td className="py-2 pr-3 text-right text-emerald-300">{fmtNum(p.present)}</td>
                        <td className="py-2 pr-3 text-right text-red-300">{fmtNum(p.absent)}</td>
                        <td className="py-2 pr-3 text-right text-amber-300">{fmtNum(p.late)}</td>
                        <td className="py-2 pr-3 text-right text-[var(--text-secondary)]">{fmtRate(rate)}</td>
                        <td className="py-2 text-[var(--text-secondary)]">{p.lastSeen ? fmtDate(p.lastSeen) : 'N/A'}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </div>

          {/* Detailed attendance / absentee register */}
          <div className="card">
            <div className="flex items-center gap-2 mb-3">
              <CalendarCheck2 size={16} className="text-[var(--text-secondary)]" />
              <h3 className="font-semibold text-[var(--text-primary)]">Attendance register</h3>
              <span className="text-[11px] text-[var(--text-muted)]">{detailRows.length} shifts</span>
              <div className="ml-auto flex items-center gap-2">
                <button onClick={exportExcel} disabled={detailRows.length === 0} className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-lg bg-[var(--input-bg)] border border-[var(--input-border)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] disabled:opacity-50">
                  <FileSpreadsheet size={14} /> Excel
                </button>
                <button onClick={exportPdf} disabled={detailRows.length === 0} className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-lg bg-[var(--input-bg)] border border-[var(--input-border)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] disabled:opacity-50">
                  <FileText size={14} /> PDF
                </button>
              </div>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-[var(--text-muted)] border-b border-[var(--input-border)]">
                    <th className="py-2 pr-3 font-medium">Date</th>
                    <th className="py-2 pr-3 font-medium">Person</th>
                    <th className="py-2 pr-3 font-medium">Site</th>
                    <th className="py-2 pr-3 font-medium">Rostered shift</th>
                    <th className="py-2 pr-3 font-medium">Check in</th>
                    <th className="py-2 font-medium">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {detailRows.slice(0, 500).map((r, i) => (
                    <tr key={`${r.person}-${r.date}-${i}`} className="border-b border-[var(--input-border)]/60 hover:bg-[var(--input-bg)]/50">
                      <td className="py-2 pr-3 text-[var(--text-secondary)]">{fmtDate(r.date)}</td>
                      <td className="py-2 pr-3 text-[var(--text-primary)]">{r.person}</td>
                      <td className="py-2 pr-3 text-[var(--text-secondary)]">{r.site || 'N/A'}</td>
                      <td className="py-2 pr-3 text-[var(--text-secondary)]">{r.rostered}</td>
                      <td className="py-2 pr-3 text-[var(--text-secondary)]">{r.checkIn || 'N/A'}</td>
                      <td className="py-2">
                        <span className={`inline-block text-[11px] px-2 py-0.5 rounded-full border ${STATUS_TONE[r.status] || STATUS_TONE.cancelled}`}>
                          {STATUS_LABEL[r.status] || r.status}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {detailRows.length > 500 && (
                <p className="text-[11px] text-[var(--text-muted)] mt-2">Showing the first 500 of {detailRows.length}. Narrow the filters or export for the full set.</p>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  )
}

function EmptyChart({ hint = 'No data for the selected filters.' }) {
  return (
    <div className="h-full flex flex-col items-center justify-center text-[var(--text-muted)]">
      <CalendarCheck2 size={26} className="opacity-40 mb-2" />
      <p className="text-xs">{hint}</p>
    </div>
  )
}
