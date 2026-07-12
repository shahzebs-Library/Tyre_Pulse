/**
 * Vehicle Handover / Condition Reports — pure, dependency-free domain logic for
 * the Vehicle Handover module (/vehicle-handover). Reduces a set of handover
 * (check-in / check-out) condition records into fleet-level KPI roll-ups.
 *
 * Keeping this here (no Supabase, no React) makes it deterministic and
 * unit-tested; the service (`src/lib/api/handoverReports.js`) and page
 * (`src/pages/VehicleHandover.jsx`) both build on these primitives so the
 * roll-up logic lives in exactly one place.
 */

/** Parse a value to a finite number, or null when it isn't numeric. */
export function toFiniteNumber(v) {
  if (v === '' || v == null) return null
  const n = typeof v === 'number' ? v : parseFloat(String(v).replace(/[^0-9.\-]/g, ''))
  return Number.isFinite(n) ? n : null
}

/**
 * How many damages a handover report carries. Prefers the explicit
 * `damage_count` when present and non-negative; otherwise derives from the
 * length of the `damages` array. Returns 0 when neither is usable.
 *
 * @param {object} report
 * @returns {number}
 */
export function damageCount(report) {
  if (!report || typeof report !== 'object') return 0
  const explicit = toFiniteNumber(report.damage_count)
  if (explicit != null && explicit >= 0) return Math.trunc(explicit)
  if (Array.isArray(report.damages)) return report.damages.length
  return 0
}

/** Canonical condition ratings, worst-flagged for KPI counting. */
const POOR_CONDITION = 'poor'

/**
 * Summarise a set of handover reports for the KPI header:
 *   • totalReports        — number of rows
 *   • checkoutCount       — rows with handover_type === 'checkout'
 *   • checkinCount        — rows with handover_type === 'checkin'
 *   • distinctAssets      — count of distinct asset numbers
 *   • poorConditionCount  — rows rated 'poor'
 *   • totalDamages        — sum of damageCount() across all rows
 *
 * @param {Array<object>} rows
 * @returns {{ totalReports:number, checkoutCount:number, checkinCount:number,
 *             distinctAssets:number, poorConditionCount:number,
 *             totalDamages:number }}
 */
export function summariseHandovers(rows = []) {
  const list = Array.isArray(rows) ? rows : []
  const assets = new Set()
  let checkoutCount = 0
  let checkinCount = 0
  let poorConditionCount = 0
  let totalDamages = 0

  for (const r of list) {
    const asset = r?.asset_no != null ? String(r.asset_no).trim() : ''
    if (asset) assets.add(asset)

    const type = r?.handover_type
    if (type === 'checkout') checkoutCount++
    else if (type === 'checkin') checkinCount++

    if (r?.condition_rating === POOR_CONDITION) poorConditionCount++

    totalDamages += damageCount(r)
  }

  return {
    totalReports: list.length,
    checkoutCount,
    checkinCount,
    distinctAssets: assets.size,
    poorConditionCount,
    totalDamages,
  }
}

/**
 * Tally reports by condition_rating. Returns an object with one integer count
 * per rating actually present in the data (e.g. { excellent: 2, good: 5 }).
 * Rows with a missing/blank rating are ignored.
 *
 * @param {Array<object>} rows
 * @returns {Record<string, number>}
 */
export function byCondition(rows = []) {
  const list = Array.isArray(rows) ? rows : []
  const out = {}
  for (const r of list) {
    const rating = r?.condition_rating
    if (rating == null || rating === '') continue
    const key = String(rating)
    out[key] = (out[key] || 0) + 1
  }
  return out
}
