/**
 * Daily Ops -> Workshop Status - permission model, client mirror (Loop 2).
 *
 * THE SERVER DECIDES. Every action is checked by public.workshop_status_can()
 * (supabase/migrations/20261007100000_workshop_status_permissions.sql), and the
 * RLS policies call the same function. This module only:
 *   - describes the actions for the UI and Console -> Access Control,
 *   - mirrors the role defaults the migration seeds (a test parses the SQL
 *     arrays and fails on drift - CHANGE BOTH TOGETHER),
 *   - turns the workshop_status_my_permissions() jsonb into a frozen object
 *     that FAILS CLOSED: any action the server did not answer true is false.
 *
 * Hiding a button is never the security boundary; it only avoids offering an
 * action the server would refuse.
 */

/** Composite module key of the Workshop Status view (Loop 1). */
export const WORKSHOP_MODULE_KEY = 'daily_ops:workshop'

export const WORKSHOP_CATEGORIES = ['Visibility', 'Editing', 'Upload', 'Export', 'Administration']

/**
 * Every action the server understands, in display order.
 * `superAdminOnly` actions have no permission key and cannot be granted.
 *
 * @type {ReadonlyArray<{ key: string, label: string, category: string, description: string, superAdminOnly: boolean }>}
 */
export const WORKSHOP_ACTIONS = Object.freeze([
  { key: 'view', label: 'View workshop status', category: 'Visibility', description: 'Open Workshop Status and see vehicles currently in the workshop report.', superAdminOnly: false },
  { key: 'view_removed', label: 'View removed vehicles', category: 'Visibility', description: 'See vehicles that have left the current daily report.', superAdminOnly: false },
  { key: 'view_uploads', label: 'View uploads', category: 'Visibility', description: 'See the daily Excel upload register and the parsed rows of each file.', superAdminOnly: false },
  { key: 'view_activity', label: 'View activity log', category: 'Visibility', description: 'See the full activity history of every vehicle, including exports.', superAdminOnly: false },
  { key: 'view_reports', label: 'View reports', category: 'Visibility', description: 'Open the Workshop Status reports and summaries.', superAdminOnly: false },
  { key: 'view_audit', label: 'View audit trail', category: 'Administration', description: 'See the administrative audit trail of the module.', superAdminOnly: false },
  { key: 'update', label: 'Update status', category: 'Editing', description: 'Change the stage, reasons, actions, parts and dates of a vehicle.', superAdminOnly: false },
  { key: 'assign', label: 'Assign responsibility', category: 'Editing', description: 'Set the responsible and supporting person for a vehicle.', superAdminOnly: false },
  { key: 'disposition', label: 'Record final disposition', category: 'Editing', description: 'Record how a vehicle left the workshop report.', superAdminOnly: false },
  { key: 'upload', label: 'Upload daily Excel', category: 'Upload', description: 'Upload and preview the daily workshop Excel file.', superAdminOnly: false },
  { key: 'confirm', label: 'Confirm upload', category: 'Upload', description: 'Apply a previewed upload to the workshop report.', superAdminOnly: false },
  { key: 'export', label: 'Export', category: 'Export', description: 'Download the workshop report as Excel or PDF.', superAdminOnly: false },
  { key: 'archive', label: 'Archive', category: 'Administration', description: 'Archive a closed workshop record.', superAdminOnly: false },
  { key: 'restore', label: 'Restore', category: 'Administration', description: 'Bring a removed or archived record back to the report.', superAdminOnly: false },
  { key: 'soft_delete', label: 'Delete (recoverable)', category: 'Administration', description: 'Hide a wrong or duplicate record. It stays recoverable and audited.', superAdminOnly: false },
  { key: 'configure', label: 'Configure module', category: 'Administration', description: 'Change Workshop Status settings and lists.', superAdminOnly: false },
  { key: 'permanent_delete', label: 'Permanently delete', category: 'Administration', description: 'Erase a record for good. Super admin only; cannot be granted to anyone else.', superAdminOnly: true },
].map(Object.freeze))

