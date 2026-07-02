/**
 * Users service - `profiles` records plus the admin `audit_log` read. This is
 * the single Supabase boundary for the User Management screen (list, inline
 * role/approval changes, edit, delete) as it migrates off inline supabase.
 *
 * AUTH-SENSITIVE: `adminUpdateProfile` is a thin pass-through over the
 * security-definer RPC `admin_update_profile`. The RPC name and the caller's
 * argument object are forwarded verbatim - never rename the RPC, add, drop, or
 * reshape args here. The page owns the arg construction; this layer only
 * relocates the call and normalises error surfacing.
 */
import { supabase, unwrap, ServiceError } from './_client'

// Least-privilege column set for the admin user list + edit modal. Covers every
// profile field the page reads or writes. Omits push_token/avatar_url and
// org-internal columns (organisation_id, org_id, is_super_admin metadata beyond
// the flag the UI surfaces) that the page never touches.
const COLS =
  'id,username,full_name,role,employee_id,approved,country,countries,site,region,locked,is_super_admin,pending_reason,email,phone,last_login_at,login_count,created_at,module_overrides,notes,updated_at'

/**
 * List profiles, newest first - mirrors the page's
 * `.from('profiles').select('*').order('created_at', desc)`.
 * Returns the rows (throws ServiceError on failure; the page catches and maps
 * RLS/permission codes to its "RLS blocked" state).
 */
export async function listProfiles() {
  return unwrap(
    await supabase
      .from('profiles')
      .select(COLS)
      .order('created_at', { ascending: false })
  )
}

/**
 * Read the most recent audit_log entries (default 100), newest first - mirrors
 * the page's Activity tab query.
 */
export async function listAuditLog({ limit = 100 } = {}) {
  return unwrap(
    await supabase
      .from('audit_log')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(limit)
  )
}

/**
 * Thin wrapper over `supabase.rpc('admin_update_profile', args)`. The args
 * object is passed through UNCHANGED. Returns the RPC's data payload (e.g.
 * `{ success, error }`); throws ServiceError (carrying the Postgres/PostgREST
 * `code`) on a transport error so the caller can branch on `err.code`
 * (PGRST202 / "does not exist" → fallback, etc.) exactly as before.
 *
 * @param {object} args  the exact `p_*` argument object built by the caller
 */
export async function adminUpdateProfile(args) {
  const { data, error } = await supabase.rpc('admin_update_profile', args)
  if (error) throw new ServiceError(error.message, error.code, error)
  return data
}

/**
 * Direct `profiles` update by id - the fallback path used when the RPC function
 * is not deployed. Throws ServiceError (carrying `code`) on failure so the
 * caller can map 42501 / PGRST301 to a permission message.
 *
 * @param {string} id
 * @param {object} patch  column → value updates (built by the caller)
 */
export async function updateProfileById(id, patch) {
  return unwrap(
    await supabase.from('profiles').update(patch).eq('id', id)
  )
}

/** Delete a profile by id. Throws ServiceError on failure. */
export async function deleteProfileById(id) {
  return unwrap(
    await supabase.from('profiles').delete().eq('id', id)
  )
}
