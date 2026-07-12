/**
 * Checklist-only access — a role that may use ONLY the checklists area of the
 * app (build, schedule, fill, review checklists) and nothing else. Everything
 * outside the checklist routes is redirected back to the checklist home, and the
 * sidebar shows only the checklist items.
 */

// Roles restricted to the checklists area. (Maintenance Supervisor per the
// predictive-maintenance rules: this role authors + runs checklists only.)
export const CHECKLIST_ONLY_ROLES = ['Maintenance Supervisor']

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
  '/profile',
]

export function isChecklistPathAllowed(pathname) {
  const p = String(pathname || '')
  return CHECKLIST_PATH_PREFIXES.some((x) => p === x || p.startsWith(`${x}/`))
}

// Roles allowed to author checklists (build / schedule / insights). Includes the
// checklist-only Maintenance Supervisor alongside the elevated roles.
export const CHECKLIST_AUTHOR_ROLES = ['Admin', 'Manager', 'Director', 'Maintenance Supervisor']
