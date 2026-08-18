/**
 * checklistRoles — who a checklist is for.
 *
 * A template may name the roles it targets in `checklist_templates.assignee_roles`
 * (V591, `text[]`, Title Case profiles.role values). NULL or empty means EVERY
 * role, which is the pre-V591 behaviour and therefore what all existing
 * templates keep doing until somebody deliberately narrows one.
 *
 * WHY MATCHING IS DONE ON A NORMALISED KEY. The same role is spelled three ways
 * across this system: `profiles.role` stores 'Tyre Man', mobile's `UserRole`
 * stores 'tyre_man', and a hand-typed value could be 'tyre man'. Comparing the
 * raw strings is how a targeting rule silently matches nobody. Everything here
 * folds to lowercase+underscore before comparing, so all three forms are the
 * same role. PROJECT_MEMORY already records this exact trap for
 * `module_permissions.role`.
 *
 * THIS IS TARGETING, NOT A SECURITY BOUNDARY - say it that way. Templates are
 * already walled by the org + country RLS policies and a published template is
 * just a list of questions, so narrowing decides what a person is OFFERED, not
 * what they could read if they had the id. The security wall is unchanged.
 *
 * MIRROR: mobile/lib/checklistRoles.ts. CHANGE BOTH TOGETHER - pinned by
 * src/test/checklistRoles.test.js, which reads the mobile source.
 */

/**
 * The roles a checklist is usually written for, offered first in the builder's
 * picker. This is a SHORTLIST for convenience, not the allowed set: the builder
 * merges it with the live role list (built-ins + custom_roles) so any role can
 * be targeted.
 *
 * Mechanic and Electrician are V591 additions - before it, neither existed
 * anywhere in the system, which is why "assign this to the electricians" could
 * not be expressed.
 */
export const CHECKLIST_TRADE_ROLES = [
  'Mechanic',
  'Electrician',
  'Driver',
  'Tyre Man',
  'Inspector',
  'Maintenance Supervisor',
]

/**
 * Roles that see every checklist regardless of targeting, because they run and
 * review the programme rather than being assigned by it. An Admin authors the
 * templates, so hiding one from them would break the builder; a Manager or
 * Director signs the work off and must be able to see what their crews were
 * given.
 */
export const CHECKLIST_OVERSIGHT_ROLES = ['Admin', 'Manager', 'Director']

/** Fold any role spelling to one comparable key: 'Tyre Man' -> 'tyre_man'. */
export function normaliseRoleKey(role) {
  return String(role ?? '').trim().toLowerCase().replace(/[\s-]+/g, '_')
}

/** The template's target roles as normalised keys (empty array = everyone). */
export function templateRoleKeys(template) {
  const raw = template?.assignee_roles
  if (!Array.isArray(raw)) return []
  return raw.map(normaliseRoleKey).filter(Boolean)
}

/** True when the template names no roles, i.e. it is for everyone. */
export function templateTargetsEveryone(template) {
  return templateRoleKeys(template).length === 0
}

/** True when this role has oversight and therefore sees every checklist. */
export function isOversightRole(role, { isSuperAdmin = false } = {}) {
  if (isSuperAdmin) return true
  const key = normaliseRoleKey(role)
  return CHECKLIST_OVERSIGHT_ROLES.some((r) => normaliseRoleKey(r) === key)
}

/**
 * Should this role be OFFERED this checklist?
 *
 * An untargeted template is for everyone; an oversight role sees everything; a
 * targeted template is offered only to the roles it names. A caller with no
 * role at all (profile still loading) is treated as NOT matching a targeted
 * template - showing a narrowed checklist to an unknown role would defeat the
 * feature, and the list re-renders the moment the profile arrives.
 */
export function templateAllowsRole(template, role, opts = {}) {
  if (templateTargetsEveryone(template)) return true
  if (isOversightRole(role, opts)) return true
  const key = normaliseRoleKey(role)
  if (!key) return false
  return templateRoleKeys(template).includes(key)
}

/** Filter a template list to what this role should be offered. */
export function filterTemplatesForRole(templates, role, opts = {}) {
  return (Array.isArray(templates) ? templates : []).filter((t) => templateAllowsRole(t, role, opts))
}

/**
 * Should this ASSIGNMENT row be shown to this role?
 *
 * `checklist_assignments.assignee_role` is a single role (it comes from the
 * schedule that generated it). A NULL means the assignment was not aimed at a
 * role, so it is everyone's to pick up. Oversight roles see all of them.
 */
export function assignmentAllowsRole(assignment, role, opts = {}) {
  const target = normaliseRoleKey(assignment?.assignee_role)
  if (!target) return true
  if (isOversightRole(role, opts)) return true
  return normaliseRoleKey(role) === target
}

export function filterAssignmentsForRole(assignments, role, opts = {}) {
  return (Array.isArray(assignments) ? assignments : []).filter((a) => assignmentAllowsRole(a, role, opts))
}

/**
 * Display label for who a template is for. Returns null when it is for
 * everyone, so a caller can render nothing rather than a meaningless
 * "Everyone" chip on every single card.
 */
export function roleTargetLabel(template) {
  const raw = template?.assignee_roles
  if (!Array.isArray(raw)) return null
  const names = raw.map((r) => String(r ?? '').trim()).filter(Boolean)
  return names.length ? names.join(', ') : null
}

export default {
  CHECKLIST_TRADE_ROLES, CHECKLIST_OVERSIGHT_ROLES,
  normaliseRoleKey, templateRoleKeys, templateTargetsEveryone, isOversightRole,
  templateAllowsRole, filterTemplatesForRole,
  assignmentAllowsRole, filterAssignmentsForRole, roleTargetLabel,
}
