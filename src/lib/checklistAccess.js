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

// Paths outside the checklist area that a checklist-only role reaches ONLY when
// the role's module is switched on in Access Control (module_permissions). Nothing
// changes for a company that has not enabled the module; the database decides
// every write.
//   Work orders and Workshop Live Control: workshop supervisors create and manage
//   work orders inside their sites (owner decision 2026-11-15; work_order_can).
//   Corrective actions: a supervisor is a default reviewer of the closure workflow
//   (draft 20261116102000). Until that row exists the path is hidden and redirects.
export const SUPERVISOR_WORK_PATHS = Object.freeze({
  '/work-orders': 'work_orders',
  '/workshop-live': 'workshop_live',
})
export const CHECKLIST_MODULE_GATED_PATHS = Object.freeze({
  ...SUPERVISOR_WORK_PATHS,
  '/actions': 'corrective_actions',
})

const under = (p, x) => p === x || p.startsWith(`${x}/`)

/** The module key that opens a supervisor work path, or null when it is not one. */
export function supervisorWorkModuleKey(pathname) {
  const p = String(pathname || '')
  for (const [prefix, key] of Object.entries(SUPERVISOR_WORK_PATHS)) {
    if (under(p, prefix)) return key
  }
  return null
}

/**
 * @param {string} pathname
 * @param {(moduleKey:string)=>boolean} [hasPermission]  the signed-in person's
 *   module check. When given, a module-gated path is allowed if its module is on
 *   for them. Omitted: checklist paths only.
 */
export function isChecklistPathAllowed(pathname, hasPermission) {
  const p = String(pathname || '')
  if (CHECKLIST_PATH_PREFIXES.some((x) => under(p, x))) return true
  if (typeof hasPermission !== 'function') return false
  return Object.entries(CHECKLIST_MODULE_GATED_PATHS).some(([x, key]) => under(p, x) && hasPermission(key) === true)
}

// Roles allowed to author checklists (build / schedule / insights). Includes the
// checklist-only Maintenance Supervisor alongside the elevated roles.
// Deliberately WITHOUT Workshop Supervisor: they sign sheets off, they do not
// author or schedule them. Adding them here would hand over the builder too.
export const CHECKLIST_AUTHOR_ROLES = ['Admin', 'Manager', 'Director', 'Maintenance Supervisor']
