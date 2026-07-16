/**
 * Console admin role tiers (Admin Control & Self-Healing, Module 7).
 *
 * THE single source of truth for "which console admin can do what". The console
 * (super-admin surface, `/console`) has a small, fixed ladder of administrative
 * tiers that is DISTINCT from the operational RBAC roles used across the fleet
 * app. Model it here as a pure, I/O-free capability matrix so every console
 * screen (System Health, error logs, backups, admin management, config) gates
 * consistently and testably.
 *
 * Design:
 *  - Three tiers, worst-to-best privilege: viewer (rank 1) < regional_admin
 *    (rank 2) < super_admin (rank 3).
 *  - Capabilities map to a MINIMUM required rank, except the app-wide-only
 *    capabilities (create_backup, restore_backup, manage_admins, edit_config)
 *    which are explicitly reserved for super_admin. regional_admin is
 *    region-scoped: it can view health, view and resolve logs, and view backups
 *    for its own region, but never perform app-wide privileged actions.
 *  - `canonAdminRole` folds case / spaces / hyphens and defaults unknown or
 *    empty input to the least-privileged tier ('viewer'), fail-closed.
 */

/* Role tokens, least-to-most privileged is the reverse of this list order. */
export const ADMIN_ROLES = ['super_admin', 'regional_admin', 'viewer']

/* Presentation + rank metadata per tier. Higher rank = more privilege. */
export const ADMIN_ROLE_META = {
  super_admin: {
    label: 'Super Admin',
    rank: 3,
    tone: 'red',
    desc: 'Full access to every console module.',
  },
  regional_admin: {
    label: 'Regional Admin',
    rank: 2,
    tone: 'amber',
    desc: 'Their region only: can view health and resolve logs and recover backups for their region.',
  },
  viewer: {
    label: 'Viewer',
    rank: 1,
    tone: 'slate',
    desc: 'Read-only dashboards, no edit / resolve / restore.',
  },
}

/**
 * Capability matrix: each key maps to the MINIMUM role rank required.
 *  - view_* capabilities are available to every tier (rank 1+).
 *  - resolve_logs is available to regional_admin+ (rank 2+).
 *  - app-wide privileged capabilities (create_backup, restore_backup,
 *    manage_admins, edit_config) are super_admin only (rank 3).
 * regional_admin's backup RECOVERY is region-scoped and handled by
 * `regionScopeApplies`, not by an app-wide create/restore capability.
 */
export const ADMIN_CAPABILITIES = {
  view_health: 1,
  view_logs: 1,
  resolve_logs: 2,
  view_backups: 1,
  create_backup: 3,
  restore_backup: 3,
  manage_admins: 3,
  view_config: 1,
  edit_config: 3,
}

/** Rank of a (folded) role token. Unknown resolves to 'viewer' rank. */
function rankOf(role) {
  return ADMIN_ROLE_META[canonAdminRole(role)].rank
}

/**
 * Fold arbitrary input to a valid admin role token. Case, spaces and hyphens
 * are normalized (e.g. 'Super Admin', 'super-admin', 'SUPER_ADMIN' all fold to
 * 'super_admin'). Unknown or empty input defaults to 'viewer' (fail-closed).
 */
export function canonAdminRole(v) {
  if (v == null) return 'viewer'
  const key = String(v).trim().toLowerCase().replace(/[\s-]+/g, '_')
  if (key === '') return 'viewer'
  if (Object.prototype.hasOwnProperty.call(ADMIN_ROLE_META, key)) return key
  return 'viewer'
}

/**
 * True when `role` (folded) meets the minimum rank for `capability`.
 * Unknown capability -> false (fail-closed).
 */
export function adminCan(role, capability) {
  const min = ADMIN_CAPABILITIES[capability]
  if (typeof min !== 'number') return false
  return rankOf(role) >= min
}

/** True when `role` is at least as privileged as `minRole`, by rank. */
export function adminRoleAtLeast(role, minRole) {
  return rankOf(role) >= rankOf(minRole)
}

/**
 * True only for the region-scoped tier (regional_admin). super_admin is
 * app-wide (no region limit); viewer is read-only everywhere.
 */
export function regionScopeApplies(role) {
  return canonAdminRole(role) === 'regional_admin'
}
