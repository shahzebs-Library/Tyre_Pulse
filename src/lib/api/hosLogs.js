/**
 * Hours of Service (ELD) service — the single seam between the Hours of Service
 * page (/hours-of-service) and Supabase (table `hos_logs`, V172). Keeps an
 * explicit column list (least-privilege selects), null-safe country scoping, and
 * input validation. RLS enforces org isolation; this layer never trusts client
 * input blindly.
 *
 * Mirrors odometerLogs.js. A missing `hos_logs` relation (org has not run the
 * migration) degrades listing to an empty array so the page can render its
 * "apply the migration" empty state instead of erroring.
 */
import { supabase, unwrap, applyCountry } from './_client'
import { toFiniteNumber } from '../hosLogs'

export const COLS =
  'id,organisation_id,country,driver_name,asset_no,log_date,duty_status,' +
  'start_time,end_time,duration_min,distance_km,location,remarks,violation,' +
  'violation_type,notes,created_by,created_at,updated_at'

const DUTY_STATUSES = new Set(['off_duty', 'sleeper', 'driving', 'on_duty'])

/** True when the failure is "table does not exist yet" (pre-migration). */
function isMissingRelation(err) {
  const code = err?.code || err?.cause?.code
  const msg = String(err?.message || err?.cause?.message || '').toLowerCase()
  return (
    code === '42P01' || code === 'PGRST205' ||
    msg.includes('does not exist') ||
    msg.includes('could not find the table') ||
    msg.includes('schema cache') ||
    (msg.includes('relation') && msg.includes('hos_logs'))
  )
}

const asText = (v, max) => (v == null || v === '' ? null : String(v).trim().slice(0, max))
const asDate = (v) => {
  if (!v) return null
  const d = new Date(v)
  return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10)
}
const asTimestamp = (v) => {
  if (!v) return null
  const d = new Date(v)
  return Number.isNaN(d.getTime()) ? null : d.toISOString()
}
const asDuty = (v) => {
  const s = v == null ? '' : String(v).trim().toLowerCase()
  return DUTY_STATUSES.has(s) ? s : null
}

/** Validate a non-negative numeric field; throws with a field-specific message. */
function nonNegative(value, label) {
  if (value === undefined || value === null || value === '') return null
  const n = toFiniteNumber(value)
  if (n == null) throw new Error(`${label} must be a number.`)
  if (n < 0) throw new Error(`${label} cannot be negative.`)
  return n
}

/**
 * List duty-status logs (newest first by log_date, then created_at). Optional
 * `country` filter. Returns [] when the table has not been provisioned yet.
 * @param {{ country?:string, limit?:number }} [opts]
 */
export async function listHosLogs({ country, limit = 500 } = {}) {
  try {
    let q = supabase.from('hos_logs').select(COLS)
    q = applyCountry(q, country)
    return unwrap(
      await q
        .order('log_date', { ascending: false, nullsFirst: false })
        .order('created_at', { ascending: false })
        .limit(limit),
    ) || []
  } catch (err) {
    if (isMissingRelation(err)) return []
    throw err
  }
}

export async function getHosLog(id) {
  return unwrap(await supabase.from('hos_logs').select(COLS).eq('id', id).maybeSingle())
}

/**
 * Log a duty-status record. Requires a driver name. Numeric fields
 * (duration_min, distance_km) must be non-negative when present. Log date
 * defaults to today when omitted.
 */
export async function createHosLog(values = {}) {
  const driver_name = asText(values.driver_name, 200)
  if (!driver_name) throw new Error('A driver name is required.')

  const duration_min = nonNegative(values.duration_min, 'Duration (min)')
  const distance_km = nonNegative(values.distance_km, 'Distance (km)')

  const payload = {
    driver_name,
    asset_no: asText(values.asset_no, 120),
    log_date: asDate(values.log_date) || new Date().toISOString().slice(0, 10),
    duty_status: asDuty(values.duty_status),
    start_time: asTimestamp(values.start_time),
    end_time: asTimestamp(values.end_time),
    duration_min,
    distance_km,
    location: asText(values.location, 200),
    remarks: values.remarks ? String(values.remarks).slice(0, 8000) : null,
    violation: values.violation === true || values.violation === 'true',
    violation_type: asText(values.violation_type, 200),
    notes: values.notes ? String(values.notes).slice(0, 8000) : null,
    country: values.country ?? null,
  }
  return unwrap(await supabase.from('hos_logs').insert(payload).select(COLS).single())
}

/**
 * Patch a duty-status record. Strips immutable/ownership fields; coerces each
 * field present so the stored value never drifts from the validated shape.
 */
export async function updateHosLog(id, patch = {}) {
  const clean = {}
  if (patch.driver_name !== undefined) {
    const driver_name = asText(patch.driver_name, 200)
    if (!driver_name) throw new Error('A driver name is required.')
    clean.driver_name = driver_name
  }
  if (patch.asset_no !== undefined) clean.asset_no = asText(patch.asset_no, 120)
  if (patch.log_date !== undefined) clean.log_date = asDate(patch.log_date)
  if (patch.duty_status !== undefined) clean.duty_status = asDuty(patch.duty_status)
  if (patch.start_time !== undefined) clean.start_time = asTimestamp(patch.start_time)
  if (patch.end_time !== undefined) clean.end_time = asTimestamp(patch.end_time)
  if (patch.duration_min !== undefined) clean.duration_min = nonNegative(patch.duration_min, 'Duration (min)')
  if (patch.distance_km !== undefined) clean.distance_km = nonNegative(patch.distance_km, 'Distance (km)')
  if (patch.location !== undefined) clean.location = asText(patch.location, 200)
  if (patch.remarks !== undefined) clean.remarks = patch.remarks ? String(patch.remarks).slice(0, 8000) : null
  if (patch.violation !== undefined) clean.violation = patch.violation === true || patch.violation === 'true'
  if (patch.violation_type !== undefined) clean.violation_type = asText(patch.violation_type, 200)
  if (patch.notes !== undefined) clean.notes = patch.notes ? String(patch.notes).slice(0, 8000) : null
  if (patch.country !== undefined) clean.country = patch.country ?? null

  return unwrap(await supabase.from('hos_logs').update(clean).eq('id', id).select(COLS).single())
}

export async function deleteHosLog(id) {
  return unwrap(await supabase.from('hos_logs').delete().eq('id', id))
}
