/**
 * Trip Replay service — the single seam between the Trip Replay page
 * (/trip-replay) and Supabase (table `trip_segments`, V191). Keeps an explicit
 * column list (least-privilege selects), null-safe country scoping, and strict
 * input validation. RLS enforces org isolation; this layer never trusts client
 * input blindly.
 *
 * Mirrors odometerLogs.js / gpsPositions.js. A missing `trip_segments` relation
 * (org has not run the migration) degrades listing to an empty array so the
 * page can render its "apply the migration" empty state instead of erroring.
 */
import { supabase, unwrap, applyCountry } from './_client'
import { toFiniteNumber, EVENT_TYPES } from '../tripReplay'

export const COLS =
  'id,organisation_id,country,trip_ref,asset_no,driver_name,sequence,latitude,' +
  'longitude,speed_kmh,heading,event_type,recorded_at,address,notes,created_by,' +
  'created_at,updated_at'

/** True when the failure is "table does not exist yet" (pre-migration). */
function isMissingRelation(err) {
  const code = err?.code || err?.cause?.code
  const msg = String(err?.message || err?.cause?.message || '').toLowerCase()
  return (
    code === '42P01' || code === 'PGRST205' ||
    msg.includes('does not exist') ||
    msg.includes('could not find the table') ||
    msg.includes('schema cache') ||
    (msg.includes('relation') && msg.includes('trip_segments'))
  )
}

const EVENT_SET = new Set(EVENT_TYPES)

const asText = (v, max) => (v == null || v === '' ? null : String(v).trim().slice(0, max))
const asTimestamp = (v) => {
  if (!v) return null
  const d = new Date(v)
  return Number.isNaN(d.getTime()) ? null : d.toISOString()
}

/** Validate a latitude in [-90, 90]; throws on non-numeric / out-of-range. */
function asLatitude(v) {
  if (v == null || v === '') return null
  const n = toFiniteNumber(v)
  if (n == null) throw new Error('Latitude must be numeric.')
  if (n < -90 || n > 90) throw new Error('Latitude must be between -90 and 90.')
  return n
}

/** Validate a longitude in [-180, 180]; throws on non-numeric / out-of-range. */
function asLongitude(v) {
  if (v == null || v === '') return null
  const n = toFiniteNumber(v)
  if (n == null) throw new Error('Longitude must be numeric.')
  if (n < -180 || n > 180) throw new Error('Longitude must be between -180 and 180.')
  return n
}

/** Validate a non-negative numeric field; throws when negative or non-numeric. */
function asNonNegative(v, label) {
  if (v == null || v === '') return null
  const n = toFiniteNumber(v)
  if (n == null) throw new Error(`${label} must be numeric.`)
  if (n < 0) throw new Error(`${label} cannot be negative.`)
  return n
}

/** Coerce a heading to [0, 360) degrees; null when absent. */
function asHeading(v) {
  if (v == null || v === '') return null
  const n = toFiniteNumber(v)
  if (n == null) throw new Error('Heading must be numeric.')
  return ((n % 360) + 360) % 360
}

/** Whitelist the event_type; null (unknown) when not one of the allowed values. */
function asEventType(v) {
  if (v == null || v === '') return null
  const s = String(v).trim()
  return EVENT_SET.has(s) ? s : null
}

const asSequence = (v) => {
  if (v == null || v === '') return null
  const n = toFiniteNumber(v)
  if (n == null) return null
  return Math.trunc(n)
}

/**
 * List trip breadcrumb segments, ordered for path reconstruction
 * (`sequence` asc, then `recorded_at` asc). When `tripRef` is provided, results
 * are filtered to that trip. Optional `country` filter. Returns [] when the
 * table has not been provisioned yet.
 *
 * @param {{ country?:string, tripRef?:string, limit?:number }} [opts]
 */
export async function listTripSegments({ country, tripRef, limit = 1000 } = {}) {
  try {
    let q = supabase.from('trip_segments').select(COLS)
    q = applyCountry(q, country)
    if (tripRef) q = q.eq('trip_ref', tripRef)
    return unwrap(
      await q
        .order('sequence', { ascending: true, nullsFirst: false })
        .order('recorded_at', { ascending: true, nullsFirst: false })
        .limit(limit),
    ) || []
  } catch (err) {
    if (isMissingRelation(err)) return []
    throw err
  }
}

/**
 * Distinct trip summaries (one entry per `trip_ref`) for the trip selector:
 * segment count, asset, driver, and the earliest/latest breadcrumb time. Built
 * client-side from a single scan so it stays consistent with listTripSegments.
 * Returns [] when the table has not been provisioned yet.
 *
 * @param {{ country?:string, limit?:number }} [opts]
 * @returns {Promise<Array<{ trip_ref:string, segments:number, asset_no:string|null,
 *   driver_name:string|null, firstAt:string|null, lastAt:string|null }>>}
 */
