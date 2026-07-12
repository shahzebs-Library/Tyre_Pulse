/**
 * Advanced / Global Search service — the single seam between the Advanced
 * Search page (/advanced-search) and Supabase. Two responsibilities:
 *
 *   1. Saved-searches CRUD on table `saved_searches` (V198) — named,
 *      cross-entity searches an org can persist and re-run.
 *   2. A *live* cross-entity search (`runGlobalSearch`) that queries the real
 *      operational tables — vehicle_fleet (assets), tyre_records (tyres),
 *      work_orders, inspections — in parallel and returns grouped results.
 *
 * Mirrors odometerLogs.js: explicit column lists (least-privilege selects),
 * null-safe country scoping, input validation, and graceful degradation. A
 * missing relation (org has not run a migration, or a table isn't provisioned)
 * degrades to an empty array for that entity so the page can still render.
 *
 * RLS enforces org isolation; this layer never trusts client input blindly.
 */
import { supabase, unwrap, applyCountry } from './_client'
import { toFiniteNumber } from '../advancedSearch'

export const COLS =
  'id,organisation_id,country,name,entity,query_text,filters,result_count,' +
  'pinned,last_run_at,notes,created_by,created_at,updated_at'

/** Entity values accepted for a saved search (mirrors the DB CHECK). */
const VALID_ENTITIES = new Set(['assets', 'tyres', 'work_orders', 'inspections', 'all'])

/**
 * Live-search targets: each entity maps to its real table, the display columns
 * to select, and the column ilike'd for the term. Kept in one place so the
 * page and export stay consistent with the underlying schema.
 */
const LIVE_TARGETS = {
  assets: {
    table: 'vehicle_fleet',
    cols: 'id,asset_no,fleet_number,make,model,vehicle_type,site,status,country',
    searchCol: 'asset_no',
    order: 'created_at',
  },
  tyres: {
    table: 'tyre_records',
    cols: 'id,serial_no,asset_no,brand,size,position,risk_level,site,country',
    searchCol: 'serial_no',
    order: 'created_at',
  },
  work_orders: {
    table: 'work_orders',
    cols: 'id,work_order_no,asset_no,status,priority,work_type,workshop_name,site,country',
    searchCol: 'work_order_no',
    order: 'created_at',
  },
  inspections: {
    table: 'inspections',
    cols: 'id,title,inspection_type,asset_no,status,severity,inspector,site,country',
    searchCol: 'title',
    order: 'created_at',
  },
}

/** True when the failure is "table does not exist yet" (pre-migration). */
function isMissingRelation(err) {
  const code = err?.code || err?.cause?.code
  const msg = String(err?.message || err?.cause?.message || '').toLowerCase()
  return (
    code === '42P01' || code === 'PGRST205' ||
    msg.includes('does not exist') ||
    msg.includes('could not find the table') ||
    msg.includes('schema cache') ||
    (msg.includes('relation') && msg.includes('saved_searches'))
  )
}

const asText = (v, max) => (v == null || v === '' ? null : String(v).trim().slice(0, max))
const asBool = (v) => v === true || v === 'true' || v === 1 || v === '1'

// ── Saved searches CRUD ──────────────────────────────────────────────────────

/**
 * List saved searches for the active country. Pinned first, then newest.
 * Returns [] when the table has not been provisioned yet.
 * @param {{ country?:string, limit?:number }} [opts]
 */
export async function listSavedSearches({ country, limit = 500 } = {}) {
  try {
    let q = supabase.from('saved_searches').select(COLS)
    q = applyCountry(q, country)
    return unwrap(
      await q
        .order('pinned', { ascending: false })
        .order('created_at', { ascending: false })
        .limit(limit),
    ) || []
  } catch (err) {
    if (isMissingRelation(err)) return []
    throw err
  }
}

export async function getSavedSearch(id) {
  return unwrap(await supabase.from('saved_searches').select(COLS).eq('id', id).maybeSingle())
}

/**
 * Create a saved search. Requires a name. Entity is whitelisted (defaults to
 * 'all' when omitted or invalid); `pinned` is coerced to a real boolean;
 * `filters` is accepted as-is (jsonb) so the page can persist arbitrary
 * structured filter state.
 */
export async function createSavedSearch(values = {}) {
  const name = asText(values.name, 200)
  if (!name) throw new Error('A name is required to save a search.')

  const entity = VALID_ENTITIES.has(values.entity) ? values.entity : 'all'
  const payload = {
    name,
    entity,
    query_text: asText(values.query_text, 2000),
    filters: values.filters ?? null,
    result_count: toFiniteNumber(values.result_count),
    pinned: asBool(values.pinned),
    last_run_at: values.last_run_at ?? null,
    notes: values.notes ? String(values.notes).slice(0, 8000) : null,
    country: values.country ?? null,
  }
  return unwrap(await supabase.from('saved_searches').insert(payload).select(COLS).single())
}

