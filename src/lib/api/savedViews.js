/**
 * savedViews — unified persistence for the Report Builder and Dashboard Builder.
 *
 * WHY THIS EXISTS
 * ───────────────
 * Two builder UIs historically persisted to a single org-level `app_settings`
 * row per key (`saved_reports`, `dashboard_layouts`). Because every user in the
 * org shares that one row, concurrent saves clobber each other (last-write-wins)
 * and every user sees every other user's private reports/layouts.
 *
 * PR #26 migration V102 (MIGRATIONS_V102_AUDIT_TRIGGERS_BUILDERS.sql) introduces
 * proper per-user tables — `report_definitions` and `user_dashboards` — with
 * RLS (own rows + shared read). That migration is NOT YET APPLIED to the live
 * database.
 *
 * This module reconciles both worlds:
 *   • READS   try the V102 table first. If the table does not exist yet, it
 *             transparently falls back to the legacy app_settings key. The
 *             missing-table path NEVER throws.
 *   • WRITES  go to the table when it exists (per-user rows — fixes the
 *             last-write-wins bug). When the table is absent, writes fall back
 *             to the legacy app_settings blob, exactly as before.
 *   • MIGRATE the first successful table read per session opportunistically
 *             copies any of THIS user's legacy app_settings entries that are not
 *             already in the table into the table (best-effort; errors swallowed;
 *             runs at most once per key per session).
 *
 * MODULE MISMATCH (reports only)
 * ──────────────────────────────
 * `report_definitions.module` has a CHECK constraint allowing only 7 modules:
 *   tyres, inspections, work_orders, accidents, stock, fleet, purchase_orders
 * The Report Builder dataset registry additionally supports gate_passes,
 * suppliers and warranty. Persisting such a report to the table would raise a
 * CHECK violation, so those reports are ALWAYS kept in the legacy app_settings
 * blob (never sent to the table). They remain fully usable — only their storage
 * backend differs. `reportSaveTarget(dataset)` exposes this decision so the UI
 * can surface it if desired. This keeps a save from ever throwing a 23514.
 *
 * IDENTITY & SHAPE
 * ────────────────
 * The builder UIs work with denormalised array records (reportBuilder's
 * `{ id, name, description, config, created_by, ... }` and dashboardBuilder's
 * `DashboardLayout`). This module maps those records to/from table columns and
 * back, so the UIs keep their existing array-based state and helpers unchanged.
 * Table writes are diffed against current table rows and applied as per-row
 * upsert/delete, so a single user's edit never rewrites another user's rows.
 *
 * @module api/savedViews
 */
import { supabase } from '../supabase'
import {
  SAVED_REPORTS_KEY, MAX_SAVED_REPORTS, DATASETS,
  fetchSavedReports as fetchLegacyReports,
  persistSavedReports as persistLegacyReports,
} from '../reportBuilder'
import {
  DASHBOARD_LAYOUTS_KEY, MAX_LAYOUTS, validateLayout,
  fetchLayouts as fetchLegacyLayouts,
  saveLayouts as saveLegacyLayouts,
} from '../dashboardBuilder'

const REPORTS_TABLE = 'report_definitions'
const DASHBOARDS_TABLE = 'user_dashboards'

/** Modules permitted by report_definitions.module CHECK (V102). */
export const REPORT_TABLE_MODULES = Object.freeze([
  'tyres', 'inspections', 'work_orders', 'accidents', 'stock', 'fleet', 'purchase_orders',
])

/**
 * Map a Report Builder dataset key onto the report_definitions.module CHECK
 * value. Datasets whose key is not one of the 7 allowed modules return null,
 * signalling "keep in app_settings".
 */
const DATASET_TO_MODULE = Object.freeze({
  tyres: 'tyres',
  inspections: 'inspections',
  work_orders: 'work_orders',
  accidents: 'accidents',
  fleet: 'fleet',
  // gate_passes, suppliers, warranty → no allowed module → app_settings only
})

/**
 * Storage backend for a report of the given dataset.
 * @param {string} datasetKey
 * @returns {{ table: boolean, module: string|null, reason: string|null }}
 */
export function reportSaveTarget(datasetKey) {
  const module = DATASET_TO_MODULE[datasetKey] || null
  if (module) return { table: true, module, reason: null }
  const known = !!DATASETS[datasetKey]
  return {
    table: false,
    module: null,
    reason: known
      ? `The "${DATASETS[datasetKey].label}" dataset is not one of the ${REPORT_TABLE_MODULES.length} report modules stored server-side; this report is saved to shared settings instead.`
      : `Unknown dataset "${String(datasetKey)}".`,
  }
}

