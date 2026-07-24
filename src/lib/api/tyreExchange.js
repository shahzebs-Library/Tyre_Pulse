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
  let userId = null
  try { userId = (await supabase.auth.getUser()).data?.user?.id || null } catch { /* best effort */ }
  const { error: markErr } = await supabase.from('tyre_status_marks').upsert(
    { serial: s, mark_type: 'scrap', reason: reason ? String(reason).trim() : null, country: country || null, created_by: userId },
    { onConflict: 'serial,mark_type' },
  )
  if (markErr) throw markErr
  // Scope the status stamp to the country. The SAME serial exists independently
  // in KSA, UAE and Egypt (intake de-dupes per country), and the country RLS
  // policies are SELECT-only, so an unscoped UPDATE scrapped every country's
  // copy of the tyre for anyone whose scope spans more than one country.
  let upd = supabase.from('tyre_records').update({ status: 'Scrapped' }).eq('serial_no', s)
  if (country) upd = upd.eq('country', country)
  const { data, error } = await upd.select('id')
  if (error) throw error
  return { updated: (data || []).length }
}

/**
 * Undo a scrap: removes the 'scrap' mark and reverts any row still flagged
 * 'Scrapped' back to 'Active'. (removal_date / km_at_removal lifecycle signals are
 * untouched, so a genuinely-removed tyre stays out of the allocatable pool.)
 * @param {string} serial
 * @param {{ country?:string|null }} [opts]
 * @returns {Promise<{ ok:boolean }>}
 */
export async function unscrapTyreBySerial(serial, { country = null } = {}) {
  const s = String(serial || '').trim()
  if (!s) throw new Error('Serial number is required.')
  const { error: delErr } = await supabase.from('tyre_status_marks')
    .delete().eq('serial', s).eq('mark_type', 'scrap')
  if (delErr) throw delErr
  // Country-scoped for the same reason as scrapTyreBySerial: one serial can
  // exist in several countries and an unscoped UPDATE would revive them all.
  let upd = supabase.from('tyre_records')
    .update({ status: 'Active' }).eq('serial_no', s).eq('status', 'Scrapped')
  if (country) upd = upd.eq('country', country)
  const { error } = await upd
  if (error) throw error
  return { ok: true }
}

/** Update the reason on an existing 'scrap' mark (in-place edit). */
export async function updateScrapReason(serial, reason) {
  const s = String(serial || '').trim()
  if (!s) throw new Error('Serial number is required.')
  const { error } = await supabase.from('tyre_status_marks')
    .update({ reason: reason ? String(reason).trim() : null })
    .eq('serial', s).eq('mark_type', 'scrap')
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

/** All 'scrap' marks for this org (serial, reason, created_at), newest first. */
export async function listScrapMarks() {
  const { data, error } = await supabase.from('tyre_status_marks')
    // country is needed so an undo from this list can be scoped to the right
    // country's copy of the serial (see unscrapTyreBySerial).
    .select('serial,reason,created_at,country').eq('mark_type', 'scrap')
    .order('created_at', { ascending: false })
  if (error) throw error
  return data || []
}
