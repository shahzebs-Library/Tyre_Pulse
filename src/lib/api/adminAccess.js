/**
 * Admin Access service - the single Supabase boundary for the super-admin
 * Access Control console (V228 access_audit, V229 capability helpers, V230
 * admin_* RPCs). Mirrors the sibling service modules (accessGrants.js /
 * users.js): `unwrap`/`ServiceError` error surfacing (no raw Supabase errors
 * to callers) and thin, faithful pass-throughs over the security-definer RPCs.
 *
 * AUTH-SENSITIVE: every `admin_*` RPC self-gates on is_super_admin() in the
 * database and raises 42501 for anyone else; this layer never re-implements the
 * gate, it only relocates the call and normalises error surfacing. Do NOT
 * rename an RPC or reshape its `p_*` argument object here - the enforcement
 * lives in Postgres.
 */
import { supabase, unwrap } from './_client'

/**
 * Resolve one user's full effective access matrix (role + per-module role/grant
 * resolution) via `admin_get_effective_access`. Super-admin only (DB raises
 * 42501 otherwise).
 *
 * @param {string} userId  the target user's uuid
 * @returns {Promise<{
 *   role: string,
 *   is_super: boolean,
 *   country: string[],
 *   modules: Array<{
 *     key: string,
 *     role_allows: boolean,
 *     override: 'grant'|'revoke'|null,
 *     caps: Record<string, 'grant'|'revoke'>,
 *     final: boolean,
 *     reason: string
 *   }>
 * }>} the resolved access object
 */
export async function getEffectiveAccess(userId) {
  return unwrap(
    await supabase.rpc('admin_get_effective_access', { p_user_id: userId }),
  )
}

/**
 * Read the CURRENT user's capability overlay via `get_my_capabilities`. Never
 * throws - defaults to `{}` on a null payload or any RPC error so the UI can
 * degrade to role-only access.
 *
 * @returns {Promise<Record<string, Record<string, 'grant'|'revoke'>>>}
 *   nested map { module_key: { capability: 'grant'|'revoke' } }
 */
export async function getMyCapabilities() {
  try {
    const { data, error } = await supabase.rpc('get_my_capabilities')
    if (error) return {}
    return data && typeof data === 'object' ? data : {}
  } catch {
    return {}
  }
}

/**
 * Set a user's country scope (profiles.country, a text[]) via
 * `admin_set_user_country`. Super-admin only.
 *
 * @param {string}   userId     the target user's uuid
 * @param {string[]} countries  the new country array (replaces the current one)
 * @returns {Promise<void>}
 */
export async function setUserCountry(userId, countries) {
  return unwrap(
    await supabase.rpc('admin_set_user_country', {
      p_user_id: userId,
      p_countries: countries,
    }),
  )
}

/**
 * Set a user's site scope (profiles.sites, a text[]) via `admin_set_user_sites`
 * (V269). Server-side gated to super-admin/Admin. Pass null or an empty array
 * to clear the scope, which means the user sees every site. Site visibility is
 * enforced by RESTRICTIVE RLS policies in the database (app_can_see_site).
 *
 * @param {string}          userId  the target user's uuid
 * @param {string[] | null} sites   the new site array (replaces the current
 *                                  one); null/empty clears = all sites
 * @returns {Promise<void>}
 */
export async function adminSetUserSites(userId, sites) {
  return unwrap(
    await supabase.rpc('admin_set_user_sites', {
      p_user_id: userId,
      p_sites: Array.isArray(sites) && sites.length > 0 ? sites : null,
    }),
  )
}

/**
 * Grant or revoke a capability across many users in one call via
 * `admin_bulk_set_grant`. Super-admin only.
 *
 * @param {object}   params
 * @param {string[]} params.userIds              target user uuids
 * @param {string}   params.moduleKey            module/capability key
 * @param {string}   [params.capability='view']  capability being set
 * @param {string}   [params.effect='grant']     'grant' | 'revoke'
 * @param {string?}  [params.expiresAt=null]     optional ISO expiry (timestamptz)
 * @returns {Promise<number>} count of users touched
 */
export async function bulkSetGrant({
  userIds,
  moduleKey,
  capability = 'view',
  effect = 'grant',
  expiresAt = null,
}) {
  return unwrap(
    await supabase.rpc('admin_bulk_set_grant', {
      p_user_ids: userIds,
      p_module_key: moduleKey,
      p_capability: capability,
      p_effect: effect,
      p_expires_at: expiresAt,
    }),
  )
}

/**
 * Change the role of many users in one call via `admin_bulk_set_role`. Super-
 * admin only. The DB honours a last-super-admin lockout guard and never demotes
 * a super admin, so the returned count may be lower than `userIds.length`.
 *
 * @param {string[]} userIds  target user uuids
 * @param {string}   role     the role to assign
 * @returns {Promise<number>} count of users whose role actually changed
 */
export async function bulkSetRole(userIds, role) {
  return unwrap(
    await supabase.rpc('admin_bulk_set_role', {
      p_user_ids: userIds,
      p_role: role,
    }),
  )
}

/**
 * Clone a role's module permission matrix into a new custom role via
 * `admin_clone_role`. Super-admin only. Idempotent (re-running is a no-op).
 *
 * @param {string} source   the role name to copy from
 * @param {string} newName  the new custom role name
 * @returns {Promise<void>}
 */
export async function cloneRole(source, newName) {
  return unwrap(
    await supabase.rpc('admin_clone_role', {
      p_source: source,
      p_new_name: newName,
    }),
  )
}

/**
 * List access-audit rows (newest first) via `admin_list_access_audit`. Super-
 * admin only. Optionally filter to a single target user.
 *
 * @param {object}  [params]
 * @param {number}  [params.limit=100]  max rows to return
 * @param {string?} [params.target=null] optional target_user uuid filter
 * @returns {Promise<Array<object>>} audit rows (empty array when none)
 */
export async function listAccessAudit({ limit = 100, target = null } = {}) {
  return (
    unwrap(
      await supabase.rpc('admin_list_access_audit', {
        p_limit: limit,
        p_target: target,
      }),
    ) || []
  )
}
