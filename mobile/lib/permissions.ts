/**
 * Centralised Role-Based Access Control (RBAC) for the mobile app.
 *
 * SINGLE source of truth for "what a role is allowed to see / do". Every screen,
 * the tab navigator and the Home hub derive their visible surface from the MODULE
 * registry below, so navigation auto-adjusts per user and access never drifts
 * between layers.
 *
 * Two layers, resolved by `resolveModuleAccess`:
 *   1. ROLE DEFAULT  - the `roles` list on each module (this file).
 *   2. PER-USER GRANT overlay - a super-admin can grant or revoke a single module
 *      for one user (stored in `user_access_grants`, loaded by AuthContext). A
 *      revoke always wins; a grant adds access the role would not otherwise have.
 * Admin and super-admin always have full access.
 *
 * Roles (see lib/types.ts): admin | manager | director | inspector | tyre_man |
 * reporter | driver.
 */

import { UserRole, isAdminOrAbove, isAdmin } from './types'

// ── Module registry ─────────────────────────────────────────────────────────
// The one place access is defined. `roles` = the roles allowed BY DEFAULT (admin
// is always allowed and may be omitted). To change what a role sees, edit its
// module's `roles`. To expose a new gated destination, add a module here.
export type ModuleKey =
  | 'inspect' | 'records' | 'accidents' | 'reportAccident' | 'scan' | 'serial'
  | 'vehicles' | 'workorders' | 'rca' | 'stock' | 'stockManage' | 'overview'
  | 'reports' | 'analytics' | 'ai' | 'admin' | 'users' | 'meter' | 'tasks'
  | 'calendar' | 'reportIssue' | 'checklists' | 'approvals' | 'alerts'
  | 'history' | 'tyreChange' | 'team' | 'pm'

export interface ModuleDef {
  key: ModuleKey
  label: string
  icon: string
  /** Roles allowed by default. Admin is always allowed regardless. */
  roles: UserRole[]
  /** Grouping for the admin access editor. */
  group: 'Field' | 'Fleet' | 'Maintenance' | 'Management' | 'Admin'
}

const M = (
  key: ModuleKey, label: string, icon: string, group: ModuleDef['group'], roles: UserRole[],
): ModuleDef => ({ key, label, icon, group, roles })

/**
 * Role defaults. Removals applied per the product owner (2026-07-17):
 *   - director  loses analytics, ai, stock
 *   - inspector loses vehicles, workorders, calendar, reportIssue
 *
 * Tyre Man (2026-07-17, field-feedback): the role is deliberately MINIMAL - its
 * Home shows only Scan, Checklists ("recent vehicle checklist") and Meter Log,
 * plus the New Inspection CTA and its own recent inspections. So tyre_man keeps
 * inspect + scan + checklists + meter (meter RE-ADDED at the owner's request,
 * reversing the earlier removal) and nothing else (no serial, tyreChange,
 * reportIssue, history, alerts, records, vehicles, workorders, stock, tasks).
 */
export const MODULES: ModuleDef[] = [
  // Field ---------------------------------------------------------------------
  M('inspect',        'New Inspection',    'clipboard-outline',      'Field',      ['manager', 'director', 'inspector', 'tyre_man']),
  M('scan',           'Scan',              'scan-outline',           'Field',      ['manager', 'director', 'inspector', 'tyre_man']),
  M('serial',         'Serial Search',     'search-outline',         'Field',      ['manager', 'director', 'inspector']),
  M('tyreChange',     'Tyre Change',       'swap-horizontal-outline','Field',      ['manager', 'director', 'inspector']),
  M('checklists',     'Checklists',        'checkbox-outline',       'Field',      ['manager', 'director', 'inspector', 'tyre_man']),
  M('meter',          'Meter Log',         'speedometer-outline',    'Field',      ['manager', 'director', 'inspector', 'tyre_man', 'reporter', 'driver']),
  M('reportIssue',    'Report Issue',      'megaphone-outline',      'Field',      ['manager', 'director', 'reporter', 'driver']),
  // Fleet ---------------------------------------------------------------------
  M('records',        'Tyre Records',      'layers-outline',         'Fleet',      ['manager', 'director', 'inspector', 'reporter']),
  M('vehicles',       'Vehicles',          'car-outline',            'Fleet',      ['manager', 'director']),
  M('history',        'History',           'time-outline',           'Fleet',      ['manager', 'director', 'inspector', 'reporter']),
  M('alerts',         'Alerts',            'notifications-outline',  'Fleet',      ['manager', 'director', 'inspector']),
  M('calendar',       'Calendar',          'calendar-outline',       'Fleet',      ['manager', 'director', 'tyre_man', 'reporter']),
  // Maintenance ---------------------------------------------------------------
  M('accidents',      'Accidents',         'warning-outline',        'Maintenance',['manager', 'director', 'inspector']),
  M('reportAccident', 'File Accident',     'alert-circle-outline',   'Maintenance',['manager', 'director', 'inspector']),
  M('workorders',     'Work Orders',       'construct-outline',      'Maintenance',['manager', 'director']),
  M('rca',            'Root Cause',        'git-branch-outline',     'Maintenance',['manager', 'director', 'inspector']),
  M('tasks',          'Tasks',             'list-outline',           'Maintenance',['manager', 'director', 'inspector']),
  M('stock',          'Stock Count',       'cube-outline',           'Maintenance',['manager', 'inspector']),
  M('pm',             'Maintenance Due',   'build-outline',          'Maintenance',['manager', 'director']),
  // Management ----------------------------------------------------------------
  M('overview',       'Overview',          'grid-outline',           'Management', ['manager', 'director']),
  M('reports',        'Reports',           'document-text-outline',  'Management', ['manager', 'director', 'reporter']),
  M('analytics',      'Analytics',         'bar-chart-outline',      'Management', ['manager']),
  M('stockManage',    'Stock Management',  'file-tray-full-outline', 'Management', ['manager']),
  M('ai',             'Fleet AI',          'sparkles-outline',       'Management', ['manager']),
  M('team',           'Team',              'people-outline',         'Management', ['manager', 'director']),
  // Admin ---------------------------------------------------------------------
  M('approvals',      'Approvals',         'checkmark-done-outline', 'Admin',      ['manager', 'director']),
  M('admin',          'Admin Console',     'shield-outline',         'Admin',      ['manager', 'director']),
  M('users',          'User Management',   'person-add-outline',     'Admin',      []),
]
export const MODULE_BY_KEY: Record<ModuleKey, ModuleDef> =
  MODULES.reduce((m, d) => { m[d.key] = d; return m }, {} as Record<ModuleKey, ModuleDef>)

