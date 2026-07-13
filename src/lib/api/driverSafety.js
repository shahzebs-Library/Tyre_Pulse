/**
 * Driver Safety service — the single seam between the Driver Safety Events page
 * (/driver-safety) and Supabase (table `driver_safety_events`, V170). Keeps an
 * explicit column list (least-privilege selects), null-safe country scoping, and
 * input validation. RLS enforces org isolation; this layer never trusts client
 * input blindly.
 *
 * Mirrors odometerLogs.js. A missing `driver_safety_events` relation (org has
 * not run the migration) degrades listing to an empty array so the page can
 * render its "apply the migration" empty state instead of erroring.
 */
import { supabase, unwrap, applyCountry, fetchAllPages } from './_client'
import { toFiniteNumber } from '../driverSafety'

export const COLS =
  'id,organisation_id,country,asset_no,driver_name,event_type,severity,event_at,' +
  'location,speed_kmh,speed_limit_kmh,g_force,penalty_points,notes,' +
  'created_by,created_at,updated_at'

const EVENT_TYPES = new Set([
  'harsh_brake', 'harsh_accel', 'harsh_corner', 'speeding',
  'overspeed', 'idling', 'fatigue', 'other',
])
const SEVERITIES = new Set(['low', 'medium', 'high'])

/** True when the failure is "table does not exist yet" (pre-migration). */
function isMissingRelation(err) {
  const code = err?.code || err?.cause?.code
  const msg = String(err?.message || err?.cause?.message || '').toLowerCase()
  return (
    code === '42P01' || code === 'PGRST205' ||
    msg.includes('does not exist') ||
    msg.includes('could not find the table') ||
    msg.includes('schema cache') ||
    (msg.includes('relation') && msg.includes('driver_safety_events'))
  )
}

const asText = (v, max) => (v == null || v === '' ? null : String(v).trim().slice(0, max))
const asEnum = (v, allowed) => {
  const s = v == null || v === '' ? null : String(v).trim().toLowerCase()
  return s && allowed.has(s) ? s : null
}
const asTimestamp = (v) => {
  if (!v) return null
  const d = new Date(v)
  return Number.isNaN(d.getTime()) ? null : d.toISOString()
}
/** Coerce a non-negative numeric value; throws with `label` when invalid/negative. */
const asNonNegative = (v, label) => {
  if (v == null || v === '') return null
  const n = toFiniteNumber(v)
  if (n == null) throw new Error(`${label} must be a number.`)
  if (n < 0) throw new Error(`${label} cannot be negative.`)
  return n
}

/**
 * List events (newest first by event_at, then created_at). Optional `country`
 * filter. Returns [] when the table has not been provisioned yet.
 * @param {{ country?:string, limit?:number }} [opts]
 */
export async function listDriverSafetyEvents({ country, limit = 500 } = {}) {
  try {
    let q = supabase.from('driver_safety_events').select(COLS)
    q = applyCountry(q, country)
    return unwrap(
      await q
        .order('event_at', { ascending: false, nullsFirst: false })
        .order('created_at', { ascending: false })
        .limit(limit),
    ) || []
  } catch (err) {
    if (isMissingRelation(err)) return []
    throw err
  }
}

export async function getDriverSafetyEvent(id) {
  return unwrap(await supabase.from('driver_safety_events').select(COLS).eq('id', id).maybeSingle())
}

/**
 * Record a driver-safety event. Requires an asset number (which vehicle);
 * numeric fields are validated non-negative. event_at defaults to now when
 * omitted.
 */
export async function createDriverSafetyEvent(values = {}) {
  const asset_no = asText(values.asset_no, 120)
  if (!asset_no) throw new Error('An asset number is required.')

  const payload = {
    asset_no,
    driver_name: asText(values.driver_name, 200),
    event_type: asEnum(values.event_type, EVENT_TYPES),
    severity: asEnum(values.severity, SEVERITIES),
    event_at: asTimestamp(values.event_at) || new Date().toISOString(),
    location: asText(values.location, 300),
    speed_kmh: asNonNegative(values.speed_kmh, 'Speed (km/h)'),
    speed_limit_kmh: asNonNegative(values.speed_limit_kmh, 'Speed limit (km/h)'),
    g_force: asNonNegative(values.g_force, 'G-force'),
    penalty_points: asNonNegative(values.penalty_points, 'Penalty points'),
    notes: values.notes ? String(values.notes).slice(0, 8000) : null,
    country: values.country ?? null,
  }
  return unwrap(await supabase.from('driver_safety_events').insert(payload).select(COLS).single())
}

