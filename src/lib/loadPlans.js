/**
 * Load Plans — pure, dependency-free domain logic for the Load Planning module
 * (/load-planning). Converts planned cargo weight/volume into rated-capacity
 * utilisation, flags overloads, and rolls a set of plans up into a fleet-level
 * KPI summary.
 *
 * Keeping this here (no Supabase, no React) makes it deterministic and
 * unit-tested; the service (`src/lib/api/loadPlans.js`) and page
 * (`src/pages/LoadPlanning.jsx`) both build on these primitives so the
 * utilisation and overload logic lives in exactly one place.
 */

/** Parse a value to a finite number, or null when it isn't numeric. */
export function toFiniteNumber(v) {
  if (v === '' || v == null) return null
  const n = typeof v === 'number' ? v : parseFloat(String(v).replace(/[^0-9.\-]/g, ''))
  return Number.isFinite(n) ? n : null
}

/**
 * A single utilisation percentage: value / capacity × 100.
 *   • Returns null when the capacity is missing or ≤ 0 (divide-by-zero guard),
 *     or when the value itself is not numeric — "no basis to compute".
 *   • Negative values clamp up to 0 (a load can't be negative).
 *   • The upper bound is NOT clamped: an overload legitimately exceeds 100 so
 *     callers can detect and surface it.
 * Rounded to one decimal for stable, deterministic output.
 */
function ratio(value, capacity) {
  const v = toFiniteNumber(value)
  const cap = toFiniteNumber(capacity)
  if (v == null || cap == null || cap <= 0) return null
  const pct = (Math.max(0, v) / cap) * 100
  return Math.round(pct * 10) / 10
}

/**
 * Weight and volume utilisation for a plan, each as a percentage of the asset's
 * rated capacity (or null when the capacity is absent). Overloads exceed 100.
 *
 * @param {object} plan
 * @returns {{ weightPct: number|null, volumePct: number|null }}
 */
export function utilization(plan = {}) {
  const p = plan || {}
  return {
    weightPct: ratio(p.cargo_weight_kg, p.max_payload_kg),
    volumePct: ratio(p.volume_m3, p.max_volume_m3),
  }
}

/**
 * True when a plan exceeds either its rated payload or its rated volume
 * (utilisation > 100%). Missing capacities can't be judged, so they never flag.
 *
 * @param {object} plan
 * @returns {boolean}
 */
export function isOverloaded(plan = {}) {
  const { weightPct, volumePct } = utilization(plan)
  return (weightPct != null && weightPct > 100) || (volumePct != null && volumePct > 100)
}

/**
 * Summarise a set of load plans for the KPI header:
 *   • totalPlans          — number of rows
 *   • totalWeightKg       — sum of planned cargo weight across all rows
 *   • avgWeightUtilPct    — mean weight utilisation over plans with a rated
 *                           payload (rounded; 0 when none are measurable)
 *   • avgVolumeUtilPct    — mean volume utilisation over plans with a rated
 *                           volume (rounded; 0 when none are measurable)
 *   • overloadedCount     — plans exceeding payload or volume capacity
 *   • dispatchedCount     — plans in a dispatched or delivered state (en route
 *                           or completed — no longer awaiting load)
 *
 * @param {Array<object>} rows
 * @returns {{ totalPlans:number, totalWeightKg:number, avgWeightUtilPct:number,
 *             avgVolumeUtilPct:number, overloadedCount:number,
 *             dispatchedCount:number }}
 */
export function summariseLoadPlans(rows = []) {
  const list = Array.isArray(rows) ? rows : []

  let totalWeightKg = 0
  let overloadedCount = 0
  let dispatchedCount = 0
  let weightSum = 0
  let weightN = 0
  let volumeSum = 0
  let volumeN = 0

  for (const r of list) {
    const w = toFiniteNumber(r?.cargo_weight_kg)
    if (w != null) totalWeightKg += w

    const { weightPct, volumePct } = utilization(r)
    if (weightPct != null) { weightSum += weightPct; weightN += 1 }
    if (volumePct != null) { volumeSum += volumePct; volumeN += 1 }

    if (isOverloaded(r)) overloadedCount += 1

    const status = String(r?.status || '').toLowerCase()
    if (status === 'dispatched' || status === 'delivered') dispatchedCount += 1
  }

  return {
    totalPlans: list.length,
    totalWeightKg,
    avgWeightUtilPct: weightN ? Math.round(weightSum / weightN) : 0,
    avgVolumeUtilPct: volumeN ? Math.round(volumeSum / volumeN) : 0,
    overloadedCount,
    dispatchedCount,
  }
}
