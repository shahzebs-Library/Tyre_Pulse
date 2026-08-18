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
  | 'history' | 'tyreChange' | 'team' | 'pm' | 'washing' | 'workshop'

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
 * reversing the earlier removal) and little else (no serial, tyreChange,
 * reportIssue, alerts, records, vehicles, workorders, stock, tasks).
 *
 * Reporting (2026-07-18, field-feedback): field submitters must be able to SEE
 * and SHARE their own submitted work as PDF, so tyre_man also gets `history`
 * (their own submitted inspections/checklists, each shareable as PDF via the
 * per-row Share action) and `reports` (the site-scoped fleet PDF reports, which
 * the Reports screen already restricts to the user's own site for non-elevated
 * roles). `inspector` gains `reports` for the same reason (it already had
 * `history`). Driver is intentionally left out of both: a driver submits meter /
 * wash / issue records, not tyre inspections, so a tyre risk/cost report is not
 * their responsibility and their History would be empty - surfacing either would
 * be dishonest padding rather than a real capability.
 */
// MOBILE IS A FIELD-CAPTURE APP, NOT A REPORTING CLIENT.
//
// The phone is for ACCIDENTS, INSPECTIONS and WASHING, plus the cheap lookups
// that support them (scan, serial search, meter log, checklists). Those are all
// single-record reads or writes.
//
// The data-HEAVY modules below carry `roles: []`, which means admin and
// super-admin only (resolveModuleAccess always admits them). They were pulling
// whole tables onto the handset - mobile Analytics paged through every
// tyre_record, 7,498 rows and climbing - which is slow on a good phone and an
// out-of-memory crash on a cheap one. Restricting them keeps that load off the
// devices doing real field work, while an admin can still open them, and a
// per-user grant can still extend any of them to a specific person.
//
// RULE: do not give a bulk-listing or reporting module a role default here. If a
// field role genuinely needs one, either add a server-side aggregate so the
// phone fetches one row instead of the table, or grant it per user.
/**
 * Supervisory + approver roles. Named once so the modules below cannot drift
 * apart, and so it is obvious WHO these are: the people who sign work off.
 *
 * They all used to normalise to 'reporter' on the phone, which is why they are
 * listed on the field modules a reporter already had - adding a role to
 * UserRole without listing it here would have TAKEN AWAY access two real people
 * are using today.
 */
export const SUPERVISOR_ROLES: readonly UserRole[] = [
  'maintenance_supervisor', 'workshop_supervisor',
  'pmv_manager', 'workshop_area_manager', 'workshop_maintenance_area_manager',
]

