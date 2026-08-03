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
/**
 * KM SOURCE for CPK (V462): trace the fleet CPK km back to the exact tyre rows.
 * The CPK km side = SUM of each tyre's total_km (from the monthly tyre consumption),
 * matched to the tyre's change month by coalesce(removal_date, issue_date) - the
 * IDENTICAL filter get_fleet_cpk uses, so the per-asset km reconciles to the page.
 *
 * @param {{ country?:string, from?:string, to?:string, asset?:string }} [opts]
 *   asset omitted -> `{ ok, source, basis, from, to, by_asset:[{asset_no,tyres,km}] }`
 *   asset given   -> `{ ok, source, basis, asset_no, km, tyre_count,
 *                       tyres:[{serial_no,position,brand,size,job_card,issue_date,
 *                       fitment_date,removal_date,effective_date,km_at_fitment,
 *                       km_at_removal,total_km,cost_per_tyre,data_source}] }`
 * Degrades to `{ ok:false }`; never throws.
 */
export async function getCpkKmSource({ country, from, to, asset } = {}) {
  try {
    const { data, error } = await supabase.rpc('get_cpk_km_source', {
      p_country: country && country !== 'All' ? country : null,
      p_from: from || null,
      p_to: to || null,
      p_asset: asset || null,
    })
    if (error) return { ok: false, reason: 'error' }
    return data || { ok: false, reason: 'empty' }
  } catch {
    return { ok: false, reason: 'unavailable' }
  }
}

/**
 * HOURS SOURCE for CPK (V463): the NON-MOVABLE (engine-hour) counterpart of
 * getCpkKmSource. An asset's CPK hours = span (max-min engine_hours) over its
 * period readings. Same filter as fleet_hours_by_asset, so it reconciles.
 * @param {{ country?:string, from?:string, to?:string, asset?:string }} [opts]
 */
export async function getCpkHoursSource({ country, from, to, asset } = {}) {
  try {
    const { data, error } = await supabase.rpc('get_cpk_hours_source', {
      p_country: country && country !== 'All' ? country : null,
      p_from: from || null, p_to: to || null, p_asset: asset || null,
    })
    if (error) return { ok: false, reason: 'error' }
    return data || { ok: false, reason: 'empty' }
  } catch {
    return { ok: false, reason: 'unavailable' }
  }
}

/**
 * UNIT AUDIT (V463): per asset, the vehicle_type, the unit CPK measures it in
 * (plant = engine_hours, else km) and whether it has km data (tyre total_km)
 * and/or hours data (engine-hour span), with a status flag so a user can see
 * WHY an asset's CPK looks the way it does: `both_present` (has km AND hours -
 * CPK uses only its type's unit), `off_unit_only` (its only data is on the OTHER
 * unit - possible mis-classification, CPK ignores it), `used_unit_no_data` (no
 * data for its unit -> CPK N/A), `ok`. Returns `{ ok, summary, assets, note }`.
 * @param {{ country?:string, from?:string, to?:string }} [opts]
 */
export async function getCpkUnitAudit({ country, from, to } = {}) {
  try {
    const { data, error } = await supabase.rpc('get_cpk_unit_audit', {
      p_country: country && country !== 'All' ? country : null,
      p_from: from || null, p_to: to || null,
    })
    if (error) return { ok: false, reason: 'error' }
    return data || { ok: false, reason: 'empty' }
  } catch {
    return { ok: false, reason: 'unavailable' }
  }
}

/**
 * AREA (BRANCH) MAP for the Scenario Studio: which BRANCH (vehicle_fleet.site) each
 * asset belongs to, so the studio can group CPK per real branch (NHC, RED SEA,
 * KSP-TP, ...) and model moving assets between branch cost rates. Calls the live
 * `get_fleet_area_map(p_country)` RPC.
 *
 * @param {{ country?:string }} [opts]
 *   country: a single country ('KSA'/'UAE'/'Egypt') or 'All'/null for every country.
 * @returns {Promise<Array<{ asset_no:string, site:string, region:string,
 *   vehicle_type:string }>>}
 *   The parsed `assets` array on success, or [] on any error/degrade.
 *   Always resolves; never rejects.
 */
export async function getFleetAreaMap({ country } = {}) {
  try {
    const { data, error } = await supabase.rpc('get_fleet_area_map', {
      p_country: country && country !== 'All' ? country : null,
    })
    if (error || !data) return []
    const assets = Array.isArray(data.assets) ? data.assets : (Array.isArray(data) ? data : [])
    return Array.isArray(assets) ? assets : []
  } catch {
    return []
  }
}

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
