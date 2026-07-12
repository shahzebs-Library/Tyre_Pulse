/**
 * Breakdown Callouts — pure, dependency-free domain logic for the Roadside
 * Assistance / Breakdown Callouts module (/breakdown-callouts). Reduces a set of
 * callout records into response/resolution timings, a fleet-level KPI summary,
 * and a per-type breakdown.
 *
 * Keeping this here (no Supabase, no React) makes it deterministic and
 * unit-tested; the service (`src/lib/api/breakdownCallouts.js`) and page
 * (`src/pages/BreakdownCallouts.jsx`) both build on these primitives so the
 * roll-up logic lives in exactly one place.
 */

/** Parse a value to a finite number, or null when it isn't numeric. */
export function toFiniteNumber(v) {
  if (v === '' || v == null) return null
  const n = typeof v === 'number' ? v : parseFloat(String(v).replace(/[^0-9.\-]/g, ''))
  return Number.isFinite(n) ? n : null
}

/** Milliseconds for a timestamp value, or null when it isn't parseable. */
function msOf(v) {
  if (!v) return null
  const t = new Date(v).getTime()
  return Number.isNaN(t) ? null : t
}

/** Whole minutes between two timestamps (later − earlier), or null. */
function minutesBetween(from, to) {
  const a = msOf(from)
  const b = msOf(to)
  if (a == null || b == null) return null
  const diff = b - a
  if (diff < 0) return null
  return Math.round(diff / 60000)
}

/**
 * Response time — minutes from when a breakdown was reported to when help was
 * dispatched. Null when either timestamp is missing/invalid or dispatch predates
 * the report.
 */
export function responseMinutes(c) {
  return minutesBetween(c?.reported_at, c?.dispatched_at)
}

/**
 * Resolution time — minutes from when a breakdown was reported to when it was
 * resolved. Null when either timestamp is missing/invalid or resolution predates
 * the report.
 */
export function resolutionMinutes(c) {
  return minutesBetween(c?.reported_at, c?.resolved_at)
}

/** A callout is "open" while it is neither resolved nor cancelled. */
function isOpen(c) {
  const s = String(c?.status || '').toLowerCase()
  return s !== 'resolved' && s !== 'cancelled'
}

/**
 * Summarise a set of callouts for the KPI header:
 *   • totalCallouts        — number of rows
 *   • openCount            — status not resolved/cancelled
 *   • criticalOpenCount    — open AND severity === 'critical'
 *   • totalCost            — sum of all numeric costs
 *   • avgResponseMinutes   — mean response time over callouts that have one (or null)
 *   • avgResolutionMinutes — mean resolution time over callouts that have one (or null)
 *
 * @param {Array<object>} rows
 * @returns {{ totalCallouts:number, openCount:number, criticalOpenCount:number,
 *             totalCost:number, avgResponseMinutes:number|null,
 *             avgResolutionMinutes:number|null }}
 */
export function summariseCallouts(rows = []) {
  const list = Array.isArray(rows) ? rows : []
  let openCount = 0
  let criticalOpenCount = 0
  let totalCost = 0
  let respSum = 0
  let respN = 0
  let resoSum = 0
  let resoN = 0

  for (const c of list) {
    const open = isOpen(c)
    if (open) {
      openCount += 1
      if (String(c?.severity || '').toLowerCase() === 'critical') criticalOpenCount += 1
    }
    const cost = toFiniteNumber(c?.cost)
    if (cost != null) totalCost += cost

    const resp = responseMinutes(c)
    if (resp != null) { respSum += resp; respN += 1 }
    const reso = resolutionMinutes(c)
    if (reso != null) { resoSum += reso; resoN += 1 }
  }

  return {
    totalCallouts: list.length,
    openCount,
    criticalOpenCount,
    totalCost,
    avgResponseMinutes: respN > 0 ? Math.round(respSum / respN) : null,
    avgResolutionMinutes: resoN > 0 ? Math.round(resoSum / resoN) : null,
  }
}

/**
 * Group callouts by breakdown_type into { type, count, cost } rows, sorted by
 * count descending (cost descending as a tiebreaker). Rows without a type are
 * bucketed under 'other'. Cost accumulates numeric costs per type.
 *
 * @param {Array<object>} rows
 * @returns {Array<{ type:string, count:number, cost:number }>}
 */
export function byType(rows = []) {
  const list = Array.isArray(rows) ? rows : []
  const map = new Map()
  for (const c of list) {
    const type = c?.breakdown_type ? String(c.breakdown_type).trim() : 'other'
    const key = type || 'other'
    const prev = map.get(key) || { type: key, count: 0, cost: 0 }
    prev.count += 1
    const cost = toFiniteNumber(c?.cost)
    if (cost != null) prev.cost += cost
    map.set(key, prev)
  }
  return [...map.values()].sort((a, b) => b.count - a.count || b.cost - a.cost)
}
