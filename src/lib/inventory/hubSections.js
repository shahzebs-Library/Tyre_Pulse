/**
 * Inventory Control Center - section catalogue (pure, no I/O).
 *
 * ONE hub (`/stock`, src/pages/StockManagement.jsx) with twenty-five sections
 * grouped into five tabs. The section lives in the URL (`?section=`), so a
 * link to "Physical audits" survives a refresh and can be shared.
 *
 * Capability keys follow the build contract (module key `stock`):
 * view, view_value, receive, issue, transfer, count, audit_create, recount,
 * discrepancy_review, adjustment_approve, financial_post, scrap_approve,
 * export, audit_history.
 *
 * The client gate here only decides what to SHOW. The database (RLS + the
 * inv_* SECURITY DEFINER RPCs) is the boundary, so a section that is shown
 * can still refuse an action, and the UI renders that refusal honestly.
 */

export const GROUPS = [
  { key: 'operate', labelKey: 'inventory.groups.operate' },
  { key: 'control', labelKey: 'inventory.groups.control' },
  { key: 'supply', labelKey: 'inventory.groups.supply' },
  { key: 'assets', labelKey: 'inventory.groups.assets' },
  { key: 'insight', labelKey: 'inventory.groups.insight' },
]

/** `cap` = capability needed to SEE the section (besides module view). */
export const SECTIONS = [
  { key: 'overview', group: 'operate', icon: 'LayoutDashboard', cap: 'view' },
  { key: 'register', group: 'operate', icon: 'Boxes', cap: 'view' },
  { key: 'locations', group: 'operate', icon: 'MapPin', cap: 'view' },
  { key: 'materials', group: 'operate', icon: 'Package', cap: 'view' },
  { key: 'physical', group: 'operate', icon: 'ScanLine', cap: 'view' },
  { key: 'movements', group: 'operate', icon: 'ArrowLeftRight', cap: 'view' },
  { key: 'floor', group: 'operate', icon: 'Forklift', cap: 'view' },
  { key: 'audits', group: 'control', icon: 'ClipboardCheck', cap: 'view' },
  { key: 'discrepancies', group: 'control', icon: 'AlertTriangle', cap: 'view' },
  { key: 'corrections', group: 'control', icon: 'FileWarning', cap: 'view' },
  { key: 'controls', group: 'control', icon: 'ShieldCheck', cap: 'view' },
  { key: 'matching', group: 'control', icon: 'Link', cap: 'view' },
  { key: 'procurement', group: 'supply', icon: 'ShoppingCart', cap: 'view' },
  { key: 'purchasing', group: 'supply', icon: 'FileText', cap: 'view' },
  { key: 'receiving', group: 'supply', icon: 'PackageCheck', cap: 'view' },
  { key: 'supplier', group: 'supply', icon: 'Truck', cap: 'view' },
  { key: 'tyres', group: 'assets', icon: 'CircleDot', cap: 'view' },
  { key: 'identification', group: 'assets', icon: 'ScanLine', cap: 'view' },
  { key: 'custody', group: 'assets', icon: 'Wrench', cap: 'view' },
  { key: 'valuation', group: 'insight', icon: 'Coins', cap: 'view_value' },
  { key: 'finance', group: 'insight', icon: 'Scale', cap: 'view_value' },
  { key: 'kpis', group: 'insight', icon: 'Gauge', cap: 'view' },
  { key: 'classification', group: 'insight', icon: 'Layers', cap: 'view' },
  { key: 'planning', group: 'insight', icon: 'LineChart', cap: 'view' },
  { key: 'reports', group: 'insight', icon: 'FileBarChart', cap: 'view' },
]

export const SECTION_KEYS = SECTIONS.map((s) => s.key)
export const DEFAULT_SECTION = 'overview'

/** The URL value -> a known section key (unknown or blank -> overview). */
export function resolveSection(param) {
  const v = String(param || '').trim().toLowerCase()
  return SECTION_KEYS.includes(v) ? v : DEFAULT_SECTION
}

export function sectionGroup(key) {
  return SECTIONS.find((s) => s.key === key)?.group || 'operate'
}

/**
 * Sections the user may see, grouped. `can(cap)` is a boolean predicate.
 * A group with no visible section is dropped, never rendered empty.
 */
export function visibleGroups(can) {
  const allowed = SECTIONS.filter((s) => (s.cap === 'view' ? true : !!can?.(s.cap)))
  return GROUPS
    .map((g) => ({ ...g, sections: allowed.filter((s) => s.group === g.key) }))
    .filter((g) => g.sections.length > 0)
}

/**
 * Inventory capabilities fall back to the nearest standard capability while
 * the stock module has no dedicated rows yet. The server still enforces the
 * real inventory capability, so this only decides button visibility.
 */
export const CAPABILITY_FALLBACK = {
  view: 'view',
  view_value: 'view',
  receive: 'create',
  issue: 'edit',
  transfer: 'edit',
  count: 'edit',
  audit_create: 'create',
  recount: 'edit',
  discrepancy_review: 'edit',
  adjustment_approve: 'approve',
  financial_post: 'approve',
  scrap_approve: 'approve',
  export: 'export',
  audit_history: 'view',
}

export const INVENTORY_CAPABILITIES = Object.keys(CAPABILITY_FALLBACK)

/**
 * Build a `can(cap)` predicate from the AuthContext helpers. A dedicated
 * inventory grant wins; otherwise the standard capability decides.
 */
export function makeCan({ hasCapability, canExport } = {}) {
  return (cap) => {
    if (typeof hasCapability !== 'function') return false
    if (cap === 'export' && typeof canExport === 'function') return !!canExport('stock')
    if (hasCapability('stock', cap)) return true
    const fallback = CAPABILITY_FALLBACK[cap]
    return fallback ? !!hasCapability('stock', fallback) : false
  }
}
