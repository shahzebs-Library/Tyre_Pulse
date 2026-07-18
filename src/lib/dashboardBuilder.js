/**
 * dashboardBuilder — pure logic behind the Dynamic Dashboard Builder
 * (src/pages/DashboardBuilder.jsx, route /dashboard-builder).
 *
 * Responsibilities:
 *   - WIDGET_CATALOG: every composable widget with its label, category,
 *     default size and a data descriptor. Each widget is backed by a REAL
 *     query already used elsewhere in the app (DisplayDashboard.jsx /
 *     Dashboard.jsx column lists) — the live DB drifts from migration files,
 *     so only tables/columns visible in existing page code are referenced:
 *       vehicle_fleet:  asset_no, site, status
 *       tyre_records:   asset_no, risk_level, cost_per_tyre, qty, issue_date, removal_date
 *       inspections:    scheduled_date, status
 *       alerts:         severity, message, asset_no, created_at, is_active
 *       import_batches: id, approval_status
 *       work_orders:    id, status
 *   - Layout model + immutable helpers (add/remove/move/resize/validate).
 *   - Org-scoped persistence in app_settings under `dashboard_layouts`
 *     (same pattern as lib/api/erp.js / lib/reportBuilder.js). Layouts carry
 *     created_by and are per-user filtered client-side; admins may publish a
 *     layout to everyone via the `shared` flag.
 *   - Pure shaping helpers for the two widgets not already covered by
 *     lib/displayBoard.js (6-month cost trend, work orders by status).
 *
 * Every helper is side-effect free and unit-tested in
 * src/test/dashboardBuilder.test.js.
 *
 * @module dashboardBuilder
 */
import { resolvePeriod } from './api/scheduledReports'

// ── Limits & size domains ─────────────────────────────────────────────────────
export const MIN_W = 1
export const MAX_W = 4
export const HEIGHTS = Object.freeze(['sm', 'md', 'lg'])
export const MAX_WIDGETS_PER_LAYOUT = 24
export const MAX_LAYOUTS = 50
export const MAX_LAYOUT_NAME = 80

/** Size presets exposed as S / M / L buttons in edit mode. */
export const SIZE_PRESETS = Object.freeze({
  S: { w: 1, h: 'sm' },
  M: { w: 2, h: 'md' },
  L: { w: 4, h: 'lg' },
})

// ── Widget catalog ────────────────────────────────────────────────────────────
/**
 * @typedef {'stat'|'gauge'|'donut'|'bar'|'line'|'list'} WidgetKind
 * @typedef {Object} WidgetDef
 * @property {string} id
 * @property {string} label
 * @property {string} description
 * @property {'Fleet'|'Tyres'|'Cost'|'Operations'|'Alerts'} category
 * @property {WidgetKind} kind
 * @property {number} defaultW   grid columns (1-4)
 * @property {'sm'|'md'|'lg'} defaultH
 * @property {{ source:string, shape:string }} data  data descriptor: which
 *           query feeds it and how the rows are shaped for rendering.
 */

