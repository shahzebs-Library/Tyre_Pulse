/**
 * Checklist-only access — a role that may use ONLY the checklists area of the
 * app (build, schedule, fill, review checklists) and nothing else. Everything
 * outside the checklist routes is redirected back to the checklist home, and the
 * sidebar shows only the checklist items.
 */

// Roles restricted to the checklists area. (Maintenance Supervisor per the
// predictive-maintenance rules: this role authors + runs checklists only.)
// Workshop Supervisor (V599) is the first approval rung on the workshop sheets
// and does nothing else in the app, so it belongs here beside Maintenance
// Supervisor rather than being given the whole sidebar.
export const CHECKLIST_ONLY_ROLES = ['Maintenance Supervisor', 'Workshop Supervisor']

export function isChecklistOnlyRole(role) {
  return CHECKLIST_ONLY_ROLES.includes(String(role || '').trim())
}

// Path prefixes a checklist-only role may visit (checklists + their own profile
// so they can sign out / switch language).
export const CHECKLIST_PATH_PREFIXES = [
  '/checklists',
  '/my-checklists',
  '/checklist-builder',
  '/checklist-schedules',
  '/checklist-insights',
  '/checklist-audit',
  // A supervisor's whole job is the first rung of the approval ladder, so the
  // queue has to be reachable or the role can be assigned and still not work.
  // The page is not a boundary: every decision goes through
  // decide_checklist_approval, which re-resolves the rung server-side and
  // refuses anything this person cannot give.
  '/approvals',
  // Just-in-time access requests (V116 request_elevation). A checklist-only
  // person who needs one module for an hour must be able to ask for it; the
  // request is decided by a super admin, so reaching the page grants nothing.
  '/request-access',
  '/help',
  '/profile',
  // A person's own problem reports: every signed-in user can report one, so
  // every signed-in user must be able to follow it. Reads are RLS-scoped to own rows.
  '/my-problems',
]

// Workshop work a supervisor role may also reach (owner decision 2026-11-15:
// workshop supervisors create and manage work orders and use Workshop Live
// Control inside their sites). These are NOT open by default: each path is
// reachable only when the role's module is switched on in Access Control
// (module_permissions), so nothing changes for a company that has not enabled
// it. The database decides every write (work_order_can).
export const SUPERVISOR_WORK_PATHS = Object.freeze({
  '/work-orders': 'work_orders',
  '/workshop-live': 'workshop_live',
})

/** The module key that opens a supervisor work path, or null when it is not one. */
export function supervisorWorkModuleKey(pathname) {
  const p = String(pathname || '')
  for (const [prefix, key] of Object.entries(SUPERVISOR_WORK_PATHS)) {
    if (p === prefix || p.startsWith(`${prefix}/`)) return key
  }
  return null
}

/**
 * @param {string} pathname
 * @param {(moduleKey:string)=>boolean} [hasPermission]  the signed-in person's
 *   module check. When given, a supervisor work path is allowed if its module is
 *   on for them. Omitted: checklist paths only (the rule before 2026-11-15).
 */
export function isChecklistPathAllowed(pathname, hasPermission) {
  const p = String(pathname || '')
  if (CHECKLIST_PATH_PREFIXES.some((x) => p === x || p.startsWith(`${x}/`))) return true
  const key = supervisorWorkModuleKey(p)
  return !!key && typeof hasPermission === 'function' && hasPermission(key) === true
}

// Roles allowed to author checklists (build / schedule / insights). Includes the
// checklist-only Maintenance Supervisor alongside the elevated roles.
// Deliberately WITHOUT Workshop Supervisor: they sign sheets off, they do not
// author or schedule them. Adding them here would hand over the builder too.
export const CHECKLIST_AUTHOR_ROLES = ['Admin', 'Manager', 'Director', 'Maintenance Supervisor']

// Checklist routes guarded by RoleRoute(CHECKLIST_AUTHOR_ROLES) in App.jsx. A
// checklist-only role that is NOT an author (Workshop Supervisor) may visit the
// checklist area, but these pages refuse it, so the sidebar and command search
// must not offer them either - otherwise the menu leads straight to Access Denied.
export const CHECKLIST_AUTHOR_PATHS = [
  '/checklist-builder',
  '/checklist-schedules',
  '/checklist-insights',
  '/checklist-audit',
]

export function isChecklistAuthorPath(pathname) {
  const p = String(pathname || '')
  return CHECKLIST_AUTHOR_PATHS.some((x) => p === x || p.startsWith(`${x}/`))
}

/** May this person open an author-only checklist page? Super admins always may. */
export function canAuthorChecklists(role, isSuperAdmin) {
  return isSuperAdmin === true || CHECKLIST_AUTHOR_ROLES.includes(String(role || '').trim())
}

/** Should a menu offer this path? True for every non-author checklist path. */
export function isChecklistNavVisible(pathname, role, isSuperAdmin) {
  if (!isChecklistAuthorPath(pathname)) return true
  return canAuthorChecklists(role, isSuperAdmin)
}
