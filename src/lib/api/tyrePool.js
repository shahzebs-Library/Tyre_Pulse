/**
 * Tyre Pool service — reads the candidate tyre records for the Tyre Pool screen
 * (unfitted / available spare stock). Ported (backend-logic side) from tyre_saas
 * and wired to Tyre Pulse's `tyre_records`. Country-scoped (null-safe) and fully
 * paginated so large fleets are never silently truncated.
 *
 * The pool DEFINITION (which of these rows are actually "in the pool") lives in
 * the pure, unit-tested `src/lib/tyrePool.js` and runs client-side — the status
 * vocabulary varies across imported datasets, so filtering there keeps the rule
 * in one auditable place rather than encoding a brittle status list in SQL.
 */
import { supabase, unwrap, applyCountry, fetchAllPages } from './_client'
import { returnConditionToStatus } from '../tyrePool'

// Explicit least-privilege column list (no SELECT *). Includes the fields the
// pure pool filter and the page's KPIs / table / export need.
const COLS =
  'id,serial_no,serial_number,tyre_serial,brand,size,asset_no,site,region,country,' +
  'status,position,tyre_position,cost_per_tyre,tread_depth,category,risk_level,' +
  'km_at_removal,fitment_date,removal_date,issue_date'

/**
 * Every candidate tyre record in scope for the pool view, paginated. The client
 * narrows these to actual pool tyres via `summarizePool` / `isPoolTyre`.
 * @param {{ country?:string }} [opts]
 */
export async function listPoolCandidates({ country } = {}) {
  return fetchAllPages((from, to) => {
    const q = supabase.from('tyre_records').select(COLS)
      .order('brand', { ascending: true, nullsFirst: false })
      .order('id', { ascending: true })
      .range(from, to)
    return applyCountry(q, country)
  })
}

// ─────────────────────────────────────────────────────────────────────────────
// Hot-spare POOL MANAGER (V209). Reads/writes the managed `tyre_pool` table.
// RLS enforces org isolation and elevated-role writes; this layer validates and
// coerces input and degrades a missing relation (org has not run V209) to an
// empty list so the page can render its "apply the migration" state instead of
// erroring — mirroring src/lib/api/orgUnits.js.
// ─────────────────────────────────────────────────────────────────────────────

/** Explicit least-privilege column list for managed pool entries. */
export const POOL_COLS =
  'id,organisation_id,tyre_serial,pool_location,reason,min_qty,status,' +
  'assigned_to,assigned_at,returned_at,notes,history,created_by,country,created_at,updated_at'

const POOL_REASONS = [
  'hot_spare', 'seasonal_rotation', 'buffer_stock', 'warranty_replacement', 'retreat_return',
]

/** True when the failure is "table does not exist yet" (pre-migration). */
export function isMissingRelation(err) {
  const code = err?.code || err?.cause?.code
  const msg = String(err?.message || err?.cause?.message || '').toLowerCase()
  return (
    code === '42P01' || code === 'PGRST205' ||
    msg.includes('does not exist') ||
    msg.includes('could not find the table') ||
    msg.includes('schema cache') ||
    (msg.includes('relation') && msg.includes('tyre_pool'))
  )
}

const asText = (v, max) => (v == null || v === '' ? null : String(v).trim().slice(0, max))
const asInt = (v, field, def = null) => {
  if (v == null || v === '') return def
  const n = typeof v === 'number' ? v : parseFloat(String(v).replace(/[^0-9.\-]/g, ''))
  if (!Number.isFinite(n)) throw new Error(`${field} must be a number.`)
  return Math.max(0, Math.round(n))
}
const asReason = (v) => {
  const t = asText(v, 40)
  return t && POOL_REASONS.includes(t) ? t : 'hot_spare'
}

/**
 * List managed pool entries, newest first. Country-scoped (null-safe) and
 * optionally filtered by status. Returns [] when the table is not provisioned.
 * @param {{ country?:string, status?:string, limit?:number }} [opts]
 */
export async function listPoolEntries({ country, status, limit = 1000 } = {}) {
  try {
    let q = supabase.from('tyre_pool').select(POOL_COLS)
      .order('created_at', { ascending: false })
      .limit(limit)
    q = applyCountry(q, country)
    if (status) q = q.eq('status', status)
    return unwrap(await q) || []
  } catch (err) {
    if (isMissingRelation(err)) return []
    throw err
  }
}

/**
 * Add a tyre to the hot-spare pool. Rejects (clear Error) if the same serial is
 * already held in a non-retired entry for this org — the DB UNIQUE constraint
 * is the hard backstop; this gives a friendly message first. Starts life as
 * `available`. The organisation_id / created_by defaults come from the DB.
 * @param {{ tyre_serial:string, pool_location?:string, reason?:string,
 *   min_qty?:number|string, notes?:string, country?:string }} values
 */
