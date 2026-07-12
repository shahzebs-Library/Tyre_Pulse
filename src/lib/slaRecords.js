/**
 * SLA Records — pure, dependency-free domain logic for the SLA Dashboard module
 * (/sla-dashboard). Turns a set of tracked service-level agreements (work
 * orders, breakdowns, deliveries, inspections, procurement, support tickets)
 * into time-to-breach signals and fleet-level compliance analytics.
 *
 * Every time-dependent function takes an explicit `nowMs` (milliseconds since
 * epoch) rather than reading the clock, so the logic is deterministic and fully
 * unit-testable. The service (`src/lib/api/slaRecords.js`) and page
 * (`src/pages/SlaDashboard.jsx`) both build on these primitives so the
 * definition of "at risk" / "breached" / "met" lives in exactly one place.
 *
 * The "at risk" threshold: an open SLA is at risk once less than 20% of its
 * target window remains before the due time.
 */

/** Fraction of the target window remaining below which an open SLA is "at risk". */
export const AT_RISK_FRACTION = 0.2

const MS_PER_HOUR = 3_600_000

/** Parse a value to a finite number, or null when it isn't numeric. */
export function toFiniteNumber(v) {
  if (v === '' || v == null) return null
  const n = typeof v === 'number' ? v : parseFloat(String(v).replace(/[^0-9.\-]/g, ''))
  return Number.isFinite(n) ? n : null
}

/** Parse a timestamp-ish value to epoch ms, or null when it isn't a valid date. */
function toMs(v) {
  if (v == null || v === '') return null
  if (typeof v === 'number') return Number.isFinite(v) ? v : null
  const t = new Date(v).getTime()
  return Number.isNaN(t) ? null : t
}

/**
 * Hours remaining until an SLA's due time relative to `nowMs`. Positive when the
 * due time is in the future, negative once overdue. Returns null when there is
 * no valid due_at.
 *
 * @param {object} rec    an sla_records row
 * @param {number} nowMs  current time in epoch milliseconds
 * @returns {number|null}
 */
export function hoursRemaining(rec, nowMs) {
  const due = toMs(rec?.due_at)
  if (due == null || !Number.isFinite(nowMs)) return null
  return (due - nowMs) / MS_PER_HOUR
}

/**
 * Hours elapsed since an SLA started relative to `nowMs`. Never negative.
 * Returns null when there is no valid started_at.
 *
 * @param {object} rec    an sla_records row
 * @param {number} nowMs  current time in epoch milliseconds
 * @returns {number|null}
 */
export function elapsedHours(rec, nowMs) {
  const start = toMs(rec?.started_at)
  if (start == null || !Number.isFinite(nowMs)) return null
  const h = (nowMs - start) / MS_PER_HOUR
  return h < 0 ? 0 : h
}

/**
 * Actual resolution time in hours (resolved_at − started_at). Returns null when
 * either timestamp is missing/invalid, or when resolution precedes the start.
 *
 * @param {object} rec  an sla_records row
 * @returns {number|null}
 */
export function resolutionHours(rec) {
  const start = toMs(rec?.started_at)
  const resolved = toMs(rec?.resolved_at)
  if (start == null || resolved == null) return null
  const h = (resolved - start) / MS_PER_HOUR
  return h < 0 ? null : h
}

/**
 * Derive the true breach status of an SLA at time `nowMs`, independent of any
 * stored `status` value (which may be stale). Returns one of:
 *   • 'met'      — resolved on or before the due time
 *   • 'breached' — resolved after the due time, OR still open and overdue
 *   • 'at_risk'  — open, not overdue, but < 20% of the target window remains
 *   • 'on_track' — open with comfortable time remaining
 *   • 'unknown'  — cancelled, or insufficient data to judge (no due time)
 *
 * @param {object} rec    an sla_records row
 * @param {number} nowMs  current time in epoch milliseconds
 * @returns {'met'|'breached'|'at_risk'|'on_track'|'unknown'}
 */
