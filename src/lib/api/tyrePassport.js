/**
 * Tyre Passport service — fetches the tyre_records that make up one tyre's
 * lifecycle, plus a serial search for the lookup box. Country-scoped (null-safe);
 * the passport assembly lives in `src/lib/tyrePassport.js`.
 */
import { supabase, applyCountry, fetchAllPages } from './_client'
import { sanitizeSearchTerm } from '../searchFilter'

const COLS =
  'id,serial_no,serial_number,tyre_serial,brand,size,supplier,asset_no,asset_number,site,' +
  'country,position,tyre_position,status,cost_per_tyre,total_km,total_hrs,km_at_fitment,' +
  'km_at_removal,tread_depth,pressure_reading,fitment_date,issue_date,removal_date,' +
  'reason_for_removal,removal_reason,findings,remarks,created_at'

/** All records for a given serial (matched across the three serial columns). */
export async function getPassportRecords(serial, { country } = {}) {
  const s = sanitizeSearchTerm(String(serial || '').trim())
  if (!s) return []
  return fetchAllPages((from, to) => {
    const q = supabase.from('tyre_records').select(COLS)
      .or(`serial_no.eq.${s},serial_number.eq.${s},tyre_serial.eq.${s}`)
      .order('fitment_date', { ascending: true, nullsFirst: true })
      .order('id', { ascending: true })
      .range(from, to)
    return applyCountry(q, country)
  })
}

/**
 * Serial search for the lookup box: distinct serials matching a query, with a
 * little context (brand/asset) for disambiguation. Capped for responsiveness.
 */
export async function searchSerials(query, { country, limit = 25 } = {}) {
  const s = sanitizeSearchTerm(String(query || '').trim())
  if (!s || s.length < 2) return []
  let q = supabase.from('tyre_records')
    .select('serial_no,serial_number,tyre_serial,brand,asset_no,size')
    .or(`serial_no.ilike.%${s}%,serial_number.ilike.%${s}%,tyre_serial.ilike.%${s}%`)
    .limit(200)
  q = applyCountry(q, country)
  const { data, error } = await q
  if (error) throw error
  const seen = new Set()
  const out = []
  for (const r of data || []) {
    const serial = (r.serial_no || r.serial_number || r.tyre_serial || '').trim()
    if (!serial || seen.has(serial.toLowerCase())) continue
    seen.add(serial.toLowerCase())
    out.push({ serial, brand: r.brand || null, asset_no: r.asset_no || null, size: r.size || null })
    if (out.length >= limit) break
  }
  return out
}
