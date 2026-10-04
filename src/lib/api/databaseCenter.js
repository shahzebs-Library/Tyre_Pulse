/**
 * Database Center service (console /console/database). Thin pass-throughs over
 * the super-admin RPCs from migration 20260930190000 (+ fix 20260930190100).
 * Every RPC gates on is_super_admin() in the database; nothing here re-checks
 * it. Failures throw a sanitised ServiceError so the page can show an error
 * with Retry instead of a fake empty state.
 */
import { supabase, unwrap, toServiceError } from './_client'

export async function getDatabaseOverview() {
  return unwrap(await supabase.rpc('admin_database_overview'))
}

export async function getTableDetail(schema, table) {
  return unwrap(await supabase.rpc('admin_table_detail', { p_schema: schema, p_table: table }))
}

export async function getQueryTimeTop(limit = 12) {
  return unwrap(await supabase.rpc('admin_query_time_top', { p_limit: limit }))
}

/** Clears the query-time counters. The database writes the audit row. */
export async function resetQueryCounters(reason) {
  return unwrap(await supabase.rpc('admin_query_time_reset', { p_reason: reason }))
}

export async function getTableFreshness() {
  return unwrap(await supabase.rpc('admin_table_freshness'))
}

/** Rebuilds a nightly copy into throwaway temp tables, counts, drops. Recorded. */
export async function runRestoreTest(snapshotId = null) {
  return unwrap(await supabase.rpc('admin_run_restore_test', { p_snapshot_id: snapshotId }))
}

export async function listRestoreTests(limit = 10) {
  const data = unwrap(await supabase.rpc('admin_list_restore_tests', { p_limit: limit }))
  return Array.isArray(data) ? data : []
}

/** Exact count of rows in the duplicate archive (what Duplicate Control removed). */
export async function countArchivedDuplicates() {
  const { count, error } = await supabase.from('dup_resolve_archive').select('id', { count: 'exact', head: true })
  if (error) throw toServiceError(error, 'Could not count archived duplicates.')
  return count ?? null
}
