/**
 * Data Reconciliation service - the single Supabase boundary for the tyre/asset
 * data-integrity console (V232/V235 recon_* RPCs). Mirrors the sibling service
 * modules (adminAccess.js / accessGrants.js): thin, faithful pass-throughs over
 * the security-definer RPCs with `unwrap`/`ServiceError` error surfacing (no raw
 * Supabase errors to callers) and honest empty results for the read paths.
 *
 * AUTH-SENSITIVE: every `recon_*` RPC self-gates server-side on super-admin /
 * Admin / Manager / Director and is org-scoped in the database. This layer never
 * re-implements the gate; it only relocates the call and normalises error
 * surfacing. Do NOT rename an RPC or reshape its `p_*` argument object here - the
 * enforcement lives in Postgres.
 *
 * Read paths (listOrphanAssets / listDuplicateTyres / listSerialConflicts) never
 * throw: they return [] on a null payload or any RPC error so the console can
 * degrade to an honest empty state. The backfill and merge write paths surface
 * the ServiceError so the UI can report a failed mutation.
 */
import { supabase, unwrap } from './_client'

/**
 * List tyres whose asset is missing from `vehicle_fleet` (orphaned assets) via
 * the `recon_orphan_assets` RPC. Never throws - returns [] on a null payload or
 * any RPC error.
 *
 * @returns {Promise<Array<{
 *   asset_no: string,
 *   vehicle_type: string,
 *   country: string,
 *   tyre_count: number
 * }>>} orphan-asset rows (empty array when none or on error)
 */
export async function listOrphanAssets() {
  try {
    const { data, error } = await supabase.rpc('recon_orphan_assets')
    if (error) return []
    return Array.isArray(data) ? data : []
  } catch {
    return []
  }
}

/**
 * List fully-identical duplicate tyre rows (byte-identical, safe to merge) via
 * the `recon_duplicate_tyres` RPC. Never throws - returns [] on a null payload
 * or any RPC error.
 *
 * @returns {Promise<Array<{
 *   serial_no: string,
 *   asset_no: string,
 *   row_count: number,
 *   keep_id: string,
 *   remove_ids: string[]
 * }>>} duplicate-group rows (empty array when none or on error)
 */
export async function listDuplicateTyres() {
  try {
    const { data, error } = await supabase.rpc('recon_duplicate_tyres')
    if (error) return []
    return Array.isArray(data) ? data : []
  } catch {
    return []
  }
}

/**
 * List serial-number conflicts - a tyre serial that appears against more than
 * one asset (INFORMATIONAL: normally a tyre that moved between vehicles, not a
 * fault) via the `recon_serial_conflicts` RPC. Never throws - returns [] on a
 * null payload or any RPC error.
 *
 * @returns {Promise<Array<{
 *   serial_no: string,
 *   asset_count: number,
 *   rows: Array<{ id: string, asset_no: string, status: string, created_at: string }>
 * }>>} serial-conflict rows (empty array when none or on error)
 */
export async function listSerialConflicts() {
  try {
    const { data, error } = await supabase.rpc('recon_serial_conflicts')
    if (error) return []
    return Array.isArray(data) ? data : []
  } catch {
    return []
  }
}

/**
 * Backfill a single missing asset into `vehicle_fleet` via the `recon_backfill_asset`
 * RPC. Throws a ServiceError (carrying the Postgres code) on failure.
 *
 * @param {string} assetNo  the asset number to insert into vehicle_fleet
 * @returns {Promise<string>} the new vehicle_fleet row's uuid
 */
export async function backfillAsset(assetNo) {
  return unwrap(
    await supabase.rpc('recon_backfill_asset', { p_asset_no: assetNo }),
  )
}

/**
 * Backfill every orphaned asset into `vehicle_fleet` in one call via the
 * `recon_backfill_all_orphan_assets` RPC. Throws a ServiceError on failure.
 *
 * @returns {Promise<number>} count of assets backfilled
 */
export async function backfillAllOrphanAssets() {
  return unwrap(await supabase.rpc('recon_backfill_all_orphan_assets'))
}

/**
 * Merge (delete) a group of byte-identical duplicate tyre rows via the
 * `recon_merge_duplicate` RPC, keeping `keepId` and removing `removeIds`. The
 * server refuses the merge if the rows are not identical. Throws a ServiceError
 * on failure.
 *
 * @param {string}   keepId     the uuid to keep
 * @param {string[]} removeIds  the duplicate uuids to delete
 * @returns {Promise<number>} count of rows removed
 */
export async function mergeDuplicate(keepId, removeIds) {
  return unwrap(
    await supabase.rpc('recon_merge_duplicate', {
      p_keep_id: keepId,
      p_remove_ids: removeIds,
    }),
  )
}
