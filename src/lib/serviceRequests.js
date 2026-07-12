/**
 * Service Requests — pure, dependency-free domain logic for the Service Requests
 * module (/service-requests). Reduces a set of service-request tickets into the
 * KPI summary, status breakdown, and category distribution the page renders.
 *
 * Keeping this here (no Supabase, no React) makes it deterministic and
 * unit-tested; the service (`src/lib/api/serviceRequests.js`) and page
 * (`src/pages/ServiceRequests.jsx`) both build on these primitives so the
 * roll-up logic lives in exactly one place.
 */

/** Statuses that mean the request is no longer open/active. */
export const CLOSED_STATUSES = ['resolved', 'closed', 'cancelled']

/** Parse a value to a finite number, or null when it isn't numeric. */
export function toFiniteNumber(v) {
  if (v === '' || v == null) return null
  const n = typeof v === 'number' ? v : parseFloat(String(v).replace(/[^0-9.\-]/g, ''))
  return Number.isFinite(n) ? n : null
}

/**
 * Hours elapsed between a request's `requested_at` and `resolved_at`. Returns
 * null when either timestamp is missing/invalid or the interval is negative
 * (bad data — resolved before requested). Rounded to two decimals.
 *
 * @param {object} req
 * @returns {number|null}
 */
export function resolutionHours(req) {
  const start = req?.requested_at
  const end = req?.resolved_at
  if (!start || !end) return null
  const ts = new Date(start).getTime()
  const te = new Date(end).getTime()
  if (Number.isNaN(ts) || Number.isNaN(te)) return null
  const hours = (te - ts) / 3_600_000
  if (!Number.isFinite(hours) || hours < 0) return null
  return Math.round(hours * 100) / 100
}

/** True when a request's status counts as open (not resolved/closed/cancelled). */
function isOpen(req) {
  const s = req?.status != null ? String(req.status).trim().toLowerCase() : ''
  return !CLOSED_STATUSES.includes(s)
}

/**
 * Summarise a set of requests for the KPI header:
 *   • totalRequests      — number of rows
 *   • openCount          — rows whose status is not resolved/closed/cancelled
 *   • urgentOpenCount    — open rows with priority 'urgent'
 *   • resolvedCount      — rows with status 'resolved' or 'closed'
 *   • avgResolutionHours — mean resolutionHours across rows that have one, or null
 *
 * @param {Array<object>} rows
 * @returns {{ totalRequests:number, openCount:number, urgentOpenCount:number,
 *             resolvedCount:number, avgResolutionHours:number|null }}
 */
export function summariseRequests(rows = []) {
  const list = Array.isArray(rows) ? rows : []
  let openCount = 0
  let urgentOpenCount = 0
  let resolvedCount = 0
  let hoursSum = 0
  let hoursCount = 0

  for (const r of list) {
    const status = r?.status != null ? String(r.status).trim().toLowerCase() : ''
    const open = isOpen(r)
    if (open) {
      openCount += 1
      const priority = r?.priority != null ? String(r.priority).trim().toLowerCase() : ''
      if (priority === 'urgent') urgentOpenCount += 1
    }
    if (status === 'resolved' || status === 'closed') resolvedCount += 1

    const h = resolutionHours(r)
    if (h != null) { hoursSum += h; hoursCount += 1 }
  }

  return {
    totalRequests: list.length,
    openCount,
    urgentOpenCount,
    resolvedCount,
    avgResolutionHours: hoursCount ? Math.round((hoursSum / hoursCount) * 100) / 100 : null,
  }
}

/**
 * Count of requests per status. Returns a plain object keyed by the (lowercased,
 * trimmed) status string; rows with a blank/missing status are ignored.
 *
 * @param {Array<object>} rows
 * @returns {Record<string, number>}
 */
export function byStatus(rows = []) {
  const list = Array.isArray(rows) ? rows : []
  const out = {}
  for (const r of list) {
    const s = r?.status != null ? String(r.status).trim().toLowerCase() : ''
    if (!s) continue
    out[s] = (out[s] || 0) + 1
  }
  return out
}

/**
 * Distribution of requests by category, sorted by count descending (ties broken
 * alphabetically for determinism). Rows with a blank/missing category are
 * ignored. Returns an array of { category, count }.
 *
 * @param {Array<object>} rows
 * @returns {Array<{ category:string, count:number }>}
 */
export function byCategory(rows = []) {
  const list = Array.isArray(rows) ? rows : []
  const m = new Map()
  for (const r of list) {
    const c = r?.category != null ? String(r.category).trim().toLowerCase() : ''
    if (!c) continue
    m.set(c, (m.get(c) || 0) + 1)
  }
  return [...m.entries()]
    .map(([category, count]) => ({ category, count }))
    .sort((a, b) => b.count - a.count || a.category.localeCompare(b.category))
}
