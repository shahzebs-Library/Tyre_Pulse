import { describe, it, expect } from 'vitest'
import {
  validateGeofence, isValidGeofence, summarizeGeofences, toFiniteNumber, ZONE_TYPES,
} from '../lib/geofences'

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
