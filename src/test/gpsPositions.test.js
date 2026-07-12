import { describe, it, expect } from 'vitest'
import {
  haversineKm, latestPerAsset, summarisePositions, toFiniteNumber,
} from '../lib/gpsPositions'

describe('gpsPositions — haversineKm', () => {
  it('returns 0 when either point has missing coordinates', () => {
    expect(haversineKm({}, {})).toBe(0)
    expect(haversineKm({ latitude: 10 }, { latitude: 20, longitude: 30 })).toBe(0)
    expect(haversineKm(null, null)).toBe(0)
    expect(haversineKm({ latitude: 24.7, longitude: 46.7 }, { latitude: null, longitude: 46.7 })).toBe(0)
  })

  it('returns 0 for identical points', () => {
    const p = { latitude: 24.7136, longitude: 46.6753 }
    expect(haversineKm(p, p)).toBe(0)
  })

  it('computes a known distance (London → Paris ≈ 343 km)', () => {
    const london = { latitude: 51.5074, longitude: -0.1278 }
    const paris = { latitude: 48.8566, longitude: 2.3522 }
    const d = haversineKm(london, paris)
    expect(d).toBeGreaterThan(340)
    expect(d).toBeLessThan(346)
  })

  it('computes ~111 km per degree of latitude at the equator', () => {
    const d = haversineKm({ latitude: 0, longitude: 0 }, { latitude: 1, longitude: 0 })
    expect(d).toBeGreaterThan(110)
    expect(d).toBeLessThan(112)
  })

  it('is symmetric and coerces numeric strings', () => {
    const a = { latitude: '24.7136', longitude: '46.6753' }
    const b = { latitude: '24.8000', longitude: '46.7000' }
    expect(haversineKm(a, b)).toBeCloseTo(haversineKm(b, a), 10)
    expect(haversineKm(a, b)).toBeGreaterThan(0)
  })
})

describe('gpsPositions — latestPerAsset', () => {
  it('returns [] for empty / non-array input', () => {
    expect(latestPerAsset([])).toEqual([])
    expect(latestPerAsset()).toEqual([])
    expect(latestPerAsset(null)).toEqual([])
  })

  it('keeps the most recent ping per asset by recorded_at', () => {
    const rows = [
      { id: 1, asset_no: 'A1', recorded_at: '2026-01-01T00:00:00Z' },
      { id: 2, asset_no: 'A1', recorded_at: '2026-03-01T00:00:00Z' },
      { id: 3, asset_no: 'A1', recorded_at: '2026-02-01T00:00:00Z' },
    ]
    const latest = latestPerAsset(rows)
    expect(latest).toHaveLength(1)
    expect(latest[0].id).toBe(2)
  })

  it('tracks one latest ping per distinct asset and falls back to created_at', () => {
    const rows = [
      { id: 1, asset_no: 'A1', recorded_at: '2026-01-01T00:00:00Z' },
      { id: 2, asset_no: 'A2', created_at: '2026-05-01T00:00:00Z' },
      { id: 3, asset_no: 'A1', recorded_at: '2026-02-01T00:00:00Z' },
    ]
    const latest = latestPerAsset(rows).sort((a, b) => a.asset_no.localeCompare(b.asset_no))
    expect(latest.map((r) => r.asset_no)).toEqual(['A1', 'A2'])
    expect(latest[0].id).toBe(3)
  })

  it('ignores rows with a blank/missing asset_no', () => {
    const rows = [
      { id: 1, asset_no: '', recorded_at: '2026-01-01T00:00:00Z' },
      { id: 2, recorded_at: '2026-01-01T00:00:00Z' },
      { id: 3, asset_no: 'A1', recorded_at: '2026-01-01T00:00:00Z' },
    ]
    const latest = latestPerAsset(rows)
    expect(latest).toHaveLength(1)
    expect(latest[0].asset_no).toBe('A1')
  })
})

describe('gpsPositions — summarisePositions', () => {
  it('returns zeroes for empty / non-array input', () => {
    expect(summarisePositions([])).toEqual({
      totalPings: 0, distinctAssets: 0, movingCount: 0, idleCount: 0, maxSpeedKmh: null,
    })
    expect(summarisePositions()).toEqual({
      totalPings: 0, distinctAssets: 0, movingCount: 0, idleCount: 0, maxSpeedKmh: null,
    })
  })

  it('counts pings, distinct assets, moving/idle (on latest ping) and max speed', () => {
    const rows = [
      // A1: latest is moving (60 km/h)
      { id: 1, asset_no: 'A1', speed_kmh: 0, ignition: true, recorded_at: '2026-01-01T00:00:00Z' },
      { id: 2, asset_no: 'A1', speed_kmh: 60, ignition: true, recorded_at: '2026-01-02T00:00:00Z' },
      // A2: latest is idle (engine on, stationary)
      { id: 3, asset_no: 'A2', speed_kmh: 0, ignition: true, recorded_at: '2026-01-02T00:00:00Z' },
      // A3: latest is stopped (engine off) → neither moving nor idle
      { id: 4, asset_no: 'A3', speed_kmh: 0, ignition: false, recorded_at: '2026-01-02T00:00:00Z' },
    ]
    const s = summarisePositions(rows)
    expect(s.totalPings).toBe(4)
    expect(s.distinctAssets).toBe(3)
    expect(s.movingCount).toBe(1)
    expect(s.idleCount).toBe(1)
    expect(s.maxSpeedKmh).toBe(60)
  })

  it('coerces string speeds and tolerates missing values', () => {
    const rows = [
      { id: 1, asset_no: 'A1', speed_kmh: '85', ignition: true, recorded_at: '2026-01-01T00:00:00Z' },
      { id: 2, asset_no: 'A2', speed_kmh: null, ignition: true, recorded_at: '2026-01-01T00:00:00Z' },
    ]
    const s = summarisePositions(rows)
    expect(s.distinctAssets).toBe(2)
    expect(s.maxSpeedKmh).toBe(85)
    expect(s.movingCount).toBe(1) // A1 moving
    expect(s.idleCount).toBe(1)   // A2 ignition on, speed treated as 0
  })
})

describe('gpsPositions — toFiniteNumber', () => {
  it('parses numbers, numeric strings, and rejects junk', () => {
    expect(toFiniteNumber(42)).toBe(42)
    expect(toFiniteNumber('46.6753')).toBe(46.6753)
    expect(toFiniteNumber('-0.1278')).toBe(-0.1278)
    expect(toFiniteNumber('')).toBeNull()
    expect(toFiniteNumber(null)).toBeNull()
    expect(toFiniteNumber('abc')).toBeNull()
  })
})
