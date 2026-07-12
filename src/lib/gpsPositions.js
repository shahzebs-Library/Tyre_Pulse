/**
 * GPS Positions — pure, dependency-free domain logic for the GPS Tracking
 * module (/gps-tracking). Reduces a set of position pings into per-asset latest
 * fixes, great-circle distances, and a fleet-level movement KPI summary.
 *
 * Keeping this here (no Supabase, no React) makes it deterministic and
 * unit-tested; the service (`src/lib/api/gpsPositions.js`) and page
 * (`src/pages/GpsTracking.jsx`) both build on these primitives so the roll-up
 * logic lives in exactly one place.
 */

/** Parse a value to a finite number, or null when it isn't numeric. */
export function toFiniteNumber(v) {
  if (v === '' || v == null) return null
  const n = typeof v === 'number' ? v : parseFloat(String(v).replace(/[^0-9.\-]/g, ''))
  return Number.isFinite(n) ? n : null
}

const EARTH_RADIUS_KM = 6371.0088
const toRad = (deg) => (deg * Math.PI) / 180

/**
 * Great-circle (haversine) distance in kilometres between two points shaped
 * `{ latitude, longitude }`. Returns 0 when either coordinate is missing or
 * non-numeric so a partial ping never produces NaN in downstream sums.
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

/** Sortable ordinal for a ping: prefer recorded_at, fall back to created_at. */
function pingTime(r) {
  const d = r?.recorded_at || r?.created_at
  if (!d) return 0
  const t = new Date(d).getTime()
  return Number.isNaN(t) ? 0 : t
}

/**
 * Latest ping per asset. For each distinct `asset_no`, keeps the row with the
 * most recent recorded_at (created_at as tiebreaker/fallback). Rows without an
 * asset number are ignored. Returns an array (unsorted).
 *
 * @param {Array<object>} rows
 * @returns {Array<object>}
 */
export function latestPerAsset(rows = []) {
  const list = Array.isArray(rows) ? rows : []
  const byAsset = new Map()
  for (const r of list) {
    const asset = r?.asset_no != null ? String(r.asset_no).trim() : ''
    if (!asset) continue
    const prev = byAsset.get(asset)
    if (!prev) { byAsset.set(asset, r); continue }
    if (pingTime(r) > pingTime(prev)) byAsset.set(asset, r)
  }
  return [...byAsset.values()]
}

/**
 * Summarise a set of position pings for the KPI header:
 *   • totalPings     — number of rows
 *   • distinctAssets — count of distinct asset numbers
 *   • movingCount    — distinct assets whose latest ping has speed_kmh > 0
 *   • idleCount      — distinct assets whose latest ping is ignition on & speed 0
 *   • maxSpeedKmh    — single largest speed across all rows
 *
 * Moving/idle are evaluated on the latest ping per asset so the counts reflect
 * "now", not the whole history.
 *
 * @param {Array<object>} rows
 * @returns {{ totalPings:number, distinctAssets:number, movingCount:number,
 *             idleCount:number, maxSpeedKmh:number|null }}
 */
export function summarisePositions(rows = []) {
  const list = Array.isArray(rows) ? rows : []
  const assets = new Set()
  let maxSpeedKmh = null

  for (const r of list) {
    const asset = r?.asset_no != null ? String(r.asset_no).trim() : ''
    if (asset) assets.add(asset)
    const spd = toFiniteNumber(r?.speed_kmh)
    if (spd != null && (maxSpeedKmh == null || spd > maxSpeedKmh)) maxSpeedKmh = spd
  }

  let movingCount = 0
  let idleCount = 0
  for (const r of latestPerAsset(list)) {
    const spd = toFiniteNumber(r?.speed_kmh) ?? 0
    if (spd > 0) { movingCount += 1; continue }
    if (r?.ignition === true && spd === 0) idleCount += 1
  }

  return {
    totalPings: list.length,
    distinctAssets: assets.size,
    movingCount,
    idleCount,
    maxSpeedKmh,
  }
}