export function breachStatus(rec, nowMs) {
  if (!rec || typeof rec !== 'object') return 'unknown'
  if (rec.status === 'cancelled') return 'unknown'

  const due = toMs(rec.due_at)
  const resolved = toMs(rec.resolved_at)

  // Resolved / completed SLAs: compliance is decided by when they closed.
  if (resolved != null || rec.status === 'met') {
    if (resolved != null && due != null) return resolved <= due ? 'met' : 'breached'
    if (rec.status === 'met') return 'met'
    // Resolved but no due time to compare against — treat as met (it is closed).
    return 'met'
  }

  // Open SLAs need a due time to judge.
  if (due == null || !Number.isFinite(nowMs)) return 'unknown'

  const remaining = (due - nowMs) / MS_PER_HOUR
  if (remaining <= 0) return 'breached'

  const target = toFiniteNumber(rec.target_hours)
  if (target != null && target > 0 && remaining < target * AT_RISK_FRACTION) return 'at_risk'

  return 'on_track'
}

/**
 * Summarise a set of SLA records into the KPI header figures.
 *   • totalRecords      — number of rows
 *   • metCount          — SLAs met (resolved within target)
 *   • breachedCount     — SLAs breached (resolved late or open + overdue)
 *   • atRiskCount       — open SLAs with < 20% of the window remaining
 *   • complianceRate    — met / (met + breached), 0..100 (0 when none decided)
 *   • avgResolutionHours— mean resolution time across resolved rows (null if none)
 *
 * @param {Array<object>} rows
 * @param {number} nowMs  current time in epoch milliseconds
 * @returns {{ totalRecords:number, metCount:number, breachedCount:number,
 *             atRiskCount:number, complianceRate:number, avgResolutionHours:number|null }}
 */
export function summariseSla(rows = [], nowMs) {
  const list = Array.isArray(rows) ? rows : []
  let metCount = 0
  let breachedCount = 0
  let atRiskCount = 0
  let resSum = 0
  let resCount = 0

  for (const r of list) {
    const s = breachStatus(r, nowMs)
    if (s === 'met') metCount++
    else if (s === 'breached') breachedCount++
    else if (s === 'at_risk') atRiskCount++

    const rh = resolutionHours(r)
    if (rh != null) { resSum += rh; resCount++ }
  }

  const decided = metCount + breachedCount
  const complianceRate = decided > 0 ? Math.round((metCount / decided) * 1000) / 10 : 0
  const avgResolutionHours = resCount > 0 ? Math.round((resSum / resCount) * 10) / 10 : null

  return {
    totalRecords: list.length,
    metCount,
    breachedCount,
    atRiskCount,
    complianceRate,
    avgResolutionHours,
  }
}

/**
 * Compliance breakdown by SLA type. For each distinct `sla_type`, returns the
 * total number of records, how many breached, and the per-type compliance rate
 * (met / (met + breached), 0..100). Sorted by breach count descending so the
 * worst-performing categories surface first.
 *
 * @param {Array<object>} rows
 * @param {number} nowMs  current time in epoch milliseconds
 * @returns {Array<{ sla_type:string, total:number, breached:number, complianceRate:number }>}
 */
export function byType(rows = [], nowMs) {
  const list = Array.isArray(rows) ? rows : []
  const map = new Map()

  for (const r of list) {
    const type = r?.sla_type != null && String(r.sla_type).trim() !== ''
      ? String(r.sla_type).trim()
      : 'other'
    let bucket = map.get(type)
    if (!bucket) { bucket = { sla_type: type, total: 0, met: 0, breached: 0 }; map.set(type, bucket) }
    bucket.total++
    const s = breachStatus(r, nowMs)
    if (s === 'met') bucket.met++
    else if (s === 'breached') bucket.breached++
  }

  return [...map.values()]
    .map((b) => {
      const decided = b.met + b.breached
      return {
        sla_type: b.sla_type,
        total: b.total,
        breached: b.breached,
        complianceRate: decided > 0 ? Math.round((b.met / decided) * 1000) / 10 : 0,
      }
    })
    .sort((a, b) => b.breached - a.breached || b.total - a.total || a.sla_type.localeCompare(b.sla_type))
}
