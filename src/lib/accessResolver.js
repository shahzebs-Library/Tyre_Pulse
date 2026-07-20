/**
 * accessResolver — the ONE canonical, pure access-decision engine.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THIS EXISTS (roadmap: "one permission engine")
 * ─────────────────────────────────────────────────────────────────────────────
 * The access decision is currently duplicated across several call sites, each
 * with its own copy of the same precedence logic:
 *
 *   - `resolvePermission`  in src/contexts/AuthContext.jsx   (module reach)
 *   - `resolveCapability`  in src/lib/permissionMatrix.js    (per-capability)
 *   - per-user grant overlays, mobile permissions, and the console
 *
 * `resolvePermission` and `resolveCapability` are byte-for-byte identical in
 * behaviour — they only differ in the JSDoc that frames one as a module-level
 * gate and the other as a per-capability gate. Keeping two copies invites drift.
 *
 * `resolveAccess` below is the SINGLE source of truth for that precedence. It is
 * behaviour-compatible with both existing functions (see the parity tests in
 * src/test/accessResolver.test.js). Future work should migrate every call site
 * onto this module WITHOUT changing behaviour, then delete the duplicates:
 *
 *   resolvePermission({ role, isSuperAdmin, roleAllows, override })
 *     ≡ resolveAccess({ role, isSuperAdmin, roleAllows,
 *                       grant:  override === 'grant',
 *                       revoke: override === 'revoke' }).allowed
 *
 *   resolveCapability(...same...) ≡ same mapping.
 *
 * This module also RE-EXPORTS the site-scope sentinel helpers from
 * scopeSentinel.js so there is ONE import surface for all access logic.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * CANONICAL PRECEDENCE (highest priority first)
 * ─────────────────────────────────────────────────────────────────────────────
 *   1. Admin role OR Super Admin  -> ALLOW  (reason: 'admin')
 *                                    Break-glass: cannot be revoked here.
 *   2. explicit revoke override    -> DENY   (reason: 'revoke')
 *                                    A per-user revoke beats the role.
 *   3. explicit grant override     -> ALLOW  (reason: 'grant')
 *                                    A per-user grant is honoured next...
 *   4. role/DB logic allows it     -> ALLOW  (reason: 'role')
 *   5. otherwise                   -> DENY   (reason: 'default')
 *                                    Deny-by-default.
 *
 * NOTE on ordering vs. the legacy copies: the legacy resolvers test roleAllows
 * (step 4) BEFORE the grant override (step 3), but the two orderings produce an
 * IDENTICAL boolean — both a `grant` and a truthy `roleAllows` yield ALLOW, and
 * neither can flip the other's result once revoke has already been handled. This
 * module surfaces `grant` first only so the returned `reason` attributes an
 * explicit grant to the grant (more useful for auditing/UX); the `allowed`
 * boolean is unchanged. Parity tests assert this equivalence exhaustively.
 *
 * ENFORCEMENT CAVEAT (unchanged from resolveCapability): only the `view`
 * capability is enforced server-side today. For create/edit/delete/export/
 * approve this resolver is a CLIENT-SIDE UI gate only — the authoritative
 * boundary is the server (app_user_can / RLS). A `true` here is NOT a security
 * guarantee for non-view capabilities.
 *
 * This module is PURE (no I/O, no imports beyond the sentinel re-export) so it
 * can be unit-tested in isolation and shared by web + console + mobile.
 */

import { isOrgWideSites, withoutOrgWide, SITE_ALL_TOKENS } from './scopeSentinel'

// Re-export the site-scope sentinel helpers so accessResolver is the single
// entry point for all access-logic. Callers should import these from here.
export { isOrgWideSites, withoutOrgWide, SITE_ALL_TOKENS }

/**
 * The stable set of reason codes returned by resolveAccess. Kept as a frozen
 * map so callers can switch on / display them without magic strings.
 */
export const ACCESS_REASON = Object.freeze({
  ADMIN: 'admin',       // Admin role or super-admin break-glass
  REVOKE: 'revoke',     // explicit per-user revoke override
  GRANT: 'grant',       // explicit per-user grant override
  ROLE: 'role',         // the role's own matrix/DB logic allows it
  DEFAULT: 'default',   // deny-by-default (nothing granted it)
})

/**
 * Resolve a single access decision under the one canonical precedence.
 *
 * @param {object}   p
 * @param {string}   [p.role]           the user's role (e.g. 'Manager')
 * @param {boolean}  [p.isSuperAdmin]   profiles.is_super_admin === true
 * @param {string}   [p.moduleKey]      module the decision is about (informational; not used in the boolean)
 * @param {string}   [p.capability]     capability being resolved (default 'view'; informational)
 * @param {boolean}  [p.roleAllows]     whether the existing role/DB logic grants it
 * @param {boolean}  [p.grant]          an explicit per-user 'grant' override is present
 * @param {boolean}  [p.revoke]         an explicit per-user 'revoke' override is present
 * @returns {{ allowed: boolean, reason: string, moduleKey: (string|undefined), capability: string }}
 */
export function resolveAccess({
  role,
  isSuperAdmin,
  moduleKey,
  capability = 'view',
  roleAllows,
  grant,
  revoke,
} = {}) {
  const decide = (allowed, reason) => ({ allowed, reason, moduleKey, capability })

  // 1. Admin / super-admin — break-glass, cannot be revoked here.
  if (role === 'Admin' || isSuperAdmin === true) return decide(true, ACCESS_REASON.ADMIN)

  // 2. Explicit revoke beats the role and any grant.
  if (revoke === true) return decide(false, ACCESS_REASON.REVOKE)

  // 3. Explicit grant allows (attributed to the grant for auditing).
  if (grant === true) return decide(true, ACCESS_REASON.GRANT)

  // 4. Role / DB logic already allows it.
  if (roleAllows === true) return decide(true, ACCESS_REASON.ROLE)

  // 5. Deny-by-default.
  return decide(false, ACCESS_REASON.DEFAULT)
}

/**
 * Convenience: collapse the legacy single `override` union ('grant'|'revoke'|
 * undefined) into the {grant, revoke} pair this module uses. Lets a call site
 * migrate off resolvePermission/resolveCapability with a one-line change.
 *
 * @param {('grant'|'revoke'|null|undefined)} override
 * @returns {{ grant: boolean, revoke: boolean }}
 */
export function overrideToFlags(override) {
  return { grant: override === 'grant', revoke: override === 'revoke' }
}

export default resolveAccess