/** Ordered list of the module groups, for a grouped access editor. */
export const MODULE_GROUPS = MODULES.reduce<ModuleDef['group'][]>(
  (a, d) => (a.includes(d.group) ? a : a.concat(d.group)), [],
)

/** Per-user grant overlay shape (keyed by mobile ModuleKey, prefix stripped). */
export type GrantMap = Record<string, 'grant' | 'revoke'>

/**
 * Mobile access grants are namespaced in `user_access_grants.module_key` with a
 * `mobile:` prefix so they are INDEPENDENT of the web app's access / approvals
 * grants (which use their own bare keys). Revoking a module on mobile never
 * touches web access and vice versa.
 */
export const MOBILE_GRANT_PREFIX = 'mobile:'

/** Storage key for a mobile module (what the admin screen writes / revokes). */
export function mobileGrantKey(key: ModuleKey): string {
  return MOBILE_GRANT_PREFIX + key
}

/**
 * Build the mobile GrantMap from the raw `{module_key: effect}` returned by
 * get_my_access_grants(): keep ONLY `mobile:` keys and strip the prefix, so web
 * grants are ignored here.
 */
export function mobileGrantsFromRaw(raw: Record<string, unknown> | null | undefined): GrantMap {
  const out: GrantMap = {}
  if (!raw) return out
  for (const [k, v] of Object.entries(raw)) {
    if (!k.startsWith(MOBILE_GRANT_PREFIX)) continue
    if (v === 'grant' || v === 'revoke') out[k.slice(MOBILE_GRANT_PREFIX.length)] = v
  }
  return out
}

/** Role default only (no grant overlay). Admin is always allowed. */
export function moduleAllowedByRole(key: ModuleKey, role: UserRole | null | undefined): boolean {
  if (isAdmin(role)) return true
  const def = MODULE_BY_KEY[key]
  if (!def) return false
  return !!role && def.roles.includes(role)
}

/**
 * Effective access = role default, then the per-user grant overlay.
 * Precedence: admin / super-admin > revoke > grant > role default > deny.
 */
export function resolveModuleAccess(
  key: ModuleKey,
  role: UserRole | null | undefined,
  grants?: GrantMap | null,
  isSuper?: boolean,
): boolean {
  // Super-admin is never lockable. An ADMIN's default is allow-all, but an
  // explicit per-user Deny now beats it (user ask: "I change access and it
  // does not change in actual" - admins were un-revokable).
  if (isSuper) return true
  const override = grants?.[key]
  if (override === 'revoke') return false
  if (override === 'grant' || isAdmin(role)) return true
  return moduleAllowedByRole(key, role)
}

