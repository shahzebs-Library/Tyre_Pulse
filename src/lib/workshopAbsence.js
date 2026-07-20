/**
 * workshopAbsence.js - pure, deterministic attendance / absence analytics for the
 * workshop. No I/O; `now` is injectable so every classification is fully testable
 * and never reads Date.now() implicitly.
 *
 * Model (evidence-based, no fabrication):
 *   - The ROSTER is the `shifts` table: who was scheduled, on which shift_date, at
 *     which site, with a start_time.
 *   - The EVIDENCE is `workshop_attendance`: a check_in / check_out log. An
 *     attendance row is linked to a roster shift by shift_id, or (fallback) by the
 *     same person on the same date.
 *
 * A rostered shift is classified against the evidence:
 *   - check_in present, on time                -> 'present'
 *   - check_in present, after start_time       -> 'late'
 *   - no check_in, and the shift start is in
 *     the past (or today and already started)  -> 'absent'
 *   - no check_in, but the shift is in the
 *     future (or today, not yet started)       -> 'scheduled'
 *   - roster status cancelled                  -> 'cancelled'
 *
 * Absence is therefore only ever asserted for a ROSTERED shift whose start has
 * passed with no check-in - never inferred from silence on a non-rostered day.
 *
 * Summary buckets:
 *   - present = attended (checked in), which INCLUDES late arrivals (they showed up)
 *   - late    = the subset of the attended who arrived after start_time
 *   - absent  = rostered, start passed, no check-in
 *   - onLeave = rostered shifts whose status is a leave token (not counted absent)
 *   - attendanceRate = present / (present + absent), or null when that denom is 0
 */

const MONTHS_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/** Roster status tokens that mean an approved absence (not counted as absent). */
export const LEAVE_STATUSES = new Set([
  'leave', 'on_leave', 'on leave', 'annual_leave', 'annual leave',
  'sick', 'sick_leave', 'sick leave',
])

// ── small pure helpers ──────────────────────────────────────────────────────

/** First 10 chars of a date-ish value (YYYY-MM-DD), or '' when absent. */
export function dateOf(v) {
  if (!v) return ''
  return String(v).slice(0, 10)
}

/** Normalise a person name into a stable match key (lower, single-spaced). */
export function personKey(name) {
  if (name == null) return ''
  return String(name).trim().toLowerCase().replace(/\s+/g, ' ')
}

/**
 * Minutes-since-midnight for a clock string ('HH:MM' or 'HH:MM:SS'), or null.
 * Used for both roster start_time and the time-of-day of a check_in.
 */
export function clockMinutes(v) {
  if (v == null) return null
  const s = String(v)
  const m = s.match(/(\d{1,2}):(\d{2})/)
  if (!m) return null
  const h = Number(m[1])
  const min = Number(m[2])
  if (!Number.isFinite(h) || !Number.isFinite(min)) return null
  return h * 60 + min
}

/**
 * Time-of-day minutes for a check_in value. Prefers the clock portion of an ISO
 * timestamp (after 'T', else after a space) so the result is deterministic and
 * independent of the runtime timezone; falls back to Date parsing.
 */
export function checkInMinutes(checkIn) {
  if (!checkIn) return null
  const s = String(checkIn)
  const idx = s.indexOf('T') >= 0 ? s.indexOf('T') : s.indexOf(' ')
  if (idx >= 0) {
    const mins = clockMinutes(s.slice(idx + 1))
    if (mins != null) return mins
  }
  const d = new Date(s)
  if (!Number.isNaN(d.getTime())) return d.getHours() * 60 + d.getMinutes()
  return null
}

function isLeaveStatus(status) {
  if (status == null) return false
  return LEAVE_STATUSES.has(String(status).trim().toLowerCase())
}

// ── attendance indexing ─────────────────────────────────────────────────────

/**
 * Build lookup indexes over attendance rows so a shift can find its evidence in
 * O(1). Matching is primary by shift_id, fallback by person + date.
 *
 * Attendance rows may carry a resolved `person_name` (the page enriches them from
 * the profiles/staff map, since the raw row only has user_id). When present it is
 * used for the person+date fallback.
 *
 * @param {object[]} attendance
 * @returns {{ byShift:Map, byPersonDate:Map }}
 */
