/**
 * permissions/registry.js — the canonical `module.resource.action` catalog for
 * the centralized Master Access Control engine (see repo-root
 * "Master Access Control and Approval Permissions.md").
 *
 * This is the ADDITIVE central catalog. It does NOT replace the existing
 * view-only enforcement in src/contexts/AuthContext.jsx (module_permissions) or
 * the capability matrix in src/lib/permissionMatrix.js — those keep working.
 * Pages migrate to `can()` / <Can> / useCan progressively.
 *
 * Naming: every permission key is `module.resource.action`, e.g.
 *   inspections.daily.approve, tyres.replacement.authorize,
 *   reports.executive.export, finance.costs.view, settings.access.manage.
 *
 * Design rules:
 *   - Deny-by-default. A key that is not granted (directly, by role template, or
 *     by a wildcard) is denied.
 *   - Role templates map to a set of permission keys OR wildcards
 *     (`*`, `module.*`, `module.resource.*`). Wildcards keep the catalog
 *     maintainable and let broad roles (Company Admin) stay concise.
 *   - Title-case role names, matching the existing app (Admin, Manager,
 *     Director, Tyre Man, Inspector, Reporter, Driver) plus the spec's extended
 *     templates (Site Supervisor, Fleet Supervisor, Store Keeper, Workshop
 *     Manager, PMV Manager, Finance, Operations Manager, Company Admin,
 *     Platform Super Admin).
 *
 * SECURITY: this catalog is a convenience layer for the frontend. The real
 * boundary is Supabase Row Level Security + validated backend writes. Hiding a
 * button is never security (see the master spec, "Hiding buttons is not
 * security").
 */

// ── Actions ──────────────────────────────────────────────────────────────────
// The full action vocabulary from the master spec. `view_financial` gates
// confidential fields (costs, rates, commercial terms) independently of `view`.
export const ACTIONS = Object.freeze([
  'view',
  'create',
  'edit',
  'delete',
  'approve',
  'reject',
  'return',
  'assign',
  'export',
  'print',
  'sign',
  'upload',
  'configure',
  'view_financial',
])

export const ACTION_SET = Object.freeze(new Set(ACTIONS))

// ── Modules ──────────────────────────────────────────────────────────────────
// Top-level modules the spec says the rules apply throughout. These are the
// first segment of every permission key.
export const MODULES = Object.freeze([
  'dashboards',
  'fleet',
  'tyres',
  'inspections',
  'inventory',
  'store',
  'warranty',
  'accidents',
  'jobcards',
  'maintenance',
  'purchasing',
  'finance',
  'vendors',
  'reports',
  'exports',
  'documents',
  'ai',
  'automation',
  'settings',
  'integrations',
  'api',
  'admin',
])

export const MODULE_SET = Object.freeze(new Set(MODULES))

