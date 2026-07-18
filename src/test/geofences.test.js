import { describe, it, expect } from 'vitest'
import {
  validateGeofence, isValidGeofence, summarizeGeofences, toFiniteNumber, ZONE_TYPES,
  haversineKm, zoneAreaKm2, hasValidCenter, detectOverlaps, nearestZone,
  geofenceDataQuality, coverageSummary, EARTH_RADIUS_KM,
} from '../lib/geofences'

const DUBAI = { lat: 25.2048, lng: 55.2708 }
const RIYADH = { lat: 24.7136, lng: 46.6753 }

describe('geofences — validateGeofence', () => {
  it('requires a name', () => {
    const errors = validateGeofence({ name: '' })
    expect(errors.name).toBeTruthy()
    expect(validateGeofence({ name: '   ' }).name).toBeTruthy()
  })

  it('accepts a minimal valid zone (name only)', () => {
    expect(validateGeofence({ name: 'Depot A' })).toEqual({})
    expect(isValidGeofence({ name: 'Depot A' })).toBe(true)
  })

  it('rejects an unknown zone_type but accepts the canonical ones', () => {
    expect(validateGeofence({ name: 'Z', zone_type: 'airport' }).zone_type).toBeTruthy()
    for (const t of ZONE_TYPES) {
      expect(validateGeofence({ name: 'Z', zone_type: t })).toEqual({})
    }
  })

  it('validates latitude and longitude ranges', () => {
    expect(validateGeofence({ name: 'Z', center_lat: 25.2, center_lng: 55.3 })).toEqual({})
    expect(validateGeofence({ name: 'Z', center_lat: 120, center_lng: 55 }).center_lat).toBeTruthy()
    expect(validateGeofence({ name: 'Z', center_lat: 25, center_lng: 200 }).center_lng).toBeTruthy()
    expect(validateGeofence({ name: 'Z', center_lat: 'abc', center_lng: 10 }).center_lat).toBeTruthy()
  })

  it('requires latitude and longitude together', () => {
    expect(validateGeofence({ name: 'Z', center_lat: 25.2 }).center_lng).toBeTruthy()
    expect(validateGeofence({ name: 'Z', center_lng: 55.3 }).center_lat).toBeTruthy()
  })

  it('validates radius bounds', () => {
    expect(validateGeofence({ name: 'Z', radius_m: 1500 })).toEqual({})
    expect(validateGeofence({ name: 'Z', radius_m: 0 }).radius_m).toBeTruthy()
    expect(validateGeofence({ name: 'Z', radius_m: -5 }).radius_m).toBeTruthy()
    expect(validateGeofence({ name: 'Z', radius_m: 5_000_000 }).radius_m).toBeTruthy()
    expect(validateGeofence({ name: 'Z', radius_m: 'nope' }).radius_m).toBeTruthy()
  })

  it('accepts a fully specified zone', () => {
    expect(validateGeofence({
      name: 'Port Zone', zone_type: 'site',
      center_lat: 25.2048, center_lng: 55.2708, radius_m: 2500, site: 'Jebel Ali',
    })).toEqual({})
  })
})

describe('geofences — toFiniteNumber', () => {
  it('parses numbers and numeric strings, rejects junk', () => {
    expect(toFiniteNumber(12.5)).toBe(12.5)
    expect(toFiniteNumber('12.5')).toBe(12.5)
    expect(toFiniteNumber('')).toBeNull()
    expect(toFiniteNumber(null)).toBeNull()
    expect(toFiniteNumber('abc')).toBeNull()
    expect(toFiniteNumber(NaN)).toBeNull()
  })
})

describe('geofences — summarizeGeofences', () => {
  it('handles an empty / non-array input', () => {
    expect(summarizeGeofences([])).toEqual({
      total: 0, active: 0, inactive: 0, geolocated: 0,
      byType: { site: 0, restricted: 0, service: 0, custom: 0 },
      areaM2: 0, areaKm2: 0,
    })
    expect(summarizeGeofences(null).total).toBe(0)
    expect(summarizeGeofences(undefined).total).toBe(0)
  })

  it('counts by zone type and active/inactive split', () => {
    const rows = [
      { zone_type: 'site', active: true },
      { zone_type: 'site', active: false },
      { zone_type: 'restricted', active: true },
      { zone_type: 'service' },            // active defaults to counted-as-active
      { zone_type: 'weird', active: true }, // unknown → custom
    ]
    const s = summarizeGeofences(rows)
    expect(s.total).toBe(5)
    expect(s.byType).toEqual({ site: 2, restricted: 1, service: 1, custom: 1 })
    expect(s.active).toBe(4)
    expect(s.inactive).toBe(1)
  })

  it('sums covered area as Σ π·r² and reports km²', () => {
    const rows = [
      { zone_type: 'site', radius_m: 1000, center_lat: 25, center_lng: 55 },
      { zone_type: 'custom', radius_m: 500, center_lat: 24, center_lng: 54 },
      { zone_type: 'custom', radius_m: 0 },      // ignored
      { zone_type: 'custom', radius_m: 'bad' },  // ignored
    ]
    const s = summarizeGeofences(rows)
    const expectedM2 = Math.PI * 1000 * 1000 + Math.PI * 500 * 500
    expect(s.areaM2).toBeCloseTo(expectedM2, 5)
    expect(s.areaKm2).toBeCloseTo(Math.round((expectedM2 / 1_000_000) * 100) / 100, 5)
    expect(s.geolocated).toBe(2)
  })
})

