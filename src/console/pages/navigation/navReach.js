/**
 * How many roles are allowed each module in Access Control (global rows of
 * module_permissions). Used by the Navigation editor to say how many roles a
 * hidden page used to reach. Roles without a saved row follow their built-in
 * defaults, so this is a count of explicit allows, labelled as such.
 * Throws on a failed read so the caller can show N/A instead of zero.
 */
import { supabase } from '../../../lib/supabase'

export async function rolesAllowedByModule() {
  const { data, error } = await supabase
    .from('module_permissions')
    .select('role,module_key,enabled')
    .is('org_id', null)
    .limit(5000)
  if (error) throw error
  const out = {}
  for (const r of data || []) if (r.enabled === true) out[r.module_key] = (out[r.module_key] || 0) + 1
  return out
}
