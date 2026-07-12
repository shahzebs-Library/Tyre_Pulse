/**
 * Route Plans — pure, dependency-free domain logic for the Route Optimization
 * module (/route-optimization). Reduces a set of route plans into per-plan
 * savings figures and a fleet-level KPI summary.
 *
 * Keeping this here (no Supabase, no React) makes it deterministic and
 * unit-tested; the service (`src/lib/api/routePlans.js`) and page
 * (`src/pages/RouteOptimization.jsx`) both build on these primitives so the
 * roll-up logic lives in exactly one place.
 */

/** Parse a value to a finite number, or null when it isn't numeric. */
export function toFiniteNumber(v) {
  if (v === '' || v == null) return null
  const n = typeof v === 'number' ? v : parseFloat(String(v).replace(/[^0-9.\-]/g, ''))
  return Number.isFinite(n) ? n : null
}

/** Clamp a number into the inclusive [lo, hi] range. */
function clamp(n, lo, hi) {
  return Math.max(lo, Math.min(hi, n))
}

/**
 * Kilometres and percentage saved for a single plan. Savings is the difference
 * between the naive total distance and the optimised distance. Guards against a
 * missing/zero baseline (percentage is 0 when total distance is not positive)
 * and clamps the percentage into 0..100 so a bad optimised value can never
 * produce a nonsensical figure.
 *
 * @param {object} plan
 * @returns {{ savingsKm:number, savingsPct:number }}
 */
export function computeSavings(plan = {}) {
  const total = toFiniteNumber(plan?.total_distance_km)
  const optimized = toFiniteNumber(plan?.optimized_distance_km)

  if (total == null || optimized == null) return { savingsKm: 0, savingsPct: 0 }

  const savingsKm = total - optimized
  if (total <= 0) return { savingsKm, savingsPct: 0 }

  const savingsPct = clamp((savingsKm / total) * 100, 0, 100)
  return { savingsKm, savingsPct }
}

/**
 * Summarise a set of route plans for the KPI header:
 *   • totalPlans        — number of rows
 *   • totalStops        — sum of stops_count across all plans
 *   • totalDistanceKm   — sum of naive total_distance_km
 *   • totalOptimizedKm  — sum of optimized_distance_km
 *   • totalSavingsKm     — sum of per-plan savings (total − optimised, ≥ 0)
 *   • avgSavingsPct     — average per-plan savings % over plans that have a
 *                         positive baseline distance
 *   • optimizedCount    — plans whose optimised distance beats their total
 *
 * @param {Array<object>} rows
 * @returns {{ totalPlans:number, totalStops:number, totalDistanceKm:number,
 *             totalOptimizedKm:number, totalSavingsKm:number,
 *             avgSavingsPct:number, optimizedCount:number }}
 */
export function summariseRoutePlans(rows = []) {
  const list = Array.isArray(rows) ? rows : []

  let totalStops = 0
  let totalDistanceKm = 0
  let totalOptimizedKm = 0
  let totalSavingsKm = 0
  let optimizedCount = 0
  let pctSum = 0
  let pctCount = 0

  for (const r of list) {
    const stops = toFiniteNumber(r?.stops_count)
    if (stops != null) totalStops += stops

    const total = toFiniteNumber(r?.total_distance_km)
    if (total != null) totalDistanceKm += total

    const optimized = toFiniteNumber(r?.optimized_distance_km)
    if (optimized != null) totalOptimizedKm += optimized

    const { savingsKm, savingsPct } = computeSavings(r)
    if (savingsKm > 0) totalSavingsKm += savingsKm
    if (savingsKm > 0) optimizedCount += 1

    if (total != null && total > 0) {
      pctSum += savingsPct
      pctCount += 1
    }
  }

  return {
    totalPlans: list.length,
    totalStops,
    totalDistanceKm,
    totalOptimizedKm,
    totalSavingsKm,
    avgSavingsPct: pctCount > 0 ? pctSum / pctCount : 0,
    optimizedCount,
  }
}
