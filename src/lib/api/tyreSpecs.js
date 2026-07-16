/**
 * Tyre Specifications service - the reads/writes the Tyre Specifications screen
 * consumes: the approved-fitment spec library (CRUD), the live tyre_records +
 * fleet_master data the compliance analysis runs over, and the "raise work
 * order" flow for non-conforming fitments.
 *
 * Pass-through style: each returns the raw Supabase query builder (thenable),
 * RPC result, or fetchAllPages promise the page reads via `.data` / `.error`,
 * preserving the page's destructuring and try/catch exactly. Country scoping is
 * replicated verbatim from the page: specs use NULL-inclusive `.or(...)`, while
 * the compliance tyre_records read uses strict `.eq('country', ...)` - kept as-is
 * to avoid any behaviour change. Explicit column lists throughout.
 */
import { supabase, fetchAllPages } from './_client'

// Column set the page reads from tyre_specifications (verified against the page).
const SPEC_COLS =
  'id, vehicle_type, position, approved_sizes, approved_brands, min_load_index, min_speed_index, ply_rating, recommended_pressure, min_tread_depth, notes, country, created_by, created_at, updated_at'

/**
 * List tyre specifications, NULL-inclusive country scoping when a real country
 * is active, ordered by vehicle_type then position (both ascending).
 * @param {{country?:string|null}} [opts]
 */
export function listSpecs({ country } = {}) {
  let q = supabase.from('tyre_specifications').select(SPEC_COLS)
  if (country) q = q.or(`country.eq.${country},country.is.null`)
  return q.order('vehicle_type', { ascending: true }).order('position', { ascending: true })
}

/**
 * All tyre_records for compliance analysis, fully paged (200k ceiling), newest
 * first, with STRICT country scoping (`.eq`) matching the page exactly.
 * @param {{country?:string}} [opts]
 */
export function listComplianceTyreRecords({ country } = {}) {
  return fetchAllPages((from, to) => {
    let q = supabase
      .from('tyre_records')
      .select('id, asset_no, serial_number, position, brand, size, site, country, issue_date, risk_level')
    if (country && country !== 'All') q = q.eq('country', country)
    return q.order('issue_date', { ascending: false }).range(from, to)
  }, { max: 200000 })
}

/**
 * Fleet master rows for vehicle-type resolution. Mirrors the page's read
 * including its `.catch(() => ({ data: null }))` soft-fail (fleet_master may be
 * absent in some deployments).
 */
export function getFleetMaster() {
  return supabase
    .from('fleet_master')
    .select('id, asset_no, vehicle_type, make, model, site, country')
    .catch(() => ({ data: null }))
}

/** Generate the next work-order number via the `generate_work_order_no` RPC. */
export function generateWorkOrderNo() {
  return supabase.rpc('generate_work_order_no')
}

/** Insert a work_orders row (whitelisted payload built by the page). */
export function insertWorkOrder(payload) {
  return supabase.from('work_orders').insert(payload)
}

/** Update a tyre specification by id. */
export function updateSpec(id, row) {
  return supabase.from('tyre_specifications').update(row).eq('id', id)
}

/** Insert one or many tyre specification rows (page passes a row or an array). */
export function insertSpec(row) {
  return supabase.from('tyre_specifications').insert(row)
}

/** Delete a tyre specification by id. */
export function deleteSpec(id) {
  return supabase.from('tyre_specifications').delete().eq('id', id)
}