/**
 * Patch an event. Strips immutable/ownership fields; coerces each field present
 * so the stored value never drifts from the validated shape.
 */
export async function updateDriverSafetyEvent(id, patch = {}) {
  const clean = {}
  if (patch.asset_no !== undefined) {
    const asset_no = asText(patch.asset_no, 120)
    if (!asset_no) throw new Error('An asset number is required.')
    clean.asset_no = asset_no
  }
  if (patch.driver_name !== undefined) clean.driver_name = asText(patch.driver_name, 200)
  if (patch.event_type !== undefined) clean.event_type = asEnum(patch.event_type, EVENT_TYPES)
  if (patch.severity !== undefined) clean.severity = asEnum(patch.severity, SEVERITIES)
  if (patch.event_at !== undefined) clean.event_at = asTimestamp(patch.event_at)
  if (patch.location !== undefined) clean.location = asText(patch.location, 300)
  if (patch.speed_kmh !== undefined) clean.speed_kmh = asNonNegative(patch.speed_kmh, 'Speed (km/h)')
  if (patch.speed_limit_kmh !== undefined) clean.speed_limit_kmh = asNonNegative(patch.speed_limit_kmh, 'Speed limit (km/h)')
  if (patch.g_force !== undefined) clean.g_force = asNonNegative(patch.g_force, 'G-force')
  if (patch.penalty_points !== undefined) clean.penalty_points = asNonNegative(patch.penalty_points, 'Penalty points')
  if (patch.notes !== undefined) clean.notes = patch.notes ? String(patch.notes).slice(0, 8000) : null
  if (patch.country !== undefined) clean.country = patch.country ?? null

  return unwrap(await supabase.from('driver_safety_events').update(clean).eq('id', id).select(COLS).single())
}

export async function deleteDriverSafetyEvent(id) {
  return unwrap(await supabase.from('driver_safety_events').delete().eq('id', id))
}

/* ── Cross-table reads for the deepened engine ──────────────────────────────
 * The Scorecards / Tyre-correlation tabs correlate driver_safety_events with
 * tyre_records (damage + CPK) and trips (utilisation). Both readers page the
 * full set, are country-scoped, request only the columns the pure engine needs,
 * and degrade to [] when the source table has not been provisioned. */

/** Columns tyre_records exposes for driver ↔ tyre-damage correlation. */
export const TYRE_CORRELATION_COLS =
  'id,country,driver_name,reason_for_removal,removal_reason,removal_date,' +
  'km_at_fitment,km_at_removal,cost_per_tyre,total_km'

/** Columns the trips table exposes for driver utilisation. */
export const TRIP_UTILISATION_COLS =
  'id,country,driver_name,distance_km,idle_min,max_speed_kmh'

/**
 * Tyre records that carry a driver_name, for the tyre-correlation engine.
 * Country-scoped; paged in full. Returns [] when `tyre_records` is absent.
 * @param {{ country?:string }} [opts]
 */
export async function listDriverTyreRecords({ country } = {}) {
  const { data, error } = await fetchAllPages((from, to) => {
    const q = supabase.from('tyre_records').select(TYRE_CORRELATION_COLS)
      .not('driver_name', 'is', null)
      .order('id', { ascending: true })
      .range(from, to)
    return applyCountry(q, country)
  })
  if (error) {
    if (isMissingRelation(error)) return []
    throw error
  }
  return data || []
}

/**
 * Trips that carry a driver_name, for utilisation (km) in the composite band.
 * Country-scoped; paged in full. Returns [] when `trips` is absent.
 * @param {{ country?:string }} [opts]
 */
export async function listDriverTrips({ country } = {}) {
  const { data, error } = await fetchAllPages((from, to) => {
    const q = supabase.from('trips').select(TRIP_UTILISATION_COLS)
      .not('driver_name', 'is', null)
      .order('id', { ascending: true })
      .range(from, to)
    return applyCountry(q, country)
  })
  if (error) {
    if (isMissingRelation(error)) return []
    throw error
  }
  return data || []
}
