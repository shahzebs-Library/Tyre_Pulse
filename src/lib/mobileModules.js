/**
 * Mobile app module catalog, mirrored for the WEB Access Manager.
 *
 * KEEP IN SYNC with mobile/lib/permissions.ts MODULES. This is a web-safe (plain
 * JS, no React/TS) mirror of the mobile app's module registry so a super-admin can
 * allow / deny mobile modules from the web Access Manager.
 *
 * WHY THIS EXISTS: the web catalog (src/lib/moduleCatalog.js) uses WEB module keys
 * (e.g. `tyre_records`). The web Access Manager stores a mobile override as
 * `mobile:<webKey>` (e.g. `mobile:tyre_records`). But the mobile app's
 * resolveModuleAccess matches the EXACT mobile ModuleKey (e.g. `records`, `scan`,
 * `checklists`), so a web deny only ever reached mobile when the two strings
 * happened to be identical (a handful of keys). Exposing the real mobile keys here
 * lets the web UI write `mobile:<mobileKey>` rows/grants that the mobile app
 * actually reads. The `key` strings below are the match target and MUST equal the
 * mobile ModuleKey exactly.
 *
 * The mobile app already enforces these keys with NO change required:
 *   - ROLE deny  -> a `module_permissions` row `mobile:<key>` = false, read via
 *     get_user_module_permissions -> mobileRoleMatrixFromRaw -> resolveModuleAccess
 *     (matrix false => deny).
 *   - USER deny  -> a `user_access_grants` row on `mobile:<key>` effect=revoke,
 *     read via get_my_access_grants -> mobileGrantsFromRaw -> resolveModuleAccess
 *     (grant revoke => deny). A grant likewise adds access.
 * See mobile/lib/permissions.ts resolveModuleAccess for the precedence.
 */

/**
 * Mirror of mobile/lib/permissions.ts MODULES. Each entry keeps the EXACT mobile
 * `key` plus `label`, `group` and the default `roles` (mobile role tokens) so the
 * UI can show what a role gets by default. Order preserved from the mobile file.
 * @type {{ key: string, label: string, group: string, roles: string[] }[]}
 */
export const MOBILE_MODULES = [
  // Field ---------------------------------------------------------------------
  { key: 'inspect',        label: 'New Inspection',   group: 'Field',       roles: ['manager', 'director', 'inspector', 'tyre_man'] },
  { key: 'scan',           label: 'Scan',             group: 'Field',       roles: ['manager', 'director', 'inspector', 'tyre_man'] },
  { key: 'serial',         label: 'Serial Search',    group: 'Field',       roles: ['manager', 'director', 'inspector'] },
  { key: 'tyreChange',     label: 'Tyre Change',      group: 'Field',       roles: ['manager', 'director', 'inspector'] },
  { key: 'checklists',     label: 'Checklists',       group: 'Field',       roles: ['manager', 'director', 'inspector', 'tyre_man'] },
  { key: 'meter',          label: 'Meter Log',        group: 'Field',       roles: ['manager', 'director', 'inspector', 'tyre_man', 'reporter', 'driver'] },
  { key: 'washing',        label: 'Vehicle Washing',  group: 'Field',       roles: ['manager', 'director', 'inspector', 'driver'] },
  { key: 'reportIssue',    label: 'Report Issue',     group: 'Field',       roles: ['manager', 'director', 'reporter', 'driver'] },
  // Fleet ---------------------------------------------------------------------
  { key: 'records',        label: 'Tyre Records',     group: 'Fleet',       roles: ['manager', 'director', 'inspector', 'reporter'] },
  { key: 'vehicles',       label: 'Vehicles',         group: 'Fleet',       roles: ['manager', 'director'] },
  { key: 'history',        label: 'History',          group: 'Fleet',       roles: ['manager', 'director', 'inspector', 'reporter', 'tyre_man'] },
  { key: 'alerts',         label: 'Alerts',           group: 'Fleet',       roles: ['manager', 'director', 'inspector'] },
  { key: 'calendar',       label: 'Calendar',         group: 'Fleet',       roles: ['manager', 'director', 'tyre_man', 'reporter'] },
  // Maintenance ---------------------------------------------------------------
  { key: 'accidents',      label: 'Accidents',        group: 'Maintenance', roles: ['manager', 'director', 'inspector'] },
  { key: 'reportAccident', label: 'File Accident',    group: 'Maintenance', roles: ['manager', 'director', 'inspector'] },
  { key: 'workorders',     label: 'Work Orders',      group: 'Maintenance', roles: ['manager', 'director'] },
  { key: 'rca',            label: 'Root Cause',       group: 'Maintenance', roles: ['manager', 'director', 'inspector'] },
  { key: 'tasks',          label: 'Tasks',            group: 'Maintenance', roles: ['manager', 'director', 'inspector'] },
  { key: 'stock',          label: 'Stock Count',      group: 'Maintenance', roles: ['manager', 'inspector'] },
  { key: 'pm',             label: 'Maintenance Due',  group: 'Maintenance', roles: ['manager', 'director'] },
  // Management ----------------------------------------------------------------
  { key: 'overview',       label: 'Overview',         group: 'Management',  roles: ['manager', 'director'] },
  { key: 'reports',        label: 'Reports',          group: 'Management',  roles: ['manager', 'director', 'reporter', 'inspector', 'tyre_man'] },
  { key: 'analytics',      label: 'Analytics',        group: 'Management',  roles: ['manager'] },
  { key: 'stockManage',    label: 'Stock Management', group: 'Management',  roles: ['manager'] },
  { key: 'ai',             label: 'Fleet AI',         group: 'Management',  roles: ['manager'] },
  { key: 'team',           label: 'Team',             group: 'Management',  roles: ['manager', 'director'] },
  // Admin ---------------------------------------------------------------------
  { key: 'approvals',      label: 'Approvals',        group: 'Admin',       roles: ['manager', 'director'] },
  { key: 'admin',          label: 'Admin Console',    group: 'Admin',       roles: ['manager', 'director'] },
  { key: 'users',          label: 'User Management',  group: 'Admin',       roles: [] },
]