// ── Permission catalog (module.resource.action) ──────────────────────────────
// Each entry is `[module, resource, [actions]]`. The cartesian product of
// resource × actions produces the canonical keys. Keep resources meaningful —
// they map to real workflows so approval steps can target `module.resource`.
/** @type {[string, string, string[]][]} */
const CATALOG = [
  // Dashboards & executive intelligence
  ['dashboards', 'overview', ['view', 'export', 'print']],
  ['dashboards', 'executive', ['view', 'export', 'print', 'view_financial']],

  // Fleet & assets
  ['fleet', 'vehicles', ['view', 'create', 'edit', 'delete', 'assign', 'export', 'print']],
  ['fleet', 'assignments', ['view', 'create', 'edit', 'delete', 'assign']],

  // Tyres
  ['tyres', 'records', ['view', 'create', 'edit', 'delete', 'export', 'print']],
  ['tyres', 'replacement', ['view', 'create', 'edit', 'approve', 'reject', 'return', 'authorize', 'sign']],
  ['tyres', 'retread', ['view', 'create', 'edit', 'approve', 'reject']],
  ['tyres', 'scrap', ['view', 'create', 'approve', 'reject', 'sign']],

  // Inspections (incl. daily inspections / Tyre Man PWA)
  ['inspections', 'daily', ['view', 'create', 'edit', 'delete', 'approve', 'reject', 'return', 'export', 'print', 'sign', 'upload']],
  ['inspections', 'scheduled', ['view', 'create', 'edit', 'delete', 'approve', 'reject', 'export']],
  ['inspections', 'audit', ['view', 'create', 'edit', 'approve', 'export']],

  // Inventory & store issuance
  ['inventory', 'stock', ['view', 'create', 'edit', 'delete', 'export', 'print']],
  ['inventory', 'issue', ['view', 'create', 'edit', 'approve', 'reject', 'return', 'sign']],
  ['inventory', 'adjustment', ['view', 'create', 'approve', 'reject']],
  ['store', 'issuance', ['view', 'create', 'edit', 'approve', 'reject', 'return', 'sign', 'print']],
  ['store', 'receipt', ['view', 'create', 'edit', 'approve', 'reject']],

  // Warranty & accidents / insurance
  ['warranty', 'claims', ['view', 'create', 'edit', 'delete', 'approve', 'reject', 'return', 'sign', 'upload', 'export']],
  ['accidents', 'records', ['view', 'create', 'edit', 'delete', 'approve', 'reject', 'sign', 'upload', 'export', 'view_financial']],
  ['accidents', 'insurance', ['view', 'create', 'edit', 'approve', 'reject', 'sign', 'upload', 'view_financial']],

  // Job cards & maintenance
  ['jobcards', 'orders', ['view', 'create', 'edit', 'delete', 'assign', 'approve', 'reject', 'return', 'sign', 'export', 'print']],
  ['maintenance', 'schedule', ['view', 'create', 'edit', 'delete', 'assign', 'approve', 'export']],
  ['maintenance', 'corrective', ['view', 'create', 'edit', 'approve', 'reject', 'assign']],

  // Purchasing, finance, vendors
  ['purchasing', 'requisitions', ['view', 'create', 'edit', 'delete', 'approve', 'reject', 'return', 'sign', 'export', 'view_financial']],
  ['purchasing', 'orders', ['view', 'create', 'edit', 'approve', 'reject', 'sign', 'export', 'view_financial']],
  ['finance', 'costs', ['view', 'edit', 'export', 'view_financial']],
  ['finance', 'budgets', ['view', 'create', 'edit', 'approve', 'reject', 'export', 'view_financial']],
  ['finance', 'invoices', ['view', 'create', 'edit', 'approve', 'reject', 'sign', 'export', 'view_financial']],
  ['vendors', 'directory', ['view', 'create', 'edit', 'delete', 'export']],
  ['vendors', 'performance', ['view', 'export', 'view_financial']],

  // Reports & exports
  ['reports', 'standard', ['view', 'create', 'edit', 'export', 'print']],
  ['reports', 'executive', ['view', 'create', 'export', 'print', 'view_financial']],
  ['reports', 'scheduled', ['view', 'create', 'edit', 'delete', 'configure']],
  ['exports', 'data', ['view', 'export', 'print']],

  // Documents
  ['documents', 'library', ['view', 'create', 'edit', 'delete', 'upload', 'export', 'print', 'sign']],

  // AI & automation
  ['ai', 'assistant', ['view', 'configure']],
  ['ai', 'knowledge', ['view', 'create', 'edit', 'delete', 'upload', 'configure']],
  ['automation', 'rules', ['view', 'create', 'edit', 'delete', 'configure']],
  ['automation', 'workflows', ['view', 'create', 'edit', 'delete', 'approve', 'configure']],

  // Settings, integrations, API, administration
  ['settings', 'general', ['view', 'edit', 'configure']],
  ['settings', 'access', ['view', 'create', 'edit', 'delete', 'assign', 'configure', 'manage']],
  ['settings', 'branding', ['view', 'edit', 'configure']],
  ['settings', 'flags', ['view', 'edit', 'configure']],
  ['integrations', 'erp', ['view', 'create', 'edit', 'delete', 'configure']],
  ['api', 'keys', ['view', 'create', 'edit', 'delete', 'configure']],
  ['api', 'webhooks', ['view', 'create', 'edit', 'delete', 'configure']],
  ['admin', 'users', ['view', 'create', 'edit', 'delete', 'assign', 'approve', 'configure']],
  ['admin', 'audit', ['view', 'export', 'print']],
  ['admin', 'tenants', ['view', 'create', 'edit', 'delete', 'configure']],
]

