/**
 * gpsTrackingAnalytics - pure engine behind the GPS Tracking page
 * (/gps-tracking). Builds on `src/lib/gpsPositions.js` (haversineKm,
 * latestPerAsset, summarisePositions, toFiniteNumber) and adds the per-asset
 * track roll-up, staleness, overspeed and coordinate-coverage figures the page
 * shows.
 *
 * No I/O, no React, no Date.now(): `now` is always injected.
 *
 * Honesty rules:
 *   - a distance is only reconstructed from two consecutive pings that BOTH
 *     carry coordinates; an asset with fewer than two such pings has distance
 *     null (N/A), not 0 km;
 *   - a leg implying more than MAX_PLAUSIBLE_KMH between pings is treated as a
 *     GPS glitch and left out of the distance, and counted so the page can say so;
 *   - "last seen" hours are null when the ping carries no timestamp.
 */
import { haversineKm, latestPerAsset, summarisePositions, toFiniteNumber } from './gpsPositions'

export const DEFAULT_STALE_HOURS = 24
export const DEFAULT_OVERSPEED_KMH = 120
export const OVERSPEED_OPTIONS = [80, 100, 120]
/** Implied speed between two pings above which the leg is treated as a GPS jump. */
export const MAX_PLAUSIBLE_KMH = 250

const HOUR_MS = 3_600_000

function toMs(v) {
  if (v instanceof Date) return v.getTime()
  if (typeof v === 'number') return Number.isFinite(v) ? v : null
  if (!v) return null
  const t = Date.parse(String(v))
  return Number.isFinite(t) ? t : null
}

export function pingTimeMs(r) {
  return toMs(r?.recorded_at) ?? toMs(r?.created_at)
}

export function hasCoords(r) {
  const lat = toFiniteNumber(r?.latitude)
  const lng = toFiniteNumber(r?.longitude)
  return lat != null && lng != null && Math.abs(lat) <= 90 && Math.abs(lng) <= 180
}

/** Motion state of a ping: moving | idle | stopped. */
export function motionOf(r) {
  const spd = toFiniteNumber(r?.speed_kmh) ?? 0
  if (spd > 0) return 'moving'
  if (r?.ignition === true) return 'idle'
  return 'stopped'
}

export const MOTION_LABEL = { moving: 'Moving', idle: 'Idle', stopped: 'Stopped' }

/**
 * Filter pings. All criteria optional.
 * @param {{ asset?:string, motion?:string, search?:string, fromMs?:number|null,
 *           overspeedOnly?:boolean, overspeedKmh?:number }} f
 */
export function filterPositions(rows, f = {}) {
  const list = Array.isArray(rows) ? rows : []
  const q = String(f.search || '').trim().toLowerCase()
  const limit = Number(f.overspeedKmh) || DEFAULT_OVERSPEED_KMH
  return list.filter((r) => {
    if (!r) return false
    if (f.asset && r.asset_no !== f.asset) return false
    if (f.motion && motionOf(r) !== f.motion) return false
    if (f.overspeedOnly && !((toFiniteNumber(r.speed_kmh) ?? 0) > limit)) return false
    if (f.fromMs != null) {
      const t = pingTimeMs(r)
      if (t == null || t < f.fromMs) return false
    }
    if (q) {
      const hay = [r.asset_no, r.driver_name, r.address, r.notes].filter(Boolean).join(' ').toLowerCase()
      if (!hay.includes(q)) return false
    }
    return true
  })
}

/**
 * Per-asset track summary over the given pings.
 * @param {Array} rows
 * @param {{ now:number|Date, staleHours?:number, overspeedKmh?:number }} opts
 */
