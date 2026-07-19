/**
 * Custom Roles service — the self-service role builder (V211 `custom_roles`).
 *
 * A custom role is a name + description in `custom_roles`; its module access is
 * granted through the EXISTING permission engine (`set_module_permissions` RPC →
 * `module_permissions` rows keyed by the role string), which AuthContext already
 * enforces via hasPermission. So creating a role and granting access reuses the
 * live enforcement path — no new enforcement code.
 *
 * Admin-gated writes are enforced in RLS (custom_roles) and in the RPC.
 * Renaming a role is intentionally NOT supported: module_permissions rows and
 * users' `profiles.role` are keyed by the name string, so a rename would orphan
 * both. Only description/active are editable; access is edited via setRoleModules.
 */
import { supabase, unwrap } from './_client'
import { saveModulePermissions, listGlobalPermissions } from './modulePermissions'
import { ACCESS_ROLES, ALL_MODULES } from '../moduleCatalog'

const COLS = 'id,organisation_id,name,description,active,created_by,created_at,updated_at'

const BUILTIN = new Set([...ACCESS_ROLES, 'Maintenance Supervisor', 'Store Keeper'])

/** True when a role name is a reserved built-in (case-insensitive). */
export function isBuiltInRole(name) {
  const n = String(name || '').trim().toLowerCase()
  return [...BUILTIN].some((b) => b.toLowerCase() === n)
}

/**
 * Pure reducer: profile rows -> { roleName: count }. Every requested name is
 * seeded with 0 so a role with no users reads an honest 0 (never undefined).
 * Rows whose role is not in `names` are ignored.
 */
export function reduceRoleCounts(rows, names) {
  const counts = {}
  for (const n of names || []) {
    if (n) counts[n] = 0
  }
  for (const r of rows || []) {
    const role = r?.role
    if (role != null && Object.prototype.hasOwnProperty.call(counts, role)) counts[role] += 1
  }
  return counts
}

/**
 * Count assigned users per role name (RLS-scoped: only profiles the caller can
 * see are counted). Degrades to {} on any error so the UI never blocks on it.
 * @param {string[]} names
 * @returns {Promise<Record<string, number>>}
 */
export async function countUsersByRole(names) {
  const clean = (names || []).filter(Boolean)
  if (!clean.length) return {}
  try {
    const rows = unwrap(
      await supabase.from('profiles').select('role').in('role', clean),
    ) || []
    return reduceRoleCounts(rows, clean)
  } catch {
    return {}
  }
}

/**
 * Pure name generator for the Duplicate action: `<name> copy`, then
 * `<name> copy 2`, `copy 3`, ... until it collides with neither an existing
 * role name (case-insensitive) nor a built-in role.
 */
export function duplicateName(name, existingNames = []) {
  const base = `${String(name || '').trim()} copy`.trim()
  const taken = new Set((existingNames || []).filter(Boolean).map((n) => String(n).trim().toLowerCase()))
  const isFree = (candidate) => !taken.has(candidate.toLowerCase()) && !isBuiltInRole(candidate)
  if (isFree(base)) return base
  for (let i = 2; i <= 99; i += 1) {
    const candidate = `${base} ${i}`
    if (isFree(candidate)) return candidate
  }
  return `${base} ${Date.now()}`
}

function isMissingRelation(err) {
  const code = err?.code || err?.cause?.code
  const msg = String(err?.message || '').toLowerCase()
  return code === '42P01' || code === 'PGRST205' ||
    msg.includes('does not exist') || msg.includes('could not find the table') ||
    msg.includes('schema cache') || (msg.includes('relation') && msg.includes('custom_roles'))
}

/** List custom roles for the current org (newest first). [] when not provisioned. */
export async function listCustomRoles() {
  try {
    return unwrap(
      await supabase.from('custom_roles').select(COLS).order('created_at', { ascending: false }),
    ) || []
  } catch (err) {
    if (isMissingRelation(err)) return []
    throw err
  }
}

/** Module keys a role currently has view access to (from the global permission map). */
export async function getRoleModules(role) {
  const map = await listGlobalPermissions()
  const perms = map[role] || {}
  return Object.entries(perms).filter(([, v]) => v === true).map(([k]) => k)
}

/**
 * Set the exact module set a role can access. Writes an enabled=true row for
 * EVERY chosen module key (any nav module, not just the curated base set) and an
 * enabled=false row for every key the role currently has but no longer wants, so
 * a removal always sticks. The write set is the union of: the wanted keys, the
 * role's currently-granted keys, and the curated base modules (a stable baseline
 * that is toggled off when not selected). This lets a custom role reach ALL ~163
 * navigable modules, not only the 37 curated ones.
 */
export async function setRoleModules(role, moduleKeys) {
  const want = new Set((moduleKeys || []).filter(Boolean))
  let current = []
  try { current = await getRoleModules(role) } catch { current = [] }
  const all = new Set([
    ...want,
    ...current,
    ...ALL_MODULES.map((m) => m.key),
  ])
  const changes = [...all].map((key) => ({ role, module_key: key, enabled: want.has(key) }))
  return saveModulePermissions(changes)
}

/**
 * Create a custom role and grant it the chosen modules in one step.
 * @param {{ name:string, description?:string, moduleKeys?:string[] }} values
 */
export async function createCustomRole({ name, description, moduleKeys } = {}) {
  const clean = String(name || '').trim()
  if (!clean) throw new Error('A role name is required.')
  if (isBuiltInRole(clean)) throw new Error(`"${clean}" is a built-in role name — choose a different name.`)

  const row = unwrap(
    await supabase.from('custom_roles')
      .insert({ name: clean, description: description ? String(description).slice(0, 500) : null })
      .select(COLS).single(),
  )
  // Grant the selected modules through the existing enforcement path.
  if (moduleKeys && moduleKeys.length) await setRoleModules(clean, moduleKeys)
  return row
}

/** Patch description/active only (name is immutable — see file header). */
export async function updateCustomRole(id, patch = {}) {
  const clean = {}
  if (patch.description !== undefined) clean.description = patch.description ? String(patch.description).slice(0, 500) : null
  if (patch.active !== undefined) clean.active = Boolean(patch.active)
  return unwrap(await supabase.from('custom_roles').update(clean).eq('id', id).select(COLS).single())
}

/**
 * Delete a custom role. Also revokes its module grants (disables every module
 * for the name) so no stale access lingers if the name is ever reused.
 */
export async function deleteCustomRole(id, name) {
  await supabase.from('custom_roles').delete().eq('id', id)
  if (name) {
    try { await setRoleModules(name, []) } catch { /* best-effort revoke */ }
  }
  return true
}