export async function listTripRefs({ country, limit = 5000 } = {}) {
  try {
    let q = supabase
      .from('trip_segments')
      .select('trip_ref,asset_no,driver_name,recorded_at,created_at')
    q = applyCountry(q, country)
    const rows = unwrap(await q.limit(limit)) || []
    const byTrip = new Map()
    for (const r of rows) {
      const ref = r?.trip_ref
      if (!ref) continue
      const at = r.recorded_at || r.created_at || null
      const prev = byTrip.get(ref)
      if (!prev) {
        byTrip.set(ref, {
          trip_ref: ref,
          segments: 1,
          asset_no: r.asset_no ?? null,
          driver_name: r.driver_name ?? null,
          firstAt: at,
          lastAt: at,
        })
        continue
      }
      prev.segments += 1
      if (!prev.asset_no && r.asset_no) prev.asset_no = r.asset_no
      if (!prev.driver_name && r.driver_name) prev.driver_name = r.driver_name
      if (at) {
        if (!prev.firstAt || at < prev.firstAt) prev.firstAt = at
        if (!prev.lastAt || at > prev.lastAt) prev.lastAt = at
      }
    }
    return [...byTrip.values()].sort((a, b) => {
      const ta = a.lastAt || ''
      const tb = b.lastAt || ''
      if (ta !== tb) return tb.localeCompare(ta)
      return String(a.trip_ref).localeCompare(String(b.trip_ref))
    })
  } catch (err) {
    if (isMissingRelation(err)) return []
    throw err
  }
}

export async function getTripSegment(id) {
  return unwrap(await supabase.from('trip_segments').select(COLS).eq('id', id).maybeSingle())
}

/**
 * Create a breadcrumb segment. Requires a trip reference (which trip this point
 * belongs to). Coordinates, speed, and heading are validated; event_type is
 * whitelisted against the recognised set.
 */
export async function createTripSegment(values = {}) {
  const trip_ref = asText(values.trip_ref, 200)
  if (!trip_ref) throw new Error('A trip reference is required.')

  const payload = {
    trip_ref,
    asset_no: asText(values.asset_no, 120),
    driver_name: asText(values.driver_name, 200),
    sequence: asSequence(values.sequence),
    latitude: asLatitude(values.latitude),
    longitude: asLongitude(values.longitude),
    speed_kmh: asNonNegative(values.speed_kmh, 'Speed (km/h)'),
    heading: asHeading(values.heading),
    event_type: asEventType(values.event_type),
    recorded_at: asTimestamp(values.recorded_at),
    address: asText(values.address, 500),
    notes: values.notes ? String(values.notes).slice(0, 8000) : null,
    country: values.country ?? null,
  }
  return unwrap(await supabase.from('trip_segments').insert(payload).select(COLS).single())
}

/**
 * Patch a breadcrumb segment. Strips immutable / ownership fields (id,
 * organisation_id, created_by, created_at, updated_at); coerces and validates
 * each field present so the stored value never drifts from the validated shape.
 */
export async function updateTripSegment(id, patch = {}) {
  const clean = {}
  if (patch.trip_ref !== undefined) {
    const trip_ref = asText(patch.trip_ref, 200)
    if (!trip_ref) throw new Error('A trip reference is required.')
    clean.trip_ref = trip_ref
  }
  if (patch.asset_no !== undefined) clean.asset_no = asText(patch.asset_no, 120)
  if (patch.driver_name !== undefined) clean.driver_name = asText(patch.driver_name, 200)
  if (patch.sequence !== undefined) clean.sequence = asSequence(patch.sequence)
  if (patch.latitude !== undefined) clean.latitude = asLatitude(patch.latitude)
  if (patch.longitude !== undefined) clean.longitude = asLongitude(patch.longitude)
  if (patch.speed_kmh !== undefined) clean.speed_kmh = asNonNegative(patch.speed_kmh, 'Speed (km/h)')
  if (patch.heading !== undefined) clean.heading = asHeading(patch.heading)
  if (patch.event_type !== undefined) clean.event_type = asEventType(patch.event_type)
  if (patch.recorded_at !== undefined) clean.recorded_at = asTimestamp(patch.recorded_at)
  if (patch.address !== undefined) clean.address = asText(patch.address, 500)
  if (patch.notes !== undefined) clean.notes = patch.notes ? String(patch.notes).slice(0, 8000) : null
  if (patch.country !== undefined) clean.country = patch.country ?? null

  return unwrap(await supabase.from('trip_segments').update(clean).eq('id', id).select(COLS).single())
}

export async function deleteTripSegment(id) {
  return unwrap(await supabase.from('trip_segments').delete().eq('id', id))
}
