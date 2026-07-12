/**
 * Fleet Optimizer — pure, dependency-free domain logic for the Fleet Optimizer
 * module (/fleet-optimizer). Turns per-asset utilisation-vs-cost scenarios into
 * fleet right-sizing intelligence: cost-per-km, a suggested keep / replace /
 * redeploy / dispose decision, portfolio roll-ups, a recommendation breakdown
 * and an under-utilisation attention list.
 *
 * Keeping this here (no Supabase, no React) makes every calculation
 * deterministic and unit-tested; the service (`src/lib/api/fleetOptimizer.js`)
 * and page (`src/pages/FleetOptimizer.jsx`) both build on these primitives so
 * the right-sizing logic lives in exactly one place.
 */

/** Parse a value to a finite number, or null when it isn't numeric. */
export function toFiniteNumber(v) {
  if (v === '' || v == null) return null
  const n = typeof v === 'number' ? v : parseFloat(String(v).replace(/[^0-9.\-]/g, ''))
  return Number.isFinite(n) ? n : null
}

/**
 * Cost per kilometre for a scenario: annual_cost / annual_km. Returns null when
 * either input is missing/non-numeric or annual_km is zero (avoids a
 * divide-by-zero producing Infinity/NaN). Negative km is treated as unusable.
 *
 * @param {object} s scenario row
 * @returns {number|null}
 */
export function costPerKm(s) {
  const cost = toFiniteNumber(s?.annual_cost)
  const km = toFiniteNumber(s?.annual_km)
  if (cost == null || km == null || km <= 0) return null
  return cost / km
}

/**
 * Suggest a right-sizing recommendation from the scenario's utilisation, age and
 * downtime signals. Deterministic, ordered so the most decisive outcome wins:
 *
 *   • dispose  — chronically idle and old:  utilization_pct < 30 && age_years >= 7
 *   • replace  — end of economic life:      age_years >= 8 || downtime_days > 45
 *   • redeploy — under-utilised but viable:  utilization_pct < 40
 *   • keep     — performing within targets
 *
 * When the inputs needed to reach a confident call are missing (no utilisation
 * and no age/downtime signal), returns 'review' rather than guessing.
 *
 * @param {object} s scenario row
 * @returns {'keep'|'replace'|'redeploy'|'dispose'|'review'}
 */
export function suggestRecommendation(s) {
  const util = toFiniteNumber(s?.utilization_pct)
  const age = toFiniteNumber(s?.age_years)
  const downtime = toFiniteNumber(s?.downtime_days)

  // Guard: with no utilisation signal AND no age/downtime signal there is
  // nothing to base a decision on — flag for manual review.
  if (util == null && age == null && downtime == null) return 'review'

  if (util != null && age != null && util < 30 && age >= 7) return 'dispose'
  if ((age != null && age >= 8) || (downtime != null && downtime > 45)) return 'replace'
  if (util != null && util < 40) return 'redeploy'
  return 'keep'
}

/**
 * Portfolio roll-up across a set of scenarios. Counts each recorded
 * recommendation, sums projected saving and averages utilisation across the
 * assets that report one.
 *
 * @param {Array<object>} rows
 * @returns {{ totalAssets:number, keepCount:number, replaceCount:number,
 *             redeployCount:number, disposeCount:number,
 *             totalProjectedSaving:number, avgUtilization:number }}
 */
export function summariseOptimizer(rows = []) {
  const list = Array.isArray(rows) ? rows : []
  let keepCount = 0, replaceCount = 0, redeployCount = 0, disposeCount = 0
  let totalProjectedSaving = 0
  let utilSum = 0, utilCount = 0

  for (const r of list) {
    switch (r?.recommendation) {
      case 'keep': keepCount++; break
      case 'replace': replaceCount++; break
      case 'redeploy': redeployCount++; break
      case 'dispose': disposeCount++; break
      default: break
    }
    const saving = toFiniteNumber(r?.projected_saving)
    if (saving != null) totalProjectedSaving += saving
    const util = toFiniteNumber(r?.utilization_pct)
    if (util != null) { utilSum += util; utilCount++ }
  }

  return {
    totalAssets: list.length,
    keepCount,
    replaceCount,
    redeployCount,
    disposeCount,
    totalProjectedSaving,
    avgUtilization: utilCount ? utilSum / utilCount : 0,
  }
}

/**
 * Group scenarios by recorded recommendation, with a count and total projected
 * saving per bucket. Returned sorted by saving descending (largest opportunity
 * first) so the breakdown panel leads with the highest-value action.
 *
 * @param {Array<object>} rows
 * @returns {Array<{ recommendation:string, count:number, saving:number }>}
 */
export function byRecommendation(rows = []) {
  const list = Array.isArray(rows) ? rows : []
  const m = new Map()
  for (const r of list) {
    const key = r?.recommendation || 'review'
    const prev = m.get(key) || { recommendation: key, count: 0, saving: 0 }
    prev.count++
    const saving = toFiniteNumber(r?.projected_saving)
    if (saving != null) prev.saving += saving
    m.set(key, prev)
  }
  return [...m.values()].sort((a, b) => b.saving - a.saving)
}

/**
 * Under-utilised assets: scenarios whose utilisation is below 40%, sorted by
 * utilisation ascending (worst first) so the attention list surfaces the most
 * idle assets at the top. Rows without a numeric utilisation are excluded.
 *
 * @param {Array<object>} rows
 * @returns {Array<object>}
 */
export function underutilised(rows = []) {
  const list = Array.isArray(rows) ? rows : []
  return list
    .filter((r) => {
      const util = toFiniteNumber(r?.utilization_pct)
      return util != null && util < 40
    })
    .sort((a, b) => toFiniteNumber(a?.utilization_pct) - toFiniteNumber(b?.utilization_pct))
}
