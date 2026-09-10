/**
 * Tyre Passport service. Fetches the data that makes up one physical tyre's
 * whole-life record, plus a serial search for the lookup box. The primary
 * source is `tyre_records` (fitment / movement history). Four auxiliary sources
 * enrich the passport, each fetched with an explicit column list, null-safe
 * country scoping, and explicit incomplete-history warnings when an auxiliary source fails:
 *   - tyre_service_events (rotations / repairs / inflation / inspections)
 *   - warranty_claims (warranty and quality claims for this serial)
 *   - tyre_status_marks (return / write-off marks)
 *   - retread_claims (retread vendor claims)
 * The passport assembly lives in `src/lib/tyrePassport.js`.
 */
import { supabase, applyCountry, fetchAllPages, unwrap } from './_client'
import { sanitizeSearchTerm } from '../searchFilter'

const COLS =
  'id,serial_no,serial_number,tyre_serial,brand,size,supplier,asset_no,asset_number,site,' +
  'country,position,tyre_position,status,cost_per_tyre,total_km,total_hrs,km_at_fitment,' +
  'km_at_removal,tread_depth,pressure_reading,fitment_date,issue_date,removal_date,' +
  'reason_for_removal,removal_reason,findings,remarks,created_at'

const SERVICE_EVENT_COLS =
  'id,tyre_serial,asset_no,position,event_type,event_date,tread_depth,pressure,cost,' +
  'technician,site,notes,created_at'

const WARRANTY_COLS =
  'id,claim_no,serial_number,brand,size,asset_no,site,country,fitment_date,removal_date,' +
  'km_run,expected_life_km,failure_type,supplier,claim_status,credit_amount,credit_date,notes,created_at'

const RETREAD_COLS =
  'id,claim_no,tyre_serial,asset_no,vendor,reason,claim_date,cost,amount_recovered,status,notes,country,created_at'

/** All records for a given serial (matched across the three serial columns). */
export async function getPassportRecords(serial, { country } = {}) {
  const s = sanitizeSearchTerm(String(serial || '').trim())
  if (!s) return []
  const result = await fetchAllPages((from, to) => {
    const q = supabase.from('tyre_records').select(COLS)
      .or(`serial_no.eq.${s},serial_number.eq.${s},tyre_serial.eq.${s}`)
      .order('fitment_date', { ascending: true, nullsFirst: true })
      .order('id', { ascending: true })
      .range(from, to)
    return applyCountry(q, country)
  }, { max: 20000 })
  if (result.truncated) throw new Error("This tyre history exceeds the display limit.")
  return unwrap(result) || []
}

/** Auxiliary histories are paged; failures are identified in the bundle. */
async function serialHistory(table, columns, column, serial, country, date = 'created_at') {
  const value = String(serial || '').trim()
  if (!value) return []
  const result = await fetchAllPages((from, to) => {
    let q = applyCountry(supabase.from(table).select(columns).eq(column, value), country)
    if (table === 'tyre_status_marks') q = q.order('serial').order('mark_type')
    else q = q.order(date, { ascending: false }).order('id')
    return q.range(from, to)
  }, { max: 20000 })
  if (result.truncated) throw new Error('This history exceeds the display limit.')
  return unwrap(result) || []
}
export function getServiceEvents(serial, { country } = {}) {
  return serialHistory('tyre_service_events', SERVICE_EVENT_COLS, 'tyre_serial', serial, country, 'event_date')
}
export function getWarrantyClaims(serial, { country } = {}) {
  return serialHistory('warranty_claims', WARRANTY_COLS, 'serial_number', serial, country)
}
export function getStatusMarks(serial) {
  return serialHistory('tyre_status_marks', 'serial,mark_type', 'serial', serial)
}
export function getRetreadClaims(serial, { country } = {}) {
  return serialHistory('retread_claims', RETREAD_COLS, 'tyre_serial', serial, country)
}

/**
 * Fetch the full passport bundle for a serial in parallel. Records are
 * authoritative (their failure propagates); every auxiliary source is
 * best-effort and resolves to [] on any failure so one missing/blocked table
 * never blanks the passport.
 * @returns {Promise<{records:object[], serviceEvents:object[], warrantyClaims:object[], statusMarks:object[], retreadClaims:object[]}>}
 */
export async function getPassportBundle(serial, { country } = {}) {
  const records = await getPassportRecords(serial, { country })
  const sources = [
    ['serviceEvents', 'Service and repair history', () => getServiceEvents(serial, { country })],
    ['warrantyClaims', 'Warranty claims', () => getWarrantyClaims(serial, { country })],
    ['statusMarks', 'Tyre status marks', () => getStatusMarks(serial)],
    ['retreadClaims', 'Retread claims', () => getRetreadClaims(serial, { country })],
  ]
  const settled = await Promise.allSettled(sources.map(([, , load]) => load()))
  const bundle = { records, unavailableSources: [] }
  settled.forEach((result, i) => {
    const [key, label] = sources[i]
    bundle[key] = result.status === 'fulfilled' ? result.value : []
    if (result.status === 'rejected') bundle.unavailableSources.push(label)
  })
  return bundle
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
