/**
 * Action Center — pure, dependency-free domain logic for the Action Center /
 * Exception Dashboard module (/action-center). Turns a raw set of action_items
 * rows into a prioritised triage queue and a fleet-level exception summary.
 *
 * Everything here is deterministic: no Supabase, no React, no `Date.now()` read
 * internally. The "current time" is always injected (`nowMs`) so ranking,
 * overdue detection, and summaries are fully reproducible and unit-testable. The
 * service (`src/lib/api/actionCenter.js`) and page (`src/pages/ActionCenter.jsx`)
 * both build on these primitives so the prioritisation logic lives in exactly
 * one place.
 */

/** Severity → numeric weight. Higher = more urgent. Unknown/blank → 0. */
export const SEVERITY_WEIGHT = Object.freeze({
  critical: 100,
  high: 70,
  medium: 40,
  low: 20,
  info: 5,
})

/** Statuses that represent an item still needing attention (not closed). */
export const OPEN_STATUSES = Object.freeze(['open', 'acknowledged', 'in_progress'])

/** Statuses that represent a closed item (no longer actionable). */
export const CLOSED_STATUSES = Object.freeze(['resolved', 'dismissed'])

const DAY_MS = 86_400_000

/** Parse a value to a finite number, or null when it isn't numeric. */
export function toFiniteNumber(v) {
  if (v === '' || v == null) return null
  const n = typeof v === 'number' ? v : parseFloat(String(v).replace(/[^0-9.\-]/g, ''))
  return Number.isFinite(n) ? n : null
}

/** Normalise a status/severity/category token to a lowercase trimmed string. */
function token(v) {
  return v == null ? '' : String(v).trim().toLowerCase()
}

/** True when the item's status counts as "open" (still needs attention). */
export function isOpen(item) {
  return OPEN_STATUSES.includes(token(item?.status))
}

/** True when the item's status counts as "closed" (resolved/dismissed). */
export function isClosed(item) {
  return CLOSED_STATUSES.includes(token(item?.status))
}

/** Epoch-ms for a due date, or null when absent/unparseable. */
function dueMs(item) {
  const d = item?.due_date
  if (!d) return null
  const t = new Date(`${String(d).slice(0, 10)}T00:00:00Z`).getTime()
  return Number.isNaN(t) ? null : t
}

/**
 * True when an item is overdue: it has a due date in the past AND it is not
 * closed (a resolved/dismissed item is never "overdue"). `nowMs` is injected so
 * this is deterministic.
 *
 * @param {object} item
 * @param {number} nowMs  current time, epoch milliseconds
 * @returns {boolean}
 */
export function isOverdue(item, nowMs) {
  if (!item || isClosed(item)) return false
  const due = dueMs(item)
  if (due == null) return false
  return due < Number(nowMs)
}

/**
 * How many whole days overdue an item is (0 when not overdue). Injected `nowMs`.
 * @param {object} item
 * @param {number} nowMs
 * @returns {number}
 */
export function daysOverdue(item, nowMs) {
  if (!isOverdue(item, nowMs)) return 0
  const due = dueMs(item)
  return Math.floor((Number(nowMs) - due) / DAY_MS)
}

/**
 * Blend an item's signals into a single sortable urgency score (higher = more
 * urgent). Deterministic given `nowMs`. Components:
 *   • severity weight        (0–100)  — the dominant signal
 *   • priority_score          (clamped 0–100, added directly) — analyst/source override
 *   • overdue pressure        (up to +80, scaled by days late, capped) — time decay
 *   • closed penalty         (−1000)  — resolved/dismissed sink to the bottom
 *
 * @param {object} item
 * @param {number} nowMs
 * @returns {number}
 */
export function rankScore(item, nowMs) {
  if (!item) return 0
  const sev = SEVERITY_WEIGHT[token(item.severity)] || 0

  const rawPriority = toFiniteNumber(item.priority_score)
  const priority = rawPriority == null ? 0 : Math.max(0, Math.min(100, rawPriority))

  let overdue = 0
  if (isOverdue(item, nowMs)) {
    const late = daysOverdue(item, nowMs)
    // 20-point base the moment it tips overdue, +2/day, capped at 80.
    overdue = Math.min(80, 20 + late * 2)
  }

  const closedPenalty = isClosed(item) ? 1000 : 0

  return sev + priority + overdue - closedPenalty
}

