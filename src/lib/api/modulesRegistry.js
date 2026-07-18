/**
 * Modules Registry service - the single Supabase boundary for the super-admin
 * Module Control Center (Admin Control Module 8, V258 `modules`). Mirrors the
 * sibling service modules (systemLogs.js / dataReconciliation.js): explicit
 * least-privilege column list, `unwrap`/`ServiceError` error surfacing, faithful
 * upsert/update pass-throughs, and a missing-relation guard that degrades to an
 * empty result so the page can render an "apply the migration" state instead of
 * erroring.
 *
 * RLS (V258): any authenticated user may READ; only Admin / super-admin may
 * write. This layer never re-implements the gate, it only relocates the call and
 * normalises error surfacing.
 *
 * HONESTY: a module row records lifecycle STATUS (Live / Maintenance / Off /
 * Beta) for administration. App-wide hiding of a module's pages from regular
 * users is a follow-up; this service and its page do NOT hide any route yet.
 */
import { supabase, unwrap } from './_client'
import { MODULE_GROUPS } from '../moduleCatalog'

/** The lifecycle states a module row may carry. */
export const MODULE_STATUSES = ['live', 'maintenance', 'disabled', 'beta']

/** Display metadata per status: user-facing label + colour tone for badges. */
export const MODULE_STATUS_META = {
  live: { label: 'Live', tone: 'green' },
  maintenance: { label: 'Maintenance', tone: 'amber' },
  disabled: { label: 'Off', tone: 'red' },
  beta: { label: 'Beta', tone: 'blue' },
}

/** Explicit least-privilege column list (no SELECT *). */
export const MODULE_COLS =
  'module_id,name,category,status,visible_to,roles,depends_on,note,maintenance_until,maintenance_note,last_updated,updated_by'

/**
 * True when the failure is "table does not exist yet" (pre-migration) so callers
 * can degrade to an empty result rather than surfacing a raw error.
 */
export function isMissingRelation(err) {
  const code = err?.code || err?.cause?.code
  const msg = String(err?.message || err?.cause?.message || '').toLowerCase()
  return (
    code === '42P01' ||
    code === 'PGRST205' ||
    msg.includes('does not exist') ||
    msg.includes('could not find the table') ||
    msg.includes('schema cache') ||
    (msg.includes('relation') && msg.includes('modules'))
  )
}

/**
 * List every module row, ordered by category then name. Degrades to [] when the
 * table is not provisioned or on a read error so the control center can render
 * its empty / migration state.
 *
 * @returns {Promise<Array<object>>}
 */
export async function listModules() {
  try {
    const q = supabase.from('modules').select(MODULE_COLS)
      .order('category', { ascending: true })
      .order('name', { ascending: true })
    return unwrap(await q) || []
  } catch (err) {
    if (isMissingRelation(err)) return []
    throw err
  }
}

/**
 * Read a lightweight { module_id: { status, until, note } } map of every module
 * row, for app-wide status enforcement (Module Control) plus the maintenance
 * window (ETA + note). Least-privilege projection (id + status + the two
 * maintenance columns). Degrades to an empty map on ANY failure - missing table
 * (pre-migration), read error, or unexpected shape - so enforcement can FAIL
 * OPEN (availability over lockout) rather than blocking routes when the registry
 * is unreadable.
 *
 * NOTE: the map VALUE is an object (not a bare status string). Callers read
 * `.status` for the lifecycle state and `.until` / `.note` for the maintenance
 * window (AuthContext.moduleStatus / moduleMaintenance do exactly this).
 *
 * @returns {Promise<Record<string,{status:string,until:(string|null),note:(string|null)}>>}
 */
export async function listModuleStatuses() {
  try {
    const rows = unwrap(
      await supabase.from('modules').select('module_id,status,maintenance_until,maintenance_note'),
    ) || []
    const map = {}
    for (const r of rows) {
      if (r && r.module_id != null) {
        map[String(r.module_id)] = {
          status: r.status,
          until: r.maintenance_until ?? null,
          note: r.maintenance_note ?? null,
        }
      }
    }
    return map
  } catch {
    return {}
  }
}

/**
 * Upsert a single module row (insert or update on module_id conflict). Only the
 * provided fields are written; status defaults to 'live'. Returns the stored row.
 *
 * @param {object} m
 * @param {string} m.moduleId            required primary key
 * @param {string} [m.name]
 * @param {string} [m.category]
 * @param {string} [m.status='live']     one of MODULE_STATUSES
 * @param {string} [m.visibleTo='all']   all | admin_only | specific_roles
 * @param {string[]} [m.roles]
 * @param {string[]} [m.dependsOn]
 * @param {string} [m.note]
 * @returns {Promise<object|null>}
 */
export async function upsertModule({
  moduleId,
  name,
  category,
  status = 'live',
  visibleTo = 'all',
  roles,
  dependsOn,
  note,
} = {}) {
  const id = moduleId == null ? '' : String(moduleId).trim()
  if (!id) throw new Error('moduleId is required')
  const payload = {
    module_id: id,
    name: name == null ? id : String(name),
    category: category == null ? null : String(category),
    status: MODULE_STATUSES.includes(status) ? status : 'live',
    visible_to: visibleTo || 'all',
    roles: Array.isArray(roles) ? roles : [],
    depends_on: Array.isArray(dependsOn) ? dependsOn : [],
    note: note == null ? null : String(note),
    last_updated: new Date().toISOString(),
  }
  return unwrap(
    await supabase.from('modules')
      .upsert(payload, { onConflict: 'module_id' })
      .select(MODULE_COLS)
      .single(),
  )
}