export const WORKSHOP_ACTION_KEYS = Object.freeze(WORKSHOP_ACTIONS.map((a) => a.key))

/**
 * The permission key an action is stored under in module_permissions /
 * user_access_grants. `view` is the module key itself; a super-admin-only or
 * unknown action has no key (null), so it can never be granted.
 *
 * @param {string} action
 * @returns {string|null}
 */
export function WORKSHOP_PERMISSION_KEY(action) {
  const a = WORKSHOP_ACTIONS.find((x) => x.key === action)
  if (!a || a.superAdminOnly) return null
  return a.key === 'view' ? WORKSHOP_MODULE_KEY : `${WORKSHOP_MODULE_KEY}:${a.key}`
}

/**
 * Role groups and their seeded actions. MIRRORS the v_*_roles / v_*_actions
 * arrays in the migration. `view` is implied for every group (the migration
 * seeds daily_ops:workshop for each listed role).
 */
export const ROLE_GROUPS = Object.freeze({
  ground: Object.freeze({
    label: 'Ground team',
    roles: Object.freeze(['Mechanic', 'Electrician', 'Inspector', 'Tyre Man', 'Tyre Data Collector']),
    actions: Object.freeze(['update']),
  }),
  supervisor: Object.freeze({
    label: 'Workshop supervisors',
    roles: Object.freeze(['Workshop Supervisor', 'Maintenance Supervisor', 'Workshop Area Manager', 'Workshop Maintenance Area Manager']),
    actions: Object.freeze(['update', 'upload', 'confirm', 'assign', 'disposition', 'export',
      'view_removed', 'view_uploads', 'view_activity', 'view_reports', 'restore']),
  }),
  manager: Object.freeze({
    label: 'Managers',
    roles: Object.freeze(['PMV Manager', 'Manager', 'Director', 'Fleet Supervisor']),
    actions: Object.freeze(['update', 'assign', 'disposition', 'export',
      'view_removed', 'view_uploads', 'view_activity', 'view_reports', 'archive', 'restore']),
  }),
})

/** Everything except permanent_delete: what role Admin holds through app_user_can. */
const ADMIN_ACTIONS = Object.freeze(WORKSHOP_ACTION_KEYS.filter((k) => k !== 'permanent_delete'))

/**
 * Default action set per role (as seeded, plus Admin and super admin which the
 * server grants without a seed row). role -> sorted action keys, `view` included.
 *
 * @type {Readonly<Record<string, ReadonlyArray<string>>>}
 */
export const DEFAULT_ROLE_MATRIX = Object.freeze({
  ...Object.fromEntries(
    Object.values(ROLE_GROUPS).flatMap((g) =>
      g.roles.map((role) => [role, Object.freeze(['view', ...g.actions].sort())]),
    ),
  ),
  Admin: Object.freeze([...ADMIN_ACTIONS].sort()),
  'Super Admin': Object.freeze([...WORKSHOP_ACTION_KEYS].sort()),
})

/**
 * Turn the workshop_status_my_permissions() jsonb into a frozen
 * { [action]: boolean } covering EVERY action. Fails closed: a missing,
 * malformed or non-true value is false. Unknown keys from the server are
 * ignored so a newer server cannot invent a flag the UI does not understand.
 *
 * @param {{ myPermissions?: unknown }} [input]
 * @returns {Readonly<Record<string, boolean>>}
 */
export function resolveWorkshopPermissions({ myPermissions } = {}) {
  const src = myPermissions && typeof myPermissions === 'object' && !Array.isArray(myPermissions)
    ? myPermissions
    : {}
  const out = {}
  for (const key of WORKSHOP_ACTION_KEYS) out[key] = src[key] === true
  return Object.freeze(out)
}

/** All-false permission object (no session, failed read, not provisioned). */
export const NO_WORKSHOP_PERMISSIONS = resolveWorkshopPermissions()