// A couple of catalog entries use domain-specific actions (`authorize`,
// `manage`) that read better than a generic verb at the call site. Register
// them so validation accepts them without polluting the top-level ACTIONS list
// that drives the permission-matrix UI.
const EXTRA_ACTIONS = Object.freeze(new Set(['authorize', 'manage']))

/** Build the frozen set of every canonical `module.resource.action` key. */
function buildPermissions() {
  const keys = new Set()
  for (const [mod, resource, actions] of CATALOG) {
    for (const action of actions) {
      keys.add(`${mod}.${resource}.${action}`)
    }
  }
  return Object.freeze(new Set(keys))
}

/** All valid, canonical permission keys. Deny anything not derivable from these. */
export const PERMISSIONS = buildPermissions()

/** Sorted array form (stable order) for UIs that render the full catalog. */
export const PERMISSION_LIST = Object.freeze([...PERMISSIONS].sort())

/** Grouped `{ module: { resource: [action, …] } }` view for matrix UIs. */
export const PERMISSION_TREE = Object.freeze(
  CATALOG.reduce((tree, [mod, resource, actions]) => {
    ;(tree[mod] ||= {})[resource] = Object.freeze([...actions])
    return tree
  }, {}),
)

/**
 * Is `key` a well-formed `module.resource.action` string whose action is a
 * known action (either a top-level ACTION or a registered extra action like
 * `authorize`/`manage`)? Used to validate keys defensively; unknown-but-well-
 * formed keys still deny by default at the engine.
 */
export function isValidActionKey(key) {
  if (typeof key !== 'string') return false
  const parts = key.split('.')
  if (parts.length !== 3) return false
  const [mod, resource, action] = parts
  if (!mod || !resource || !action) return false
  return ACTION_SET.has(action) || EXTRA_ACTIONS.has(action)
}

