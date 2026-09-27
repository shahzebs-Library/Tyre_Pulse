/**
 * Shift Scheduling analytics (pure, no I/O) behind /shifts.
 *
 * Builds on src/lib/shifts.js (the canonical status set). Adds per-shift
 * enrichment (rostered hours from start/end with overnight handling, timing
 * relative to today, and a "not closed out" flag for a past shift still marked
 * scheduled), filters, the KPI strip, a 14-day coverage series, hours by role
 * and export rows.
 *
 * Honesty: a shift with no start or end time has no duration (null), not zero
 * hours. The absence rate is null until at least one shift has been closed out
 * as completed or absent. `now` is injectable so "today" is deterministic.
 */
import { SHIFT_STATUS_VALUES } from './shifts'

export { SHIFT_STATUS_VALUES }
export const SHIFT_STATUS_LABEL = { scheduled: 'Scheduled', completed: 'Completed', absent: 'Absent', cancelled: 'Cancelled' }
export const TIMING_KEYS = ['today', 'upcoming', 'past', 'undated']
export const TIMING_LABEL = { today: 'Today', upcoming: 'Upcoming', past: 'Past', undated: 'No date' }
export const EMPTY_SHIFT_FILTERS = { search: '', status: 'all', role: '', site: '', timing: 'all', from: '', to: '', openPastOnly: false }

const str = (v) => (v == null ? '' : String(v).trim())
const round1 = (n) => Math.round(n * 10) / 10
const pct = (num, den) => (den > 0 ? round1((num / den) * 100) : null)

