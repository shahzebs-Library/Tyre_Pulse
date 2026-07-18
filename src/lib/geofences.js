/**
 * Geofences — pure, dependency-free domain logic for the Geofencing module.
 *
 * Keeping validation and aggregation here (no Supabase, no React) makes them
 * unit-testable and reusable across the service layer, the page and any future
 * import pipeline. The service (`src/lib/api/geofences.js`) and page
 * (`src/pages/Geofencing.jsx`) both build on these primitives.
 */

/** Canonical zone types (mirrors the CHECK constraint in V133). */
export const ZONE_TYPES = ['site', 'restricted', 'service', 'custom']

export const ZONE_TYPE_META = {
  site: { label: 'Site', tint: 'text-sky-400' },
  restricted: { label: 'Restricted', tint: 'text-red-400' },
  service: { label: 'Service', tint: 'text-emerald-400' },
  custom: { label: 'Custom', tint: 'text-violet-400' },
}

/** Parse a value to a finite number, or null when it isn't numeric. */
export function toFiniteNumber(v) {
  if (v === '' || v == null) return null
  const n = typeof v === 'number' ? v : parseFloat(String(v).replace(/[^0-9.\-]/g, ''))
  return Number.isFinite(n) ? n : null
}

/**
 * Validate a geofence input. Returns a keyed map of error messages; an empty
 * object means the input is valid. Coordinates and radius are optional (a zone
 * may be catalogued before it is geolocated) but, when present, must be sane.
 */
export function validateGeofence(input = {}) {
  const errors = {}

  const name = String(input.name ?? '').trim()
  if (!name) errors.name = 'A zone name is required.'
  else if (name.length > 160) errors.name = 'Name must be 160 characters or fewer.'

  if (input.zone_type != null && input.zone_type !== '' && !ZONE_TYPES.includes(input.zone_type)) {
    errors.zone_type = `Zone type must be one of: ${ZONE_TYPES.join(', ')}.`
  }

  const hasLat = input.center_lat !== '' && input.center_lat != null
  const hasLng = input.center_lng !== '' && input.center_lng != null

  if (hasLat) {
    const lat = toFiniteNumber(input.center_lat)
    if (lat == null) errors.center_lat = 'Latitude must be a number.'
    else if (lat < -90 || lat > 90) errors.center_lat = 'Latitude must be between -90 and 90.'
  }
  if (hasLng) {
    const lng = toFiniteNumber(input.center_lng)
    if (lng == null) errors.center_lng = 'Longitude must be a number.'
    else if (lng < -180 || lng > 180) errors.center_lng = 'Longitude must be between -180 and 180.'
  }
  // Coordinates come as a pair — one without the other cannot place a zone.
  if (hasLat !== hasLng) {
    const missing = hasLat ? 'center_lng' : 'center_lat'
    errors[missing] = errors[missing] || 'Latitude and longitude must be provided together.'
  }

  if (input.radius_m !== '' && input.radius_m != null) {
    const r = toFiniteNumber(input.radius_m)
    if (r == null) errors.radius_m = 'Radius must be a number.'
    else if (r <= 0) errors.radius_m = 'Radius must be greater than zero.'
    else if (r > 1_000_000) errors.radius_m = 'Radius must be 1,000 km or less.'
  }

  return errors
}

/** True when `validateGeofence` finds no problems. */
export function isValidGeofence(input) {
  return Object.keys(validateGeofence(input)).length === 0
}

/**
 * Aggregate a set of geofence rows for the KPI header: counts by zone type,
 * active/inactive split, total zones and the total covered area (Σ π·r², in
 * square metres and square kilometres). Only positive radii of active-or-not
 * zones contribute area; missing radii are ignored.
 */