/** Lookup by mobile key. */
export const MOBILE_MODULE_BY_KEY = Object.fromEntries(MOBILE_MODULES.map((m) => [m.key, m]))

/**
 * Ordered, de-duplicated list of the mobile module groups (Field / Fleet /
 * Maintenance / Management / Admin) for a grouped editor.
 * @type {string[]}
 */
export const MOBILE_MODULE_GROUPS = MOBILE_MODULES.reduce(
  (acc, m) => (acc.includes(m.group) ? acc : acc.concat(m.group)),
  [],
)

/** MOBILE_MODULES grouped into { group, modules[] } in registry order. */
export const MOBILE_MODULES_BY_GROUP = MOBILE_MODULE_GROUPS.map((group) => ({
  group,
  modules: MOBILE_MODULES.filter((m) => m.group === group),
}))

/**
 * The default mobile roles for a module (mobile role tokens). Empty array for an
 * unknown key. This is the same data the mobile app's moduleAllowedByRole reads.
 * @param {string} key mobile module key
 * @returns {string[]}
 */
export function mobileModuleRoles(key) {
  return MOBILE_MODULE_BY_KEY[key]?.roles || []
}

/**
 * Map a WEB access role label (as used by the web Access Manager, e.g. 'Tyre Man')
 * to the MOBILE role token (e.g. 'tyre_man'). Lowercase + spaces to underscores.
 * Web-only roles with no mobile equivalent (Integration Admin, Data Engineer,
 * Automation, Data Monitor Officer) map to a token that is in no module's roles,
 * so they default to denied on mobile - which is honest (those roles are web-only).
 * @param {string} webRole
 * @returns {string}
 */
export function webRoleToMobileRole(webRole) {
  return String(webRole || '').trim().toLowerCase().replace(/\s+/g, '_')
}

/**
 * Whether a mobile module is allowed BY DEFAULT for a web role (before any
 * `mobile:` role matrix row or per-user grant). Admin (and thus super-admin) is
 * always allowed, mirroring mobile moduleAllowedByRole / isAdmin.
 * @param {string} key      mobile module key
 * @param {string} webRole  web role label (e.g. 'Manager', 'Tyre Man')
 * @returns {boolean}
 */
export function mobileModuleDefaultAllows(key, webRole) {
  const mobileRole = webRoleToMobileRole(webRole)
  if (mobileRole === 'admin') return true
  return mobileModuleRoles(key).includes(mobileRole)
}