export function indexAttendance(attendance) {
  const byShift = new Map()
  const byPersonDate = new Map()
  for (const a of Array.isArray(attendance) ? attendance : []) {
    if (!a) continue
    if (a.shift_id != null && a.shift_id !== '') {
      const key = String(a.shift_id)
      // Prefer a row that actually has a check_in.
      const cur = byShift.get(key)
      if (!cur || (!cur.check_in && a.check_in)) byShift.set(key, a)
    }
    const pk = personKey(a.person_name)
    const d = dateOf(a.check_in) || dateOf(a.shift_date) || dateOf(a.created_at)
    if (pk && d) {
      const key = `${pk}|${d}`
      const cur = byPersonDate.get(key)
      if (!cur || (!cur.check_in && a.check_in)) byPersonDate.set(key, a)
    }
  }
  return { byShift, byPersonDate }
}

/**
 * Find the attendance row that belongs to a roster shift (or null).
 * @param {object} shift
 * @param {{byShift:Map, byPersonDate:Map}} index
 */
export function attendanceForShift(shift, index) {
  if (!shift || !index) return null
  if (shift.id != null && index.byShift.has(String(shift.id))) {
    return index.byShift.get(String(shift.id))
  }
  const pk = personKey(shift.person_name)
  const d = dateOf(shift.shift_date)
  if (pk && d) {
    const hit = index.byPersonDate.get(`${pk}|${d}`)
    if (hit) return hit
  }
  return null
}

// ── classification ──────────────────────────────────────────────────────────

/**
 * Classify a single rostered shift against its attendance evidence.
 * @param {object} shift roster row (person_name, shift_date, start_time, status)
 * @param {object|null} attendanceForPersonDate the matched attendance row, or null
 * @param {{now?: Date}} [opts]
 * @returns {'present'|'late'|'absent'|'scheduled'|'cancelled'}
 */
export function classifyShift(shift, attendanceForPersonDate, { now = new Date() } = {}) {
  if (!shift) return 'scheduled'
  const status = shift.status != null ? String(shift.status).trim().toLowerCase() : ''
  if (status === 'cancelled') return 'cancelled'

  const att = attendanceForPersonDate
  const hasCheckIn = !!(att && att.check_in)

  if (hasCheckIn) {
    const startMin = clockMinutes(shift.start_time)
    const inMin = checkInMinutes(att.check_in)
    if (startMin != null && inMin != null && inMin > startMin) return 'late'
    return 'present'
  }

  // No check-in. Explicit roster 'absent' marking is trusted evidence.
  if (status === 'absent') return 'absent'

  const anchor = now instanceof Date && !Number.isNaN(now.getTime()) ? now : new Date()
  const shiftDate = dateOf(shift.shift_date)
  const todayStr = dateOf(anchor.toISOString())

  if (!shiftDate) return 'scheduled' // undated roster row: cannot assert absence
  if (shiftDate > todayStr) return 'scheduled' // future shift, not yet due
  if (shiftDate < todayStr) return 'absent' // past shift, never showed

  // Today: absent only once the shift start has passed.
  const startMin = clockMinutes(shift.start_time)
  if (startMin == null) return 'scheduled' // cannot prove it started yet
  const nowMin = anchor.getUTCHours() * 60 + anchor.getUTCMinutes()
  return nowMin >= startMin ? 'absent' : 'scheduled'
}

// ── bucketing helpers ───────────────────────────────────────────────────────

/**
 * Bucket classified shifts by day: [{ date, present, absent, late }] ascending.
 * @param {{shift:object, cls:string}[]} classified
 */
export function bucketByDay(classified) {
  const map = new Map()
  for (const { shift, cls } of classified) {
    const date = dateOf(shift.shift_date)
    if (!date) continue
    const b = map.get(date) || { date, present: 0, absent: 0, late: 0 }
    if (cls === 'present' || cls === 'late') b.present += 1
    if (cls === 'late') b.late += 1
    if (cls === 'absent') b.absent += 1
    map.set(date, b)
  }
  return [...map.values()].sort((a, b) => a.date.localeCompare(b.date))
}

/**
 * Bucket classified shifts by site: [{ site, present, absent }] by absent desc.
 */
export function bucketBySite(classified) {
  const map = new Map()
  for (const { shift, cls } of classified) {
    const raw = shift.site
    const site = raw == null || String(raw).trim() === '' ? 'Unspecified' : String(raw).trim()
    const b = map.get(site) || { site, present: 0, absent: 0 }
    if (cls === 'present' || cls === 'late') b.present += 1
    if (cls === 'absent') b.absent += 1
    map.set(site, b)
  }
  return [...map.values()].sort(
    (a, b) => b.absent - a.absent || b.present - a.present || a.site.localeCompare(b.site),
  )
}

