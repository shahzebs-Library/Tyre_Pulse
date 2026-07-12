/**
 * Trip Replay — pure, dependency-free domain logic for the Trip Replay module
 * (/trip-replay). Reconstructs and analyses a single trip from its ordered GPS
 * breadcrumb segments: great-circle distance travelled, stop/idle count, harsh
 * driving events, and a speed profile over the path.
 *
 * Keeping this here (no Supabase, no React) makes it deterministic and
 * unit-tested; the service (`src/lib/api/tripReplay.js`) and page
 * (`src/pages/TripReplay.jsx`) both build on these primitives so the analytic
 * logic lives in exactly one place. The haversine formula mirrors
 * `src/lib/gpsPositions.js` exactly so distances agree across modules.
 */

/** Parse a value to a finite number, or null when it isn't numeric. */
export function toFiniteNumber(v) {
  if (v === '' || v == null) return null
  const n = typeof v === 'number' ? v : parseFloat(String(v).replace(/[^0-9.\-]/g, ''))
  return Number.isFinite(n) ? n : null
}

const EARTH_RADIUS_KM = 6371.0088
const toRad = (deg) => (deg * Math.PI) / 180

/** Harsh-driving / speeding event types (excludes move / stop / idle / none). */
export const HARSH_EVENTS = Object.freeze([
  'harsh_brake', 'harsh_accel', 'harsh_corner', 'speeding',
])

/** All recognised event_type values (whitelist for the DB CHECK constraint). */
export const EVENT_TYPES = Object.freeze([
  'move', 'stop', 'idle', 'harsh_brake', 'harsh_accel', 'harsh_corner',
  'speeding', 'none',
])

/**
 * Great-circle (haversine) distance in kilometres between two points shaped
 * `{ latitude, longitude }`. Returns 0 when either coordinate is missing or
 * non-numeric so a partial breadcrumb never produces NaN in downstream sums.
 * Formula mirrors `gpsPositions.haversineKm` exactly.
 *
 * @param {{latitude:number|string, longitude:number|string}} a
 * @param {{latitude:number|string, longitude:number|string}} b
 * @returns {number} distance in km (>= 0)
 */
export function haversineKm(a, b) {
  const lat1 = toFiniteNumber(a?.latitude)
  const lon1 = toFiniteNumber(a?.longitude)
  const lat2 = toFiniteNumber(b?.latitude)
  const lon2 = toFiniteNumber(b?.longitude)
  if (lat1 == null || lon1 == null || lat2 == null || lon2 == null) return 0

  const dLat = toRad(lat2 - lat1)
  const dLon = toRad(lon2 - lon1)
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2
  const c = 2 * Math.atan2(Math.sqrt(s), Math.sqrt(1 - s))
  return EARTH_RADIUS_KM * c
}

/** Sortable ordinal for a breadcrumb's timestamp: recorded_at, else created_at. */
function segmentTime(r) {
  const d = r?.recorded_at || r?.created_at
  if (!d) return 0
  const t = new Date(d).getTime()
  return Number.isNaN(t) ? 0 : t
}

/**
 * Order a trip's breadcrumb segments into a deterministic path: primarily by
 * `sequence` (ascending), falling back to `recorded_at` when sequences tie or
 * are absent. Segments without a numeric sequence sort after those that have
 * one, then by time. Returns a new array (input is never mutated).
 *
 * @param {Array<object>} rows
 * @returns {Array<object>}
 */
export function orderSegments(rows = []) {
  const list = Array.isArray(rows) ? rows.slice() : []
  return list.sort((a, b) => {
    const sa = toFiniteNumber(a?.sequence)
    const sb = toFiniteNumber(b?.sequence)
    if (sa != null && sb != null && sa !== sb) return sa - sb
    if (sa != null && sb == null) return -1
    if (sa == null && sb != null) return 1
    const ta = segmentTime(a)
    const tb = segmentTime(b)
    return ta - tb
  })
}