export function summarizeGeofences(rows = []) {
  const list = Array.isArray(rows) ? rows : []
  const byType = { site: 0, restricted: 0, service: 0, custom: 0 }
  let active = 0
  let inactive = 0
  let areaM2 = 0
  let geolocated = 0

  for (const r of list) {
    const type = ZONE_TYPES.includes(r?.zone_type) ? r.zone_type : 'custom'
    byType[type] += 1

    if (r?.active === false) inactive += 1
    else active += 1

    const radius = toFiniteNumber(r?.radius_m)
    const lat = toFiniteNumber(r?.center_lat)
    const lng = toFiniteNumber(r?.center_lng)
    if (lat != null && lng != null) geolocated += 1
    if (radius != null && radius > 0) {
      areaM2 += Math.PI * radius * radius
    }
  }

  const areaKm2 = areaM2 / 1_000_000

  return {
    total: list.length,
    active,
    inactive,
    geolocated,
    byType,
    areaM2,
    areaKm2: Math.round(areaKm2 * 100) / 100,
  }
}

// ── Geometry primitives ──────────────────────────────────────────────────────

/** Mean Earth radius in kilometres (spherical approximation). */
export const EARTH_RADIUS_KM = 6371.0088

const toRad = (deg) => (deg * Math.PI) / 180

/**
 * Great-circle (haversine) distance in kilometres between two lat/lng points.
 * Accepts finite degrees only; returns null when any coordinate is missing or
 * out of range, so callers get an honest "cannot measure" rather than NaN.
 */
export function haversineKm(lat1, lng1, lat2, lng2) {
  const a = toFiniteNumber(lat1)
  const b = toFiniteNumber(lng1)
  const c = toFiniteNumber(lat2)
  const d = toFiniteNumber(lng2)
  if (a == null || b == null || c == null || d == null) return null
  if (a < -90 || a > 90 || c < -90 || c > 90) return null
  if (b < -180 || b > 180 || d < -180 || d > 180) return null
  const dLat = toRad(c - a)
  const dLng = toRad(d - b)
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a)) * Math.cos(toRad(c)) * Math.sin(dLng / 2) ** 2
  const angle = 2 * Math.atan2(Math.sqrt(s), Math.sqrt(1 - s))
  return EARTH_RADIUS_KM * angle
}

/**
 * Circular coverage area of a single zone in square kilometres (pi * r^2).
 * `radiusM` is metres; returns null for a missing or non-positive radius.
 */
export function zoneAreaKm2(radiusM) {
  const r = toFiniteNumber(radiusM)
  if (r == null || r <= 0) return null
  return (Math.PI * r * r) / 1_000_000
}

/**
 * True when a row carries a usable centre coordinate pair (finite, in range).
 */
export function hasValidCenter(row) {
  const lat = toFiniteNumber(row?.center_lat)
  const lng = toFiniteNumber(row?.center_lng)
  if (lat == null || lng == null) return false
  return lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180
}

/**
 * Detect overlapping zone pairs. Two circles overlap when the distance between
 * their centres is less than the sum of their radii. Only geolocated zones with
 * a positive radius are considered. Returns pairs sorted by overlap (deepest
 * first), each with the centre distance (km) and overlap depth (metres and km).
 */
export function detectOverlaps(rows = []) {
  const list = (Array.isArray(rows) ? rows : []).filter(
    (r) => hasValidCenter(r) && toFiniteNumber(r?.radius_m) > 0,
  )
  const pairs = []
  for (let i = 0; i < list.length; i += 1) {
    for (let j = i + 1; j < list.length; j += 1) {
      const a = list[i]
      const b = list[j]
      const distKm = haversineKm(a.center_lat, a.center_lng, b.center_lat, b.center_lng)
      if (distKm == null) continue
      const distM = distKm * 1000
      const rA = toFiniteNumber(a.radius_m)
      const rB = toFiniteNumber(b.radius_m)
      const reach = rA + rB
      if (distM < reach) {
        const overlapM = reach - distM
        pairs.push({
          aId: a.id ?? null,
          bId: b.id ?? null,
          aName: a.name || 'Unnamed zone',
          bName: b.name || 'Unnamed zone',
          distanceKm: Math.round(distKm * 1000) / 1000,
          distanceM: Math.round(distM),
          overlapM: Math.round(overlapM),
          overlapKm: Math.round((overlapM / 1000) * 1000) / 1000,
          // True containment: the smaller circle sits fully inside the larger.
          contained: distM + Math.min(rA, rB) <= Math.max(rA, rB),
        })
      }
    }
  }
  return pairs.sort((x, y) => y.overlapM - x.overlapM)
}

