/**
 * Module permissions service — the role × module access matrix.
 * Reads the global (org_id IS NULL) permission rows and writes changes through
 * the Admin-gated `set_module_permissions` RPC (V64). Every method throws on error.
 */
import { supabase, unwrap, ServiceError } from './_client'

/**
 * Load the global permission map: { [role]: { [module_key]: boolean } }.
 * Only org-wide (org_id IS NULL) rows — the defaults every workspace inherits.
 */
export async function listGlobalPermissions() {
  const rows = unwrap(
    await supabase
      .from('module_permissions')
      .select('role,module_key,enabled')
      .is('org_id', null),
  )
  const map = {}
  for (const r of rows || []) {
    ;(map[r.role] ||= {})[r.module_key] = r.enabled === true
  }
  return map
}

/**
 * Persist a batch of access changes.
 * @param {{ role: string, module_key: string, enabled: boolean }[]} changes
 * @returns {Promise<number>} rows written
 */
export async function saveModulePermissions(changes) {
  const clean = (changes || []).filter(
    (c) => c && c.role && c.module_key && typeof c.enabled === 'boolean',
  )
  if (!clean.length) return 0
  const { data, error } = await supabase.rpc('set_module_permissions', { p_changes: clean })
  if (error) throw new ServiceError(error.message, error.code, error)
  return data ?? clean.length
}
