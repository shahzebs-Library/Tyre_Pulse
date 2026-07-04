/**
 * Vehicle History service - the reads the Vehicle History screen consumes: the
 * full-fleet tyre_records feed its per-asset metrics/anomaly analysis runs over,
 * the vehicle_fleet master lookup, and the four per-asset related-record reads
 * (corrective actions, RCA records, inspections, tyre records) loaded when an
 * asset is selected.
 *
 * Pass-through style: each returns the raw Supabase query builder (thenable) or
 * fetchAllPages promise the page reads via `.data`, preserving the page's
 * destructuring and `Promise.all` exactly. Country scoping on the fleet feed is
 * STRICT `.eq('country', ...)` when a real country is active - replicated
 * verbatim from the page (`country !== 'All'`), NOT NULL-inclusive. Explicit
 * column lists where the page used them.
 */
import { supabase, fetchAllPages } from './_client'

/**
 * All tyre_records for the fleet, fully paged (200k ceiling), oldest issue_date
 * first, strictly country-scoped (`.eq`) when a real country is active.
 * @param {{country?:string}} [opts]
 */
export function listFleetTyreRecords({ country } = {}) {
  return fetchAllPages((from, to) => {
    let q = supabase.from('tyre_records').select('*').order('issue_date', { ascending: true })
    if (country !== 'All') q = q.eq('country', country)
    return q.range(from, to)
  }, { max: 200000 })
}

/** Full vehicle_fleet master table for the per-asset fleet-record lookup. */
export function getVehicleFleet() {
  return supabase.from('vehicle_fleet').select('*')
}

/**
 * Corrective actions related to an asset (matched by asset_no OR description
 * mention), up to 20.
 */
export function listAssetActions(assetNo) {
  return supabase
    .from('corrective_actions')
    .select('id,title,status,priority,due_date,site,created_at')
    .or(`asset_no.eq.${assetNo},description.ilike.%${assetNo}%`)
    .limit(20)
}

/** RCA records for an asset (by asset_no), up to 20. */
export function listAssetRca(assetNo) {
  return supabase
    .from('rca_records')
    .select('id,asset_no,root_cause,tyre_serial,brand,site,created_at')
    .eq('asset_no', assetNo)
    .limit(20)
}

/** Inspections for an asset (by asset_no), up to 20. */
export function listAssetInspections(assetNo) {
  return supabase
    .from('inspections')
    .select('id,asset_no,status,site,created_at')
    .eq('asset_no', assetNo)
    .limit(20)
}

/** Tyre records for an asset (by asset_no), newest issue_date first. */
export function listAssetTyreRecords(assetNo) {
  return supabase
    .from('tyre_records')
    .select('position,risk_level,brand,serial_no,issue_date')
    .eq('asset_no', assetNo)
    .order('issue_date', { ascending: false })
}
