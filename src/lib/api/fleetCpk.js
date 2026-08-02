/**
 * fleetCpk - unit-aware Cost Per Km / Cost Per Hour (CPK) for the fleet.
 *
 * Reads the LIVE server aggregate `get_fleet_cpk(p_country, p_from, p_to)` (V433),
 * which chooses km for road assets and engine-hours for plant (generators, pumps,
 * loaders, ...) automatically, and never blends currencies (the fleet view is a
 * per-country array). The RPC returns jsonb:
 *   {
 *     per_vehicle: [{ asset_no, vehicle_type, unit, distance_or_hours,
 *                     tyre_cost, maintenance_cost, total_cost, cpk_tyre, cpk_total }],
 *     by_type:     [ ...same, rolled up per vehicle_type ],
 *     fleet:       [{ country, currency, km side + hours side totals,
 *                     cpk_tyre, cpk_total, coverage_pct, unregistered_cost }]
 *   }
 * A CPK is NULL when its denominator (km or hours) is 0 - the UI renders "N/A",
 * never a fabricated 0.
 *
 * This service is INTENTIONALLY forgiving: a missing relation/function (org not
 * migrated), an empty result, or any RPC error degrades to an empty-but-shaped
 * object so the page shows an honest empty state - it never throws to the UI.
 */
import { supabase } from './_client'

/** The empty, correctly-shaped result used for every degrade path. */
function emptyResult() {
  return { perVehicle: [], byType: [], fleet: [] }
}

/**
 * Fetch unit-aware fleet CPK for a period.
 *
 * @param {{ country?:string, from?:string, to?:string }} [opts]
 *   country: a single country ('KSA'/'UAE'/'Egypt') or 'All'/null for every country.
 *   from/to: ISO YYYY-MM-DD date bounds (either may be omitted).
 * @returns {Promise<{ perVehicle:Array, byType:Array, fleet:Array }>}
 *   Camel-cased arrays parsed from the RPC's per_vehicle / by_type / fleet.
 *   Always resolves; never rejects.
 */
export async function getFleetCpk({ country, from, to } = {}) {
  try {
    const { data, error } = await supabase.rpc('get_fleet_cpk', {
      p_country: country && country !== 'All' ? country : null,
      p_from: from || null,
      p_to: to || null,
    })
    if (error || !data) return emptyResult()
    return {
      perVehicle: Array.isArray(data.per_vehicle) ? data.per_vehicle : [],
      byType: Array.isArray(data.by_type) ? data.by_type : [],
      fleet: Array.isArray(data.fleet) ? data.fleet : [],
    }
  } catch {
    return emptyResult()
  }
}