/**
 * Bucket classified shifts by person:
 *   [{ person, scheduled, present, absent, late, lastSeen }] by absent desc.
 * scheduled = total rostered shifts for that person in range (all statuses except
 * cancelled). present includes late. lastSeen = latest matched check_in date.
 */
export function bucketByPerson(classified) {
  const map = new Map()
  for (const { shift, cls, att } of classified) {
    const raw = shift.person_name
    const person = raw == null || String(raw).trim() === '' ? 'Unknown' : String(raw).trim()
    const b = map.get(person) || { person, scheduled: 0, present: 0, absent: 0, late: 0, lastSeen: null }
    if (cls !== 'cancelled') b.scheduled += 1
    if (cls === 'present' || cls === 'late') b.present += 1
    if (cls === 'late') b.late += 1
    if (cls === 'absent') b.absent += 1
    const seen = att && att.check_in ? dateOf(att.check_in) : ''
    if (seen && (!b.lastSeen || seen > b.lastSeen)) b.lastSeen = seen
    map.set(person, b)
  }
  return [...map.values()].sort(
    (a, b) => b.absent - a.absent || b.scheduled - a.scheduled || a.person.localeCompare(b.person),
  )
}

/**
 * Filter roster shifts to an inclusive [from, to] date window by shift_date.
 * Blank bounds are ignored. Rows with a blank shift_date are dropped only when a
 * bound is set.
 */
export function filterShiftsByRange(shifts, { from, to } = {}) {
  if (!Array.isArray(shifts)) return []
  const hasFrom = from && String(from).trim() !== ''
  const hasTo = to && String(to).trim() !== ''
  if (!hasFrom && !hasTo) return shifts.filter(Boolean)
  const lo = hasFrom ? String(from).slice(0, 10) : null
  const hi = hasTo ? String(to).slice(0, 10) : null
  return shifts.filter((s) => {
    if (!s) return false
    const d = dateOf(s.shift_date)
    if (!d) return false
    if (lo && d < lo) return false
    if (hi && d > hi) return false
    return true
  })
}

// ── top-level summary ───────────────────────────────────────────────────────

/**
 * Summarise attendance for a roster + evidence set over a date range.
 *
 * @param {{ shifts?:object[], attendance?:object[], from?:string, to?:string, now?:Date }} args
 * @returns {{
 *   present:number, absent:number, late:number, onLeave:number,
 *   scheduled:number, cancelled:number, rostered:number,
 *   attendanceRate:(number|null),
 *   byDay:{date:string,present:number,absent:number,late:number}[],
 *   bySite:{site:string,present:number,absent:number}[],
 *   byPerson:{person:string,scheduled:number,present:number,absent:number,late:number,lastSeen:(string|null)}[],
 *   detail:{shift:object, cls:string, att:(object|null)}[]
 * }}
 */
export function summarizeAttendance({ shifts, attendance, from, to, now = new Date() } = {}) {
  const inRange = filterShiftsByRange(shifts, { from, to })
  const index = indexAttendance(attendance)

  let present = 0
  let absent = 0
  let late = 0
  let onLeave = 0
  let scheduled = 0
  let cancelled = 0

  const classified = []
  for (const shift of inRange) {
    if (isLeaveStatus(shift.status)) {
      onLeave += 1
      // Leave still appears in the roster detail as a non-absent row.
      classified.push({ shift, cls: 'leave', att: null })
      continue
    }
    const att = attendanceForShift(shift, index)
    const cls = classifyShift(shift, att, { now })
    classified.push({ shift, cls, att })
    if (cls === 'present' || cls === 'late') present += 1
    if (cls === 'late') late += 1
    if (cls === 'absent') absent += 1
    if (cls === 'scheduled') scheduled += 1
    if (cls === 'cancelled') cancelled += 1
  }

  const denom = present + absent
  const attendanceRate = denom > 0 ? present / denom : null

  // byDay / bySite exclude leave rows (no attendance signal); byPerson includes
  // them so a person's rostered count is complete.
  const nonLeave = classified.filter((c) => c.cls !== 'leave')

  return {
    present,
    absent,
    late,
    onLeave,
    scheduled,
    cancelled,
    rostered: inRange.length,
    attendanceRate,
    byDay: bucketByDay(nonLeave),
    bySite: bucketBySite(nonLeave),
    byPerson: bucketByPerson(classified),
    detail: classified,
  }
}
