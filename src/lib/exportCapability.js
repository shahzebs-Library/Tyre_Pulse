/**
 * exportCapability.js - the 'export' capability gate.
 *
 * HONEST SCOPE: an export is a download assembled in the browser from rows the
 * user is already allowed to READ. A browser cannot be a hard security boundary
 * for data the user can already see on screen, so this gate is enforced at the
 * APPLICATION level (every export path goes through guardExport in
 * exportUtils.js) and at the AUDIT level (every allowed AND every refused export
 * writes an EXPORT row to audit_log_v2). The data-access boundary itself is the
 * database (RLS / org / country / site isolation), not this file.
 *
 * Semantics (compatible, additive; nobody who can export today loses it):
 *   Admin / Super Admin ........................ always allowed
 *   explicit per-user REVOKE of 'export' ....... blocked (beats everything)
 *   explicit per-user GRANT of 'export' ........ allowed
 *   a built-in role whose stored role override
 *     turned 'export' OFF for a module it can
 *     view by default .......................... blocked
 *   everything else ............................ allowed
 * The "everything else" default is deliberately ALLOW: the role matrix stores
 * export=false for custom roles and for modules reached through DB view rows,
 * and treating that as a denial would silently remove export from people who
 * have it today.
 *
 * The governing module is derived from the current route with the same mapping
 * the sidebar and RoleRoute use (navAccess.governingModuleKey).
 */
import { governingModuleKey } from './navAccess'

export class ExportDeniedError extends Error {
  constructor(moduleKey) {
    super('You do not have permission to export from this module.')
    this.name = 'ExportDeniedError'
    this.moduleKey = moduleKey
  }
}

/**
 * Pure verdict for one module.
 * @param {object} p
 * @param {string}  p.role
 * @param {boolean} p.isSuperAdmin
 * @param {string}  p.moduleKey
 * @param {Record<string, Record<string,'grant'|'revoke'>>} [p.capabilities] per-user overrides
 * @param {Record<string, Record<string,boolean>>} [p.roleCapabilities] effective role matrix for the user's role
 * @param {boolean} [p.defaultView] the built-in role's DEFAULT view access to the module (permissionMatrix.defaultViewAccess)
 */
export function resolveExportAllowed({ role, isSuperAdmin, moduleKey, capabilities, roleCapabilities, defaultView }) {
  if (isSuperAdmin || role === 'Admin') return true
  if (!moduleKey) return true
  const override = capabilities?.[moduleKey]?.export
  if (override === 'revoke') return false
  if (override === 'grant') return true
  const stored = roleCapabilities?.[moduleKey]?.export
  if (stored === false && defaultView === true) return false
  return true
}

// ── Runtime registry (AuthContext registers the live resolver) ───────────────
let gate = null

/** AuthContext calls this with (moduleKey) => boolean, or null on sign-out. */
export function registerExportGate(fn) {
  gate = typeof fn === 'function' ? fn : null
}

/** Governing module of the page the user is on (null outside a browser). */
export function currentExportModule(pathname) {
  const p = pathname ?? (typeof window !== 'undefined' ? window.location?.pathname : null)
  if (!p) return null
  try { return governingModuleKey(p) } catch { return null }
}

/** True when export is allowed for the module (default allow when no gate is registered). */
export function canExportFrom(moduleKey) {
  if (!gate) return true
  try { return gate(moduleKey) !== false } catch { return true }
}

/** Throws ExportDeniedError when the current page's module has export revoked. */
export function assertExportAllowed(moduleKey) {
  const key = moduleKey ?? currentExportModule()
  if (!canExportFrom(key)) throw new ExportDeniedError(key)
  return true
}
