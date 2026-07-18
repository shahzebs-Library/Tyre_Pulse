/**
 * Tyre Passport service. Fetches the data that makes up one physical tyre's
 * whole-life record, plus a serial search for the lookup box. The primary
 * source is `tyre_records` (fitment / movement history). Four auxiliary sources
 * enrich the passport, each fetched with an explicit column list, null-safe
 * country scoping, and honest [] degradation when the relation is absent or the
 * query fails (a missing/blocked source never breaks the page):
 *   - tyre_service_events (rotations / repairs / inflation / inspections)
 *   - warranty_claims (warranty and quality claims for this serial)
 *   - tyre_status_marks (return / write-off marks)
 *   - retread_claims (retread vendor claims)
 * The passport assembly lives in `src/lib/tyrePassport.js`.
 */
import { supabase, applyCountry, fetchAllPages } from './_client'
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

/** True when the error means the relation is absent / not migrated / not visible. */
function isMissingRelation(err) {
  const m = String(err?.message || '').toLowerCase()
  const code = String(err?.code || '')
  return (
    code === '42P01' ||
    m.includes('does not exist') ||
    m.includes('could not find the table') ||
    m.includes('schema cache') ||
    m.includes('relation')
  )
}

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
 * Tyre service events for this serial (newest first). []-degrades when the
 * table is absent so the passport still renders.
 */
export async function getServiceEvents(serial, { country } = {}) {
  const s = sanitizeSearchTerm(String(serial || '').trim())
  if (!s) return []
  try {
    let q = supabase.from('tyre_service_events').select(SERVICE_EVENT_COLS).eq('tyre_serial', s)
    q = applyCountry(q, country)
    const { data, error } = await q
      .order('event_date', { ascending: false, nullsFirst: false })
      .order('created_at', { ascending: false })
      .limit(500)
    if (error) throw error
    return data || []
  } catch (err) {
    if (isMissingRelation(err)) return []
    throw err
  }
}

/**
 * Warranty claims for this serial (matched on serial_number). Newest first,
 * []-degrades when absent.
 */
export async function getWarrantyClaims(serial, { country } = {}) {
  const s = sanitizeSearchTerm(String(serial || '').trim())
  if (!s) return []
  try {
    let q = supabase.from('warranty_claims').select(WARRANTY_COLS).eq('serial_number', s)
    q = applyCountry(q, country)
    const { data, error } = await q.order('created_at', { ascending: false }).limit(200)
    if (error) throw error
    return data || []
  } catch (err) {
    if (isMissingRelation(err)) return []
    throw err
  }
}

/**
 * Return / write-off marks for this serial. []-degrades when absent.
 */
export async function getStatusMarks(serial) {
  const s = sanitizeSearchTerm(String(serial || '').trim())
  if (!s) return []
  try {
    const { data, error } = await supabase
      .from('tyre_status_marks')
      .select('serial,mark_type')
      .eq('serial', s)
      .limit(50)
    if (error) throw error
    return data || []
  } catch (err) {
    if (isMissingRelation(err)) return []
    throw err
  }
}

/**
 * Retread vendor claims for this serial (matched on tyre_serial). Newest first,
 * []-degrades when absent.
 */
export async function getRetreadClaims(serial, { country } = {}) {
  const s = sanitizeSearchTerm(String(serial || '').trim())
  if (!s) return []
  try {
    let q = supabase.from('retread_claims').select(RETREAD_COLS).eq('tyre_serial', s)
    q = applyCountry(q, country)
    const { data, error } = await q.order('created_at', { ascending: false }).limit(200)
    if (error) throw error
    return data || []
  } catch (err) {
    if (isMissingRelation(err)) return []
    throw err
  }
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
  const [serviceEvents, warrantyClaims, statusMarks, retreadClaims] = await Promise.all([
    getServiceEvents(serial, { country }).catch(() => []),
    getWarrantyClaims(serial, { country }).catch(() => []),
    getStatusMarks(serial).catch(() => []),
    getRetreadClaims(serial, { country }).catch(() => []),
  ])
  return { records, serviceEvents, warrantyClaims, statusMarks, retreadClaims }
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
