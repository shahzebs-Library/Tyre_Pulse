/**
 * navAccess.js — maps a sidebar path to the permission module that governs it,
 * so a CUSTOM role's sidebar can be filtered to exactly what it was granted.
 *
 * Built-in roles keep their existing hardcoded sidebar rules (Layout.jsx). A
 * custom role has no hardcoded rule, so its sidebar is derived from the module
 * access an Admin granted it (module_permissions → hasPermission): an item shows
 * only when its governing module is permitted. Paths with no governing module
 * are hidden for custom roles by default (custom roles are restrictive by
 * design) — except the universally-available Settings.
 *
 * The map mirrors the <ModuleRoute moduleKey> pairings in App.jsx plus a few
 * permissioned pages that use a different guard (e.g. Accidents is flag-gated).
 * Route-level enforcement is unchanged; this only governs sidebar visibility.
 */

/** Paths every signed-in user may open regardless of role (ungated routes). */
export const ALWAYS_ALLOWED_PATHS = new Set(['/settings'])

/** path → permission module key. Extends the App.jsx ModuleRoute pairings. */
export const NAV_MODULE_KEY = {
  '/': 'dashboard',
  '/daily-ops': 'daily_ops',
  '/accidents': 'accidents',
  '/tyres': 'tyre_records',
  '/analytics': 'analytics',
  '/brand-perf': 'brand_performance',
  '/site-comp': 'site_comparison',
  '/fleet': 'fleet_analytics',
  '/kpi': 'kpi_scorecard',
  '/country-comp': 'country_comparison',
  '/comparison': 'analytics',
  '/stock': 'stock',
  '/budgets': 'budgets',
  '/actions': 'corrective_actions',
  '/rca': 'rca',
  '/inspections': 'inspections',
  '/alerts': 'alerts',
  '/alert-thresholds': 'alerts',
  '/fleet-master': 'fleet_master',
  '/reports': 'reports',
  '/report-center': 'reports',
  '/gate-pass': 'gate_pass',
  '/vehicle-washing': 'vehicle_washing',
  '/work-orders': 'work_orders',
  '/assets': 'fleet_master',
  '/kpi-engine': 'kpi_scorecard',
  '/kpi-command': 'kpi_scorecard',
  '/position-intelligence': 'position_intelligence',
  '/pressure-intel': 'pressure_intelligence',
  '/inspection-intelligence': 'inspections',
  '/root-cause': 'root_cause_engine',
  '/predictive-maintenance': 'predictive_maintenance',
  '/vendor-intelligence': 'vendor_intelligence',
  '/driver-management': 'fleet_master',
  '/fleet-intelligence': 'fleet_intelligence',
  '/fleet-health': 'fleet_intelligence',
  '/advanced-analytics': 'analytics',
  '/ai-command-center': 'ai_command_center',
  '/executive-report': 'executive_report',
  '/forecasting': 'forecasting',
  '/cost-center': 'budgets',
  '/benchmark': 'analytics',
  '/procurement': 'stock',
  '/suppliers': 'stock',
  '/tyre-size': 'tyre_records',
  '/tyre-lifecycle': 'tyre_records',
  '/downtime': 'fleet_analytics',
  '/budget-planner': 'budgets',
  '/workshop': 'work_orders',
  '/fuel-efficiency': 'fleet_analytics',
  '/continuous-improvement': 'analytics',
  '/erp-sync': 'erp_sync',
  '/anomalies': 'tyre_records',
  '/vehicle-history': 'fleet_master',
  '/ai': 'ai_analytics',
  '/cleaning': 'data_cleaning',
  '/audit': 'audit_trail',
  '/users': 'user_management',
  '/custom-data': 'custom_data',
}

/**
 * Slugify a route into a stable module key for pages with no explicit
 * NAV_MODULE_KEY entry, e.g. '/board-overview' -> 'board_overview'. Kept in sync
 * with (and byte-identical to) moduleCatalog.slugifyModuleKey; inlined here to
 * avoid an import cycle (moduleCatalog imports NAV_MODULE_KEY from this module).
 * @param {string} route
 * @returns {string}
 */
function slugify(route) {
  const s = String(route == null ? '' : route)
    .trim()
    .toLowerCase()
    .replace(/^\/+/, '')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
  return s || 'root'
}

/**
 * The permission module key that governs a route. Prefers the curated
 * NAV_MODULE_KEY mapping (many routes -> one shared module), else the slug of the
 * route — which is exactly the key buildNavModuleCatalog() stores for pages with
 * no curated mapping, so a grant on a specialty page (board_overview,
 * roi_calculator, ...) resolves consistently for both sidebar visibility and
 * route access.
 * @param {string} path route `to`
 * @returns {string}
 */
export function governingModuleKey(path) {
  return NAV_MODULE_KEY[path] || slugify(path)
}

/**
 * Should a CUSTOM-role sidebar show this path?
 * @param {string} path         nav item `to`
 * @param {(k:string)=>boolean} hasPermission  AuthContext.hasPermission
 */
export function navItemAllowedForCustomRole(path, hasPermission) {
  if (ALWAYS_ALLOWED_PATHS.has(path)) return true
  const key = governingModuleKey(path)
  if (!key) return false
  return typeof hasPermission === 'function' ? hasPermission(key) === true : false
}
