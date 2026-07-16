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
  'module_id,name,category,status,visible_to,roles,depends_on,note,last_updated,updated_by'

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
    roles: Array.isArray(roles) ? roles : null,
    depends_on: Array.isArray(dependsOn) ? dependsOn : null,
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
 * @param {string} moduleId
 * @param {string} status  one of MODULE_STATUSES
 * @returns {Promise<object|null>}
 */
export async function setModuleStatus(moduleId, status) {
  return unwrap(
    await supabase.from('modules')
      .update({ status, last_updated: new Date().toISOString() })
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
  return unwrap(
    await supabase.from('modules')
      .update({ status, last_updated: new Date().toISOString() })
      .in('module_id', ids)
      .select(MODULE_COLS),
  ) || []
}

/**
 * Seed the registry from the module catalog. Best-effort: reads the existing
 * rows, then upserts any catalog module that has no row yet with status 'live'
 * so the control center is populated on first use. Never throws; returns the
 * number of rows seeded (0 when nothing was missing or on any failure).
 *
 * @returns {Promise<number>}
 */
export async function seedFromCatalog() {
  try {
    const existing = await listModules()
    const have = new Set((existing || []).map((r) => r.module_id))
    const missing = []
    for (const g of MODULE_GROUPS) {
      for (const m of g.modules) {
        if (!have.has(m.key)) {
          missing.push({
            module_id: m.key,
            name: m.label,
            category: g.group,
            status: 'live',
            visible_to: 'all',
            roles: null,
            depends_on: null,
            note: null,
            last_updated: new Date().toISOString(),
          })
        }
      }
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
