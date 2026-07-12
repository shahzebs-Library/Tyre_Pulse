/**
 * Fleet Risk Score service — reads the tyre records + fleet master data needed
 * to rank every vehicle by composite tyre risk. Wired to Tyre Pulse's
 * `tyre_records` and `vehicle_fleet`. Country-scoped (null-safe) and fully
 * paginated so large fleets are never silently truncated. All scoring maths
 * live in the pure, unit-tested `src/lib/fleetRisk.js`.
 */
import { supabase, applyCountry, fetchAllPages, unwrap } from './_client'

// Explicit least-privilege column list (no SELECT *). Covers every field the
// risk signals consume: identity, age anchors, tread/pressure, cost/distance,
// and removal metadata used for failure detection.
const TYRE_COLS =
  'id,asset_no,site,country,status,brand,size,tread_depth,pressure_reading,' +
  'cost_per_tyre,total_km,km_at_fitment,km_at_removal,fitment_date,issue_date,' +
  'removal_date,reason_for_removal,removal_reason'

const VEHICLE_COLS =
  'id,asset_no,make,model,vehicle_type,site,country,status'

/**
 * Every tyre record in scope, paginated + country-scoped. Ordered by asset so
 * grouping is cache-friendly; id tiebreaker keeps pages from overlapping.
 * @param {{ country?:string }} [opts]
 */
export async function listTyresForRisk({ country } = {}) {
  return fetchAllPages((from, to) => {
    const q = supabase.from('tyre_records').select(TYRE_COLS)
      .order('asset_no', { ascending: true, nullsFirst: false })
      .order('id', { ascending: true })
      .range(from, to)
    return applyCountry(q, country)
  })
}

/**
 * Fleet master rows (for make/model/type/site enrichment of scored assets),
 * paginated + country-scoped.
 * @param {{ country?:string }} [opts]
 */
export async function listVehiclesForRisk({ country } = {}) {
  return fetchAllPages((from, to) => {
    const q = supabase.from('vehicle_fleet').select(VEHICLE_COLS)
      .order('asset_no', { ascending: true, nullsFirst: false })
      .order('id', { ascending: true })
      .range(from, to)
    return applyCountry(q, country)
  })
}

/**
 * Convenience loader — fetches both datasets concurrently. Vehicle master data
 * is best-effort: an error there (or an empty table) never blocks the tyre-based
 * risk scoring, which is the primary signal source.
 * @param {{ country?:string }} [opts]
 * @returns {Promise<{ tyres: Array, vehicles: Array }>}
 */
export async function getFleetRiskData({ country } = {}) {
  const [tyres, vehicles] = await Promise.all([
    listTyresForRisk({ country }),
    listVehiclesForRisk({ country }).catch(() => []),
  ])
  return {
    tyres: Array.isArray(tyres) ? tyres : [],
    vehicles: Array.isArray(vehicles) ? vehicles : [],
  }
}

// Re-export unwrap so future single-row reads share the service error contract.
export { unwrap }
