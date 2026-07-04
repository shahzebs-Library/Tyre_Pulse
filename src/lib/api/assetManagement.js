/**
 * Asset Management page reads/writes - the exact selects/RPCs/mutations the
 * Fleet Asset Management screen consumes (registry, overview, work orders,
 * per-asset tyre drawer, add/edit form).
 *
 * Read-only pass-throughs return the raw Supabase query builder (thenable) or
 * RPC result the page reads via `.data` / `.error` (consumed through
 * `Promise.allSettled` / `.then`), preserving behaviour exactly. Country
 * filtering stays client-side in the page (unchanged). Additive only.
 */
import { supabase } from './_client'

/** All fleet_master assets, ordered by asset number. */
export function listFleetMaster() {
  return supabase.from('fleet_master').select('*').order('asset_no')
}

/** Per-asset overview aggregates via RPC (country passed straight through). */
export function reportAssetOverview({ country } = {}) {
  return supabase.rpc('report_asset_overview', { p_country: country })
}

/** Work orders feeding the asset registry cost/health columns. */
export function listAssetWorkOrders() {
  return supabase.from('work_orders').select('id,asset_no,status,total_cost,created_at,work_type')
}

/** Tyres for a single asset (detail drawer), keyed by asset number. */
export function listAssetTyres(assetNo) {
  return supabase
    .from('tyre_records')
    .select('id,asset_no,serial_number,position,brand,size,cost_per_tyre,issue_date,km_at_fitment,km_at_removal,risk_level,tread_depth,site,country')
    .eq('asset_no', assetNo)
}

/** Update an existing fleet_master asset by id. Pass-through (page reads `.error`). */
export function updateAsset(id, payload) {
  return supabase.from('fleet_master').update(payload).eq('id', id)
}

/** Insert a new fleet_master asset. Pass-through (page reads `.error`). */
export function insertAsset(payload) {
  return supabase.from('fleet_master').insert([payload])
}
