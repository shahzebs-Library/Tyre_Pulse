/**
 * Tachograph Records service — the single seam between the Tachograph Records
 * page (/tachograph) and Supabase (table `tachograph_records`, V183). Keeps an
 * explicit column list (least-privilege selects), null-safe country scoping, and
 * input validation. RLS enforces org isolation; this layer never trusts client
 * input blindly.
 *
 * Mirrors odometerLogs.js. A missing `tachograph_records` relation (org has not
 * run the migration) degrades listing to an empty array so the page can render
 * its "apply the migration" empty state instead of erroring.
 */
import { supabase, unwrap, applyCountry } from './_client'
import { toFiniteNumber } from '../tachographRecords'

export const COLS =
  'id,organisation_id,country,driver_name,asset_no,card_number,record_date,' +
  'download_type,driving_min,rest_min,work_min,available_min,distance_km,' +
  'infringement_count,infringement_types,status,notes,created_by,created_at,updated_at'

const DOWNLOAD_TYPES = new Set(['driver_card', 'vehicle_unit'])
const STATUSES = new Set(['downloaded', 'reviewed', 'flagged', 'archived'])

/** True when the failure is "table does not exist yet" (pre-migration). */
function isMissingRelation(err) {
  const code = err?.code || err?.cause?.code
  const msg = String(err?.message || err?.cause?.message || '').toLowerCase()
  return (
    code === '42P01' || code === 'PGRST205' ||
    msg.includes('does not exist') ||
    msg.includes('could not find the table') ||
    msg.includes('schema cache') ||
    (msg.includes('relation') && msg.includes('tachograph_records'))
  )
}

const asText = (v, max) => (v == null || v === '' ? null : String(v).trim().slice(0, max))
const asDate = (v) => {
  if (!v) return null
  const d = new Date(v)
  return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10)
}
const asEnum = (v, allowed, field) => {
  if (v == null || v === '') return null
  const s = String(v).trim()
  if (!allowed.has(s)) throw new Error(`Invalid ${field}: ${s}`)
  return s
}
/** Non-negative numeric coercion; throws when present but negative. */
const asNonNegNum = (v, field) => {
  const n = toFiniteNumber(v)
  if (n == null) return null
  if (n < 0) throw new Error(`${field} cannot be negative.`)
  return n
}
const asNonNegInt = (v, field) => {
  const n = asNonNegNum(v, field)
  return n == null ? null : Math.round(n)
}
/** Store an array/object as-is (JSONB); anything else becomes null. */
const asJson = (v) => {
  if (v == null || v === '') return null
  if (Array.isArray(v) || typeof v === 'object') return v
  return null
}

/**
 * List records (newest first by record_date, then created_at). Optional
 * `country` filter. Returns [] when the table has not been provisioned yet.
 * @param {{ country?:string, limit?:number }} [opts]
 */
export async function listTachographRecords({ country, limit = 500 } = {}) {
  try {
    let q = supabase.from('tachograph_records').select(COLS)
    q = applyCountry(q, country)
    return unwrap(
      await q
        .order('record_date', { ascending: false, nullsFirst: false })
        .order('created_at', { ascending: false })
        .limit(limit),
    ) || []
  } catch (err) {
    if (isMissingRelation(err)) return []
    throw err
  }
}

export async function getTachographRecord(id) {
  return unwrap(await supabase.from('tachograph_records').select(COLS).eq('id', id).maybeSingle())
}

/**
 * Record a tachograph download. Requires a driver name. Minute/distance/count
 * fields are validated non-negative; download_type and status are whitelisted;
 * infringement_types is stored as an array/object as-is (or null).
 */
export async function createTachographRecord(values = {}) {
  const driver_name = asText(values.driver_name, 200)
  if (!driver_name) throw new Error('A driver name is required.')

  const payload = {
    driver_name,
    asset_no: asText(values.asset_no, 120),
    card_number: asText(values.card_number, 120),
    record_date: asDate(values.record_date) || new Date().toISOString().slice(0, 10),
    download_type: asEnum(values.download_type, DOWNLOAD_TYPES, 'download type'),
    driving_min: asNonNegNum(values.driving_min, 'Driving minutes'),
    rest_min: asNonNegNum(values.rest_min, 'Rest minutes'),
    work_min: asNonNegNum(values.work_min, 'Work minutes'),
    available_min: asNonNegNum(values.available_min, 'Available minutes'),
    distance_km: asNonNegNum(values.distance_km, 'Distance (km)'),
    infringement_count: asNonNegInt(values.infringement_count, 'Infringement count'),
    infringement_types: asJson(values.infringement_types),
    status: asEnum(values.status, STATUSES, 'status'),
    notes: values.notes ? String(values.notes).slice(0, 8000) : null,
    country: values.country ?? null,
  }
  return unwrap(await supabase.from('tachograph_records').insert(payload).select(COLS).single())
}

/**
 * Patch a record. Strips immutable/ownership fields; coerces each field present
 * so the stored value never drifts from the validated shape.
 */
export async function updateTachographRecord(id, patch = {}) {
  const clean = {}
  if (patch.driver_name !== undefined) {
    const driver_name = asText(patch.driver_name, 200)
    if (!driver_name) throw new Error('A driver name is required.')
    clean.driver_name = driver_name
  }
  if (patch.asset_no !== undefined) clean.asset_no = asText(patch.asset_no, 120)
  if (patch.card_number !== undefined) clean.card_number = asText(patch.card_number, 120)
  if (patch.record_date !== undefined) clean.record_date = asDate(patch.record_date)
  if (patch.download_type !== undefined) clean.download_type = asEnum(patch.download_type, DOWNLOAD_TYPES, 'download type')
  if (patch.driving_min !== undefined) clean.driving_min = asNonNegNum(patch.driving_min, 'Driving minutes')
  if (patch.rest_min !== undefined) clean.rest_min = asNonNegNum(patch.rest_min, 'Rest minutes')
  if (patch.work_min !== undefined) clean.work_min = asNonNegNum(patch.work_min, 'Work minutes')
  if (patch.available_min !== undefined) clean.available_min = asNonNegNum(patch.available_min, 'Available minutes')
  if (patch.distance_km !== undefined) clean.distance_km = asNonNegNum(patch.distance_km, 'Distance (km)')
  if (patch.infringement_count !== undefined) clean.infringement_count = asNonNegInt(patch.infringement_count, 'Infringement count')
  if (patch.infringement_types !== undefined) clean.infringement_types = asJson(patch.infringement_types)
  if (patch.status !== undefined) clean.status = asEnum(patch.status, STATUSES, 'status')
  if (patch.notes !== undefined) clean.notes = patch.notes ? String(patch.notes).slice(0, 8000) : null
  if (patch.country !== undefined) clean.country = patch.country ?? null

  return unwrap(await supabase.from('tachograph_records').update(clean).eq('id', id).select(COLS).single())
}

export async function deleteTachographRecord(id) {
  return unwrap(await supabase.from('tachograph_records').delete().eq('id', id))
}
