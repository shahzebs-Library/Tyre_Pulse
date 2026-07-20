/**
 * dataCleanup.js — client boundary for the Console Data Cleanup module (V289).
 *
 * Super-admin only, controlled deletion of OLD records. The DB does all the real
 * work behind self-gating SECURITY DEFINER RPCs that resolve the table from a
 * fixed server-side safelist (no injection) and take a recovery SNAPSHOT before
 * any delete, so a purge is recoverable from Console -> Backups. This layer is a
 * thin, error-safe pass-through.
 */
import { supabase } from './_client'
import { toUserMessage } from '../safeError'

/** All cleanup targets with total rows + oldest/newest date. */
export async function listCleanupTargets() {
  const { data, error } = await supabase.rpc('admin_data_cleanup_targets')
  if (error) throw new Error(toUserMessage(error, 'Could not load cleanup targets.'))
  return Array.isArray(data) ? data : []
}

/** Count how many rows of `key` are older than the `before` (YYYY-MM-DD) cutoff. */
export async function previewCleanup(key, before) {
  const { data, error } = await supabase.rpc('admin_data_cleanup_preview', { p_key: key, p_before: before })
  if (error) throw new Error(toUserMessage(error, 'Could not preview the cleanup.'))
  return data || { count: 0 }
}

/** Delete rows of `key` older than `before`. Snapshots first; returns {deleted, snapshot}. */
export async function runCleanup(key, before) {
  const { data, error } = await supabase.rpc('admin_data_cleanup_run', { p_key: key, p_before: before })
  if (error) throw new Error(toUserMessage(error, 'Could not run the cleanup.'))
  return data || { deleted: 0 }
}

/** Pure: the YYYY-MM-DD date `months` months before `from` (default today). */
export function monthsAgoISO(months, from = new Date()) {
  const d = new Date(from.getTime())
  d.setMonth(d.getMonth() - Math.max(0, Number(months) || 0))
  return d.toISOString().slice(0, 10)
}

/** Age presets offered in the UI (months). */
export const AGE_PRESETS = Object.freeze([
  { months: 6, label: '6 months' },
  { months: 12, label: '1 year' },
  { months: 24, label: '2 years' },
  { months: 36, label: '3 years' },
  { months: 60, label: '5 years' },
])