/** Local YYYY-MM-DD for a Date / epoch ms. */
export function dayKey(now = new Date()) {
  const d = now instanceof Date ? now : new Date(now)
  if (Number.isNaN(d.getTime())) return ''
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${d.getFullYear()}-${m}-${day}`
}

function shiftDay(v) {
  const m = str(v).match(/^(\d{4}-\d{2}-\d{2})/)
  return m ? m[1] : ''
}

function minutesOf(t) {
  const m = str(t).match(/^(\d{1,2}):(\d{2})/)
  if (!m) return null
  const h = Number(m[1])
  const mi = Number(m[2])
  if (h > 24 || mi > 59) return null
  return h * 60 + mi
}

/** Rostered hours for a start/end pair; an end before the start runs past midnight. */
export function shiftHours(start, end) {
  const a = minutesOf(start)
  const b = minutesOf(end)
  if (a == null || b == null) return null
  let diff = b - a
  if (diff <= 0) diff += 24 * 60
  return round1(diff / 60)
}

export function statusLabel(s) {
  return SHIFT_STATUS_LABEL[s] || (str(s) || 'N/A')
}

export function enrichShift(r = {}, now = new Date()) {
  const today = dayKey(now)
  const day = shiftDay(r.shift_date)
  const timing = !day ? 'undated' : day === today ? 'today' : day > today ? 'upcoming' : 'past'
  return {
    ...r,
    _day: day,
    _hours: shiftHours(r.start_time, r.end_time),
    _timing: timing,
    _openPast: r.status === 'scheduled' && timing === 'past',
    _statusLabel: statusLabel(r.status),
  }
}

export function enrichShifts(rows = [], now = new Date()) {
  return (Array.isArray(rows) ? rows : []).map((r) => enrichShift(r, now))
}

const optionsOf = (rows, key) => [...new Set((Array.isArray(rows) ? rows : []).map((r) => str(r?.[key])).filter(Boolean))].sort()
export const roleOptions = (rows) => optionsOf(rows, 'role')
export const siteOptions = (rows) => optionsOf(rows, 'site')

export function activeShiftFilterCount(f = EMPTY_SHIFT_FILTERS) {
  let n = ['search', 'role', 'site', 'from', 'to'].filter((k) => str(f[k])).length
  if (f.status && f.status !== 'all') n++
  if (f.timing && f.timing !== 'all') n++
  if (f.openPastOnly) n++
  return n
}

export function filterShifts(enriched = [], f = EMPTY_SHIFT_FILTERS) {
  const q = str(f.search).toLowerCase()
  return (Array.isArray(enriched) ? enriched : []).filter((r) => {
    if (f.status && f.status !== 'all' && r.status !== f.status) return false
    if (f.role && str(r.role) !== f.role) return false
    if (f.site && str(r.site) !== f.site) return false
    if (f.timing && f.timing !== 'all' && r._timing !== f.timing) return false
    if (f.from && (!r._day || r._day < f.from)) return false
    if (f.to && (!r._day || r._day > f.to)) return false
    if (f.openPastOnly && !r._openPast) return false
    if (q) {
      const hay = `${r.person_name || ''} ${r.role || ''} ${r.site || ''} ${r.notes || ''}`.toLowerCase()
      if (!hay.includes(q)) return false
    }
    return true
  })
}

export function shiftKpis(enriched = []) {
  const list = Array.isArray(enriched) ? enriched : []
  const byStatus = Object.fromEntries(SHIFT_STATUS_VALUES.map((s) => [s, 0]))
  const people = new Set()
  let today = 0
  let upcoming = 0
  let openPast = 0
  let hours = 0
  let timed = 0
  for (const r of list) {
    if (byStatus[r.status] != null) byStatus[r.status] += 1
    const name = str(r.person_name).toLowerCase()
    if (name) people.add(name)
    if (r.status === 'scheduled' && r._timing === 'today') today += 1
    if (r.status === 'scheduled' && r._timing === 'upcoming') upcoming += 1
    if (r._openPast) openPast += 1
    if (r.status !== 'cancelled' && r._hours != null) { hours += r._hours; timed += 1 }
  }
  const closed = byStatus.completed + byStatus.absent
  return {
    total: list.length,
    byStatus,
    people: people.size,
    today,
    upcoming,
    openPast,
    rosteredHours: timed ? round1(hours) : null,
    timedShifts: timed,
    absenceRate: pct(byStatus.absent, closed),
    attendanceRate: pct(byStatus.completed, closed),
  }
}

/** Non-cancelled shifts per day for the next `days` days starting today. */
export function coverageNextDays(enriched = [], now = new Date(), days = 14) {
  const start = now instanceof Date ? new Date(now.getTime()) : new Date(now)
  const out = []
  for (let i = 0; i < days; i++) {
    const d = new Date(start.getFullYear(), start.getMonth(), start.getDate() + i)
    out.push({ day: dayKey(d), shifts: 0 })
  }
  const idx = new Map(out.map((o, i) => [o.day, i]))
  for (const r of Array.isArray(enriched) ? enriched : []) {
    if (r.status === 'cancelled') continue
    const i = idx.get(r._day)
    if (i != null) out[i].shifts += 1
  }
  return out
}

/** Rostered hours by role (non-cancelled, timed shifts), largest first. */
export function hoursByRole(enriched = [], limit = 8) {
  const m = new Map()
  for (const r of Array.isArray(enriched) ? enriched : []) {
    if (r.status === 'cancelled' || r._hours == null) continue
    const role = str(r.role) || 'No role'
    m.set(role, (m.get(role) || 0) + r._hours)
  }
  return [...m.entries()].map(([role, hours]) => ({ role, hours: round1(hours) }))
    .sort((a, b) => b.hours - a.hours || a.role.localeCompare(b.role))
    .slice(0, limit)
}

export const SHIFT_EXPORT_COLUMNS = [
  ['person_name', 'Person'], ['role', 'Role'], ['shift_date', 'Date'], ['start_time', 'Start'],
  ['end_time', 'End'], ['hours', 'Hours'], ['site', 'Site'], ['status', 'Status'],
  ['timing', 'Timing'], ['not_closed', 'Past, not closed out'], ['notes', 'Notes'],
]

export function shiftExportRows(enriched = []) {
  return (Array.isArray(enriched) ? enriched : []).map((r) => ({
    person_name: r.person_name || '',
    role: r.role || '',
    shift_date: r.shift_date || '',
    start_time: r.start_time || '',
    end_time: r.end_time || '',
    hours: r._hours == null ? 'N/A' : r._hours,
    site: r.site || '',
    status: r._statusLabel,
    timing: TIMING_LABEL[r._timing] || '',
    not_closed: r._openPast ? 'Yes' : 'No',
    notes: r.notes || '',
  }))
}
