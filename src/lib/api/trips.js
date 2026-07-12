/**
 * Trips service — the single seam between the Trip History page (/trips) and
 * Supabase (table `trips`, V164). Keeps an explicit column list (least-privilege
 * selects), null-safe country scoping, and input validation. RLS enforces org
 * isolation; this layer never trusts client input blindly.
 *
 * Mirrors odometerLogs.js / journeys.js. A missing `trips` relation (org has not
 * run the migration) degrades listing to an empty array so the page can render
 * its "apply the migration" empty state instead of erroring.
 */
import { supabase, unwrap, applyCountry } from './_client'
import { toFiniteNumber } from '../trips'

export const COLS =
  'id,organisation_id,country,asset_no,driver_name,origin,destination,' +
  'started_at,ended_at,distance_km,duration_min,max_speed_kmh,avg_speed_kmh,' +
  'idle_min,status,notes,created_by,created_at,updated_at'

const STATUSES = ['planned', 'in_progress', 'completed', 'cancelled']

/** True when the failure is "table does not exist yet" (pre-migration). */
function isMissingRelation(err) {
  const code = err?.code || err?.cause?.code
  const msg = String(err?.message || err?.cause?.message || '').toLowerCase()
  return (
    code === '42P01' || code === 'PGRST205' ||
    msg.includes('does not exist') ||
    msg.includes('could not find the table') ||
    msg.includes('schema cache') ||
    (msg.includes('relation') && msg.includes('trips'))
  )
}

const asText = (v, max) => (v == null || v === '' ? null : String(v).trim().slice(0, max))
const asDate = (v) => {
  if (!v) return null
  const d = new Date(v)
  return Number.isNaN(d.getTime()) ? null : d.toISOString()
}
const asStatus = (v) => {
  const s = v == null ? '' : String(v).trim().toLowerCase()
  return STATUSES.includes(s) ? s : null
}

/** Coerce a non-negative numeric, throwing on negatives; null when absent. */
function asNonNegative(v, label) {
  const n = toFiniteNumber(v)
  if (n == null) return null
  if (n < 0) throw new Error(`${label} cannot be negative.`)
  return n
}

/**
 * List trips (newest first by started_at, then created_at). Optional `country`
 * filter. Returns [] when the table has not been provisioned yet.
 * @param {{ country?:string, limit?:number }} [opts]
 */
export async function listTrips({ country, limit = 500 } = {}) {
  try {
    let q = supabase.from('trips').select(COLS)
    q = applyCountry(q, country)
    return unwrap(
      await q
        .order('started_at', { ascending: false, nullsFirst: false })
        .order('created_at', { ascending: false })
        .limit(limit),
    ) || []
  } catch (err) {
    if (isMissingRelation(err)) return []
    throw err
  }
}

export async function getTrip(id) {
  return unwrap(await supabase.from('trips').select(COLS).eq('id', id).maybeSingle())
}

/**
 * Record a trip. Requires an asset number (which vehicle). All numeric metrics
 * are validated non-negative when present.
 */
export async function createTrip(values = {}) {
  const asset_no = asText(values.asset_no, 120)
  if (!asset_no) throw new Error('An asset number is required.')

  const payload = {
    asset_no,
    driver_name: asText(values.driver_name, 200),
    origin: asText(values.origin, 300),
    destination: asText(values.destination, 300),
    started_at: asDate(values.started_at),
    ended_at: asDate(values.ended_at),
    distance_km: asNonNegative(values.distance_km, 'Distance (km)'),
    duration_min: asNonNegative(values.duration_min, 'Duration (min)'),
    max_speed_kmh: asNonNegative(values.max_speed_kmh, 'Max speed (km/h)'),
    avg_speed_kmh: asNonNegative(values.avg_speed_kmh, 'Average speed (km/h)'),
    idle_min: asNonNegative(values.idle_min, 'Idle time (min)'),
    status: asStatus(values.status),
    notes: values.notes ? String(values.notes).slice(0, 8000) : null,
    country: values.country ?? null,
  }
  return unwrap(await supabase.from('trips').insert(payload).select(COLS).single())
}

/**
 * Patch a trip. Strips immutable/ownership fields; coerces each field present so
 * the stored value never drifts from the validated shape.
 */
export async function updateTrip(id, patch = {}) {
  const clean = {}
  if (patch.asset_no !== undefined) {
    const asset_no = asText(patch.asset_no, 120)
    if (!asset_no) throw new Error('An asset number is required.')
    clean.asset_no = asset_no
  }
  if (patch.driver_name !== undefined) clean.driver_name = asText(patch.driver_name, 200)
  if (patch.origin !== undefined) clean.origin = asText(patch.origin, 300)
  if (patch.destination !== undefined) clean.destination = asText(patch.destination, 300)
  if (patch.started_at !== undefined) clean.started_at = asDate(patch.started_at)
  if (patch.ended_at !== undefined) clean.ended_at = asDate(patch.ended_at)
  if (patch.distance_km !== undefined) clean.distance_km = asNonNegative(patch.distance_km, 'Distance (km)')
  if (patch.duration_min !== undefined) clean.duration_min = asNonNegative(patch.duration_min, 'Duration (min)')
  if (patch.max_speed_kmh !== undefined) clean.max_speed_kmh = asNonNegative(patch.max_speed_kmh, 'Max speed (km/h)')
  if (patch.avg_speed_kmh !== undefined) clean.avg_speed_kmh = asNonNegative(patch.avg_speed_kmh, 'Average speed (km/h)')
  if (patch.idle_min !== undefined) clean.idle_min = asNonNegative(patch.idle_min, 'Idle time (min)')
  if (patch.status !== undefined) clean.status = asStatus(patch.status)
  if (patch.notes !== undefined) clean.notes = patch.notes ? String(patch.notes).slice(0, 8000) : null
  if (patch.country !== undefined) clean.country = patch.country ?? null

  return unwrap(await supabase.from('trips').update(clean).eq('id', id).select(COLS).single())
}

export async function deleteTrip(id) {
  return unwrap(await supabase.from('trips').delete().eq('id', id))
}