/** @type {ReadonlyArray<WidgetDef>} */
export const WIDGET_CATALOG = Object.freeze([
  {
    id: 'fleet-availability',
    label: 'Fleet Availability',
    description: 'Semi-circular gauge of vehicles in service vs registered fleet.',
    category: 'Fleet', kind: 'gauge', defaultW: 1, defaultH: 'md',
    data: { source: 'fleet', shape: 'availability' },
  },
  {
    id: 'total-vehicles',
    label: 'Total Vehicles',
    description: 'Registered fleet assets across all sites.',
    category: 'Fleet', kind: 'stat', defaultW: 1, defaultH: 'sm',
    data: { source: 'fleet', shape: 'count' },
  },
  {
    id: 'tyres-in-service',
    label: 'Tyres in Service',
    description: 'Tyres currently fitted (no removal date).',
    category: 'Tyres', kind: 'stat', defaultW: 1, defaultH: 'sm',
    data: { source: 'tyresActive', shape: 'count' },
  },
  {
    id: 'critical-tyres',
    label: 'Critical Tyres',
    description: 'Fitted tyres flagged Critical, with High-risk count alongside.',
    category: 'Tyres', kind: 'stat', defaultW: 1, defaultH: 'sm',
    data: { source: 'tyresActive', shape: 'attention' },
  },
  {
    id: 'monthly-tyre-cost',
    label: 'Tyre Cost This Month',
    description: 'Spend on tyres issued in the current calendar month.',
    category: 'Cost', kind: 'stat', defaultW: 1, defaultH: 'sm',
    data: { source: 'monthTyres', shape: 'monthlyCost' },
  },
  {
    id: 'alerts-by-severity',
    label: 'Alerts by Severity',
    description: 'Active alerts bucketed Critical / High / Medium / Low / Info.',
    category: 'Alerts', kind: 'donut', defaultW: 2, defaultH: 'md',
    data: { source: 'alerts', shape: 'bySeverity' },
  },
  {
    id: 'inspections-today',
    label: 'Inspections Today',
    description: "Today's inspection programme: done, pending and overdue.",
    category: 'Operations', kind: 'stat', defaultW: 1, defaultH: 'sm',
    data: { source: 'inspections', shape: 'today' },
  },
  {
    id: 'pending-approvals',
    label: 'Pending Approvals',
    description: 'Data-import batches awaiting review.',
    category: 'Operations', kind: 'stat', defaultW: 1, defaultH: 'sm',
    data: { source: 'pendingImports', shape: 'count' },
  },
  {
    id: 'vehicles-by-site',
    label: 'Vehicles by Site',
    description: 'Fleet distribution across the top sites.',
    category: 'Fleet', kind: 'bar', defaultW: 2, defaultH: 'md',
    data: { source: 'fleet', shape: 'bySite' },
  },
  {
    id: 'recent-alerts',
    label: 'Recent Alerts',
    description: 'Latest active alerts with severity and asset.',
    category: 'Alerts', kind: 'list', defaultW: 2, defaultH: 'lg',
    data: { source: 'alerts', shape: 'recent' },
  },
  {
    id: 'tyre-cost-trend',
    label: 'Tyre Cost Trend',
    description: 'Monthly tyre spend over the last 6 months.',
    category: 'Cost', kind: 'line', defaultW: 2, defaultH: 'md',
    data: { source: 'costTrend', shape: 'costTrend' },
  },
  {
    id: 'work-orders-by-status',
    label: 'Work Orders by Status',
    description: 'Open / in-progress / completed work order mix.',
    category: 'Operations', kind: 'donut', defaultW: 2, defaultH: 'md',
    data: { source: 'workOrders', shape: 'byStatus' },
  },
])

/** Fast lookup: widgetId → catalog entry. */
export const WIDGET_BY_ID = Object.freeze(
  Object.fromEntries(WIDGET_CATALOG.map(w => [w.id, w])),
)

/** Distinct catalog categories in display order. */
export const WIDGET_CATEGORIES = Object.freeze(
  [...new Set(WIDGET_CATALOG.map(w => w.category))],
)

// ── Global dashboard filters (drive every widget's fetch) ─────────────────────
/**
 * Date-range presets for the dashboard filter bar. Values mirror the scheduled
 * reports vocabulary so the same `resolvePeriod()` engine resolves them — one
 * source of truth for "Last N days / MTD / YTD / Custom". `all` = no date bound
 * (the historical default, so a filter-free board behaves exactly as before).
 * @type {ReadonlyArray<{value:string,label:string}>}
 */
export const DASHBOARD_RANGE_PRESETS = Object.freeze([
  { value: 'all',     label: 'All time' },
  { value: 'last_7',  label: 'Last 7 days' },
  { value: 'last_30', label: 'Last 30 days' },
  { value: 'last_90', label: 'Last 90 days' },
  { value: 'mtd',     label: 'Month to date' },
  { value: 'ytd',     label: 'Year to date' },
  { value: 'custom',  label: 'Custom range' },
])

const RANGE_VALUES = new Set(DASHBOARD_RANGE_PRESETS.map(p => p.value))

/**
 * Neutral default: no date bound, all sites, all countries. Persisted layouts
 * that predate the filter feature have no `filters` key, so this default is what
 * `normalizeFilters(undefined)` yields — i.e. the exact pre-filter behaviour.
 * @typedef {{range:string, from:string|null, to:string|null, site:string, country:string}} DashboardFilters
 * @type {Readonly<DashboardFilters>}
 */
export const DEFAULT_DASHBOARD_FILTERS = Object.freeze({
  range: 'all', from: null, to: null, site: 'All', country: 'All',
})

const cleanDate = v => {
  if (typeof v !== 'string') return null
  const s = v.trim()
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null
}

/** Trim a site/country scope; empty or "all" (any case) collapses to 'All'. */
const cleanScope = v => {
  const s = (v == null ? '' : String(v)).trim()
  return s && s.toLowerCase() !== 'all' ? s : 'All'
}

/**
 * Sanitise a raw filter object into a stable, storable DashboardFilters record.
 * Never throws; unknown ranges fall back to 'all'; custom dates are only kept
 * for the custom range and must be YYYY-MM-DD.
 * @param {*} raw
 * @returns {DashboardFilters}
 */