// ── Capability predicates (role default; back-compat wrappers over the registry)
// Existing screens import these by name - keep them. Each maps to a module so the
// role matrix stays the single source of truth.
export const canInspect          = (r: UserRole | null | undefined) => moduleAllowedByRole('inspect', r)
export const canReportAccident   = (r: UserRole | null | undefined) => moduleAllowedByRole('reportAccident', r)
export const canSearchSerial     = (r: UserRole | null | undefined) => moduleAllowedByRole('serial', r)
export const canViewAccidents    = (r: UserRole | null | undefined) => moduleAllowedByRole('accidents', r)
export const canViewFleet        = (r: UserRole | null | undefined) => moduleAllowedByRole('vehicles', r)
export const canManageWorkOrders = (r: UserRole | null | undefined) => moduleAllowedByRole('workorders', r)
export const canDoRca            = (r: UserRole | null | undefined) => moduleAllowedByRole('rca', r)
export const canManageStock      = (r: UserRole | null | undefined) => moduleAllowedByRole('stockManage', r)
export const canCountStock       = (r: UserRole | null | undefined) => moduleAllowedByRole('stock', r)
export const canViewOverview     = (r: UserRole | null | undefined) => moduleAllowedByRole('overview', r)
export const canAccessAdmin      = (r: UserRole | null | undefined) => moduleAllowedByRole('admin', r)
export const canUseAI            = (r: UserRole | null | undefined) => moduleAllowedByRole('ai', r)
export const canLogMeter         = (r: UserRole | null | undefined) => moduleAllowedByRole('meter', r)
export const canViewRecords      = (r: UserRole | null | undefined) => moduleAllowedByRole('records', r)
export const canViewAnalytics    = (r: UserRole | null | undefined) => moduleAllowedByRole('analytics', r)
export const canViewWorkOrders   = (r: UserRole | null | undefined) => moduleAllowedByRole('workorders', r)
export const canUpdateWorkOrders = (r: UserRole | null | undefined) => moduleAllowedByRole('workorders', r)
export const canViewReports      = (r: UserRole | null | undefined) => moduleAllowedByRole('reports', r)
export const canViewTasks        = (r: UserRole | null | undefined) => moduleAllowedByRole('tasks', r)
export const canViewCalendar     = (r: UserRole | null | undefined) => moduleAllowedByRole('calendar', r)
export const canReportIssue      = (r: UserRole | null | undefined) => moduleAllowedByRole('reportIssue', r)

// These stay strictly role-based (management sign-off), unaffected by the removals.
export const canReviewAccidents   = (r: UserRole | null | undefined) => isAdminOrAbove(r)
export const canApproveChecklists = (r: UserRole | null | undefined) => isAdminOrAbove(r)
export const canManageUsers       = (r: UserRole | null | undefined) => isAdmin(r)
export const canEditRecords       = (r: UserRole | null | undefined) => r === 'admin' || r === 'manager'

// ── Navigation model ────────────────────────────────────────────────────────
//
// The tab bar is rendered from this descriptor so a single change here keeps
// routing, icons and RBAC in lockstep. `moduleKey` ties a tab to the registry so
// the grant overlay (via AuthContext.canAccess) governs it too.

export interface TabDescriptor {
  /** expo-router route name within (app)/ */
  name: string
  /** i18n key for the tab label */
  labelKey: string
  /** Ionicons glyph */
  icon: string
  /** Optional active tint override (e.g. accident = red, admin = purple) */
  activeTint?: string
  /** Module this tab maps to (drives role + grant gating). Omitted = always on. */
  moduleKey?: ModuleKey
  /** Returns true when this tab should be visible for the given role (default). */
  visible: (role: UserRole | null | undefined) => boolean
  /**
   * Shown in the bottom tab bar. Only a small set are primary; the rest stay
   * routable (reached from the Home hub) but are kept OUT of the bar so it never
   * crowds. A non-primary descriptor is still declared as a screen (href:null)
   * so expo-router never auto-adds it as a stray tab.
   */
  primary?: boolean
}

export const TAB_BAR: TabDescriptor[] = [
  { name: 'index',              labelKey: 'tabs.home',       icon: 'home-outline',        visible: () => true,                 primary: true },
  { name: 'inspection/new',     labelKey: 'tabs.inspect',    icon: 'clipboard-outline',   moduleKey: 'inspect',   visible: canInspect,        primary: true },
  { name: 'records/index',      labelKey: 'tabs.records',    icon: 'layers-outline',      moduleKey: 'records',   visible: canViewRecords,    primary: true },
  { name: 'accident/dashboard', labelKey: 'tabs.accident',   icon: 'warning-outline',     activeTint: '#dc2626', moduleKey: 'accidents', visible: canViewAccidents, primary: true },
  { name: 'meter-logs',         labelKey: 'tabs.meter',      icon: 'speedometer-outline', activeTint: '#0369a1', moduleKey: 'meter',     visible: (r) => r === 'driver', primary: true },
  { name: 'workorders/index',   labelKey: 'tabs.workorders', icon: 'construct-outline',   moduleKey: 'workorders', visible: canViewWorkOrders },
  { name: 'analytics/index',    labelKey: 'tabs.analytics',  icon: 'bar-chart-outline',   activeTint: '#3b82f6', moduleKey: 'analytics', visible: canViewAnalytics },
  { name: 'reports/index',      labelKey: 'tabs.reports',    icon: 'document-text-outline', moduleKey: 'reports', visible: canViewReports },
  { name: 'ai/index',           labelKey: 'tabs.ai',         icon: 'sparkles-outline',    activeTint: '#7c3aed', moduleKey: 'ai',        visible: canUseAI },
  { name: 'admin/index',        labelKey: 'tabs.admin',      icon: 'shield-outline',      activeTint: '#7c3aed', moduleKey: 'admin',     visible: canAccessAdmin },
  { name: 'profile',            labelKey: 'tabs.profile',    icon: 'person-outline',      visible: () => true,                 primary: true },
]
