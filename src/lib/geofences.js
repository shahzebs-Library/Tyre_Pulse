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
