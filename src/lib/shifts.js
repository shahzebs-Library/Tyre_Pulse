/**
 * Pure, dependency-free shift-roster analytics. No I/O, no Supabase, no clock
 * reads — the reference "now"/"today" is passed in so the function is fully
 * deterministic and unit-testable. Consumed by the ShiftScheduling page for its
 * KPI tiles; kept isolated from the service layer so it can be exercised in
 * isolation (mirrors lib/batteries.js / lib/tyreAge.js).
 */

/** Canonical status set for a shift, in lifecycle order. */
export const SHIFT_STATUS_VALUES = ['scheduled', 'completed', 'absent', 'cancelled']

/** Coerce a value to a YYYY-MM-DD day string, or null when unparseable. */
function toDayString(value) {
  if (!value) return null
  if (typeof value === 'string') {
    // Already an ISO date (optionally with a time component).
    const m = value.match(/^(\d{4}-\d{2}-\d{2})/)
    if (m) return m[1]
  }
  const d = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(d.getTime())) return null
  return d.toISOString().slice(0, 10)
}

/**
 * Summarise a set of shift rows for the roster KPIs.
 *
 * @param {Array<object>} rows       shift records (from listShifts)
 * @param {Date|number|string} [now] reference clock for "today" (default: now)
 * @returns {{
 *   total: number,
 *   byStatus: { scheduled: number, completed: number, absent: number, cancelled: number },
 *   scheduledToday: number,
 *   distinctPeople: number,
 * }}
 */
export function summarizeShifts(rows = [], now = new Date()) {
  const list = Array.isArray(rows) ? rows : []
  const byStatus = { scheduled: 0, completed: 0, absent: 0, cancelled: 0 }
  const today = toDayString(now)
  const people = new Set()
  let scheduledToday = 0

  for (const r of list) {
    const status = r?.status
    if (byStatus[status] != null) byStatus[status] += 1

    const name = typeof r?.person_name === 'string' ? r.person_name.trim() : ''
    if (name) people.add(name.toLowerCase())

    if (status === 'scheduled' && today && toDayString(r?.shift_date) === today) {
      scheduledToday += 1
    }
  }

  return {
    total: list.length,
    byStatus,
    scheduledToday,
    distinctPeople: people.size,
  }
}
