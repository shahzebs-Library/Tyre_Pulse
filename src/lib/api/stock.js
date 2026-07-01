/**
 * Stock service — inventory records (stock_records). Explicit column lists
 * (no SELECT *); null-safe country scoping. Pages migrate onto these methods
 * instead of inline queries. Additive only — mirrors assets.js / tyres.js.
 */
import { supabase, unwrap, applyCountry } from './_client'

const COLS =
  'id,site,description,stock_qty,min_level,critical_level,stock_status,reorder_qty,management_action,region,country,updated_by,updated_at'

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
