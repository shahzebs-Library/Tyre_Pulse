/**
 * Stock service — inventory records (stock_records). Explicit column lists
 * (no SELECT *); null-safe country scoping. Pages migrate onto these methods
 * instead of inline queries. Additive only — mirrors assets.js / tyres.js.
 */
import { supabase, unwrap, applyCountry, fetchAllPages } from './_client'

const COLS =
  'id,site,description,stock_qty,min_level,critical_level,stock_status,reorder_qty,management_action,region,country,updated_by,updated_at'

// Movement ledger (stock_movements). Full row — the movement-history modal
// renders every audit field.
const MOVEMENT_COLS =
  'id,stock_id,site,description,movement_type,qty_before,qty_change,qty_after,reason,reference_no,created_by,created_at'

// Tyre issue rows drive stock velocity / timeline analytics on this page. Only
// the three columns those computations need — nothing wider.
const TYRE_ISSUE_COLS = 'site,qty,issue_date'

/**
 * List stock records, most recently updated first. Country-scoped (null-safe)
 * and optionally filtered by site / stock status.
 * @param {{country?:string, site?:string, status?:string, limit?:number}} [opts]
 */
export async function listStock({ country, site, status, limit = 100 } = {}) {
  let q = supabase
    .from('stock_records')
    .select(COLS)
    .order('updated_at', { ascending: false })
    .limit(limit)
  q = applyCountry(q, country)
  if (site) q = q.eq('site', site)
  if (status) q = q.eq('stock_status', status)
  return unwrap(await q)
}

/** Get one stock record by id (or null if not found). */
export async function getStock(id) {
  return unwrap(await supabase.from('stock_records').select(COLS).eq('id', id).maybeSingle())
}

/** Create a stock record; returns the inserted row. */
export async function createStock(values) {
  return unwrap(await supabase.from('stock_records').insert(values).select(COLS).single())
}

/** Update a stock record by id; returns the updated row. */
export async function updateStock(id, patch) {
  return unwrap(
    await supabase.from('stock_records').update(patch).eq('id', id).select(COLS).single(),
  )
}

/**
 * List stock records for the Stock Management page, ordered by site (A→Z),
 * country-scoped with a strict match ("All" = no filter). No row cap — the page
 * derives status, velocity and reorder suggestions client-side over the full
 * set.
 * @param {{country?:string}} [opts]
 */
export async function listStockRecords({ country } = {}) {
  let q = supabase.from('stock_records').select(COLS).order('site')
  if (country && country !== 'All') q = q.eq('country', country)
  return unwrap(await q)
}

/** Insert a stock record; returns only the new id (page mutation). */
export async function insertStockRecord(values) {
  return unwrap(await supabase.from('stock_records').insert(values).select('id').single())
}

/** Update a stock record by id (page mutation — no row returned). */
export async function updateStockRecord(id, patch) {
  return unwrap(await supabase.from('stock_records').update(patch).eq('id', id))
}

/** Insert a raw movement ledger row (used for the initial / manual-edit leg). */
export async function insertStockMovement(values) {
  return unwrap(await supabase.from('stock_movements').insert(values))
}

/**
 * Movement history for one stock record, newest first (capped at 50 — matches
 * the history modal).
 */
export async function listStockMovements(stockId, limit = 50) {
  return unwrap(
    await supabase
      .from('stock_movements')
      .select(MOVEMENT_COLS)
      .eq('stock_id', stockId)
      .order('created_at', { ascending: false })
      .limit(limit),
  )
}

/**
 * Post a stock movement through the atomic, guarded, audited DB RPC
 * (post_stock_movement). The server computes qty_before/after and blocks a
 * negative balance — no client-side stock math. Returns the RPC payload
 * (includes qty_after).
 * @param {{stockId:string, type:string, qty:number, reason?:string, reference?:string}} args
 */
export async function postStockMovement({ stockId, type, qty, reason, reference }) {
  return unwrap(
    await supabase.rpc('post_stock_movement', {
      p_stock_id: stockId,
      p_type: type,
      p_qty: Math.abs(Number(qty)),
      p_reason: reason || null,
      p_reference: reference || null,
    }),
  )
}

/**
 * Tyre issue rows (site, qty, issue_date) since a date, paged in full via
 * fetchAllPages. Powers the stock velocity estimate. Not country-scoped —
 * mirrors the page's fleet-wide velocity basis.
 */
export async function listTyreIssuesSince(sinceDate) {
  const { data } = await fetchAllPages((from, to) =>
    supabase
      .from('tyre_records')
      .select(TYRE_ISSUE_COLS)
      .gte('issue_date', sinceDate)
      .range(from, to),
  )
  return data ?? []
}

/**
 * Tyre issue rows within a date range for the stock timeline chart/table,
 * ordered by issue_date. Country-scoped with a strict match ("All" = no filter).
 * @param {{from:string, to:string, country?:string}} args
 */
export async function listTyreIssuesInRange({ from, to, country } = {}) {
  let q = supabase
    .from('tyre_records')
    .select(TYRE_ISSUE_COLS)
    .gte('issue_date', from)
    .lte('issue_date', to)
    .order('issue_date', { ascending: true })
  if (country && country !== 'All') q = q.eq('country', country)
  return unwrap(await q)
}
