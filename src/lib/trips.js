/**
 * Trips — pure, dependency-free domain logic for the Trip History / Trip Replay
 * module (/trips). Reduces a set of trip records into a fleet-level KPI summary
 * and per-asset roll-ups.
 *
 * Keeping this here (no Supabase, no React) makes it deterministic and
 * unit-tested; the service (`src/lib/api/trips.js`) and page
 * (`src/pages/Trips.jsx`) both build on these primitives so the roll-up logic
 * lives in exactly one place.
 */

/** Parse a value to a finite number, or null when it isn't numeric. */
export function toFiniteNumber(v) {
  if (v === '' || v == null) return null
  const n = typeof v === 'number' ? v : parseFloat(String(v).replace(/[^0-9.\-]/g, ''))
  return Number.isFinite(n) ? n : null
}

/** Normalise an asset number to a trimmed string ('' when absent). */
function assetKey(r) {
  return r?.asset_no != null ? String(r.asset_no).trim() : ''
}

/**
 * Summarise a set of trips for the KPI header:
 *   • totalTrips        — number of rows
 *   • totalDistanceKm   — sum of distance_km across all trips
 *   • totalDurationMin  — sum of duration_min across all trips
 *   • distinctAssets    — count of distinct asset numbers
 *   • avgSpeedKmh       — distance-weighted average speed (totalDistance / totalHours),
 *                         null when no usable distance/duration exists
 *   • completedCount    — trips with status 'completed'
 *   • activeCount       — trips with status 'in_progress'
 *
 * @param {Array<object>} rows
 * @returns {{ totalTrips:number, totalDistanceKm:number, totalDurationMin:number,
 *             distinctAssets:number, avgSpeedKmh:number|null,
 *             completedCount:number, activeCount:number }}
 */
export function summariseTrips(rows = []) {
  const list = Array.isArray(rows) ? rows : []
  const assets = new Set()
  let totalDistanceKm = 0
  let totalDurationMin = 0
  let completedCount = 0
  let activeCount = 0

  for (const r of list) {
    const asset = assetKey(r)
    if (asset) assets.add(asset)

    const dist = toFiniteNumber(r?.distance_km)
    if (dist != null && dist > 0) totalDistanceKm += dist

    const dur = toFiniteNumber(r?.duration_min)
    if (dur != null && dur > 0) totalDurationMin += dur

    const status = r?.status != null ? String(r.status).trim().toLowerCase() : ''
    if (status === 'completed') completedCount += 1
    else if (status === 'in_progress') activeCount += 1
  }

  const hours = totalDurationMin / 60
  const avgSpeedKmh = hours > 0 && totalDistanceKm > 0
    ? Math.round((totalDistanceKm / hours) * 10) / 10
    : null

  return {
    totalTrips: list.length,
    totalDistanceKm,
    totalDurationMin,
    distinctAssets: assets.size,
    avgSpeedKmh,
    completedCount,
    activeCount,
  }
}

/**
 * Per-asset totals across all trips: trip count, distance and duration summed by
 * asset. Rows without an asset number are ignored. Returns an array sorted by
 * distanceKm descending (ties broken by asset_no for determinism).
 *
 * @param {Array<object>} rows
 * @returns {Array<{ asset_no:string, trips:number, distanceKm:number, durationMin:number }>}
 */
export function perAssetTotals(rows = []) {
  const list = Array.isArray(rows) ? rows : []
  const byAsset = new Map()

  for (const r of list) {
    const asset = assetKey(r)
    if (!asset) continue
    const prev = byAsset.get(asset) || { asset_no: asset, trips: 0, distanceKm: 0, durationMin: 0 }
    prev.trips += 1
    const dist = toFiniteNumber(r?.distance_km)
    if (dist != null && dist > 0) prev.distanceKm += dist
    const dur = toFiniteNumber(r?.duration_min)
    if (dur != null && dur > 0) prev.durationMin += dur
    byAsset.set(asset, prev)
  }

  return [...byAsset.values()].sort(
    (a, b) => (b.distanceKm - a.distanceKm) || a.asset_no.localeCompare(b.asset_no),
  )
}