describe('geofences — haversineKm', () => {
  it('returns 0 for identical points', () => {
    expect(haversineKm(25, 55, 25, 55)).toBe(0)
  })

  it('measures a known distance within tolerance', () => {
    const d = haversineKm(DUBAI.lat, DUBAI.lng, RIYADH.lat, RIYADH.lng)
    expect(d).toBeGreaterThan(840)
    expect(d).toBeLessThan(900)
  })

  it('is symmetric', () => {
    const a = haversineKm(DUBAI.lat, DUBAI.lng, RIYADH.lat, RIYADH.lng)
    const b = haversineKm(RIYADH.lat, RIYADH.lng, DUBAI.lat, DUBAI.lng)
    expect(Math.abs(a - b)).toBeLessThan(1e-9)
  })

  it('half the equator equals pi * R', () => {
    const d = haversineKm(0, 0, 0, 180)
    expect(Math.abs(d - Math.PI * EARTH_RADIUS_KM)).toBeLessThan(1e-6)
  })

  it('returns null for missing / out-of-range input', () => {
    expect(haversineKm(null, 55, 25, 55)).toBeNull()
    expect(haversineKm('', '', '', '')).toBeNull()
    expect(haversineKm(200, 55, 25, 55)).toBeNull()
    expect(haversineKm(25, 400, 25, 55)).toBeNull()
  })
})

describe('geofences — zoneAreaKm2', () => {
  it('computes pi * r^2 in km2', () => {
    expect(zoneAreaKm2(1000)).toBeCloseTo(Math.PI, 6)
  })
  it('returns null for missing / non-positive radius', () => {
    expect(zoneAreaKm2(0)).toBeNull()
    expect(zoneAreaKm2(-10)).toBeNull()
    expect(zoneAreaKm2('')).toBeNull()
    expect(zoneAreaKm2(null)).toBeNull()
  })
})

describe('geofences — hasValidCenter', () => {
  it('accepts a valid pair and rejects otherwise', () => {
    expect(hasValidCenter({ center_lat: 25, center_lng: 55 })).toBe(true)
    expect(hasValidCenter({ center_lat: 25 })).toBe(false)
    expect(hasValidCenter({ center_lat: 200, center_lng: 55 })).toBe(false)
    expect(hasValidCenter({})).toBe(false)
    expect(hasValidCenter(null)).toBe(false)
  })
})

describe('geofences — detectOverlaps', () => {
  it('flags two overlapping circles with overlap depth and distance', () => {
    const rows = [
      { id: 'a', name: 'A', center_lat: 25, center_lng: 55, radius_m: 5000 },
      { id: 'b', name: 'B', center_lat: 25, center_lng: 55, radius_m: 3000 },
    ]
    const pairs = detectOverlaps(rows)
    expect(pairs).toHaveLength(1)
    expect(pairs[0].distanceM).toBe(0)
    expect(pairs[0].overlapM).toBe(8000)
    expect(pairs[0].contained).toBe(true)
  })

  it('does not flag well-separated zones', () => {
    const rows = [
      { id: 'a', name: 'A', center_lat: DUBAI.lat, center_lng: DUBAI.lng, radius_m: 5000 },
      { id: 'b', name: 'B', center_lat: RIYADH.lat, center_lng: RIYADH.lng, radius_m: 5000 },
    ]
    expect(detectOverlaps(rows)).toHaveLength(0)
  })

  it('ignores zones without coordinates or radius', () => {
    const rows = [
      { id: 'a', name: 'A', center_lat: 25, center_lng: 55, radius_m: 5000 },
      { id: 'b', name: 'B', radius_m: 5000 },
      { id: 'c', name: 'C', center_lat: 25, center_lng: 55 },
    ]
    expect(detectOverlaps(rows)).toHaveLength(0)
  })

  it('sorts deepest overlap first and degrades on bad input', () => {
    const rows = [
      { id: 'a', name: 'A', center_lat: 25, center_lng: 55, radius_m: 10000 },
      { id: 'b', name: 'B', center_lat: 25, center_lng: 55, radius_m: 9000 },
      { id: 'c', name: 'C', center_lat: 25.05, center_lng: 55, radius_m: 500 },
    ]
    const pairs = detectOverlaps(rows)
    for (let i = 1; i < pairs.length; i += 1) {
      expect(pairs[i - 1].overlapM).toBeGreaterThanOrEqual(pairs[i].overlapM)
    }
    expect(detectOverlaps(null)).toEqual([])
    expect(detectOverlaps(undefined)).toEqual([])
  })
})