/**
 * Patch a saved search. Strips immutable/ownership fields (id, organisation_id,
 * created_by, created_at) and coerces every field present so the stored value
 * never drifts from the validated shape.
 */
export async function updateSavedSearch(id, patch = {}) {
  const clean = {}
  if (patch.name !== undefined) {
    const name = asText(patch.name, 200)
    if (!name) throw new Error('A name is required to save a search.')
    clean.name = name
  }
  if (patch.entity !== undefined) {
    clean.entity = VALID_ENTITIES.has(patch.entity) ? patch.entity : 'all'
  }
  if (patch.query_text !== undefined) clean.query_text = asText(patch.query_text, 2000)
  if (patch.filters !== undefined) clean.filters = patch.filters ?? null
  if (patch.result_count !== undefined) clean.result_count = toFiniteNumber(patch.result_count)
  if (patch.pinned !== undefined) clean.pinned = asBool(patch.pinned)
  if (patch.last_run_at !== undefined) clean.last_run_at = patch.last_run_at ?? null
  if (patch.notes !== undefined) clean.notes = patch.notes ? String(patch.notes).slice(0, 8000) : null
  if (patch.country !== undefined) clean.country = patch.country ?? null

  return unwrap(await supabase.from('saved_searches').update(clean).eq('id', id).select(COLS).single())
}

export async function deleteSavedSearch(id) {
  return unwrap(await supabase.from('saved_searches').delete().eq('id', id))
}

/** Convenience: toggle the pinned flag on a saved search. */
export async function setSavedSearchPinned(id, pinned) {
  return updateSavedSearch(id, { pinned: asBool(pinned) })
}

/** Convenience: stamp a search as just-run with its live result count. */
export async function markSavedSearchRun(id, resultCount) {
  return updateSavedSearch(id, {
    last_run_at: new Date().toISOString(),
    result_count: toFiniteNumber(resultCount),
  })
}

// ── Live global search ───────────────────────────────────────────────────────

/**
 * Run one entity's live query, guarded so a missing table yields [] rather than
 * aborting the whole search. Applies country scoping and an ilike on the
 * entity's display column.
 */
async function queryEntity(key, term, country, limitPer) {
  const target = LIVE_TARGETS[key]
  if (!target) return []
  try {
    let q = supabase.from(target.table).select(target.cols)
    q = applyCountry(q, country)
    q = q.ilike(target.searchCol, `%${term}%`)
    return unwrap(await q.order(target.order, { ascending: false }).limit(limitPer)) || []
  } catch (err) {
    if (isMissingRelation(err)) return []
    // A column-not-found on the display column also degrades gracefully rather
    // than failing the entire multi-entity search.
    const msg = String(err?.message || '').toLowerCase()
    if (msg.includes('column') && msg.includes('does not exist')) return []
    throw err
  }
}

/**
 * Live cross-entity search. Queries the real operational tables for `term`
 * (ilike on each entity's display column), scoped to `country`. When `entity`
 * is one of the concrete entities, only that table is queried; 'all' (or an
 * unknown value) queries every table in parallel.
 *
 * Each entity is independently guarded so a missing/unprovisioned table simply
 * returns [] for that group instead of failing the whole request.
 *
 * @param {{ term:string, entity?:string, country?:string, limitPer?:number }} opts
 * @returns {Promise<{ assets:object[], tyres:object[], workOrders:object[],
 *                     inspections:object[], total:number }>}
 */
export async function runGlobalSearch({ term, entity = 'all', country, limitPer = 25 } = {}) {
  const clean = String(term ?? '').trim()
  const empty = { assets: [], tyres: [], workOrders: [], inspections: [], total: 0 }
  if (!clean) return empty

  const per = Math.max(1, Math.min(200, toFiniteNumber(limitPer) ?? 25))
  const want = VALID_ENTITIES.has(entity) ? entity : 'all'
  const run = (key) => (want === 'all' || want === key)
    ? queryEntity(key, clean, country, per)
    : Promise.resolve([])

  const [assets, tyres, workOrders, inspections] = await Promise.all([
    run('assets'),
    run('tyres'),
    run('work_orders'),
    run('inspections'),
  ])

  return {
    assets,
    tyres,
    workOrders,
    inspections,
    total: assets.length + tyres.length + workOrders.length + inspections.length,
  }
}
