/**
 * Module catalog — the canonical list of access-controlled modules, grouped into
 * the 8 product workspaces used by the sidebar. Drives the Access Control matrix
 * (role × module) in User Management. Keys match `module_permissions.module_key`
 * and the `moduleKey` props on <ModuleRoute> in App.jsx.
 *
 * The curated MODULE_GROUPS below is the STABLE, hand-maintained set (its keys are
 * referenced by module_permissions / user_access_grants and MUST NOT be renamed).
 * `buildNavModuleCatalog()` (bottom of this file) expands it to the COMPLETE set of
 * navigable modules by merging in every sidebar item, so surfaces that need full
 * coverage (e.g. the super-admin Module Control Center) see every real app module
 * without a second, drift-prone catalog. That merge is pure: the live nav
 * descriptor (Layout.NAV_CATALOG) is passed in, never imported here, so this stays
 * a React-free data module with no import cycle back into Layout.
 */
import { NAV_MODULE_KEY } from './navAccess'

/** @type {{ group: string, modules: { key: string, label: string }[] }[]} */
export const MODULE_GROUPS = [
  {
    group: 'Overview',
    modules: [
      { key: 'dashboard', label: 'Dashboard' },
      { key: 'daily_ops', label: 'Daily Operations' },
      { key: 'alerts', label: 'Alerts' },
    ],
  },
  {
    group: 'Tyres & Inspections',
    modules: [
      { key: 'tyre_records', label: 'Tyre Records' },
      { key: 'inspections', label: 'Inspections' },
      { key: 'gate_pass', label: 'Gate Pass' },
      { key: 'rca', label: 'Root Cause (RCA)' },
    ],
  },
  {
    group: 'Fleet & Assets',
    modules: [
      { key: 'fleet_master', label: 'Fleet Master' },
      { key: 'fleet_analytics', label: 'Fleet Analytics' },
      { key: 'fleet_intelligence', label: 'Fleet Intelligence' },
    ],
  },
  {
    group: 'Workshop & Stock',
    modules: [
      { key: 'work_orders', label: 'Work Orders' },
      { key: 'stock', label: 'Stock' },
      { key: 'maintenance_calendar', label: 'Maintenance Calendar' },
      { key: 'corrective_actions', label: 'Corrective Actions' },
      { key: 'accidents', label: 'Accidents' },
    ],
  },
  {
    group: 'Procurement & Vendors',
    modules: [
      { key: 'budgets', label: 'Budgets' },
      { key: 'vendor_intelligence', label: 'Vendor Intelligence' },
    ],
  },
  {
    group: 'Analytics & KPIs',
    modules: [
      { key: 'analytics', label: 'Analytics' },
      { key: 'kpi_scorecard', label: 'KPI Scorecard' },
      { key: 'brand_performance', label: 'Brand Performance' },
      { key: 'site_comparison', label: 'Site Comparison' },
      { key: 'country_comparison', label: 'Country Comparison' },
      { key: 'position_intelligence', label: 'Position Intelligence' },
      { key: 'pressure_intelligence', label: 'Pressure Intelligence' },
      { key: 'predictive_maintenance', label: 'Predictive Maintenance' },
      { key: 'root_cause_engine', label: 'Root Cause Engine' },
      { key: 'forecasting', label: 'Forecasting' },
    ],
  },
  {
    group: 'Reports & AI',
    modules: [
      { key: 'reports', label: 'Reports' },
      { key: 'executive_report', label: 'Executive Report' },
      { key: 'ai_analytics', label: 'AI Analytics' },
      { key: 'ai_command_center', label: 'AI Command Center' },
    ],
  },
  {
    group: 'Data & Administration',
    modules: [
      { key: 'upload_data', label: 'Upload Data' },
      { key: 'custom_data', label: 'Custom Data / Intake' },
      { key: 'data_cleaning', label: 'Data Cleaning' },
      { key: 'erp_sync', label: 'ERP Sync' },
      { key: 'audit_trail', label: 'Audit Trail' },
      { key: 'user_management', label: 'User Management' },
    ],
  },
]

