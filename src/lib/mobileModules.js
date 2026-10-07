/**
 * Flutter field app module catalog, mirrored for the WEB Access Manager.
 *
 * SOURCE OF TRUTH: tyre_pulse_flutter/lib/core/permissions/module_registry.dart
 * (ModuleRegistry.all + flutterRoleDefaultExtensions). Owner rule 2026-10-04:
 * every mobile control refers to the Flutter app; the Expo registry in
 * mobile/lib/permissions.ts is retired and is no longer what this mirrors.
 * src/test/mobileModules.test.js parses the Dart file and fails on any drift.
 *
 * WHY THIS EXISTS: the web catalog (src/lib/moduleCatalog.js) uses WEB module keys
 * (e.g. `tyre_records`), while the Flutter app matches its OWN wire key (the
 * ModuleKey enum name, e.g. `records`, `scan`, `checklists`). Exposing the real
 * phone keys here lets the web UI write `mobile:<phoneKey>` rows/grants the
 * Flutter app reads directly. The `key` strings below MUST equal the Dart
 * ModuleKey names exactly. The Flutter app ALSO accepts a handful of
 * `mobile:<webKey>` rows through webModuleKeyAliases (tyre_records -> records,
 * inspections -> inspect, ...); a row on the phone's own key wins over an alias.
 *
 * How the Flutter app enforces these keys (no app change needed):
 *   - ROLE deny  -> a `module_permissions` row `mobile:<key>` = false, read via
 *     get_user_module_permissions by core/auth/access_permissions_repository.dart.
 *   - USER deny  -> a `user_access_grants` row on `mobile:<key>` effect=revoke,
 *     read via get_my_access_grants. A grant likewise adds access.
 * Precedence lives in tyre_pulse_flutter/lib/core/permissions/access_resolver.dart.
 */

/**
 * Mirror of the Flutter ModuleRegistry. Each entry keeps the EXACT phone `key`
 * plus `label`, `group` and the default `roles` (role tokens, RoleId.token) the
 * Flutter app applies BY DEFAULT: ModuleDef.defaultRoles plus any
 * flutterRoleDefaultExtensions. Admin-only modules (ModuleDef.adminOnly) carry
 * `roles: []`. Order preserved from the Dart registry.
 * @type {{ key: string, label: string, group: string, roles: string[] }[]}
 */
