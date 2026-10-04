/**
 * Module permissions service — the role × module access matrix.
 * Reads the global (org_id IS NULL) permission rows and writes changes through
 * the Admin-gated `set_module_permissions` RPC (V64). Every method throws on error.
 */
import { supabase, unwrap, ServiceError } from './_client'
import { toUserMessage } from '../safeError'
import { serializeOverrides } from '../permissionMatrix'

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
/** @param {string} [reason] written to access_audit.reason by the trigger */
export async function saveModulePermissions(changes, reason = null) {
  const clean = (changes || []).filter(
    (c) => c && c.role && c.module_key && typeof c.enabled === 'boolean',
  )
  if (!clean.length) return 0
  const { data, error } = await supabase.rpc('set_module_permissions', { p_changes: clean, ...(reason ? { p_reason: String(reason).trim() } : {}) })
  if (error) throw new ServiceError(toUserMessage(error), error.code, error)
  return data ?? clean.length
}

/** Atomically save view rows and the complete capability override envelope. */
export async function saveAccessControlMatrix({ viewChanges = [], overrides, reason = null } = {}) {
  const clean = (viewChanges || []).filter(
    (c) => c && c.role && c.module_key && typeof c.enabled === 'boolean',
  )
  const { data, error } = await supabase.rpc('save_access_control_matrix', {
    p_view_changes: clean,
    p_capability_envelope: overrides === undefined ? null : serializeOverrides(overrides),
    p_reason: reason || null,
  })
  if (error) throw new ServiceError(toUserMessage(error), error.code, error)
  return data || { view_changes: clean.length, capabilities_saved: overrides !== undefined }
}