// ── Missing-table / not-found detection ───────────────────────────────────────
/**
 * True when a Supabase/PostgREST error means the target relation does not exist
 * yet (i.e. V102 has not been applied). Covers:
 *   • Postgres  42P01  — "undefined_table" / relation ... does not exist
 *   • PostgREST PGRST205 — table not found in the schema cache
 *   • message text fallback for clients that surface neither code
 * Anything else is a real error and must propagate.
 * @param {{code?:string, message?:string}|null|undefined} error
 */
export function isMissingTableError(error) {
  if (!error) return false
  const code = String(error.code || '')
  if (code === '42P01' || code === 'PGRST205') return true
  const msg = String(error.message || '').toLowerCase()
  return (
    /relation .* does not exist/.test(msg) ||
    (msg.includes('does not exist') && msg.includes('relation')) ||
    // PostgREST schema-cache phrasing
    (msg.includes('could not find the table') && msg.includes('schema cache'))
  )
}

// One-time-per-session migration guard.
const migratedKeys = new Set()
/** Test-only hook: reset the per-session migration guard. */
export function __resetSavedViewsSession() { migratedKeys.clear() }

/** Resolve the current auth user id (null when signed out / unavailable). */
async function currentUserId(client) {
  try {
    const { data } = await client.auth.getUser()
    return data?.user?.id || null
  } catch {
    return null
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// REPORTS
// ─────────────────────────────────────────────────────────────────────────────
/** report_definitions row → UI saved-report record (reportBuilder shape). */
function rowToReport(row) {
  return {
    id: row.id,
    name: row.name || '',
    description: row.description || '',
    config: {
      dataset: row.module, // module value doubles as the dataset key for table-backed reports
      columns: Array.isArray(row.columns) ? row.columns : [],
      filters: Array.isArray(row.filters) ? row.filters : [],
      sort: row.sort || null,
      limit: undefined,
      group: null,
      chart: row.chart || null,
    },
    created_by: row.user_id || null,
    shared: !!row.shared,
    created_at: row.created_at || null,
    updated_at: row.updated_at || null,
  }
}

/** UI saved-report record → report_definitions insert/update payload (or null if not table-eligible). */
function reportToRow(rec, userId) {
  const dataset = rec?.config?.dataset
  const target = reportSaveTarget(dataset)
  if (!target.table) return null
  const columns = Array.isArray(rec?.config?.columns) ? rec.config.columns.slice(0, 30) : []
  if (columns.length < 1) return null // CHECK: 1..30 columns
  return {
    id: rec.id,
    user_id: userId,
    name: String(rec.name || '').slice(0, 120),
    description: rec.description ? String(rec.description).slice(0, 500) : null,
    module: target.module,
    columns,
    filters: Array.isArray(rec?.config?.filters) ? rec.config.filters : [],
    sort: rec?.config?.sort ?? null,
    chart: rec?.config?.chart ?? null,
    shared: !!rec.shared,
    updated_at: new Date().toISOString(),
  }
}

/**
 * List the current user's saved reports.
 * Prefers report_definitions; falls back to the app_settings blob when the
 * table is absent. Table-backed and app_settings-only (module-mismatch) reports
 * are merged so the library shows a complete list.
 * @returns {Promise<Object[]>}
 */
export async function listReports() {
  const res = await supabase
    .from(REPORTS_TABLE)
    .select('id,user_id,name,description,module,columns,filters,sort,chart,shared,created_at,updated_at')
    .order('updated_at', { ascending: false })

  if (res.error) {
    if (isMissingTableError(res.error)) return fetchLegacyReports(supabase)
    throw new Error(res.error.message || 'Could not load saved reports.')
  }

  const tableReports = (res.data || []).map(rowToReport)

  // Legacy blob still holds this user's module-mismatch reports (and anything
  // not yet migrated). Merge, de-duping by id, table taking precedence.
  let legacy = []
  try { legacy = await fetchLegacyReports(supabase) } catch { legacy = [] }
  const tableIds = new Set(tableReports.map(r => r.id))
  const mine = legacy.filter(r => !tableIds.has(r.id))

  await migrateReportsOnce(legacy, tableIds)

  return [...tableReports, ...mine]
}

/** One-time opportunistic copy of legacy table-eligible reports into the table. */
async function migrateReportsOnce(legacy, tableIds) {
  if (migratedKeys.has(SAVED_REPORTS_KEY)) return
  migratedKeys.add(SAVED_REPORTS_KEY)
  try {
    const userId = await currentUserId(supabase)
    if (!userId) return
    const rows = (Array.isArray(legacy) ? legacy : [])
      .filter(r => !tableIds.has(r.id))
      .map(r => reportToRow(r, userId))
      .filter(Boolean)
    if (!rows.length) return
    await supabase.from(REPORTS_TABLE).upsert(rows, { onConflict: 'id' })
  } catch { /* best-effort; never blocks a read */ }
}

/**
 * Save (create/update) a single report.
 * Table path: upsert the row (module-eligible) or fall back to app_settings for
 * module-mismatch datasets. Legacy path: rewrite the app_settings blob.
 * @param {Object} rec  reportBuilder saved-report record (already validated + built)
 * @param {Object[]} currentList  the UI's current in-memory list (for legacy rewrite)
 * @returns {Promise<Object>} the saved record
 */
export async function saveReport(rec, currentList = []) {
  const userId = await currentUserId(supabase)
  const row = reportToRow(rec, userId)

  if (row) {
    const res = await supabase.from(REPORTS_TABLE).upsert(row, { onConflict: 'id' })
    if (!res.error) return rec
    if (!isMissingTableError(res.error)) throw new Error(res.error.message || 'Could not save report.')
    // fall through to legacy on missing table
  }
  // Module-mismatch report OR table missing → persist via legacy blob.
  const next = [rec, ...currentList.filter(r => r.id !== rec.id)].slice(0, MAX_SAVED_REPORTS)
  await persistLegacyReports(supabase, next)
  return rec
}

/**
 * Delete a report by id from whichever backend holds it.
 * @param {string} id
 * @param {Object[]} currentList  UI list (for legacy rewrite)
 */
export async function deleteReport(id, currentList = []) {
  const res = await supabase.from(REPORTS_TABLE).delete().eq('id', id)
  if (res.error && !isMissingTableError(res.error)) {
    throw new Error(res.error.message || 'Could not delete report.')
  }
  // Always reconcile the legacy blob too (the row may live there for
  // module-mismatch datasets, or the table may be absent).
  try {
    await persistLegacyReports(supabase, currentList.filter(r => r.id !== id))
  } catch { /* legacy blob may be empty/absent; table delete already covered it */ }
}

/**
 * Rename a report by id.
 * @param {string} id
 * @param {string} name
 * @param {Object[]} currentList  UI list (for legacy rewrite)
 */
export async function renameReport(id, name, currentList = []) {
  const clean = String(name || '').trim().slice(0, 120)
  if (!clean) return currentList
  const now = new Date().toISOString()
  const res = await supabase
    .from(REPORTS_TABLE)
    .update({ name: clean, updated_at: now })
    .eq('id', id)
  if (res.error && !isMissingTableError(res.error)) {
    throw new Error(res.error.message || 'Could not rename report.')
  }
  const next = currentList.map(r => (r.id === id ? { ...r, name: clean, updated_at: now } : r))
  // Reconcile legacy blob for module-mismatch / table-absent rows.
  try { await persistLegacyReports(supabase, next) } catch { /* best-effort */ }
  return next
}

// ─────────────────────────────────────────────────────────────────────────────
// DASHBOARDS
// ─────────────────────────────────────────────────────────────────────────────
/** user_dashboards row → DashboardLayout (dashboardBuilder shape). */
function rowToLayout(row) {
  const widgets = Array.isArray(row?.layout?.widgets) ? row.layout.widgets : []
  return validateLayout({
    id: row.id,
    name: row.name,
    widgets,
    filters: row?.layout?.filters, // validateLayout normalises (missing = default)
    created_by: row.user_id || null,
    shared: !!row.shared,
    is_default: !!row.is_default,
    created_at: row.created_at,
    updated_at: row.updated_at,
  })
}

/** DashboardLayout → user_dashboards insert/update payload. */
function layoutToRow(layout, userId) {
  const v = validateLayout(layout)
  return {
    id: v.id,
    user_id: userId,
    // CHECK: <= 40 widgets. `filters` is additive; older readers ignore it.
    layout: { widgets: v.widgets.slice(0, 40), filters: v.filters },
    name: v.name,
    is_default: !!v.is_default,
    shared: !!v.shared,
    updated_at: new Date().toISOString(),
  }
}

/**
 * List dashboards visible to the current user (own rows via RLS + shared).
 * Prefers user_dashboards; falls back to the app_settings blob when absent.
 * @returns {Promise<import('../dashboardBuilder').DashboardLayout[]>}
 */
export async function listDashboards() {
  const res = await supabase
    .from(DASHBOARDS_TABLE)
    .select('id,user_id,name,layout,is_default,shared,created_at,updated_at')
    .order('updated_at', { ascending: false })

  if (res.error) {
    if (isMissingTableError(res.error)) return fetchLegacyLayouts(supabase)
    throw new Error(res.error.message || 'Could not load dashboard layouts.')
  }

  const layouts = (res.data || []).map(rowToLayout)
  await migrateDashboardsOnce(layouts.map(l => l.id))
  return layouts
}

/** One-time opportunistic copy of this user's legacy layouts into the table. */
async function migrateDashboardsOnce(tableIdList) {
  if (migratedKeys.has(DASHBOARD_LAYOUTS_KEY)) return
  migratedKeys.add(DASHBOARD_LAYOUTS_KEY)
  try {
    const userId = await currentUserId(supabase)
    if (!userId) return
    const tableIds = new Set(tableIdList)
    let legacy = []
    try { legacy = await fetchLegacyLayouts(supabase) } catch { legacy = [] }
    const rows = (Array.isArray(legacy) ? legacy : [])
      .filter(l => l && l.created_by === userId && !tableIds.has(l.id))
      .map(l => layoutToRow(l, userId))
    if (!rows.length) return
    await supabase.from(DASHBOARDS_TABLE).upsert(rows, { onConflict: 'id' })
  } catch { /* best-effort */ }
}

/**
 * Save (create/update) a single dashboard layout.
 * @param {import('../dashboardBuilder').DashboardLayout} layout
 * @param {import('../dashboardBuilder').DashboardLayout[]} currentList  UI list (legacy rewrite)
 * @returns {Promise<import('../dashboardBuilder').DashboardLayout>}
 */
export async function saveDashboard(layout, currentList = []) {
  const userId = await currentUserId(supabase)
  const row = layoutToRow(layout, userId)
  const res = await supabase.from(DASHBOARDS_TABLE).upsert(row, { onConflict: 'id' })
  if (!res.error) return rowToLayout({ ...row, created_at: layout.created_at })
  if (!isMissingTableError(res.error)) throw new Error(res.error.message || 'Could not save dashboard.')
  // Table missing → legacy blob (validated + capped by saveLegacyLayouts).
  const v = validateLayout(layout)
  const next = [v, ...currentList.filter(l => l.id !== v.id)].slice(0, MAX_LAYOUTS)
  await saveLegacyLayouts(supabase, next)
  return v
}

/**
 * Delete a dashboard layout by id.
 * @param {string} id
 * @param {import('../dashboardBuilder').DashboardLayout[]} currentList
 */
export async function deleteDashboard(id, currentList = []) {
  const res = await supabase.from(DASHBOARDS_TABLE).delete().eq('id', id)
  if (res.error) {
    if (!isMissingTableError(res.error)) throw new Error(res.error.message || 'Could not delete dashboard.')
    await saveLegacyLayouts(supabase, currentList.filter(l => l.id !== id))
  }
}

/**
 * Set a layout as the user's default, clearing the flag on their other layouts.
 * @param {string} id
 * @param {import('../dashboardBuilder').DashboardLayout[]} currentList
 * @param {string|null} userId
 * @returns {Promise<import('../dashboardBuilder').DashboardLayout[]>} next list
 */
export async function setDefaultDashboard(id, currentList = [], userId = null) {
  const uid = userId || (await currentUserId(supabase))
  const next = (Array.isArray(currentList) ? currentList : []).map(l => {
    if (!l) return l
    if (l.id === id) return { ...l, is_default: true }
    if (uid && l.created_by === uid && l.is_default) return { ...l, is_default: false }
    return l
  })

  // Table path: flip the two affected rows only (own rows).
  const res = await supabase
    .from(DASHBOARDS_TABLE)
    .update({ is_default: false, updated_at: new Date().toISOString() })
    .eq('user_id', uid)
    .eq('is_default', true)
  if (res.error) {
    if (!isMissingTableError(res.error)) throw new Error(res.error.message || 'Could not set default dashboard.')
    await saveLegacyLayouts(supabase, next)
    return next
  }
  const setRes = await supabase
    .from(DASHBOARDS_TABLE)
    .update({ is_default: true, updated_at: new Date().toISOString() })
    .eq('id', id)
  if (setRes.error && !isMissingTableError(setRes.error)) {
    throw new Error(setRes.error.message || 'Could not set default dashboard.')
  }
  return next
}

/**
 * Toggle the shared flag on a layout (admins only, enforced by RLS + UI).
 * @param {string} id
 * @param {boolean} shared
 * @param {import('../dashboardBuilder').DashboardLayout[]} currentList
 * @returns {Promise<import('../dashboardBuilder').DashboardLayout[]>} next list
 */
export async function shareDashboard(id, shared, currentList = []) {
  const now = new Date().toISOString()
  const next = (Array.isArray(currentList) ? currentList : []).map(
    l => (l && l.id === id ? { ...l, shared: !!shared, updated_at: now } : l),
  )
  const res = await supabase
    .from(DASHBOARDS_TABLE)
    .update({ shared: !!shared, updated_at: now })
    .eq('id', id)
  if (res.error) {
    if (!isMissingTableError(res.error)) throw new Error(res.error.message || 'Could not update dashboard sharing.')
    await saveLegacyLayouts(supabase, next)
  }
  return next
}
