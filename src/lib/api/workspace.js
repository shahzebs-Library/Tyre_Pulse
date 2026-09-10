import { supabase, applyCountry } from './_client'
import { WORKSPACE_COUNTS } from '../workspaceAccess'

export async function loadWorkspaceCount(moduleKey, { country, profile, signal }) {
  const config = WORKSPACE_COUNTS[moduleKey]
  if (!config || !profile?.id) throw new Error('Workspace access unavailable')
  // These tables have verified restrictive organisation/country/site RLS.
  // Use that canonical scope rather than guessing from one profile.site value.
  const query = applyCountry(supabase.from(config.table).select('id', { head: true, count: 'exact' }), country)
  const { count, error } = await query.abortSignal(signal)
  if (error) throw error
  if (count == null) throw new Error('Count unavailable')
  return count
}
