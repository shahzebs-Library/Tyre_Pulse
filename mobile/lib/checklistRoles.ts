/**
 * checklistRoles — MOBILE MIRROR of src/lib/checklist/checklistRoles.js.
 *
 * A template may name the roles it targets in `checklist_templates.assignee_roles`
 * (V591). NULL or empty = every role, which is what every existing template
 * does, so nothing narrows until somebody deliberately narrows it.
 *
 * WHY THE NORMALISED KEY MATTERS MORE ON THIS SIDE. The DB stores `profiles.role`
 * Title Case ('Tyre Man') while this app's own `UserRole` is 'tyre_man'. A raw
 * string compare between the two matches NOTHING, so a targeted checklist would
 * silently disappear for exactly the person it was written for. Both sides fold
 * to lowercase+underscore before comparing.
 *
 * CHANGE BOTH FILES TOGETHER - pinned by src/test/checklistRoles.test.js, which
 * reads this file's source.
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
 * Roles that see every checklist regardless of targeting: they run and review
 * the programme rather than being assigned by it.
 */
export const CHECKLIST_OVERSIGHT_ROLES = ['Admin', 'Manager', 'Director']

export function normaliseRoleKey(role: unknown): string {
  return String(role ?? '').trim().toLowerCase().replace(/[\s-]+/g, '_')
}

export interface RoleTargeted { assignee_roles?: string[] | null }
export interface RoleAssigned { assignee_role?: string | null }
export interface RoleOpts { isSuperAdmin?: boolean }

export function templateRoleKeys(template: RoleTargeted | null | undefined): string[] {
  const raw = template?.assignee_roles
  if (!Array.isArray(raw)) return []
  return raw.map(normaliseRoleKey).filter(Boolean)
}

export function templateTargetsEveryone(template: RoleTargeted | null | undefined): boolean {
  return templateRoleKeys(template).length === 0
}

export function isOversightRole(role: unknown, opts: RoleOpts = {}): boolean {
  if (opts.isSuperAdmin) return true
  const key = normaliseRoleKey(role)
  return CHECKLIST_OVERSIGHT_ROLES.some((r) => normaliseRoleKey(r) === key)
}

/**
 * Should this role be OFFERED this checklist? An untargeted template is for
 * everyone; an oversight role sees everything; otherwise the template must name
 * the role. An unknown role (profile still loading) does NOT match a targeted
 * template - the list re-renders as soon as the profile arrives.
 */
export function templateAllowsRole(
  template: RoleTargeted | null | undefined, role: unknown, opts: RoleOpts = {},
): boolean {
  if (templateTargetsEveryone(template)) return true
  if (isOversightRole(role, opts)) return true
  const key = normaliseRoleKey(role)
  if (!key) return false
  return templateRoleKeys(template).includes(key)
}

export function filterTemplatesForRole<T extends RoleTargeted>(
  templates: T[] | null | undefined, role: unknown, opts: RoleOpts = {},
): T[] {
  return (Array.isArray(templates) ? templates : []).filter((t) => templateAllowsRole(t, role, opts))
}

/**
 * `checklist_assignments.assignee_role` is a SINGLE role inherited from the
 * schedule that generated the row. NULL = not aimed at a role, so anyone may
 * pick it up.
 */
export function assignmentAllowsRole(
  assignment: RoleAssigned | null | undefined, role: unknown, opts: RoleOpts = {},
): boolean {
  const target = normaliseRoleKey(assignment?.assignee_role)
  if (!target) return true
  if (isOversightRole(role, opts)) return true
  return normaliseRoleKey(role) === target
}

export function filterAssignmentsForRole<T extends RoleAssigned>(
  assignments: T[] | null | undefined, role: unknown, opts: RoleOpts = {},
): T[] {
  return (Array.isArray(assignments) ? assignments : []).filter((a) => assignmentAllowsRole(a, role, opts))
}

/** Who the template is for, or null when it is for everyone (render nothing). */
export function roleTargetLabel(template: RoleTargeted | null | undefined): string | null {
  const raw = template?.assignee_roles
  if (!Array.isArray(raw)) return null
  const names = raw.map((r) => String(r ?? '').trim()).filter(Boolean)
  return names.length ? names.join(', ') : null
}