/** Roles that appear as columns in the access matrix. Admin is always full. */
export const ACCESS_ROLES = [
  'Admin', 'Manager', 'Director', 'Reporter', 'Inspector', 'Tyre Man', 'Driver',
  'Integration Admin', 'Data Engineer', 'Automation', 'Data Monitor Officer',
]

/** Flat [{key,label,group}] for lookups. */
export const ALL_MODULES = MODULE_GROUPS.flatMap((g) =>
  g.modules.map((m) => ({ ...m, group: g.group })),
)

export const MODULE_LABEL = Object.fromEntries(ALL_MODULES.map((m) => [m.key, m.label]))

/**
 * Sub-modules: the real inner tabs / sub-surfaces of the tabbed modules, so an
 * admin can gate a single tab inside a module (e.g. hide Accidents > Analytics
 * without hiding the whole Accidents module). Keys are namespaced 'parent:child'
 * so they never collide with a base module_key and can be stored verbatim in
 * `module_permissions.module_key` (role) or `user_access_grants.module_key`
 * (user) with NO schema change (both columns are free text).
 *
 * HONESTY: sub-module access is STORED ONLY today. No <ModuleRoute> / route guard
 * consumes a composite key yet, so toggling one records intent for progressive
 * enforcement but does not hide the tab. The editor labels these "(stored only)".
 *
 * Labels below were read from the live pages (do NOT invent tabs a page lacks):
 *   accidents      -> Accidents.jsx tab bar (Incidents / Analytics / Report Builder)
 *   ai_analytics   -> AiAdministration.jsx tab bar (the platform AI config surface)
 *   user_management-> UserManagement.jsx tab bar (Users / Matrix / Branding / Sites / Activity)
 *   reports        -> reports routes sharing moduleKey "reports" + Scheduled Reports
 *   fleet_master   -> routes sharing moduleKey "fleet_master" (Assets / Sites / Drivers)
 *   analytics      -> routes sharing moduleKey "analytics" (Advanced / Comparison)
 *   work_orders    -> WorkOrders.jsx surfaces (list register + detail & actions drawer)
 *
 * @type {Record<string, { key: string, label: string }[]>}
 */
export const SUBMODULES = {
  accidents: [
    { key: 'accidents:incidents', label: 'Incidents' },
    { key: 'accidents:analytics', label: 'Analytics' },
    { key: 'accidents:builder', label: 'Report Builder' },
  ],
  ai_analytics: [
    { key: 'ai_analytics:operations', label: 'Operations' },
    { key: 'ai_analytics:jobs', label: 'Delivery & Jobs' },
    { key: 'ai_analytics:models', label: 'Models' },
    { key: 'ai_analytics:prompts', label: 'Prompts' },
    { key: 'ai_analytics:budgets', label: 'Budgets' },
    { key: 'ai_analytics:feedback', label: 'Feedback' },
  ],
  user_management: [
    { key: 'user_management:users', label: 'Users' },
    { key: 'user_management:matrix', label: 'Access Matrix' },
    { key: 'user_management:branding', label: 'Branding' },
    { key: 'user_management:sites', label: 'Sites Master' },
    { key: 'user_management:activity', label: 'Activity Log' },
  ],
  reports: [
    { key: 'reports:center', label: 'Report Center' },
    { key: 'reports:builder', label: 'Report Builder' },
    { key: 'reports:scheduled', label: 'Scheduled Reports' },
  ],
  fleet_master: [
    { key: 'fleet_master:assets', label: 'Assets' },
    { key: 'fleet_master:sites', label: 'Sites' },
    { key: 'fleet_master:drivers', label: 'Drivers' },
  ],
  analytics: [
    { key: 'analytics:advanced', label: 'Advanced Analytics' },
    { key: 'analytics:comparison', label: 'Comparison' },
  ],
  work_orders: [
    { key: 'work_orders:register', label: 'Work Order Register' },
    { key: 'work_orders:detail', label: 'Detail & Actions' },
  ],
}

/**
 * Flat, ordered registry of every gate-able node: each base module at level 0
 * immediately followed by its declared sub-modules at level 1. Sub-module rows
 * carry `group` (inherited from the parent) and `parent` (the parent module_key)
 * so a tree UI can render group -> module -> sub-module without re-joining maps.
 *
 * @type {{ key: string, label: string, group: string, level: number, parent?: string }[]}
 */