/**
 * Total great-circle distance (km) along the ordered path — the sum of
 * haversine distances between consecutive ordered breadcrumbs. Returns 0 for
 * fewer than two points.
 *
 * @param {Array<object>} rows
 * @returns {number}
 */
export function pathDistanceKm(rows = []) {
  const ordered = orderSegments(rows)
  let total = 0
  for (let i = 1; i < ordered.length; i += 1) {
    total += haversineKm(ordered[i - 1], ordered[i])
  }
  return total
}

/**
 * Count segments per `event_type`. Returns an object keyed by every recognised
 * event type (each defaulting to 0) so callers can render a stable breakdown.
 * Unrecognised / missing event types are ignored (they contribute to nothing).
 *
 * @param {Array<object>} rows
 * @returns {Record<string, number>}
 */
export function countEvents(rows = []) {
  const list = Array.isArray(rows) ? rows : []
  const counts = {}
  for (const t of EVENT_TYPES) counts[t] = 0
  for (const r of list) {
    const t = r?.event_type
    if (t != null && Object.prototype.hasOwnProperty.call(counts, t)) {
      counts[t] += 1
    }
  }
  return counts
}

/**
 * Speed profile across the trip's breadcrumbs:
 *   • maxKmh        — largest speed_kmh across all segments (0 when none)
 *   • avgKmh        — mean speed_kmh across segments that carry a numeric speed
 *   • movingAvgKmh  — mean speed_kmh across segments moving (speed > 0)
 *
 * All values are >= 0. Segments without a numeric speed are excluded from the
 * averages (they neither raise nor lower the mean).
 *
 * @param {Array<object>} rows
 * @returns {{ maxKmh:number, avgKmh:number, movingAvgKmh:number }}
 */
export function speedProfile(rows = []) {
  const list = Array.isArray(rows) ? rows : []
  let maxKmh = 0
  let sum = 0
  let n = 0
  let movingSum = 0
  let movingN = 0
  for (const r of list) {
    const spd = toFiniteNumber(r?.speed_kmh)
    if (spd == null) continue
    if (spd > maxKmh) maxKmh = spd
    sum += spd
    n += 1
    if (spd > 0) { movingSum += spd; movingN += 1 }
  }
  return {
    maxKmh,
    avgKmh: n > 0 ? sum / n : 0,
    movingAvgKmh: movingN > 0 ? movingSum / movingN : 0,
  }
}

/**
 * Number of stop/idle segments in the trip (both count as the vehicle not
 * making progress). Useful as a proxy for the number of halts on the journey.
 *
 * @param {Array<object>} rows
 * @returns {number}
 */
export function stopCount(rows = []) {
  const list = Array.isArray(rows) ? rows : []
  let n = 0
  for (const r of list) {
    if (r?.event_type === 'stop' || r?.event_type === 'idle') n += 1
  }
  return n
}

/**
 * Summarise a trip for the KPI header:
 *   • segments     — number of breadcrumb rows
 *   • distanceKm   — total great-circle distance along the ordered path
 *   • stops        — count of stop/idle segments
 *   • harshEvents  — count of harsh_* + speeding segments
 *   • maxKmh       — peak speed across the trip
 *   • avgKmh       — mean speed across segments carrying a numeric speed
 *
 * Deterministic and pure — the same rows always yield the same summary.
 *
 * @param {Array<object>} rows
 * @returns {{ segments:number, distanceKm:number, stops:number,
 *             harshEvents:number, maxKmh:number, avgKmh:number }}
 */
export function summariseTrip(rows = []) {
  const list = Array.isArray(rows) ? rows : []
  const counts = countEvents(list)
  const harshEvents = HARSH_EVENTS.reduce((acc, t) => acc + (counts[t] || 0), 0)
  const { maxKmh, avgKmh } = speedProfile(list)
  return {
    segments: list.length,
    distanceKm: pathDistanceKm(list),
    stops: stopCount(list),
    harshEvents,
    maxKmh,
    avgKmh,
  }
}
