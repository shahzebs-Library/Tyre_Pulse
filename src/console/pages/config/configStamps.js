/**
 * When each system_config key was last written and by whom, straight from the
 * row (system_config.updated_at / updated_by). Used where the change history
 * (system_config_history, from 30 Sep 2026) has no entry yet, so the screen
 * still shows the real last-write time instead of "Not recorded".
 * updated_by was not stamped before 30 Sep 2026, so it may be empty: the
 * caller says "person not recorded" then. Throws on a failed read.
 */
import { supabase } from '../../../lib/supabase'

export async function fetchConfigStamps(keys = null) {
  let q = supabase.from('system_config').select('key,updated_at,updated_by')
  if (Array.isArray(keys) && keys.length) q = q.in('key', keys)
  const { data, error } = await q.limit(500)
  if (error) throw error
  const out = {}
  for (const r of data || []) out[r.key] = { updated_at: r.updated_at || null, updated_by: r.updated_by || null }
  return out
}
