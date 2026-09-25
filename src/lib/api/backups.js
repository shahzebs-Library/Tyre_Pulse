/**
 * Backups service - the single Supabase boundary for the super-admin Automated
 * Backups console (Admin Control Module 4, V257). Mirrors the sibling service
 * modules (adminAccess.js / systemLogs.js / dataReconciliation.js): thin,
 * faithful pass-throughs over the security-definer RPCs with `unwrap` /
 * `ServiceError` error surfacing (no raw Supabase errors reach the UI).
 *
 * AUTH-SENSITIVE: every RPC self-gates on is_super_admin() in the database and
 * raises 42501 for anyone else; this layer never re-implements the gate, it only
 * relocates the call and normalises error surfacing. Do NOT rename an RPC or
 * reshape its `p_*` argument object here - the enforcement lives in Postgres.
 *
 * The nightly snapshot job runs via pg_cron in the database; this service only
 * exposes on-demand snapshotting, listing, restore preview and the NON
 * DESTRUCTIVE "restore missing rows" recovery path.
 */
import { supabase, unwrap, isNotProvisioned } from './_client'
import { isApprovalRequiredError, APPROVAL_REQUIRED_MESSAGE } from '../dualControl'

/**
 * True ONLY when the failure is "the RPC / table is not provisioned yet"
 * (pre-migration), by error CODE. It used to also treat 42501 (not a
 * super-admin) and any "does not exist" text as missing, which made a
 * permission denial render as "no backups have been taken" - the one claim a
 * backups page must never make falsely. A permission or network failure now
 * surfaces as an error.
 */
export function isMissingRelation(err) {
  return isNotProvisioned(err)
}

/**
 * Take a backup snapshot of the core data right now via
 * `create_backup_snapshot`. Super-admin only (DB raises 42501 otherwise).
 *
 * @param {string} [reason='manual']  free-text reason recorded on the snapshot
 * @returns {Promise<{
 *   id: string, reason: string, taken_at: string, taken_by: string,
 *   table_count: number, total_rows: number
 * }>} the new snapshot header
 */
export async function createBackupSnapshot(reason = 'manual') {
  return unwrap(
    await supabase.rpc('create_backup_snapshot', { p_reason: reason }),
  )
}

/**
 * List recent backup snapshots (newest first) via `list_backup_snapshots`.
 * Returns [] only when the RPC is genuinely not deployed yet; a permission
 * denial, network failure or any other error THROWS a sanitised ServiceError so
 * the console shows an error with Retry instead of "no snapshots".
 *
 * @param {number} [limit=60]  max snapshots to return
 * @returns {Promise<Array<{
 *   id: string, reason: string, taken_at: string, taken_by: string,
 *   table_count: number, total_rows: number,
 *   tables: Array<{ table_name: string, row_count: number }>
 * }>>}
 */
export async function listBackupSnapshots(limit = 60) {
  const res = await supabase.rpc('list_backup_snapshots', { p_limit: limit })
  if (res?.error && isNotProvisioned(res.error)) return []
  const data = unwrap(res)
  return Array.isArray(data) ? data : []
}

/**
 * Preview what a restore of one table from one snapshot would do, WITHOUT
 * changing anything, via `backup_restore_preview`. Super-admin only.
 *
 * @param {string} snapshotId  the snapshot uuid
 * @param {string} table       the table name to preview
 * @returns {Promise<{
 *   table: string, taken_at: string, snapshot_rows: number,
 *   current_rows: number, missing_rows: number, newer_current_rows: number
 * }>} row counts describing the safe recoverable delta
 */
export async function restorePreview(snapshotId, table) {
  return unwrap(
    await supabase.rpc('backup_restore_preview', {
      p_snapshot_id: snapshotId,
      p_table: table,
    }),
  )
}

/**
 * Recover ONLY the rows that existed in the snapshot but are missing from the
 * live table now, via `backup_restore_missing`. NON DESTRUCTIVE: it re-inserts
 * missing rows and never overwrites or deletes existing live rows. Super-admin
 * only.
 *
 * @param {string} snapshotId  the snapshot uuid
 * @param {string} table       the table name to recover into
 * @returns {Promise<{ table: string, restored: number }>} count of rows re-added
 */
export async function restoreMissing(snapshotId, table) {
  const res = await supabase.rpc('backup_restore_missing', {
      p_snapshot_id: snapshotId,
      p_table: table,
    })
  // Dual control: a gated action says plainly that it needs a second approval.
  if (res?.error && isApprovalRequiredError(res.error)) throw new Error(APPROVAL_REQUIRED_MESSAGE)
  return unwrap(res)
}