// ── Role templates ───────────────────────────────────────────────────────────
// Each template maps to the permission keys it grants by default. Wildcards:
//   '*'                       → everything (super/company admin)
//   'module.*'                → every key under a module
//   'module.resource.*'       → every action on one resource
// Deny-by-default: a role only gets what its template lists.
//
// Existing app roles (Admin/Manager/Director/Reporter/Driver + Tyre Man,
// Inspector) are preserved so migrating pages behave consistently. The extended
// templates come straight from the master spec.
/** @type {Record<string, string[]>} */
export const ROLE_TEMPLATES = Object.freeze({
  // ── Platform / company administration ──
  'Platform Super Admin': ['*'],
  'Company Admin': ['*'],
  Admin: ['*'], // existing app role — full access, mirrors AuthContext Admin bypass

  // ── Management ──
  'Operations Manager': [
    'dashboards.*', 'fleet.*', 'tyres.*', 'inspections.*', 'inventory.*',
    'store.*', 'warranty.*', 'accidents.*', 'jobcards.*', 'maintenance.*',
    'purchasing.*', 'vendors.*', 'reports.*', 'exports.*', 'documents.*',
  ],
  Manager: [
    'dashboards.*', 'fleet.*', 'tyres.*', 'inspections.*', 'inventory.*',
    'store.*', 'warranty.*', 'accidents.*', 'jobcards.*', 'maintenance.*',
    'purchasing.*', 'vendors.*', 'reports.*', 'exports.*', 'documents.*',
  ],
  Director: [
    'dashboards.*', 'fleet.*', 'tyres.*', 'inspections.*', 'inventory.*',
    'store.*', 'warranty.*', 'accidents.*', 'jobcards.*', 'maintenance.*',
    'purchasing.*', 'finance.*', 'vendors.*', 'reports.*', 'exports.*',
    'documents.*',
  ],

  // ── Finance ──
  Finance: [
    'dashboards.overview.view', 'dashboards.executive.*',
    'finance.*', 'purchasing.*', 'vendors.performance.*',
    'reports.standard.*', 'reports.executive.*', 'exports.*',
  ],

  // ── Supervisors ──
  'Site Supervisor': [
    'dashboards.overview.view',
    'tyres.records.*', 'tyres.replacement.*',
    'inspections.daily.*', 'inspections.scheduled.*',
    'inventory.stock.view', 'store.issuance.*',
    'jobcards.orders.view', 'jobcards.orders.create', 'jobcards.orders.assign',
    'reports.standard.view', 'reports.standard.export',
  ],
  'Fleet Supervisor': [
    'dashboards.overview.view',
    'fleet.*', 'tyres.records.*', 'tyres.replacement.view',
    'inspections.daily.view', 'inspections.scheduled.*',
    'maintenance.schedule.*', 'reports.standard.*',
  ],

  // ── Workshop / PMV ──
  'Workshop Manager': [
    'dashboards.overview.view',
    'jobcards.*', 'maintenance.*', 'inventory.stock.view',
    'store.issuance.*', 'tyres.replacement.*', 'tyres.retread.*',
    'reports.standard.*', 'documents.library.view',
  ],
  'PMV Manager': [
    'dashboards.overview.view',
    'fleet.*', 'maintenance.*', 'jobcards.*', 'inspections.scheduled.*',
    'reports.standard.*', 'reports.executive.view', 'exports.data.*',
  ],

  // ── Store ──
  'Store Keeper': [
    'dashboards.overview.view',
    'inventory.*', 'store.*', 'documents.library.view',
    'reports.standard.view', 'reports.standard.export',
  ],

  // ── Field / operational roles (existing app roles) ──
  'Tyre Man': [
    'dashboards.overview.view',
    'tyres.records.view', 'tyres.records.create', 'tyres.records.edit',
    'tyres.replacement.view', 'tyres.replacement.create',
    'inspections.daily.view', 'inspections.daily.create', 'inspections.daily.edit',
    'inspections.daily.upload', 'inspections.daily.sign',
    'inventory.stock.view', 'store.issuance.view',
    'jobcards.orders.view',
  ],
  Inspector: [
    'dashboards.overview.view',
    'tyres.records.view',
    'inspections.daily.view', 'inspections.daily.create', 'inspections.daily.edit',
    'inspections.daily.upload', 'inspections.daily.sign',
    'inspections.scheduled.view', 'inspections.scheduled.create',
    'inspections.audit.view', 'inspections.audit.create',
    'fleet.vehicles.view',
  ],
  Reporter: [
    'dashboards.overview.view', 'dashboards.executive.view',
    'tyres.records.view', 'fleet.vehicles.view',
    'reports.*', 'exports.data.view', 'exports.data.export',
  ],
  Driver: [
    'dashboards.overview.view',
    'inspections.daily.view', 'inspections.daily.create',
    'fleet.vehicles.view',
  ],
})

/** The list of known role-template names. */
export const ROLE_TEMPLATE_NAMES = Object.freeze(Object.keys(ROLE_TEMPLATES))

export default {
  ACTIONS,
  MODULES,
  PERMISSIONS,
  PERMISSION_LIST,
  PERMISSION_TREE,
  ROLE_TEMPLATES,
  ROLE_TEMPLATE_NAMES,
  isValidActionKey,
}