export const FULL_REGISTRY = ALL_MODULES.flatMap((m) => [
  { ...m, level: 0 },
  ...(SUBMODULES[m.key] || []).map((s) => ({ ...s, group: m.group, parent: m.key, level: 1 })),
])

/** Label lookup covering both base modules and sub-modules. */
export const REGISTRY_LABEL = Object.fromEntries(FULL_REGISTRY.map((n) => [n.key, n.label]))

/** True when a key is a namespaced sub-module key ('parent:child'). */
export const isSubmoduleKey = (key) => typeof key === 'string' && key.includes(':')

/** The parent module_key of a sub-module key, or null for a base key. */
export const parentModuleKey = (key) =>
  isSubmoduleKey(key) ? String(key).split(':', 1)[0] : null

/**
 * Convert a sidebar route into a stable, storable module key for nav items that
 * have no explicit NAV_MODULE_KEY mapping. Deterministic and lowercase:
 *   '/live-fleet'          -> 'live_fleet'
 *   '/tyre-age-compliance' -> 'tyre_age_compliance'
 * Leading slashes are stripped and every run of non-alphanumerics collapses to a
 * single underscore. An empty result (e.g. the root '/') falls back to 'root';
 * in practice '/' always resolves through NAV_MODULE_KEY to 'dashboard' first.
 *
 * @param {string} route
 * @returns {string}
 */
export function slugifyModuleKey(route) {
  const s = String(route == null ? '' : route)
    .trim()
    .toLowerCase()
    .replace(/^\/+/, '')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
  return s || 'root'
}

/**
 * Build the COMPLETE, grouped module catalog by merging the live sidebar
 * descriptor (Layout.NAV_CATALOG) onto the curated base catalog (MODULE_GROUPS).
 *
 * ONE source of truth, no fabrication: every navigable sidebar item becomes an
 * access-controlled module.
 *   - Curated base keys go first and OWN their label + group (they are the stable
 *     module_permissions / user_access_grants keys, never renamed here).
 *   - A nav item whose route resolves to an existing key collapses onto it, so the
 *     many-routes-to-one-module cases (e.g. the KPI pages, the fleet_master pages)
 *     stay a single module.
 *   - A nav item with no curated key is ADDED under its sidebar group, keyed by its
 *     NAV_MODULE_KEY when one exists, else a slug of the route.
 *
 * Pure + deterministic: the nav descriptor is an argument (Layout is a React
 * module; keeping this helper React-free avoids a cycle and keeps the service
 * layer light). Returns a flat, de-duplicated, order-stable list.
 *
 * @param {{key?:string,label?:string,items?:{key?:string,label?:string}[]}[]} navCatalog
 *        Layout.NAV_CATALOG shape: group key = group label, item key = route `to`.
 * @param {Record<string,string>} [moduleKeyMap=NAV_MODULE_KEY] route -> module key.
 * @returns {{module_id:string,name:string,category:string}[]}
 */
export function buildNavModuleCatalog(navCatalog, moduleKeyMap = NAV_MODULE_KEY) {
  const out = []
  const seen = new Set()

  // 1. Curated base modules first: they own their label + group (stable keys).
  for (const m of ALL_MODULES) {
    if (seen.has(m.key)) continue
    seen.add(m.key)
    out.push({ module_id: m.key, name: m.label, category: m.group })
  }

  // 2. Every sidebar item, in sidebar order, grouped by its nav group.
  const groups = Array.isArray(navCatalog) ? navCatalog : []
  for (const g of groups) {
    if (!g || typeof g !== 'object') continue
    const category =
      typeof g.label === 'string' && g.label.trim() ? g.label.trim() : String(g.key || '')
    const items = Array.isArray(g.items) ? g.items : []
    for (const it of items) {
      if (!it || typeof it !== 'object') continue
      const route = typeof it.key === 'string' ? it.key : ''
      if (!route) continue
      const key = (moduleKeyMap && moduleKeyMap[route]) || slugifyModuleKey(route)
      if (!key || seen.has(key)) continue
      seen.add(key)
      out.push({ module_id: key, name: String(it.label || key), category })
    }
  }

  return out
}