export const MODULES: ModuleDef[] = [
  // Field ---------------------------------------------------------------------
  M('inspect',        'New Inspection',    'clipboard-outline',      'Field',      ['manager', 'director', 'inspector', 'tyre_man']),
  M('scan',           'Scan',              'scan-outline',           'Field',      ['manager', 'director', 'inspector', 'tyre_man', 'mechanic', 'electrician']),
  M('serial',         'Serial Search',     'search-outline',         'Field',      ['manager', 'director', 'inspector', 'tyre_man', 'tyre_data_collector', 'reporter', 'driver', 'mechanic', 'electrician', 'maintenance_supervisor', 'workshop_supervisor', 'pmv_manager', 'workshop_area_manager', 'workshop_maintenance_area_manager']),
  M('tyreChange',     'Tyre Change',       'swap-horizontal-outline','Field',      ['manager', 'director', 'inspector']),
  M('checklists',     'Checklists',        'checkbox-outline',       'Field',      ['manager', 'director', 'inspector', 'tyre_man', 'mechanic', 'electrician', 'driver', 'maintenance_supervisor', 'workshop_supervisor', 'pmv_manager', 'workshop_area_manager', 'workshop_maintenance_area_manager']),
  M('meter',          'Meter Log',         'speedometer-outline',    'Field',      ['manager', 'director', 'inspector', 'tyre_man', 'reporter', 'driver', 'mechanic', 'electrician', 'maintenance_supervisor', 'workshop_supervisor', 'pmv_manager', 'workshop_area_manager', 'workshop_maintenance_area_manager']),
  M('washing',        'Vehicle Washing',   'water-outline',          'Field',      ['manager', 'director', 'inspector', 'driver', 'tyre_man']),
  M('reportIssue',    'Report Issue',      'megaphone-outline',      'Field',      ['manager', 'director', 'reporter', 'driver', 'mechanic', 'electrician', 'maintenance_supervisor', 'workshop_supervisor', 'pmv_manager', 'workshop_area_manager', 'workshop_maintenance_area_manager']),
  // Fleet ---------------------------------------------------------------------
  M('records',        'Tyre Records',      'layers-outline',         'Fleet',      []),
  // Field staff need to look an asset up (owner instruction 2026-08-06). Safe to
  // open: this screen reads a BOUNDED, country-scoped, lean-column page (2000
  // rows, ~1k per country) - it was never the unbounded table scan that caused
  // the low-end-device crashes; that was the analytics screen, now server-side.
  M('vehicles',       'Vehicles',          'car-outline',            'Fleet',
    ['manager', 'director', 'inspector', 'tyre_man', 'reporter', 'driver', 'mechanic', 'electrician', 'maintenance_supervisor', 'workshop_supervisor', 'pmv_manager', 'workshop_area_manager', 'workshop_maintenance_area_manager']),
  M('history',        'History',           'time-outline',           'Fleet',      []),
  M('alerts',         'Alerts',            'notifications-outline',  'Fleet',      ['manager', 'director', 'inspector']),
  M('calendar',       'Calendar',          'calendar-outline',       'Fleet',      ['manager', 'director', 'tyre_man', 'reporter', 'maintenance_supervisor', 'workshop_supervisor', 'pmv_manager', 'workshop_area_manager', 'workshop_maintenance_area_manager']),
  // Maintenance ---------------------------------------------------------------
  M('accidents',      'Accidents',         'warning-outline',        'Maintenance',['manager', 'director', 'inspector']),
  M('reportAccident', 'File Accident',     'alert-circle-outline',   'Maintenance',['manager', 'director', 'inspector']),
  M('workorders',     'Work Orders',       'construct-outline',      'Maintenance',[]),
  M('rca',            'Root Cause',        'git-branch-outline',     'Maintenance',['manager', 'director', 'inspector']),
  M('tasks',          'Tasks',             'list-outline',           'Maintenance',['manager', 'director', 'inspector']),
  M('stock',          'Stock Count',       'cube-outline',           'Maintenance',['manager', 'inspector']),
  M('pm',             'Maintenance Due',   'build-outline',          'Maintenance',['manager', 'director']),
  // Workshop Live Control - a technician records job activity here. V591 finally
  // created the real trades (mechanic, electrician), so this is no longer
  // approximated by tyre_man + inspector - though both keep it, because that is
  // who has been using it. Supervisors (manager/director) + admin see it too,
  // and a per-user grant can still extend it to anyone.
  M('workshop',       'My Jobs',           'construct-outline',      'Maintenance',['manager', 'director', 'inspector', 'tyre_man', 'mechanic', 'electrician']),
  // Management ----------------------------------------------------------------
  M('overview',       'Overview',          'grid-outline',           'Management', []),
  M('reports',        'Reports',           'document-text-outline',  'Management', []),
  M('analytics',      'Analytics',         'bar-chart-outline',      'Management', []),
  M('stockManage',    'Stock Management',  'file-tray-full-outline', 'Management', []),
  M('ai',             'Fleet AI',          'sparkles-outline',       'Management', []),
  M('team',           'Team',              'people-outline',         'Management', []),
  // Admin ---------------------------------------------------------------------
  // WHO SIGNS. The owner's instruction: the area manager or the PMV manager
  // signs, not a Manager. This key gates all three queues (inspection,
  // checklist, admin), so it is the UNION of who the server will actually
  // let act - each screen and RPC still enforces its own rung.
  // Director stays for the checklist FINAL rung only: exactly one person
  // holds an area-manager role, and a queue nobody else can clear jams the
  // moment they take leave (the reasoning V594 recorded).
  M('approvals',      'Approvals',         'checkmark-done-outline', 'Admin',
    ['director', 'maintenance_supervisor', 'workshop_supervisor',
     'pmv_manager', 'workshop_area_manager', 'workshop_maintenance_area_manager']),
  // ADMIN ONLY - no leakage. This console links straight to User Management,
  // the Access Manager and admin approvals, and its other destinations
  // (analytics, reports) are admin-only modules in their own right - so a
  // Manager who reached it saw a menu where most entries refused them.
  // Manager and Director keep the Accident Dashboard, which they reach
  // directly from Home; nothing they can actually use is lost here.
  M('admin',          'Admin Console',     'shield-outline',         'Admin',      []),
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
 * ROLE-level mobile permission matrix (keyed by mobile ModuleKey, prefix
 * stripped). Sourced from the shared `module_permissions` table's `mobile:`
 * prefixed rows for the user's role. `true` explicitly enables a module on
 * mobile, `false` explicitly denies it. A key that is ABSENT means "no role
 * override on mobile" so the client-side role default (moduleAllowedByRole)
 * decides. This is the mirror of the web role matrix, but scoped to mobile via
 * the `mobile:` module_key convention (see MOBILE_GRANT_PREFIX below).
 */
export type RoleMatrix = Record<string, boolean>

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

/**
 * Build the mobile RoleMatrix from the raw `{module_key: enabled}` map returned
 * by the `get_user_module_permissions()` RPC: keep ONLY `mobile:` keys and strip
 * the prefix, so the plain (web) role rows are ignored here. Non-boolean values
 * are dropped defensively so a malformed row can never enable/deny by accident.
 */
export function mobileRoleMatrixFromRaw(raw: Record<string, unknown> | null | undefined): RoleMatrix {
  const out: RoleMatrix = {}
  if (!raw) return out
  for (const [k, v] of Object.entries(raw)) {
    if (!k.startsWith(MOBILE_GRANT_PREFIX)) continue
    if (typeof v === 'boolean') out[k.slice(MOBILE_GRANT_PREFIX.length)] = v
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
 * Effective access = role default, then the ROLE-level mobile matrix, then the
 * per-user grant overlay.
 *
 * Precedence (highest first):
 *   1. admin / super-admin        -> always allowed
 *   2. per-user grant `revoke`    -> deny
 *   3. per-user grant `grant`     -> allow
 *   4. ROLE mobile matrix explicit-> `true` allow / `false` deny (this surface)
 *   5. client-side role default   -> moduleAllowedByRole
 *
 * `roleMatrix` is OPTIONAL and defaults to none, so existing 4-arg callers keep
 * working and the app FAILS OPEN: when the matrix is empty/undefined the module
 * falls back to the role default exactly as before.
 */
export function resolveModuleAccess(
  key: ModuleKey,
  role: UserRole | null | undefined,
  grants?: GrantMap | null,
  isSuper?: boolean,
  roleMatrix?: RoleMatrix | null,
): boolean {
  // Super-admin is never lockable.
  if (isSuper) return true
  // Per-user override wins over everything below. An explicit per-user Deny even
  // beats an ADMIN's allow-all default (user ask: admins were un-revokable).
  const override = grants?.[key]
  if (override === 'revoke') return false
  if (override === 'grant') return true
  if (isAdmin(role)) return true
  // ROLE-level mobile matrix: an admin can enable or deny a module for a whole
  // role on mobile only, via the `mobile:`-prefixed module_permissions rows.
  const matrix = roleMatrix?.[key]
  if (matrix === true) return true
  if (matrix === false) return false
  // No per-user and no role override on mobile -> client-side role default.
  return moduleAllowedByRole(key, role)
}

// ── Sensitive modules — fail CLOSED when permission data is unreliable ───────
//
// Finding #4/#10: the default `resolveModuleAccess` FAILS OPEN (an empty grants
// map / role matrix falls back to the client role default) so that a transient
// permission-RPC failure never strands a FIELD user mid-shift. That leniency is
// acceptable for low-risk operational modules, but NOT for administration
// surfaces: a non-admin must never reach user management / access control /
// approvals / the admin console just because the permission maps failed to load
// and the empty matrix quietly fell through to a permissive role default.
//
// SENSITIVE_MODULES therefore fail CLOSED under `permissionsError`: access is
// granted only on a signal that SURVIVES the failure — super-admin, the hard
// `admin` role, or an explicit per-user `grant` — never a role default or an
// (unreliable, empty) role matrix. Keys map to the real admin surfaces in the
// MODULES registry above (Admin Console, User Management, Approvals). No new
// role names are introduced.
export const SENSITIVE_MODULES: ReadonlySet<ModuleKey> = new Set<ModuleKey>([
  'admin', 'users', 'approvals',
])

/** True when the module is an administration surface that must fail closed. */
export function isSensitiveModule(key: ModuleKey): boolean {
  return SENSITIVE_MODULES.has(key)
}

/**
 * Guarded resolver used by <ModuleGuard>. Identical to `resolveModuleAccess`
 * for low-risk modules and whenever the permission data is healthy. When
 * `permissionsError` is true AND the module is sensitive, it fails CLOSED:
 * only a super-admin, the hard `admin` role, or an explicit per-user `grant`
 * passes. It never lets a role default or an empty/stale role matrix grant a
 * sensitive module while the permission maps are known to be unreliable.
 *
 * The client guard is UX + defense-in-depth only; the server (RLS + RPCs) is
 * the real authorization boundary.
 */
export function resolveGuardedAccess(
  key: ModuleKey,
  role: UserRole | null | undefined,
  grants: GrantMap | null | undefined,
  isSuper: boolean | undefined,
  roleMatrix: RoleMatrix | null | undefined,
  permissionsError: boolean | undefined,
): boolean {
  if (isSuper) return true
  // An explicit per-user revoke always denies, regardless of everything else.
  if (grants?.[key] === 'revoke') return false
  if (permissionsError && isSensitiveModule(key) && !isAdmin(role)) {
    // Permission data is untrustworthy: require a positive signal that does not
    // depend on it. Only an explicit grant (loaded before the failure) passes;
    // role default and role matrix are deliberately ignored here.
    return grants?.[key] === 'grant'
  }
  return resolveModuleAccess(key, role, grants, isSuper, roleMatrix)
}

// ── Capability predicates (role default; back-compat wrappers over the registry)
// Existing screens import these by name - keep them. Each maps to a module so the
// role matrix stays the single source of truth.
export const canInspect          = (r: UserRole | null | undefined) => moduleAllowedByRole('inspect', r)
export const canReportAccident   = (r: UserRole | null | undefined) => moduleAllowedByRole('reportAccident', r)
export const canSearchSerial     = (r: UserRole | null | undefined) => moduleAllowedByRole('serial', r)
export const canViewAccidents    = (r: UserRole | null | undefined) => moduleAllowedByRole('accidents', r)
export const canWash             = (r: UserRole | null | undefined) => moduleAllowedByRole('washing', r)
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
  // Records is admin-only now and is reached from the Home hub, so it no longer
  // occupies one of the five primary slots that field staff see.
  { name: 'records/index',      labelKey: 'tabs.records',    icon: 'layers-outline',      moduleKey: 'records',   visible: canViewRecords },
  { name: 'accident/dashboard', labelKey: 'tabs.accident',   icon: 'warning-outline',     activeTint: '#dc2626', moduleKey: 'accidents', visible: canViewAccidents, primary: true },
  { name: 'meter-logs',         labelKey: 'tabs.meter',      icon: 'speedometer-outline', activeTint: '#0369a1', moduleKey: 'meter',     visible: (r) => r === 'driver', primary: true },
  { name: 'washing',            labelKey: 'tabs.washing',    icon: 'water-outline',       activeTint: '#0284c7', moduleKey: 'washing',   visible: canWash,           primary: true },
  { name: 'workorders/index',   labelKey: 'tabs.workorders', icon: 'construct-outline',   moduleKey: 'workorders', visible: canViewWorkOrders },
  { name: 'analytics/index',    labelKey: 'tabs.analytics',  icon: 'bar-chart-outline',   activeTint: '#3b82f6', moduleKey: 'analytics', visible: canViewAnalytics },
  { name: 'reports/index',      labelKey: 'tabs.reports',    icon: 'document-text-outline', moduleKey: 'reports', visible: canViewReports },
  { name: 'ai/index',           labelKey: 'tabs.ai',         icon: 'sparkles-outline',    activeTint: '#7c3aed', moduleKey: 'ai',        visible: canUseAI },
  { name: 'admin/index',        labelKey: 'tabs.admin',      icon: 'shield-outline',      activeTint: '#7c3aed', moduleKey: 'admin',     visible: canAccessAdmin },
  { name: 'profile',            labelKey: 'tabs.profile',    icon: 'person-outline',      visible: () => true,                 primary: true },
]
