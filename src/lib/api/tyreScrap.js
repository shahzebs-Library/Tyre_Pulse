/**
 * Tyre Scrap Management page reads/writes - the exact inline Supabase queries
 * the scrap analysis screen consumes (removed/scrapped tyre corpus, shared
 * disposal statuses, mark-as-disposed upsert).
 *
 * Read-only pass-throughs return the raw Supabase query builder (thenable) the
 * page reads via `.data` / `.error` (corpus through `fetchAllPages`, disposals
 * through `.then`). Explicit column list on the corpus (no SELECT *). Country
 * filtering stays client-side in the page (unchanged). Additive only.
 */
import { supabase } from './_client'

/** Shared disposal statuses (tyre_record_id -> status source rows). */
export function listTyreDisposals() {
  return supabase.from('tyre_disposals').select('tyre_record_id,status')
}

/** Tyre records for scrap analysis, paged range (drives `fetchAllPages`). */
export function listScrapTyreRecords({ from, to } = {}) {
  return supabase
    .from('tyre_records')
    .select(
      'id, asset_no, serial_number, brand, size, position, site, country, ' +
      'risk_level, tread_depth, cost_per_tyre, km_at_fitment, km_at_removal, ' +
      'issue_date, removal_date, qty, category, removal_reason'
    )
    .range(from, to)
}

/**
 * Upsert a disposal status for a tyre record (shared across the team). Conflict
 * target matches the page's prior inline upsert. Pass-through (page reads `.error`).
 */
export function upsertTyreDisposal(tyreRecordId, status) {
  return supabase
    .from('tyre_disposals')
    .upsert({ tyre_record_id: tyreRecordId, status }, { onConflict: 'tyre_record_id' })
}
