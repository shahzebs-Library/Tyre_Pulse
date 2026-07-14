/**
 * User Access Grants service - the single Supabase boundary for per-user
 * capability grants/revocations (table `public.user_access_grants`, V225) and
 * the current user's effective grant map. Mirrors the sibling service modules
 * (users.js / orgUnits.js): explicit column lists (least-privilege selects),
 * `unwrap`/`ServiceError` error surfacing (no raw Supabase errors to callers),
 * and a graceful empty result when the relation has not been provisioned yet.
 *
 * AUTH-SENSITIVE: `setUserAccessGrant` / `revokeUserAccessGrant` are thin
 * pass-throughs over the security-definer RPCs `set_user_access_grant` /
 * `revoke_user_access_grant` (super-admin only; the DB raises 42501 otherwise).
 * Never rename the RPCs or reshape their `p_*` argument objects here - the RLS
 * and role checks live in the database, this layer only relocates the call and
 * normalises error surfacing.
 */
import { supabase, unwrap } from './_client'

// Least-privilege column set for the access-grant ledger. Covers every field the
// access-control UI reads (who/what/effect/why/when) without leaking internal
// bookkeeping columns beyond what is surfaced.
export const COLS =
  'id,organisation_id,user_id,module_key,capability,effect,note,' +
  'expires_at,granted_by,created_at,updated_at'

/** True when the failure is "table does not exist yet" (pre-migration). */
function isMissingRelation(err) {
  const code = err?.code || err?.cause?.code
  const msg = String(err?.message || err?.cause?.message || '').toLowerCase()
  return (
    code === '42P01' || code === 'PGRST205' ||
    msg.includes('does not exist') ||
    msg.includes('could not find the table') ||
    msg.includes('schema cache') ||
    (msg.includes('relation') && msg.includes('user_access_grants'))
  )
}

/**
 * List every access grant for a single user, newest first. Returns [] when the
 * table has not been provisioned yet (honest empty state, not an error).
 *
 * @param {string} userId  the target user's uuid
 * @returns {Promise<Array<object>>} the user's grant rows
 */
export async function listUserGrants(userId) {
  try {
    return unwrap(
      await supabase
        .from('user_access_grants')
        .select(COLS)
        .eq('user_id', userId)
        .order('created_at', { ascending: false }),
    ) || []
  } catch (err) {
    if (isMissingRelation(err)) return []
    throw err
  }
}

/**
 * Read the current user's effective view-capability grant map via the
 * `get_my_access_grants()` RPC. Returns a plain object keyed by module_key with
 * a 'grant' | 'revoke' effect value. Never throws - defaults to `{}` on a null
 * payload or any RPC error so the UI can degrade to role-only access.
 *
 * @returns {Promise<Record<string, 'grant'|'revoke'>>}
 */
export async function getMyAccessGrants() {
  try {
    const { data, error } = await supabase.rpc('get_my_access_grants')
    if (error) return {}
    return data && typeof data === 'object' ? data : {}
  } catch {
    return {}
  }
}

/**
 * Create (or upsert) an access grant for a user via the super-admin-only
 * `set_user_access_grant` RPC. The DB raises 42501 for non-super-admins; that
 * surfaces here as a ServiceError carrying the code.
 *
 * @param {object}  params
 * @param {string}  params.userId              target user's uuid
 * @param {string}  params.moduleKey           module/capability key
 * @param {string}  [params.capability='view'] capability being granted
 * @param {string}  [params.effect='grant']    'grant' | 'revoke'
 * @param {string?} [params.note=null]         optional audit note
 * @param {string?} [params.expiresAt=null]    optional ISO expiry (timestamptz)
 * @returns {Promise<string>} the new grant's uuid
 */
export async function setUserAccessGrant({
  userId,
  moduleKey,
  capability = 'view',
  effect = 'grant',
  note = null,
  expiresAt = null,
}) {
  return unwrap(
    await supabase.rpc('set_user_access_grant', {
      p_user_id: userId,
      p_module_key: moduleKey,
      p_capability: capability,
      p_effect: effect,
      p_note: note,
      p_expires_at: expiresAt,
    }),
  )
}

/**
 * Revoke (delete) an access grant by id via the super-admin-only
 * `revoke_user_access_grant` RPC. Throws a ServiceError (carrying the Postgres
 * code, e.g. 42501) on failure.
 *
 * @param {string} id  the grant row's uuid
 * @returns {Promise<void>}
 */
export async function revokeUserAccessGrant(id) {
  return unwrap(await supabase.rpc('revoke_user_access_grant', { p_id: id }))
}