describe('geofences — nearestZone', () => {
  const rows = [
    { id: 'a', name: 'Dubai', center_lat: DUBAI.lat, center_lng: DUBAI.lng, radius_m: 1000 },
    { id: 'b', name: 'Riyadh', center_lat: RIYADH.lat, center_lng: RIYADH.lng, radius_m: 1000 },
  ]
  it('finds the closest located zone', () => {
    const near = nearestZone({ lat: 25.3, lng: 55.3 }, rows)
    expect(near.zone.id).toBe('a')
    expect(near.distanceKm).toBeGreaterThanOrEqual(0)
  })
  it('accepts center_lat/center_lng shaped points', () => {
    const near = nearestZone({ center_lat: 24.7, center_lng: 46.7 }, rows)
    expect(near.zone.id).toBe('b')
  })
  it('returns null with no point or no located zone', () => {
    expect(nearestZone({}, rows)).toBeNull()
    expect(nearestZone({ lat: 25, lng: 55 }, [{ name: 'x' }])).toBeNull()
  })
})

describe('geofences — geofenceDataQuality', () => {
  it('flags missing coords, bad ranges and non-positive radius', () => {
    const flags = geofenceDataQuality([
      { id: 'ok', name: 'Good', center_lat: 25, center_lng: 55, radius_m: 1000 },
      { id: 'nocoord', name: 'No coord', radius_m: 1000 },
      { id: 'halfcoord', name: 'Half', center_lat: 25, radius_m: 1000 },
      { id: 'badlat', name: 'Bad lat', center_lat: 999, center_lng: 55, radius_m: 1000 },
      { id: 'noradius', name: 'No radius', center_lat: 25, center_lng: 55 },
      { id: 'zeroradius', name: 'Zero', center_lat: 25, center_lng: 55, radius_m: 0 },
    ])
    const ids = flags.map((f) => f.id)
    expect(ids).not.toContain('ok')
    expect(ids).toContain('nocoord')
    expect(ids).toContain('halfcoord')
    expect(ids).toContain('badlat')
    expect(ids).toContain('noradius')
    expect(ids).toContain('zeroradius')
    expect(flags.find((f) => f.id === 'zeroradius').issues.length).toBeGreaterThan(0)
  })
  it('returns [] when clean and on bad input', () => {
    expect(geofenceDataQuality([{ name: 'ok', center_lat: 1, center_lng: 1, radius_m: 5 }])).toEqual([])
    expect(geofenceDataQuality(null)).toEqual([])
  })
})

describe('geofences — coverageSummary', () => {
  it('extends the base summary with area-by-type, avg radius, overlaps and flags', () => {
    const rows = [
      { id: 'a', name: 'A', zone_type: 'site', active: true, center_lat: 25, center_lng: 55, radius_m: 1000 },
      { id: 'b', name: 'B', zone_type: 'site', active: true, center_lat: 25, center_lng: 55, radius_m: 3000 },
      { id: 'c', name: 'C', zone_type: 'restricted', active: false },
    ]
    const s = coverageSummary(rows)
    expect(s.total).toBe(3)
    expect(s.byType.site).toBe(2)
    expect(s.areaByType.site).toBeGreaterThan(0)
    expect(s.avgRadiusM).toBe(2000)
    expect(s.radiusCount).toBe(2)
    expect(s.overlapPairs).toBe(1)
    expect(s.flaggedCount).toBe(1)
    expect(ZONE_TYPES.every((t) => t in s.areaByType)).toBe(true)
  })
  it('is safe on empty / bad input', () => {
    const s = coverageSummary([])
    expect(s.total).toBe(0)
    expect(s.overlapPairs).toBe(0)
    expect(s.flaggedCount).toBe(0)
    expect(s.avgRadiusM).toBe(0)
    expect(coverageSummary(null).total).toBe(0)
  })
})