export async function addToPool(values = {}) {
  const tyre_serial = asText(values.tyre_serial, 120)
  if (!tyre_serial) throw new Error('A tyre serial is required.')

  // Friendly pre-check: is this serial already actively pooled?
  try {
    const existing = unwrap(
      await supabase.from('tyre_pool').select('id,status')
        .eq('tyre_serial', tyre_serial)
        .neq('status', 'retired')
        .limit(1),
    )
    if (Array.isArray(existing) && existing.length > 0) {
      throw new Error(`Tyre ${tyre_serial} is already in the pool.`)
    }
  } catch (err) {
    if (/already in the pool/.test(err?.message || '')) throw err
    if (!isMissingRelation(err)) throw err
    // Missing relation surfaces on the insert below with the same guard.
  }

  const payload = {
    tyre_serial,
    pool_location: asText(values.pool_location, 200),
    reason: asReason(values.reason),
    min_qty: asInt(values.min_qty, 'Minimum quantity', 1),
    status: 'available',
    notes: values.notes ? String(values.notes).slice(0, 8000) : null,
    country: asText(values.country, 120),
    history: [],
  }
  try {
    return unwrap(await supabase.from('tyre_pool').insert(payload).select(POOL_COLS).single())
  } catch (err) {
    if (/duplicate|unique/i.test(err?.message || '')) {
      throw new Error(`Tyre ${tyre_serial} is already in the pool.`)
    }
    throw err
  }
}

/**
 * Deploy an available spare to an asset. Only permitted when the entry is
 * currently `available`; sets status `deployed`, records the asset + timestamp,
 * and appends an `assigned` history event (append-only, read-then-write).
 * @param {string|number} poolId
 * @param {{ assigned_to:string, position?:string, notes?:string }} details
 */
export async function assignFromPool(poolId, { assigned_to, position, notes } = {}) {
  const asset = asText(assigned_to, 120)
  if (!asset) throw new Error('An asset / vehicle is required to deploy a spare.')

  const entry = unwrap(
    await supabase.from('tyre_pool').select('id,status,history').eq('id', poolId).maybeSingle(),
  )
  if (!entry) throw new Error('Pool entry not found.')
  if (entry.status !== 'available') {
    throw new Error(`Tyre is not available to deploy (status: ${entry.status}).`)
  }

  const now = new Date().toISOString()
  const history = Array.isArray(entry.history) ? entry.history : []
  const event = {
    action: 'assigned',
    assigned_to: asset,
    position: asText(position, 40) || null,
    notes: asText(notes, 2000) || null,
    at: now,
  }
  return unwrap(
    await supabase.from('tyre_pool')
      .update({
        status: 'deployed',
        assigned_to: asset,
        assigned_at: now,
        history: [...history, event],
      })
      .eq('id', poolId)
      .select(POOL_COLS)
      .single(),
  )
}

/**
 * Return a spare to the pool from a vehicle. The return-inspection `condition`
 * maps to the resulting status via the pure `returnConditionToStatus`
 * (good→available, worn→maintenance, else→retired). Clears the assignment,
 * stamps `returned_at`, and appends a `returned` history event.
 * @param {string|number} poolId
 * @param {{ condition:string, notes?:string }} details
 */
export async function returnToPool(poolId, { condition, notes } = {}) {
  const cond = asText(condition, 40)
  if (!cond) throw new Error('A return condition is required.')

  const entry = unwrap(
    await supabase.from('tyre_pool').select('id,history').eq('id', poolId).maybeSingle(),
  )
  if (!entry) throw new Error('Pool entry not found.')

  const now = new Date().toISOString()
  const status = returnConditionToStatus(cond)
  const history = Array.isArray(entry.history) ? entry.history : []
  const event = {
    action: 'returned',
    condition: cond,
    resulting_status: status,
    notes: asText(notes, 2000) || null,
    at: now,
  }
  return unwrap(
    await supabase.from('tyre_pool')
      .update({
        status,
        assigned_to: null,
        returned_at: now,
        history: [...history, event],
      })
      .eq('id', poolId)
      .select(POOL_COLS)
      .single(),
  )
}

/**
 * Count active vehicles in scope (for the replenishment recommendation). Uses a
 * head-only exact count so no rows are transferred. Country-scoped (null-safe).
 * Returns 0 when the fleet table is unavailable so the page never errors on it.
 * @param {{ country?:string }} [opts]
 */
export async function countActiveVehicles({ country } = {}) {
  try {
    let q = supabase.from('vehicle_fleet').select('id', { count: 'exact', head: true }).eq('is_active', true)
    q = applyCountry(q, country)
    const { count, error } = await q
    if (error) throw error
    return count || 0
  } catch {
    return 0
  }
}
