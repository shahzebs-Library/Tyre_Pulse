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
import { supabase, fetchAllPages } from './_client'

/** Shared return / write-off marks (serial + mark_type). */
export function listTyreStatusMarks() {
  return supabase.from('tyre_status_marks').select('serial,mark_type')
}

/**
 * Tyre records for transfer derivation, ordered oldest-first by issue_date, with
 * a strict country scope when a specific country is active.
 */
export function listExchangeTyreRecords({ country } = {}) {
  return fetchAllPages((from, to) => {
    let q = supabase
      .from('tyre_records')
      .select('id,asset_no,serial_number,serial_no,position,brand,size,tread_depth,cost_per_tyre,issue_date,km_at_fitment,km_at_removal,risk_level,site,country,category')
      .order('issue_date', { ascending: true })
      .order('id', { ascending: true })
      .range(from, to)
    if (country !== 'All') q = q.eq('country', country)
    return q
  })
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

/**
 * Scrap a tyre by serial. Records an authoritative 'scrap' status mark (with an
 * optional reason + acting user) AND flags every tyre_records row for that serial
 * as 'Scrapped' so pool/analytics logic (isRemovedOrScrapped) treats it as out of
 * service. Org isolation + approval RLS apply. Idempotent (re-scrapping is a no-op
 * upsert). Returns how many lifecycle rows were flagged.
 * @param {string} serial
 * @param {{ reason?:string|null, country?:string|null }} [opts]
 * @returns {Promise<{ updated:number }>}
 */
export async function scrapTyreBySerial(serial, { reason = null, country = null } = {}) {
  const s = String(serial || '').trim()
  if (!s) throw new Error('Serial number is required.')
  const { data, error } = await supabase.rpc('scrap_tyre_by_serial', {
    p_serial: s,
    p_reason: reason ? String(reason).trim() : null,
    p_country: country || null,
  })
  if (error) throw error
  return { updated: Number(data?.updated ?? 0) }
}

/**
 * Undo a scrap. ADMIN ONLY (V383) - deliberately a narrower right than
 * scrapping, because marking a scrap is a field observation while reversing one
 * is a correction to the record.
 *
 * Each row goes back to the status it held BEFORE the scrap, which the mark
 * recorded. It does NOT blanket-set 'Active': that used to bring a 'Removed'
 * tyre back into the allocatable pool, and where the position had since been
 * refilled the update was refused outright by guard_tyre_active_fitment.
 * @param {string} serial
 * @returns {Promise<{ ok:boolean, restoredExactly:boolean }>}
 */
export async function unscrapTyreBySerial(serial) {
  const s = String(serial || '').trim()
  if (!s) throw new Error('Serial number is required.')
  const { data, error } = await supabase.rpc('unscrap_tyre_by_serial', { p_serial: s })
  if (error) throw error
  return { ok: true, restoredExactly: data?.restored_exactly === true }
}

/**
 * Edit the reason on an existing scrap mark. Through the RPC so it is gated and
 * audited: the table policy alone lets any approved user rewrite any mark's
 * reason with no record of the change.
 */
export async function updateScrapReason(serial, reason) {
  const s = String(serial || '').trim()
  if (!s) throw new Error('Serial number is required.')
  const { error } = await supabase.rpc('set_scrap_reason', {
    p_serial: s,
    p_reason: reason ? String(reason).trim() : null,
  })
  if (error) throw error
  return { ok: true }
}

/** The 'scrap' mark for a serial ({serial, reason, created_at}) or null. */
export async function getScrapMark(serial) {
  const s = String(serial || '').trim()
  if (!s) return null
  const { data, error } = await supabase.from('tyre_status_marks')
    .select('serial,reason,created_at').eq('serial', s).eq('mark_type', 'scrap').maybeSingle()
  if (error && error.code !== 'PGRST116') throw error
  return data || null
}

/**
 * The scrapped register: every tyre this org has scrapped, WHO scrapped it and
 * when, with the tyre's own detail (asset, position, brand, size, cost).
 *
 * Goes through `list_scrapped_tyres` rather than reading the marks directly for
 * two reasons. It resolves created_by to a person, which a plain select cannot
 * do. And it also returns tyres carrying status='Scrapped' with NO mark - the
 * ones bulk-scrapped from the Tyre Records grid, which never wrote a mark and
 * were therefore invisible to every scrap surface. Those come back flagged
 * `marked:false` and with no actor, because there genuinely is none; merging
 * them silently would invent an accountability that was never recorded.
 *
 * @param {{ search?:string, country?:string, limit?:number }} [opts]
 * @returns {Promise<{ok:boolean, rows:Array, total:number, marked_total:number, unattributed_total:number}>}
 */
export async function listScrappedTyres({ search, country, limit } = {}) {
  const { data, error } = await supabase.rpc('list_scrapped_tyres', {
    p_search: search ? String(search).trim() : null,
    p_country: country && country !== 'All' ? country : null,
    p_limit: limit || 500,
  })
  if (error) {
    const m = String(error.message || error.code || '').toLowerCase()
    // pre-V383 backend: degrade to an empty register rather than an error page
    if (m.includes('does not exist') || m.includes('could not find') || m.includes('schema cache')) {
      return { ok: false, rows: [], total: 0, marked_total: 0, unattributed_total: 0 }
    }
    throw error
  }
  if (!data || data.ok !== true) return { ok: false, rows: [], total: 0, marked_total: 0, unattributed_total: 0 }
  return { ...data, rows: Array.isArray(data.rows) ? data.rows : [] }
}

/** All 'scrap' marks for this org (serial, reason, created_at), newest first. */
export async function listScrapMarks() {
  const { data, error } = await supabase.from('tyre_status_marks')
    .select('serial,reason,created_at').eq('mark_type', 'scrap')
    .order('created_at', { ascending: false })
  if (error) throw error
  return data || []
}

/**
 * Find a tyre by serial so a scrap can be confirmed against a real record
 * before it is written.
 *
 * Scrapping is keyed on the serial alone, so without this the operator could
 * mark a typo and create a mark against a tyre that does not exist. Returns the
 * newest fitment row for the serial, or null.
 * @param {string} serial
 */
export async function findTyreBySerial(serial) {
  const s = String(serial || '').trim()
  if (!s) return null
  const { data, error } = await supabase.from('tyre_records')
    .select('serial_no,asset_no,tyre_position,brand,size,site,country,status,cost_per_tyre,issue_date')
    .eq('serial_no', s)
    .order('issue_date', { ascending: false, nullsFirst: false })
    .limit(1)
  if (error) throw error
  return (data && data[0]) || null
}

/**
 * May THIS user scrap / undo? Asked of the server, never inferred from the role
 * string on the client.
 *
 * Two separate answers because they are two separate rights: a Tyre Data
 * Collector may scrap but not undo. Guessing either from `role === 'Admin'`
 * misses a per-user capability grant entirely, and would show a collector a
 * button the server will refuse. Both FAIL CLOSED - an action we cannot confirm
 * is not offered.
 * @returns {Promise<{ canScrap:boolean, canUndo:boolean }>}
 */
export async function getScrapPermissions() {
  const [scrap, undo] = await Promise.all([
    supabase.rpc('tyre_scrap_allowed'),
    supabase.rpc('tyre_unscrap_allowed'),
  ])
  return {
    canScrap: !scrap.error && scrap.data === true,
    canUndo: !undo.error && undo.data === true,
  }
}