export function normalizeFilters(raw) {
  const f = raw && typeof raw === 'object' ? raw : {}
  const range = RANGE_VALUES.has(f.range) ? f.range : 'all'
  return {
    range,
    from: range === 'custom' ? cleanDate(f.from) : null,
    to:   range === 'custom' ? cleanDate(f.to)   : null,
    site: cleanScope(f.site),
    country: cleanScope(f.country),
  }
}

/**
 * Resolve UI filters into concrete query parameters consumed by the widget data
 * loaders. Pure and tested. Date maths are delegated to the shared
 * `resolvePeriod()` helper (scheduled reports), so ranges stay consistent across
 * the app. Returns null for site/country/date bounds that mean "no constraint",
 * so a fetcher can apply them unconditionally without special-casing 'All'.
 * @param {*} filters
 * @returns {{range:string, from:string|null, to:string|null, label:string, site:string|null, country:string|null}}
 */
export function resolveDashboardFilters(filters) {
  const f = normalizeFilters(filters)
  let from = null
  let to = null
  let label = 'All time'
  if (f.range !== 'all') {
    const r = resolvePeriod(f.range, f.from, f.to)
    from = r.from || null
    to = r.to || null
    label = r.label
  }
  return {
    range: f.range,
    from,
    to,
    label,
    site: f.site !== 'All' ? f.site : null,
    country: f.country !== 'All' ? f.country : null,
  }
}

// ── Layout model ──────────────────────────────────────────────────────────────
/**
 * @typedef {{ widgetId:string, w:number, h:'sm'|'md'|'lg' }} PlacedWidget
 * @typedef {Object} DashboardLayout
 * @property {string} id
 * @property {string} name
 * @property {PlacedWidget[]} widgets   order = render order
 * @property {DashboardFilters} filters default global filters for the board
 * @property {string|null} created_by  profiles.id of the owner
 * @property {boolean} shared          admins may publish to everyone
 * @property {boolean} is_default      owner's preferred layout
 * @property {string} created_at
 * @property {string} updated_at
 */

const newId = () =>
  (globalThis.crypto?.randomUUID?.() ||
    `lay_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`)

const clampW = w => {
  const n = Math.round(Number(w))
  if (!Number.isFinite(n)) return MIN_W
  return Math.min(MAX_W, Math.max(MIN_W, n))
}
const clampH = h => (HEIGHTS.includes(h) ? h : 'md')

/** Build a placed-widget entry from a catalog id (defaults from the catalog). */
export function placeWidget(widgetId, overrides = {}) {
  const def = WIDGET_BY_ID[widgetId]
  if (!def) return null
  return {
    widgetId,
    w: clampW(overrides.w ?? def.defaultW),
    h: clampH(overrides.h ?? def.defaultH),
  }
}

/**
 * Create a new layout record with identity + audit metadata.
 * @param {{ name:string, widgets?:PlacedWidget[], createdBy?:string|null, shared?:boolean }} input
 * @returns {DashboardLayout}
 */
export function makeLayout({ name, widgets = [], createdBy = null, shared = false, filters } = {}) {
  const now = new Date().toISOString()
  return validateLayout({
    id: newId(),
    name: String(name || 'My Dashboard').trim().slice(0, MAX_LAYOUT_NAME) || 'My Dashboard',
    widgets,
    filters,
    created_by: createdBy,
    shared: !!shared,
    is_default: false,
    created_at: now,
    updated_at: now,
  })
}

/**
 * Sanitise a layout: unknown widget ids dropped, sizes clamped, name/flags
 * normalised. Never throws — always returns a renderable layout.
 * @param {*} layout
 * @returns {DashboardLayout}
 */
export function validateLayout(layout) {
  const src = layout && typeof layout === 'object' ? layout : {}
  const widgets = (Array.isArray(src.widgets) ? src.widgets : [])
    .filter(w => w && typeof w === 'object' && WIDGET_BY_ID[w.widgetId])
    .slice(0, MAX_WIDGETS_PER_LAYOUT)
    .map(w => ({ widgetId: w.widgetId, w: clampW(w.w), h: clampH(w.h) }))
  return {
    id: typeof src.id === 'string' && src.id ? src.id : newId(),
    name: (typeof src.name === 'string' ? src.name.trim().slice(0, MAX_LAYOUT_NAME) : '') || 'Untitled',
    widgets,
    filters: normalizeFilters(src.filters),
    created_by: typeof src.created_by === 'string' ? src.created_by : null,
    shared: !!src.shared,
    is_default: !!src.is_default,
    created_at: typeof src.created_at === 'string' ? src.created_at : new Date().toISOString(),
    updated_at: typeof src.updated_at === 'string' ? src.updated_at : new Date().toISOString(),
  }
}

