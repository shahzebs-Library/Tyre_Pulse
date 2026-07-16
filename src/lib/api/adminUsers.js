/**
 * Admin Users service (Module 7 - Console Admin Roles, V256). The single
 * Supabase boundary for the super-admin "who administers the console" registry.
 * Mirrors the sibling admin services (adminAccess.js / accessGrants.js):
 * `unwrap`/`ServiceError` error surfacing (no raw Supabase errors to callers)
 * and thin, faithful pass-throughs over the security-definer RPCs.
 *
 * AUTH-SENSITIVE: `admin_set_admin_user` self-gates on is_super_admin() in the
 * database and the `admin_users` table is super-admin-only via RLS. This layer
 * never re-implements the gate, it only relocates the call and normalises error
 * surfacing. Do NOT rename an RPC or reshape its `p_*` argument object here -
 * the enforcement lives in Postgres.
 */
import { supabase, unwrap, ServiceError } from './_client'

/** The three console admin roles (matches the admin_users.admin_role CHECK). */
export const ADMIN_ROLE_VALUES = ['super_admin', 'regional_admin', 'viewer']

/** Least-privilege column list for the admin_users registry. */
const ADMIN_USER_COLS =
  'id,user_id,admin_role,regions,active,note,created_at,updated_at'

/**
 * List every console admin-role assignment (newest first). Super-admin only via
 * RLS; a missing relation (table not yet migrated) degrades to [] rather than
 * throwing so the page can render an honest empty state.
 *
 * @returns {Promise<Array<object>>} admin_users rows (empty array when none)
 */
export async function listAdminUsers() {
  const { data, error } = await supabase
    .from('admin_users')
    .select(ADMIN_USER_COLS)
    .order('created_at', { ascending: false })
  if (error) {
    // Missing relation (e.g. migration not applied) => honest empty list.
    if (error.code === '42P01') return []
    throw new ServiceError(error.message, error.code, error)
  }
  return data ?? []
}

/**
 * Read the CURRENT user's console admin role via `my_admin_role`. Never throws
 * - defaults to 'viewer' (the least-privileged role) on a null payload or any
 * RPC error so the UI always has a safe floor.
 *
 * @returns {Promise<string>} 'super_admin' | 'regional_admin' | 'viewer'
 */
export async function getMyAdminRole() {
  try {
    const role = unwrap(await supabase.rpc('my_admin_role'))
    return typeof role === 'string' && role ? role : 'viewer'
  } catch {
    return 'viewer'
  }
}

/**
 * Create or update a console admin-role assignment via `admin_set_admin_user`
 * (super-admin gated in the DB; returns the upserted row as jsonb).
 *
 * @param {object}   params
 * @param {string}   params.userId          target user's uuid (profiles.id)
 * @param {string}   params.role            'super_admin'|'regional_admin'|'viewer'
 * @param {string[]} [params.regions=[]]    region scope (regional_admin only)
 * @param {string?}  [params.note=null]     optional free-text note
 * @param {boolean}  [params.active=true]   whether the assignment is active
 * @returns {Promise<object>} the upserted admin_users row
 */
export async function setAdminUser({
  userId,
  role,
  regions = [],
  note = null,
  active = true,
}) {
  return unwrap(
    await supabase.rpc('admin_set_admin_user', {
      p_user_id: userId,
      p_role: role,
      p_regions: regions,
      p_note: note,
      p_active: active,
    }),
  )
}

/**
 * Remove a console admin-role assignment by its row id. Super-admin only via
 * RLS on the delete.
 *
 * @param {string} id  admin_users.id (uuid)
 * @returns {Promise<object[]>} the deleted rows (as returned by PostgREST)
 */
export async function removeAdminUser(id) {
  return unwrap(await supabase.from('admin_users').delete().eq('id', id))
}

/**
 * Search profiles by email or name (for picking a user to grant an admin role).
 * Case-insensitive, capped at 20 rows. A blank query returns the most-recent
 * profiles. Returns [] rather than throwing so the picker degrades cleanly.
 *
 * @param {string} query  free-text search over email/full_name
 * @returns {Promise<Array<object>>} matching profile rows (id/email/name/role/...)
 */
export async function searchProfiles(query) {
  let q = supabase
    .from('profiles')
    .select('id,email,full_name,role,country,region')
    .order('created_at', { ascending: false })
    .limit(20)
  const term = (query ?? '').trim()
  if (term) {
    const s = term.replace(/[%,()]/g, ' ')
    q = q.or(`email.ilike.%${s}%,full_name.ilike.%${s}%`)
  }
  const { data, error } = await q
  if (error) return []
  return data ?? []
}
