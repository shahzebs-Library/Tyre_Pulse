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
  // A supervisor's whole job is the first rung of the approval ladder, so the
  // queue has to be reachable or the role can be assigned and still not work.
  // The page is not a boundary: every decision goes through
  // decide_checklist_approval, which re-resolves the rung server-side and
  // refuses anything this person cannot give.
  '/approvals',
  '/help',
  '/profile',
]

export function isChecklistPathAllowed(pathname) {
  const p = String(pathname || '')
  return CHECKLIST_PATH_PREFIXES.some((x) => p === x || p.startsWith(`${x}/`))
}

// Roles allowed to author checklists (build / schedule / insights). Includes the
// checklist-only Maintenance Supervisor alongside the elevated roles.
// Deliberately WITHOUT Workshop Supervisor: they sign sheets off, they do not
// author or schedule them. Adding them here would hand over the builder too.
export const CHECKLIST_AUTHOR_ROLES = ['Admin', 'Manager', 'Director', 'Maintenance Supervisor']