const touch = layout => ({ ...layout, updated_at: new Date().toISOString() })

/**
 * Append a widget from the catalog. Unknown ids and full layouts are no-ops.
 * @returns {DashboardLayout} a NEW layout object (input untouched)
 */
export function addWidget(layout, widgetId, overrides = {}) {
  const placed = placeWidget(widgetId, overrides)
  if (!placed || layout.widgets.length >= MAX_WIDGETS_PER_LAYOUT) return layout
  return touch({ ...layout, widgets: [...layout.widgets, placed] })
}

/** Remove the widget at `index`. Out-of-range indices are no-ops. */
export function removeWidget(layout, index) {
  if (!Number.isInteger(index) || index < 0 || index >= layout.widgets.length) return layout
  return touch({ ...layout, widgets: layout.widgets.filter((_, i) => i !== index) })
}

/**
 * Move a widget from one position to another (drag-to-reorder + arrow
 * buttons both land here). Out-of-range indices are no-ops.
 */
export function moveWidget(layout, from, to) {
  const n = layout.widgets.length
  if (!Number.isInteger(from) || !Number.isInteger(to)) return layout
  if (from < 0 || from >= n || to < 0 || to >= n || from === to) return layout
  const widgets = [...layout.widgets]
  const [item] = widgets.splice(from, 1)
  widgets.splice(to, 0, item)
  return touch({ ...layout, widgets })
}

/**
 * Resize the widget at `index`. Accepts partial size: { w } and/or { h }.
 * Width clamps to 1-4; height clamps to sm/md/lg.
 */
export function resizeWidget(layout, index, { w, h } = {}) {
  if (!Number.isInteger(index) || index < 0 || index >= layout.widgets.length) return layout
  const widgets = layout.widgets.map((widget, i) => {
    if (i !== index) return widget
    return {
      ...widget,
      w: w !== undefined ? clampW(w) : widget.w,
      h: h !== undefined ? clampH(h) : widget.h,
    }
  })
  return touch({ ...layout, widgets })
}

/** Starter layout for users with no saved layouts yet. */
export const DEFAULT_LAYOUT = Object.freeze(validateLayout({
  id: 'default',
  name: 'Fleet Overview',
  widgets: [
    { widgetId: 'fleet-availability',     w: 1, h: 'md' },
    { widgetId: 'total-vehicles',         w: 1, h: 'sm' },
    { widgetId: 'tyres-in-service',       w: 1, h: 'sm' },
    { widgetId: 'critical-tyres',         w: 1, h: 'sm' },
    { widgetId: 'alerts-by-severity',     w: 2, h: 'md' },
    { widgetId: 'vehicles-by-site',       w: 2, h: 'md' },
    { widgetId: 'tyre-cost-trend',        w: 2, h: 'md' },
    { widgetId: 'work-orders-by-status',  w: 2, h: 'md' },
    { widgetId: 'recent-alerts',          w: 2, h: 'lg' },
    { widgetId: 'inspections-today',      w: 1, h: 'sm' },
    { widgetId: 'pending-approvals',      w: 1, h: 'sm' },
  ],
  created_by: null,
  shared: true,
  created_at: '2026-01-01T00:00:00.000Z',
  updated_at: '2026-01-01T00:00:00.000Z',
}))

// ── Visibility & defaults (per-user, client-side) ────────────────────────────
/**
 * Layouts a user may see: their own plus any published (shared) layout.
 * @param {DashboardLayout[]} layouts
 * @param {string|null} userId
 */
export function visibleLayouts(layouts, userId) {
  return (Array.isArray(layouts) ? layouts : []).filter(
    l => l && (l.shared || (userId && l.created_by === userId)),
  )
}

/**
 * Mark `layoutId` as the user's default, clearing is_default on the user's
 * other layouts (shared layouts owned by others are left untouched).
 * @returns {DashboardLayout[]} a NEW array
 */
export function setDefaultLayout(layouts, layoutId, userId) {
  return (Array.isArray(layouts) ? layouts : []).map(l => {
    if (!l) return l
    if (l.id === layoutId) return { ...l, is_default: true }
    if (userId && l.created_by === userId && l.is_default) return { ...l, is_default: false }
    return l
  })
}

/** Pick the layout to open first: user default → first own → first shared. */
export function pickInitialLayout(layouts, userId) {
  const visible = visibleLayouts(layouts, userId)
  return (
    visible.find(l => l.is_default && l.created_by === userId) ||
    visible.find(l => l.created_by === userId) ||
    visible[0] ||
    null
  )
}