/**
 * Set a single module's lifecycle status. Stamps last_updated. Returns the row.
 *
 * Optionally carries a maintenance window (ETA + note) when moving INTO
 * maintenance. When the status is anything other than 'maintenance' the window
 * is cleared (both columns nulled) so a stale ETA/note never lingers on a Live
 * or Off module.
 *
 * @param {string} moduleId
 * @param {string} status  one of MODULE_STATUSES
 * @param {object} [opts]
 * @param {(string|Date|null)} [opts.until]  maintenance ETA (ISO string / Date)
 * @param {(string|null)}      [opts.note]   short maintenance note
 * @returns {Promise<object|null>}
 */
export async function setModuleStatus(moduleId, status, { until, note } = {}) {
  const maintenance = status === 'maintenance'
  let untilIso = null
  if (maintenance && until) {
    const d = until instanceof Date ? until : new Date(until)
    if (!Number.isNaN(d.getTime())) untilIso = d.toISOString()
  }
  const noteVal = maintenance && note != null && String(note).trim()
    ? String(note).trim()
    : null
  return unwrap(
    await supabase.from('modules')
      .update({
        status,
        maintenance_until: untilIso,
        maintenance_note: noteVal,
        last_updated: new Date().toISOString(),
      })
      .eq('module_id', moduleId)
      .select(MODULE_COLS)
      .single(),
  )
}

/**
 * Bulk set the status of several modules at once. No-op (empty array) when the
 * id list is empty. Returns the updated rows.
 *
 * @param {string[]} moduleIds
 * @param {string} status  one of MODULE_STATUSES
 * @returns {Promise<Array<object>>}
 */
export async function bulkSetStatus(moduleIds, status) {
  const ids = Array.isArray(moduleIds) ? moduleIds.filter(Boolean) : []
  if (ids.length === 0) return []
  // A bulk change carries no per-module window, so any prior ETA/note is cleared
  // (mirrors setModuleStatus clearing the window when not in maintenance).
  return unwrap(
    await supabase.from('modules')
      .update({
        status,
        maintenance_until: null,
        maintenance_note: null,
        last_updated: new Date().toISOString(),
      })
      .in('module_id', ids)
      .select(MODULE_COLS),
  ) || []
}

/**
 * Flatten the curated MODULE_GROUPS into the seed shape. Used as the fallback
 * when no explicit catalog is supplied so callers keep the old behaviour.
 *
 * @returns {{module_id:string,name:string,category:string}[]}
 */
function curatedSeedList() {
  return MODULE_GROUPS.flatMap((g) =>
    g.modules.map((m) => ({ module_id: m.key, name: m.label, category: g.group })),
  )
}

/**
 * Seed the registry from a module catalog. Best-effort: reads the existing rows,
 * then upserts any catalog module that has no row yet with status 'live' so the
 * control center is populated on first use. Never throws; returns the number of
 * rows seeded (0 when nothing was missing or on any failure).
 *
 * Pass the COMPLETE catalog (e.g. `buildNavModuleCatalog(NAV_CATALOG)`) to cover
 * every navigable module; called with no argument it falls back to the curated
 * MODULE_GROUPS set so existing behaviour is unchanged. Existing rows are never
 * touched, so previously seeded keys keep their stored label / category / status.
 *
 * @param {{module_id:string,name?:string,category?:string}[]} [catalog]
 * @returns {Promise<number>}
 */
export async function seedFromCatalog(catalog) {
  try {
    const list = Array.isArray(catalog) && catalog.length ? catalog : curatedSeedList()
    const existing = await listModules()
    const have = new Set((existing || []).map((r) => r.module_id))
    const seen = new Set()
    const missing = []
    for (const m of list) {
      const id = m && m.module_id != null ? String(m.module_id).trim() : ''
      if (!id || seen.has(id) || have.has(id)) continue
      seen.add(id)
      missing.push({
        module_id: id,
        name: m.name == null ? id : String(m.name),
        category: m.category == null ? null : String(m.category),
        status: 'live',
        visible_to: 'all',
        roles: [],
        depends_on: [],
        note: null,
        last_updated: new Date().toISOString(),
      })
    }
    if (missing.length === 0) return 0
    const { error } = await supabase.from('modules')
      .upsert(missing, { onConflict: 'module_id' })
    if (error) return 0
    return missing.length
  } catch {
    return 0
  }
}

/**
 * Pure helper: human-readable warnings raised when a module is about to be taken
 * out of service (status 'maintenance' or 'disabled'). Scans the other modules
 * for any that list `moduleId` in their `depends_on` and are themselves still
 * Live, since those would be operating against a dependency that is going down.
 *
 * Returns [] when the next status keeps the module in service (live / beta), when
 * nothing depends on it, or when every dependent is already out of service.
 *
 * @param {Array<object>} modules   the full module list (each row has module_id,
 *                                   name, status, depends_on[])
 * @param {string} moduleId         the module changing status
 * @param {string} nextStatus       the status it is moving to
 * @returns {string[]}              e.g. ["Reports depends on Analytics"]
 */
export function dependencyWarnings(modules, moduleId, nextStatus) {
  const takingDown = nextStatus === 'maintenance' || nextStatus === 'disabled'
  if (!takingDown) return []
  const rows = Array.isArray(modules) ? modules : []
  const target = rows.find((m) => m && m.module_id === moduleId)
  const targetName = (target && target.name) || moduleId
  const warnings = []
  for (const m of rows) {
    if (!m || m.module_id === moduleId) continue
    const deps = Array.isArray(m.depends_on) ? m.depends_on : []
    if (!deps.includes(moduleId)) continue
    // Only warn about dependents that are still in service (live or beta).
    if (m.status === 'disabled' || m.status === 'maintenance') continue
    const depName = m.name || m.module_id
    warnings.push(`${depName} depends on ${targetName}`)
  }
  return warnings
}
