/**
 * PM Programs — pure helpers (no I/O) for the Preventive Maintenance module.
 *
 * Derives a due band (overdue / due-soon / scheduled) from a program's
 * next_due date and rolls a list of programs up into counts by status plus
 * overdue / due-soon totals. A program that is not 'active' never contributes
 * to the overdue / due-soon signals (a paused or completed program isn't due).
 *
 * Every function takes an injected `now` (ms or Date) so results are fully
 * deterministic and unit-testable — the module never reads Date.now() itself.
 */

// A program is "due soon" within this many days of its next_due date.
export const DUE_SOON_DAYS = 14

export const PM_STATUSES = ['active', 'paused', 'completed']
export const PM_INTERVAL_TYPES = ['km', 'hours', 'days', 'months']

export const PM_STATUS_META = {
  active: { label: 'Active', tone: 'green' },
  paused: { label: 'Paused', tone: 'amber' },
  completed: { label: 'Completed', tone: 'slate' },
}

export const PM_DUE_META = {
  overdue: { label: 'Overdue', tone: 'red' },
  due_soon: { label: 'Due soon', tone: 'amber' },
  scheduled: { label: 'Scheduled', tone: 'green' },
  none: { label: 'No date', tone: 'slate' },
}

/** Parse a date-ish value to a Date, or null when unusable. */
function toDate(value) {
  if (!value) return null
  const d = value instanceof Date ? value : new Date(value)
  return Number.isNaN(d.getTime()) ? null : d
}

/**
 * Whole days from `now` until the program's next_due date. Negative when the
 * due date is already in the past, null when there is no usable next_due.
 * Compared on the UTC calendar-day boundary so "today" is 0, not a fraction.
 */
export function daysToDue(program, now) {
  const due = toDate(program?.next_due)
  if (!due) return null
  const ref = toDate(now)
  if (!ref) return null
  const MS = 24 * 3600 * 1000
  const a = Date.UTC(due.getUTCFullYear(), due.getUTCMonth(), due.getUTCDate())
  const b = Date.UTC(ref.getUTCFullYear(), ref.getUTCMonth(), ref.getUTCDate())
  return Math.round((a - b) / MS)
}

/**
 * Derive the due band of a program as of `now`:
 *   - 'none'      when there is no next_due date on file.
 *   - 'overdue'   when next_due is in the past (days < 0).
 *   - 'due_soon'  when next_due is within DUE_SOON_DAYS (0..14 inclusive).
 *   - 'scheduled' otherwise (further out than the due-soon window).
 */
export function pmDueStatus(program, now) {
  const days = daysToDue(program, now)
  if (days == null) return 'none'
  if (days < 0) return 'overdue'
  if (days <= DUE_SOON_DAYS) return 'due_soon'
  return 'scheduled'
}

/**
 * Roll a list of programs up into { total, byStatus, overdue, dueSoon,
 * dueList }. Counts by lifecycle status come straight from the stored status.
 * The overdue / dueSoon signals only consider ACTIVE programs — a paused or
 * completed program is never "due". `dueList` carries the active overdue +
 * due-soon programs, soonest first, each with a derived `dueStatus` and
 * `daysToDue`.
 */
export function summarizePmPrograms(rows = [], now) {
  const list = Array.isArray(rows) ? rows : []
  const byStatus = { active: 0, paused: 0, completed: 0 }
  const dueList = []
  let overdue = 0
  let dueSoon = 0

  for (const r of list) {
    if (byStatus[r?.status] != null) byStatus[r.status] += 1
    if (r?.status !== 'active') continue
    const dueStatus = pmDueStatus(r, now)
    if (dueStatus === 'overdue') overdue += 1
    else if (dueStatus === 'due_soon') dueSoon += 1
    if (dueStatus === 'overdue' || dueStatus === 'due_soon') {
      dueList.push({ ...r, dueStatus, daysToDue: daysToDue(r, now) })
    }
  }

  dueList.sort((a, b) => {
    const da = a.daysToDue == null ? Infinity : a.daysToDue
    const db = b.daysToDue == null ? Infinity : b.daysToDue
    return da - db
  })

  return {
    total: list.length,
    byStatus,
    overdue,
    dueSoon,
    dueList,
  }
}
