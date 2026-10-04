/**
 * dataOpsCenter.js - reads behind the Control Center DATA screens that no
 * existing service covered: the recent data-change feed, the cleanup run
 * history, the retention switches and the tyre-learning change history.
 *
 * All read-only and super-admin reached (the whole /console is gated; RLS on
 * console_sessions and system_logs enforces it at the database). Errors throw a
 * sanitised ServiceError; the pages show them with a Retry, never as empty data.
 */
import { supabase, toServiceError } from './_client'
import { DATA_ACTION_KEYS, shapeDataActivity, shapeCleanupRuns, readRetention, groupLearnBatches } from '../dataOpsCenter'

/** Recent console actions that changed data, with the actor's display name. */
export async function listDataActivity(limit = 60) {
  const { data, error } = await supabase
    .from('console_sessions')
    .select('id, admin_id, action, target_type, details, created_at')
    .in('action', DATA_ACTION_KEYS)
    .order('created_at', { ascending: false })
    .limit(Math.min(Math.max(Number(limit) || 60, 1), 200))
  if (error) throw toServiceError(error, 'Could not read the recent data changes.')
  const rows = Array.isArray(data) ? data : []
  const ids = [...new Set(rows.map((r) => r.admin_id).filter(Boolean))].slice(0, 50)
  let names = {}
  if (ids.length) {
    // Names only: e-mail addresses are never shown on this feed.
    const { data: people } = await supabase.from('profiles').select('id, full_name').in('id', ids).limit(50)
    names = Object.fromEntries((people || []).map((p) => [p.id, p.full_name || 'A super admin']))
  }
  return shapeDataActivity(rows, names)
}

/** Past cleanup runs, from the system_logs rows admin_data_cleanup_run writes. */
export async function listCleanupRuns(limit = 50) {
  const { data, error } = await supabase
    .from('system_logs')
    .select('id, message, detail, created_at')
    .eq('source', 'data-cleanup')
    .order('created_at', { ascending: false })
    .limit(Math.min(Math.max(Number(limit) || 50, 1), 200))
  if (error) throw toServiceError(error, 'Could not read the cleanup history.')
  return shapeCleanupRuns(data)
}

/** Retention and dual-control switches that decide how cleanup behaves. */
export async function getRetentionSettings() {
  const { data, error } = await supabase
    .from('system_config')
    .select('key, value')
    .in('key', ['audit_retention_days', 'data_retention_months', 'dual_control_enabled'])
  if (error) throw toServiceError(error, 'Could not read the retention settings.')
  return readRetention(data)
}

/**
 * The latest tyre-learning changes grouped by batch. Reads at most `limit`
 * changed rows (one per tyre record), so a very large old batch may show only
 * part of its row count; the page says so.
 */
export async function listLearnBatches(facts = [], limit = 1000) {
  const { data, error } = await supabase
    .from('tyre_learn_apply_log')
    .select('batch_id, fact_id, target_field, old_value, new_value, created_at')
    .order('created_at', { ascending: false })
    .limit(Math.min(Math.max(Number(limit) || 1000, 1), 1000))
  if (error) throw toServiceError(error, 'Could not read the learning history.')
  const byId = Object.fromEntries((facts || []).map((f) => [f.id, f]))
  const rows = Array.isArray(data) ? data : []
  return { batches: groupLearnBatches(rows, byId), capped: rows.length >= limit }
}
