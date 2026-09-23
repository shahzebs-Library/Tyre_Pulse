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
import { supabase, fetchAllPages, applyCountry } from './_client'

/**
 * All tyre_records for the fleet, fully paged (200k ceiling), oldest issue_date
 * first, strictly country-scoped (`.eq`) when a real country is active.
 *
 * `from`/`to` bound `issue_date` server-side and are OPTIONAL: with neither
 * passed this is byte-for-byte the previous all-time read, so no caller changes
 * today. The select stays `*` deliberately - the page reads fields off these rows
 * that are not enumerated here, and narrowing it blind would drop columns the
 * screen displays.
 * @param {{country?:string, from?:string, to?:string}} [opts]
 */
export function listFleetTyreRecords({ country, from: fromDate, to: toDate } = {}) {
  return fetchAllPages((from, to) => {
    let q = supabase.from('tyre_records').select('*').order('issue_date', { ascending: true })
    if (country !== 'All') q = q.eq('country', country)
    if (fromDate) q = q.gte('issue_date', fromDate)
    if (toDate) q = q.lte('issue_date', toDate)
    return q.range(from, to)
  }, { max: 200000 })
}

/**
 * Full vehicle_fleet master table for the per-asset fleet-record lookup. PAGED:
 * the register is 1,617 rows and an unbounded read returns 1,000, so under the
 * All-countries scope roughly 600 assets silently lacked fleet-master
 * enrichment. asset_no is unique per COUNTRY, not globally, so `id` is the
 * tiebreak.
 */
export function getVehicleFleet() {
  return fetchAllPages(
    (from, to) => supabase.from('vehicle_fleet').select('*')
      .order('asset_no').order('id').range(from, to),
    { max: 20000 },
  )
}

// Related records are linked by the exact asset number, never a substring in
// free text (TM1 must not inherit a TM10 action). Preserve active country scope.
async function assetRows(table, columns, assetNo, { country } = {}, date = 'created_at') {
  const result = await fetchAllPages((from, to) => applyCountry(supabase.from(table).select(columns)
    .eq('asset_no', assetNo), country).order(date, { ascending: false }).order('id').range(from, to), { max: 20000 })
  if (result.truncated) return { data: [], error: new Error('Asset history is too large to load completely. Narrow the country selection.') }
  return result
}
export function listAssetActions(assetNo, options) {
  return assetRows('corrective_actions', 'id,title,status,priority,due_date,site,created_at', assetNo, options)
}
export function listAssetRca(assetNo, options) {
  return assetRows('rca_records', 'id,asset_no,root_cause,tyre_serial,brand,site,created_at', assetNo, options)
}
export function listAssetInspections(assetNo, options) {
  return assetRows('inspections', 'id,asset_no,status,site,created_at', assetNo, options)
}
export function listAssetTyreRecords(assetNo, options) {
  return assetRows('tyre_records', 'position,risk_level,brand,serial_no,issue_date', assetNo, options, 'issue_date')
}