/**
 * Return a new array of rows sorted by rankScore descending (worst / most
 * urgent first). Stable tiebreak by due date (sooner first), then created_at
 * (older first) so ordering is deterministic. Injected `nowMs`.
 *
 * @param {Array<object>} rows
 * @param {number} nowMs
 * @returns {Array<object>}
 */
export function prioritise(rows = [], nowMs) {
  const list = Array.isArray(rows) ? rows.slice() : []
  const scoreOf = new Map()
  const idxOf = new Map()
  list.forEach((r, i) => {
    scoreOf.set(r, rankScore(r, nowMs))
    idxOf.set(r, i)
  })
  return list.sort((a, b) => {
    const s = scoreOf.get(b) - scoreOf.get(a)
    if (s !== 0) return s
    const da = dueMs(a)
    const db = dueMs(b)
    if (da != null && db != null && da !== db) return da - db
    if (da != null && db == null) return -1
    if (da == null && db != null) return 1
    const ca = new Date(a?.created_at || 0).getTime() || 0
    const cb = new Date(b?.created_at || 0).getTime() || 0
    if (ca !== cb) return ca - cb
    return idxOf.get(a) - idxOf.get(b)
  })
}

/**
 * Fleet-level exception summary for the KPI header.
 *   • totalItems        — number of rows
 *   • openCount         — items in an open status
 *   • criticalOpenCount — open items with critical severity
 *   • overdueCount      — open items past their due date
 *   • resolvedCount     — items with status 'resolved'
 *   • resolutionRate    — resolved / total, as a 0–100 integer percentage
 *
 * @param {Array<object>} rows
 * @param {number} nowMs
 * @returns {{ totalItems:number, openCount:number, criticalOpenCount:number,
 *             overdueCount:number, resolvedCount:number, resolutionRate:number }}
 */
export function summariseActions(rows = [], nowMs) {
  const list = Array.isArray(rows) ? rows : []
  let openCount = 0
  let criticalOpenCount = 0
  let overdueCount = 0
  let resolvedCount = 0

  for (const r of list) {
    const open = isOpen(r)
    if (open) {
      openCount++
      if (token(r?.severity) === 'critical') criticalOpenCount++
      if (isOverdue(r, nowMs)) overdueCount++
    }
    if (token(r?.status) === 'resolved') resolvedCount++
  }

  const totalItems = list.length
  const resolutionRate = totalItems > 0 ? Math.round((resolvedCount / totalItems) * 100) : 0

  return { totalItems, openCount, criticalOpenCount, overdueCount, resolvedCount, resolutionRate }
}

/**
 * Group rows by category → { category, open, total } sorted by open desc (then
 * total desc, then category asc). Rows with no category fall under 'other'.
 *
 * @param {Array<object>} rows
 * @returns {Array<{ category:string, open:number, total:number }>}
 */
export function byCategory(rows = []) {
  const list = Array.isArray(rows) ? rows : []
  const map = new Map()
  for (const r of list) {
    const cat = token(r?.category) || 'other'
    const entry = map.get(cat) || { category: cat, open: 0, total: 0 }
    entry.total++
    if (isOpen(r)) entry.open++
    map.set(cat, entry)
  }
  return [...map.values()].sort(
    (a, b) => b.open - a.open || b.total - a.total || a.category.localeCompare(b.category),
  )
}

/**
 * Count items per severity bucket. Always returns all five known keys (info,
 * low, medium, high, critical) so the distribution strip renders a complete
 * scale even when some buckets are empty. Unknown severities are ignored.
 *
 * @param {Array<object>} rows
 * @returns {{ info:number, low:number, medium:number, high:number, critical:number }}
 */
export function bySeverity(rows = []) {
  const list = Array.isArray(rows) ? rows : []
  const counts = { info: 0, low: 0, medium: 0, high: 0, critical: 0 }
  for (const r of list) {
    const s = token(r?.severity)
    if (s in counts) counts[s]++
  }
  return counts
}
