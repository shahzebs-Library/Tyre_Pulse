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

// ── Web / Mobile scope (surface partitioning) ────────────────────────────────
//
// Per-user grants are separated by SURFACE using the `module_key` prefix:
//   - WEB    grants use the plain module key            (e.g. `analytics`)
//   - MOBILE grants use a `mobile:` prefixed module key  (e.g. `mobile:analytics`)
// The mobile app (mobile/lib/permissions.ts MOBILE_GRANT_PREFIX) reads ONLY the
// prefixed rows; the web app reads ONLY the plain rows. So the same override can
// target web, mobile, or both surfaces with no schema change - just which
// module_key row(s) carry the grant. Keep this prefix in lockstep with mobile.

/** The surface prefix that scopes a grant to the mobile app. */
export const MOBILE_GRANT_PREFIX = 'mobile:'

/** Storage key for a module's MOBILE grant (what mobile reads / this writes). */
export function mobileGrantKey(moduleKey) {
  return `${MOBILE_GRANT_PREFIX}${moduleKey}`
}

/**
 * True when a stored key targets the MOBILE surface (a `mobile:`-prefixed
 * module_key). The web app's permission readers do keyed lookups on PLAIN module
 * keys only, so a mobile: row can never match a web module key - this predicate
 * lets callers defensively skip mobile: rows when iterating a mixed key set.
 */
export function isMobileGrantKey(key) {
  return typeof key === 'string' && key.startsWith(MOBILE_GRANT_PREFIX)
}

/**
 * Detect the SURFACE SCOPE a module currently occupies at the ROLE level, from
 * the presence of a plain (web) and/or a `mobile:` (mobile) row in a single
 * role's module_permissions map ({ module_key: enabled }). This is the role-mode
 * analogue of the per-user `rowScope`: it only looks at whether the surface's row
 * EXISTS (enabled true or false), not its value.
 *
 *   plain only   -> 'web'
 *   mobile only  -> 'mobile'
 *   both present -> 'both'
 *   neither      -> null  (no row on either surface; caller defaults the selector)
 *
 * @param {Record<string, boolean>|null|undefined} roleRows  one role's map
 * @param {string} moduleKey  the plain (web) module key
 * @returns {('web'|'mobile'|'both'|null)}
 */
export function roleScopeForKey(roleRows, moduleKey) {
  const has = (k) => !!roleRows && Object.prototype.hasOwnProperty.call(roleRows, k)
  const hasPlain = has(moduleKey)
  const hasMobile = has(mobileGrantKey(moduleKey))
  return parseGrantScope(hasPlain ? 'grant' : null, hasMobile ? 'grant' : null)
}

/**
 * Resolve the surface scope of an existing override from the presence of a plain
 * (web) and a mobile: override effect. Each argument is the override effect on
 * that surface ('grant' | 'revoke') or null/undefined when no override exists.
 *
 *   plain only   -> 'web'
 *   mobile only  -> 'mobile'
 *   both present -> 'both'
 *   neither      -> null   (no override; the UI defaults the selector to 'web')
 *
 * @param {('grant'|'revoke'|null|undefined)} plainOverride   web-surface effect
 * @param {('grant'|'revoke'|null|undefined)} mobileOverride  mobile-surface effect
 * @returns {('web'|'mobile'|'both'|null)}
 */
export function parseGrantScope(plainOverride, mobileOverride) {
  const hasPlain = plainOverride === 'grant' || plainOverride === 'revoke'
  const hasMobile = mobileOverride === 'grant' || mobileOverride === 'revoke'
  if (hasPlain && hasMobile) return 'both'
  if (hasPlain) return 'web'
  if (hasMobile) return 'mobile'
  return null
}

/**
 * The storage key(s) a grant of the given scope must be written to / cleared from.
 *   web    -> [plainKey]
 *   mobile -> [mobileKey]
 *   both   -> [plainKey, mobileKey]
 *
 * @param {string} moduleKey  the plain (web) module key
 * @param {('web'|'mobile'|'both')} scope
 * @returns {string[]}
 */
export function grantKeysForScope(moduleKey, scope) {
  if (scope === 'mobile') return [mobileGrantKey(moduleKey)]
  if (scope === 'both') return [moduleKey, mobileGrantKey(moduleKey)]
  return [moduleKey] // 'web' (default)
}

/**
 * Set/upsert an access grant for a user across a SURFACE SCOPE (web | mobile |
 * both). Thin scope-aware wrapper over `setUserAccessGrant`: it writes the same
 * effect to the plain module_key and/or the `mobile:`-prefixed module_key per
 * the scope. Clearing rows (delete) is done separately via
 * `revokeUserAccessGrant(id)` since that needs the grant's uuid.
 *
 * @param {string}  userId              target user's uuid
 * @param {string}  moduleKey           the plain (web) module key
 * @param {object}  params
 * @param {string}  [params.capability='view']
 * @param {string}  [params.effect='grant']       'grant' | 'revoke'
 * @param {('web'|'mobile'|'both')} [params.scope='web']
 * @param {string?} [params.note=null]
 * @param {string?} [params.expiresAt=null]        ISO expiry (timestamptz)
 * @param {string?} [params.expires_at=null]       snake_case alias for expiresAt
 * @returns {Promise<string[]>} the written grants' uuids (one per surface)
 */
export async function setUserAccessGrantScoped(userId, moduleKey, {
  capability = 'view',
  effect = 'grant',
  scope = 'web',
  note = null,
  expiresAt = null,
  expires_at = null,
} = {}) {
  const keys = grantKeysForScope(moduleKey, scope)
  const ids = []
  for (const key of keys) {
    ids.push(
      await setUserAccessGrant({
        userId,
        moduleKey: key,
        capability,
        effect,
        note,
        expiresAt: expiresAt ?? expires_at,
      }),
    )
  }
  return ids
}