/**
 * Nearest geolocated zone to an arbitrary point (by centre distance). Returns
 * `{ zone, distanceKm }` or null when there is no point / no located zone.
 */
export function nearestZone(point, rows = []) {
  const lat = toFiniteNumber(point?.lat ?? point?.center_lat)
  const lng = toFiniteNumber(point?.lng ?? point?.center_lng)
  if (lat == null || lng == null) return null
  let best = null
  for (const r of Array.isArray(rows) ? rows : []) {
    if (!hasValidCenter(r)) continue
    const d = haversineKm(lat, lng, r.center_lat, r.center_lng)
    if (d == null) continue
    if (!best || d < best.distanceKm) {
      best = { zone: r, distanceKm: Math.round(d * 1000) / 1000 }
    }
  }
  return best
}

/**
 * Data-quality audit: flag zones that cannot be placed or measured. Each entry
 * lists the concrete issues (missing/invalid coordinate, non-positive/missing
 * radius). Returns [] when every zone is clean.
 */
export function geofenceDataQuality(rows = []) {
  const flagged = []
  for (const r of Array.isArray(rows) ? rows : []) {
    const issues = []
    const lat = toFiniteNumber(r?.center_lat)
    const lng = toFiniteNumber(r?.center_lng)
    const hasLat = r?.center_lat !== '' && r?.center_lat != null
    const hasLng = r?.center_lng !== '' && r?.center_lng != null

    if (!hasLat && !hasLng) issues.push('No centre coordinate set')
    else if (hasLat !== hasLng) issues.push('Latitude and longitude must be set together')
    else {
      if (lat == null || lat < -90 || lat > 90) issues.push('Latitude out of range (-90 to 90)')
      if (lng == null || lng < -180 || lng > 180) issues.push('Longitude out of range (-180 to 180)')
    }

    const radius = toFiniteNumber(r?.radius_m)
    const hasRadius = r?.radius_m !== '' && r?.radius_m != null
    if (!hasRadius) issues.push('No radius set')
    else if (radius == null) issues.push('Radius is not a number')
    else if (radius <= 0) issues.push('Radius must be greater than zero')

    if (issues.length) {
      flagged.push({
        id: r?.id ?? null,
        name: r?.name || 'Unnamed zone',
        zone_type: ZONE_TYPES.includes(r?.zone_type) ? r.zone_type : 'custom',
        issues,
      })
    }
  }
  return flagged
}

/**
 * Rich coverage summary for the page: everything from `summarizeGeofences`
 * plus per-type covered area (km^2), average radius, the overlapping-pair set
 * (with a count) and the data-quality flag set (with a count). Pure, so the
 * page and any report can share one computation.
 */
export function coverageSummary(rows = []) {
  const list = Array.isArray(rows) ? rows : []
  const base = summarizeGeofences(list)

  const areaByType = { site: 0, restricted: 0, service: 0, custom: 0 }
  let radiusSum = 0
  let radiusCount = 0
  for (const r of list) {
    const type = ZONE_TYPES.includes(r?.zone_type) ? r.zone_type : 'custom'
    const area = zoneAreaKm2(r?.radius_m)
    if (area != null) areaByType[type] += area
    const radius = toFiniteNumber(r?.radius_m)
    if (radius != null && radius > 0) {
      radiusSum += radius
      radiusCount += 1
    }
  }
  for (const k of ZONE_TYPES) areaByType[k] = Math.round(areaByType[k] * 100) / 100

  const overlaps = detectOverlaps(list)
  const flagged = geofenceDataQuality(list)

  return {
    ...base,
    areaByType,
    avgRadiusM: radiusCount ? Math.round(radiusSum / radiusCount) : 0,
    radiusCount,
    overlaps,
    overlapPairs: overlaps.length,
    flagged,
    flaggedCount: flagged.length,
  }
}