export function assetTracks(rows, opts = {}) {
  const list = Array.isArray(rows) ? rows : []
  const now = toMs(opts.now)
  const staleHours = Number(opts.staleHours) || DEFAULT_STALE_HOURS
  const limit = Number(opts.overspeedKmh) || DEFAULT_OVERSPEED_KMH
  const groups = new Map()
  for (const r of list) {
    const asset = r?.asset_no != null ? String(r.asset_no).trim() : ''
    if (!asset) continue
    if (!groups.has(asset)) groups.set(asset, [])
    groups.get(asset).push(r)
  }
  const out = []
  for (const [asset, pings] of groups) {
    const ordered = pings
      .map((r) => ({ r, t: pingTimeMs(r) }))
      .sort((a, b) => (a.t ?? 0) - (b.t ?? 0))
    let distance = 0
    let legs = 0
    let glitches = 0
    let prev = null
    let maxSpeed = null
    let movingSum = 0
    let movingN = 0
    let overspeed = 0
    for (const { r, t } of ordered) {
      const spd = toFiniteNumber(r.speed_kmh)
      if (spd != null) {
        if (maxSpeed == null || spd > maxSpeed) maxSpeed = spd
        if (spd > 0) { movingSum += spd; movingN += 1 }
        if (spd > limit) overspeed += 1
      }
      if (!hasCoords(r)) continue
      if (prev) {
        const km = haversineKm(prev.r, r)
        const hours = t != null && prev.t != null ? (t - prev.t) / HOUR_MS : null
        if (hours != null && hours > 0 && km / hours > MAX_PLAUSIBLE_KMH) glitches += 1
        else { distance += km; legs += 1 }
      }
      prev = { r, t }
    }
    const last = ordered[ordered.length - 1]
    const lastMs = last?.t ?? null
    const lastSeenHours = lastMs != null && now != null ? Math.max(0, (now - lastMs) / HOUR_MS) : null
    out.push({
      asset_no: asset,
      driver_name: last?.r?.driver_name || null,
      pings: pings.length,
      firstSeenMs: ordered[0]?.t ?? null,
      lastSeenMs: lastMs,
      lastSeenHours: lastSeenHours == null ? null : Math.round(lastSeenHours * 10) / 10,
      stale: lastSeenHours == null ? null : lastSeenHours > staleHours,
      state: last ? motionOf(last.r) : 'stopped',
      lastSpeed: last ? toFiniteNumber(last.r.speed_kmh) : null,
      latitude: last ? toFiniteNumber(last.r.latitude) : null,
      longitude: last ? toFiniteNumber(last.r.longitude) : null,
      address: last?.r?.address || null,
      distanceKm: legs > 0 ? Math.round(distance * 10) / 10 : null,
      glitchLegs: glitches,
      maxSpeedKmh: maxSpeed,
      avgMovingSpeedKmh: movingN > 0 ? Math.round((movingSum / movingN) * 10) / 10 : null,
      overspeedPings: overspeed,
    })
  }
  return out.sort((a, b) => (b.lastSeenMs ?? -Infinity) - (a.lastSeenMs ?? -Infinity)
    || a.asset_no.localeCompare(b.asset_no))
}

/** KPI block for the header strip. */
export function gpsKpis(rows, opts = {}) {
  const list = Array.isArray(rows) ? rows : []
  const s = summarisePositions(list)
  const tracks = assetTracks(list, opts)
  const withCoords = list.filter(hasCoords).length
  const distances = tracks.map((t) => t.distanceKm).filter((d) => d != null)
  return {
    totalPings: s.totalPings,
    distinctAssets: s.distinctAssets,
    movingCount: s.movingCount,
    idleCount: s.idleCount,
    staleAssets: tracks.filter((t) => t.stale === true).length,
    maxSpeedKmh: s.maxSpeedKmh,
    overspeedPings: tracks.reduce((a, t) => a + t.overspeedPings, 0),
    distanceKm: distances.length ? Math.round(distances.reduce((a, b) => a + b, 0) * 10) / 10 : null,
    glitchLegs: tracks.reduce((a, t) => a + t.glitchLegs, 0),
    coordinateCoverage: list.length ? Math.round((withCoords / list.length) * 1000) / 10 : null,
  }
}

/** Latest-ping state mix for the snapshot bar. */
export function stateMix(rows) {
  const counts = { moving: 0, idle: 0, stopped: 0 }
  for (const r of latestPerAsset(Array.isArray(rows) ? rows : [])) counts[motionOf(r)] += 1
  return counts
}