export const MOBILE_MODULES = [
  // Field ---------------------------------------------------------------------
  { key: 'inspect',        label: 'New Inspection',   group: 'Field',       roles: ['manager', 'director', 'inspector', 'tyre_man'] },
  { key: 'scan',           label: 'Scan',             group: 'Field',       roles: ['manager', 'director', 'inspector', 'tyre_man', 'mechanic', 'electrician'] },
  { key: 'serial',         label: 'Serial Search',    group: 'Field',       roles: ['manager', 'director', 'inspector', 'tyre_man', 'tyre_data_collector', 'reporter', 'driver', 'mechanic', 'electrician', 'maintenance_supervisor', 'workshop_supervisor', 'pmv_manager', 'workshop_area_manager', 'workshop_maintenance_area_manager'] },
  { key: 'tyreChange',     label: 'Tyre Change',      group: 'Field',       roles: ['manager', 'director', 'inspector'] },
  { key: 'checklists',     label: 'Checklists',       group: 'Field',       roles: ['manager', 'director', 'inspector', 'tyre_man', 'mechanic', 'electrician', 'driver', 'maintenance_supervisor', 'workshop_supervisor', 'pmv_manager', 'workshop_area_manager', 'workshop_maintenance_area_manager'] },
  { key: 'meter',          label: 'Meter Log',        group: 'Field',       roles: ['manager', 'director', 'inspector', 'tyre_man', 'reporter', 'driver', 'mechanic', 'electrician', 'maintenance_supervisor', 'workshop_supervisor', 'pmv_manager', 'workshop_area_manager', 'workshop_maintenance_area_manager'] },
  { key: 'washing',        label: 'Vehicle Washing',  group: 'Field',       roles: ['manager', 'director', 'inspector', 'driver', 'tyre_man'] },
  { key: 'reportIssue',    label: 'Report Issue',     group: 'Field',       roles: ['manager', 'director', 'reporter', 'driver', 'mechanic', 'electrician', 'maintenance_supervisor', 'workshop_supervisor', 'pmv_manager', 'workshop_area_manager', 'workshop_maintenance_area_manager'] },
  { key: 'repairRequest',  label: 'Repair Request',   group: 'Field',       roles: ['manager', 'director', 'inspector', 'tyre_man', 'reporter', 'driver', 'mechanic', 'electrician'] },
  // Fleet ---------------------------------------------------------------------
  { key: 'records',        label: 'Tyre Records',     group: 'Fleet',       roles: [] },
  { key: 'vehicles',       label: 'Vehicles',         group: 'Fleet',       roles: ['manager', 'director', 'inspector', 'tyre_man', 'reporter', 'driver', 'mechanic', 'electrician', 'maintenance_supervisor', 'workshop_supervisor', 'pmv_manager', 'workshop_area_manager', 'workshop_maintenance_area_manager'] },
  { key: 'history',        label: 'History',          group: 'Fleet',       roles: [] },
  { key: 'alerts',         label: 'Alerts',           group: 'Fleet',       roles: ['manager', 'director', 'inspector'] },
  { key: 'calendar',       label: 'Calendar',         group: 'Fleet',       roles: ['manager', 'director', 'tyre_man', 'reporter', 'maintenance_supervisor', 'workshop_supervisor', 'pmv_manager', 'workshop_area_manager', 'workshop_maintenance_area_manager'] },
  // Maintenance ---------------------------------------------------------------
  // fleet_supervisor comes from flutterRoleDefaultExtensions (the accident
  // report wizard is that role's job on the Flutter app).
  { key: 'accidents',      label: 'Accidents',        group: 'Maintenance', roles: ['manager', 'director', 'inspector', 'fleet_supervisor'] },
  { key: 'reportAccident', label: 'File Accident',    group: 'Maintenance', roles: ['manager', 'director', 'inspector', 'fleet_supervisor'] },
  { key: 'workorders',     label: 'Work Orders',      group: 'Maintenance', roles: [] },
  { key: 'rca',            label: 'Root Cause',       group: 'Maintenance', roles: ['manager', 'director', 'inspector'] },
  { key: 'tasks',          label: 'Tasks',            group: 'Maintenance', roles: ['manager', 'director', 'inspector'] },
  { key: 'stock',          label: 'Stock Count',      group: 'Maintenance', roles: ['manager', 'inspector'] },
  { key: 'pm',             label: 'Maintenance Due',  group: 'Maintenance', roles: ['manager', 'director'] },
  // My Jobs: the shop-floor roles plus supervisors; admin always sees it.
  { key: 'workshop',       label: 'My Jobs',          group: 'Maintenance', roles: ['manager', 'director', 'inspector', 'tyre_man', 'mechanic', 'electrician'] },
  { key: 'workshopStatus', label: 'Workshop Status',  group: 'Maintenance', roles: ['mechanic', 'electrician', 'inspector', 'tyre_man', 'tyre_data_collector', 'workshop_supervisor', 'maintenance_supervisor', 'workshop_area_manager', 'workshop_maintenance_area_manager', 'pmv_manager', 'manager', 'director', 'fleet_supervisor'] },
  // Management ----------------------------------------------------------------
  { key: 'overview',       label: 'Overview',         group: 'Management',  roles: [] },
  { key: 'reports',        label: 'Reports',          group: 'Management',  roles: [] },
  { key: 'analytics',      label: 'Analytics',        group: 'Management',  roles: [] },
  { key: 'stockManage',    label: 'Stock Management', group: 'Management',  roles: [] },
  { key: 'ai',             label: 'Fleet AI',         group: 'Management',  roles: [] },
  { key: 'team',           label: 'Team',             group: 'Management',  roles: [] },
  // Admin ---------------------------------------------------------------------
  // Approvals gates three queues, so its role list is the union of who the
  // server lets act (V600 / V606). Director is there for the checklist FINAL
  // rung only. Mirrors module_registry.dart; the drift test pins it.
  { key: 'approvals',      label: 'Approvals',        group: 'Admin',       roles: ['director', 'maintenance_supervisor', 'workshop_supervisor', 'pmv_manager', 'workshop_area_manager', 'workshop_maintenance_area_manager', 'tyre_data_collector'] },
  // ADMIN ONLY (ModuleDef.adminOnly) - no leakage.
  { key: 'admin',          label: 'Admin Console',    group: 'Admin',       roles: [] },
  { key: 'users',          label: 'User Management',  group: 'Admin',       roles: [] },
]

/** Lookup by mobile key. */
export const MOBILE_MODULE_BY_KEY = Object.fromEntries(MOBILE_MODULES.map((m) => [m.key, m]))

/**
 * Ordered, de-duplicated list of the mobile module groups (Field / Fleet /
 * Maintenance / Management / Admin, ModuleGroup.registryName) for a grouped editor.
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
 * unknown key. This is the same default the Flutter app's ModuleDef.allowsByRoleDefault applies.
 * @param {string} key mobile module key
 * @returns {string[]}
 */
export function mobileModuleRoles(key) {
  return MOBILE_MODULE_BY_KEY[key]?.roles || []
}

/**
 * Map a WEB access role label (as used by the web Access Manager, e.g. 'Tyre Man')
 * to the Flutter role token (RoleId.token, e.g. 'tyre_man'). Lowercase + spaces to underscores.
 * Web-only roles with no mobile equivalent (Integration Admin, Data Engineer,
 * Automation, Data Monitor Officer) map to a token that is in no module's roles,
 * so they default to denied on the Flutter app - which is honest (those roles are web-only).
 * @param {string} webRole
 * @returns {string}
 */
export function webRoleToMobileRole(webRole) {
  return String(webRole || '').trim().toLowerCase().replace(/\s+/g, '_')
}

/**
 * Whether a Flutter app module is allowed BY DEFAULT for a web role (before any
 * `mobile:` role matrix row or per-user grant). Admin (and thus super-admin) is
 * always allowed, mirroring the admin break-glass in access_resolver.dart.
 * @param {string} key      mobile module key
 * @param {string} webRole  web role label (e.g. 'Manager', 'Tyre Man')
 * @returns {boolean}
 */
export function mobileModuleDefaultAllows(key, webRole) {
  const mobileRole = webRoleToMobileRole(webRole)
  if (mobileRole === 'admin') return true
  return mobileModuleRoles(key).includes(mobileRole)
}
