/**
 * Tyre Exchange page reads/writes - the exact inline Supabase queries the
 * inter-site transfer / return / write-off screen consumes (tyre corpus, stock
 * movements, shared return/write-off marks).
 *
 * Read-only pass-throughs return the raw Supabase query builder (thenable) the
 * page reads via `.data` / `.error`. Country scoping here is a STRICT
 * `.eq('country', X)` (NOT null-safe) to preserve the page's prior behaviour
 * exactly. Explicit column list on the corpus (no SELECT *). Additive only.
 */
import { supabase } from './_client'

/** Shared return / write-off marks (serial + mark_type). */
export function listTyreStatusMarks() {
  return supabase.from('tyre_status_marks').select('serial,mark_type')
}

/**
 * Tyre records for transfer derivation, ordered oldest-first by issue_date, with
 * a strict country scope when a specific country is active.
 */
export function listExchangeTyreRecords({ country } = {}) {
  let q = supabase
    .from('tyre_records')
    .select('id,asset_no,serial_number,serial_no,position,brand,size,tread_depth,cost_per_tyre,issue_date,km_at_fitment,km_at_removal,risk_level,site,country,category')
    .order('issue_date', { ascending: true })
  if (country !== 'All') q = q.eq('country', country)
  return q
}

/** Recent stock movements (may be absent); newest first, capped at 500. */
export function listStockMovements() {
  return supabase.from('stock_movements').select('*').order('created_at', { ascending: false }).limit(500)
}

/**
 * Upsert a return / write-off mark for a serial. Conflict target matches the
 * page's prior inline upsert. Pass-through (page reads `.error`).
 */
export function upsertTyreStatusMark(serial, markType) {
  return supabase
    .from('tyre_status_marks')
    .upsert({ serial, mark_type: markType }, { onConflict: 'serial,mark_type' })
}
