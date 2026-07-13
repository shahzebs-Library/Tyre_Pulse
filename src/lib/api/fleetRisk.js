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
  'removal_date,reason_for_removal,removal_reason,' +
  'serial_no,serial_number,tyre_serial,position'

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
 * Convenience loader for the Fleet Risk page. Per-tyre scoring (and the
 * per-vehicle rollup derived from it) runs entirely off `tyre_records`, so this
 * fetches only the tyre dataset. Returned shape stays `{ tyres }` so callers can
 * be extended without a signature change.
 * @param {{ country?:string }} [opts]
 * @returns {Promise<{ tyres: Array }>}
 */
export async function getFleetRiskData({ country } = {}) {
  const tyres = await listTyresForRisk({ country })
  return { tyres: Array.isArray(tyres) ? tyres : [] }
}

// Re-export unwrap so future single-row reads share the service error contract.
export { unwrap }
