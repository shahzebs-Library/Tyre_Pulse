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
import { supabase, unwrap } from './_client'

/**
 * True when the failure is "the RPC / table is not provisioned yet"
 * (pre-migration) or a plain read/permission error we want the list view to
 * degrade over rather than surface raw.
 */
export function isMissingRelation(err) {
  const code = err?.code || err?.cause?.code
  const msg = String(err?.message || err?.cause?.message || '').toLowerCase()
  return (
    code === '42P01' ||
    code === '42883' ||        // undefined_function (RPC not deployed yet)
    code === 'PGRST202' ||     // PostgREST: could not find the function
    code === 'PGRST205' ||     // PostgREST: could not find the table
    code === '42501' ||        // insufficient_privilege (not a super-admin)
    msg.includes('does not exist') ||
    msg.includes('could not find') ||
    msg.includes('schema cache')
  )
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
 * Returns an array; degrades to [] when the RPC is missing, the caller is not a
 * super-admin, or any other read error occurs, so the console can render its
 * honest empty state instead of surfacing a raw error.
 *
 * @param {number} [limit=60]  max snapshots to return
 * @returns {Promise<Array<{
 *   id: string, reason: string, taken_at: string, taken_by: string,
 *   table_count: number, total_rows: number,
 *   tables: Array<{ table_name: string, row_count: number }>
 * }>>}
 */
export async function listBackupSnapshots(limit = 60) {
  try {
    const data = unwrap(
      await supabase.rpc('list_backup_snapshots', { p_limit: limit }),
    )
    return Array.isArray(data) ? data : []
  } catch {
    return []
  }
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
  return unwrap(
    await supabase.rpc('backup_restore_missing', {
      p_snapshot_id: snapshotId,
      p_table: table,
    }),
  )
}