// ── Data shaping (pure; complements lib/displayBoard.js) ─────────────────────
const num = v => (Number.isFinite(Number(v)) ? Number(v) : 0)

/**
 * Monthly tyre spend for the last `months` calendar months (oldest first).
 * Cost rule mirrors displayBoard.computeMonthlyTyreCost:
 * cost_per_tyre × qty (qty defaults to 1).
 * @param {Array<{issue_date?:string, cost_per_tyre?:number, qty?:number}>} tyres
 * @returns {Array<{ key:string, label:string, cost:number }>}
 */
export function computeCostTrend(tyres = [], now = new Date(), months = 6) {
  const buckets = []
  const index = new Map()
  for (let i = months - 1; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1)
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
    const bucket = { key, label: d.toLocaleString('default', { month: 'short', year: '2-digit' }), cost: 0 }
    buckets.push(bucket)
    index.set(key, bucket)
  }
  tyres.forEach(t => {
    if (!t?.issue_date) return
    const key = String(t.issue_date).slice(0, 7)
    const bucket = index.get(key)
    if (!bucket) return
    const qty = t.qty == null ? 1 : num(t.qty) || 1
    bucket.cost += num(t.cost_per_tyre) * qty
  })
  buckets.forEach(b => { b.cost = Math.round(b.cost) })
  return buckets
}

/**
 * Work orders grouped by status, descending; null/empty status buckets as
 * 'Unknown'. Capped at `limit` buckets.
 * @returns {Array<{ status:string, count:number }>}
 */
export function groupWorkOrdersByStatus(rows = [], limit = 8) {
  const byStatus = {}
  rows.forEach(r => {
    const status = (r?.status && String(r.status).trim()) || 'Unknown'
    byStatus[status] = (byStatus[status] || 0) + 1
  })
  return Object.entries(byStatus)
    .map(([status, count]) => ({ status, count }))
    .sort((a, b) => b.count - a.count || a.status.localeCompare(b.status))
    .slice(0, limit)
}

// ── Persistence ──────────────────────────────────────────────────────────────
// The canonical persistence entry points live in lib/api/savedViews.js, which
// prefers the V102 `user_dashboards` table (per-user rows) and falls back to the
// legacy app_settings blob below when that table is not yet applied. Pages
// import listDashboards/saveDashboard/deleteDashboard/setDefaultDashboard/
// shareDashboard from there. The functions below remain the LEGACY (app_settings)
// primitives that savedViews consumes as its fallback — do not call from UI.
export const DASHBOARD_LAYOUTS_KEY = 'dashboard_layouts'

/**
 * Defensive parse of the stored app_settings value → validated layout array.
 * Exported for unit tests.
 */
export function parseLayoutsValue(value) {
  try {
    const v = typeof value === 'string' ? JSON.parse(value) : value
    if (!Array.isArray(v)) return []
    return v
      .filter(l => l && typeof l === 'object' && typeof l.name === 'string' && Array.isArray(l.widgets))
      .slice(0, MAX_LAYOUTS)
      .map(validateLayout)
  } catch {
    return []
  }
}

/**
 * Read every saved layout for the org from app_settings (RLS-scoped).
 * Per-user visibility is applied client-side via visibleLayouts().
 * @param {import('@supabase/supabase-js').SupabaseClient} supabase
 * @returns {Promise<DashboardLayout[]>}
 */
export async function fetchLayouts(supabase) {
  const { data, error } = await supabase
    .from('app_settings').select('value').eq('key', DASHBOARD_LAYOUTS_KEY).maybeSingle()
  if (error) throw new Error('Could not load dashboard layouts.')
  return parseLayoutsValue(data?.value)
}

/**
 * Persist the full layouts array (upsert on key, validated + capped).
 * @param {import('@supabase/supabase-js').SupabaseClient} supabase
 * @param {DashboardLayout[]} layouts
 * @returns {Promise<DashboardLayout[]>} the array as persisted
 */
export async function saveLayouts(supabase, layouts) {
  const clean = (Array.isArray(layouts) ? layouts : [])
    .filter(l => l && typeof l === 'object')
    .slice(0, MAX_LAYOUTS)
    .map(validateLayout)
  const { error } = await supabase.from('app_settings').upsert(
    { key: DASHBOARD_LAYOUTS_KEY, value: JSON.stringify(clean) },
    { onConflict: 'key' },
  )
  if (error) throw new Error('Could not save dashboard layouts.')
  return clean
}
