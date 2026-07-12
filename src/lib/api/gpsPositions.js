/**
 * GPS Positions service — the single seam between the GPS Tracking page
 * (/gps-tracking) and Supabase (table `gps_positions`, V171). Keeps an explicit
 * column list (least-privilege selects), null-safe country scoping, and input
 * validation. RLS enforces org isolation; this layer never trusts client input
 * blindly.
 *
 * Mirrors odometerLogs.js / coldChain.js. A missing `gps_positions` relation
 * (org has not run the migration) degrades listing to an empty array so the
 * page can render its "apply the migration" empty state instead of erroring.
 */
import { supabase, unwrap, applyCountry } from './_client'
import { toFiniteNumber } from '../gpsPositions'

export const COLS =
  'id,organisation_id,country,asset_no,driver_name,latitude,longitude,speed_kmh,' +
  'heading,altitude_m,ignition,odometer_km,recorded_at,address,notes,' +
  'created_by,created_at,updated_at'

/** True when the failure is "table does not exist yet" (pre-migration). */
function isMissingRelation(err) {
  const code = err?.code || err?.cause?.code
  const msg = String(err?.message || err?.cause?.message || '').toLowerCase()
  return (
    code === '42P01' || code === 'PGRST205' ||
    msg.includes('does not exist') ||
    msg.includes('could not find the table') ||
    msg.includes('schema cache') ||
    (msg.includes('relation') && msg.includes('gps_positions'))
  )
}

const asText = (v, max) => (v == null || v === '' ? null : String(v).trim().slice(0, max))
const asDate = (v) => {
  if (!v) return null
  const d = new Date(v)
  return Number.isNaN(d.getTime()) ? null : d.toISOString()
}

/** Coerce a truthy/loose value to a strict boolean, or null when unset. */
const asBool = (v) => {
  if (v === undefined || v === null || v === '') return null
  if (typeof v === 'boolean') return v
  const s = String(v).trim().toLowerCase()
  if (['true', '1', 'yes', 'on'].includes(s)) return true
  if (['false', '0', 'no', 'off'].includes(s)) return false
  return null
}

/** Validate latitude ∈ [-90, 90]; throws on out-of-range, returns null when absent. */
function validLatitude(v) {
  const n = toFiniteNumber(v)
  if (n == null) return null
  if (n < -90 || n > 90) throw new Error('Latitude must be between -90 and 90.')
  return n
}
/** Validate longitude ∈ [-180, 180]; throws on out-of-range, returns null when absent. */
function validLongitude(v) {
  const n = toFiniteNumber(v)
  if (n == null) return null
  if (n < -180 || n > 180) throw new Error('Longitude must be between -180 and 180.')
  return n
}
/** Validate a non-negative numeric (speed/odometer/altitude); throws when negative. */
function validNonNegative(v, label) {
  const n = toFiniteNumber(v)
  if (n == null) return null
  if (n < 0) throw new Error(`${label} cannot be negative.`)
  return n
}
/** Validate heading ∈ [0, 360); throws when out of range. */
function validHeading(v) {
  const n = toFiniteNumber(v)
  if (n == null) return null
  if (n < 0 || n > 360) throw new Error('Heading must be between 0 and 360 degrees.')
  return n
}

/**
 * List position pings (newest first by recorded_at, then created_at). Optional
 * `country` filter. Returns [] when the table has not been provisioned yet.
 * @param {{ country?:string, limit?:number }} [opts]
 */
export async function listGpsPositions({ country, limit = 500 } = {}) {
  try {
    let q = supabase.from('gps_positions').select(COLS)
    q = applyCountry(q, country)
    return unwrap(
      await q
        .order('recorded_at', { ascending: false, nullsFirst: false })
        .order('created_at', { ascending: false })
        .limit(limit),
    ) || []
  } catch (err) {
    if (isMissingRelation(err)) return []
    throw err
  }
}

export async function getGpsPosition(id) {
  return unwrap(await supabase.from('gps_positions').select(COLS).eq('id', id).maybeSingle())
}

/**
 * Record a position ping. Requires an asset number (which vehicle). Coordinates
 * are validated to their geographic ranges when provided; recorded_at defaults
 * to now when omitted.
 */
export async function createGpsPosition(values = {}) {
  const asset_no = asText(values.asset_no, 120)
  if (!asset_no) throw new Error('An asset number is required.')

  const payload = {
    asset_no,
    driver_name: asText(values.driver_name, 200),
    latitude: validLatitude(values.latitude),
    longitude: validLongitude(values.longitude),
    speed_kmh: validNonNegative(values.speed_kmh, 'Speed'),
    heading: validHeading(values.heading),
    altitude_m: toFiniteNumber(values.altitude_m),
    ignition: asBool(values.ignition),
    odometer_km: validNonNegative(values.odometer_km, 'Odometer reading'),
    recorded_at: asDate(values.recorded_at) || new Date().toISOString(),
    address: asText(values.address, 400),
    notes: values.notes ? String(values.notes).slice(0, 8000) : null,
    country: values.country ?? null,
  }
  return unwrap(await supabase.from('gps_positions').insert(payload).select(COLS).single())
}

/**
 * Patch a position ping. Strips immutable/ownership fields; coerces each field
 * present so the stored value never drifts from the validated shape.
 */
export async function updateGpsPosition(id, patch = {}) {
  const clean = {}
  if (patch.asset_no !== undefined) {
    const asset_no = asText(patch.asset_no, 120)
    if (!asset_no) throw new Error('An asset number is required.')
    clean.asset_no = asset_no
  }
  if (patch.driver_name !== undefined) clean.driver_name = asText(patch.driver_name, 200)
  if (patch.latitude !== undefined) clean.latitude = validLatitude(patch.latitude)
  if (patch.longitude !== undefined) clean.longitude = validLongitude(patch.longitude)
  if (patch.speed_kmh !== undefined) clean.speed_kmh = validNonNegative(patch.speed_kmh, 'Speed')
  if (patch.heading !== undefined) clean.heading = validHeading(patch.heading)
  if (patch.altitude_m !== undefined) clean.altitude_m = toFiniteNumber(patch.altitude_m)
  if (patch.ignition !== undefined) clean.ignition = asBool(patch.ignition)
  if (patch.odometer_km !== undefined) clean.odometer_km = validNonNegative(patch.odometer_km, 'Odometer reading')
  if (patch.recorded_at !== undefined) clean.recorded_at = asDate(patch.recorded_at)
  if (patch.address !== undefined) clean.address = asText(patch.address, 400)
  if (patch.notes !== undefined) clean.notes = patch.notes ? String(patch.notes).slice(0, 8000) : null
  if (patch.country !== undefined) clean.country = patch.country ?? null

  return unwrap(await supabase.from('gps_positions').update(clean).eq('id', id).select(COLS).single())
}

export async function deleteGpsPosition(id) {
  return unwrap(await supabase.from('gps_positions').delete().eq('id', id))
}
