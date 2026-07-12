import { describe, it, expect } from 'vitest'
import { summariseTrips, perAssetTotals, toFiniteNumber } from '../lib/trips'

describe('trips — toFiniteNumber', () => {
  it('parses numbers, numeric strings, and rejects junk', () => {
    expect(toFiniteNumber(42)).toBe(42)
    expect(toFiniteNumber('1,200')).toBe(1200)
    expect(toFiniteNumber('320.5')).toBe(320.5)
    expect(toFiniteNumber('')).toBeNull()
    expect(toFiniteNumber(null)).toBeNull()
    expect(toFiniteNumber(undefined)).toBeNull()
    expect(toFiniteNumber('abc')).toBeNull()
  })
})

describe('trips — summariseTrips', () => {
  it('returns zeroes for empty / non-array input', () => {
    const empty = {
      totalTrips: 0, totalDistanceKm: 0, totalDurationMin: 0,
      distinctAssets: 0, avgSpeedKmh: null, completedCount: 0, activeCount: 0,
    }
    expect(summariseTrips([])).toEqual(empty)
    expect(summariseTrips()).toEqual(empty)
    expect(summariseTrips(null)).toEqual(empty)
  })

  it('sums distance and duration, counts distinct assets and statuses', () => {
    const rows = [
      { id: 1, asset_no: 'A1', distance_km: 100, duration_min: 120, status: 'completed' },
      { id: 2, asset_no: 'A1', distance_km: 50, duration_min: 60, status: 'in_progress' },
      { id: 3, asset_no: 'A2', distance_km: 150, duration_min: 180, status: 'completed' },
    ]
    const s = summariseTrips(rows)
    expect(s.totalTrips).toBe(3)
    expect(s.totalDistanceKm).toBe(300)
    expect(s.totalDurationMin).toBe(360)
    expect(s.distinctAssets).toBe(2)
    expect(s.completedCount).toBe(2)
    expect(s.activeCount).toBe(1)
  })

  it('computes distance-weighted average speed (distance / hours)', () => {
    const rows = [
      { asset_no: 'A1', distance_km: 120, duration_min: 120 }, // 2h
      { asset_no: 'A2', distance_km: 80, duration_min: 60 },   // 1h
    ]
    // 200 km over 3h = 66.7 km/h
    expect(summariseTrips(rows).avgSpeedKmh).toBe(66.7)
  })

  it('returns null avg speed when no usable duration exists', () => {
    const rows = [{ asset_no: 'A1', distance_km: 100, duration_min: 0 }]
    expect(summariseTrips(rows).avgSpeedKmh).toBeNull()
  })

  it('coerces string metrics and ignores negatives in totals', () => {
    const rows = [
      { asset_no: 'A1', distance_km: '1,000', duration_min: '60' },
      { asset_no: 'A2', distance_km: -50, duration_min: 30 },
    ]
    const s = summariseTrips(rows)
    expect(s.totalDistanceKm).toBe(1000)
    expect(s.totalDurationMin).toBe(90)
  })

  it('is case-insensitive on status values', () => {
    const rows = [
      { asset_no: 'A1', status: 'Completed' },
      { asset_no: 'A2', status: 'IN_PROGRESS' },
    ]
    const s = summariseTrips(rows)
    expect(s.completedCount).toBe(1)
    expect(s.activeCount).toBe(1)
  })
})

describe('trips — perAssetTotals', () => {
  it('returns [] for empty / non-array input', () => {
    expect(perAssetTotals([])).toEqual([])
    expect(perAssetTotals()).toEqual([])
    expect(perAssetTotals(null)).toEqual([])
  })

  it('aggregates trips, distance and duration per asset, sorted by distance desc', () => {
    const rows = [
      { asset_no: 'A1', distance_km: 100, duration_min: 60 },
      { asset_no: 'A2', distance_km: 300, duration_min: 200 },
      { asset_no: 'A1', distance_km: 50, duration_min: 40 },
    ]
    const totals = perAssetTotals(rows)
    expect(totals).toHaveLength(2)
    expect(totals[0]).toEqual({ asset_no: 'A2', trips: 1, distanceKm: 300, durationMin: 200 })
    expect(totals[1]).toEqual({ asset_no: 'A1', trips: 2, distanceKm: 150, durationMin: 100 })
  })

  it('ignores rows with a blank/missing asset_no', () => {
    const rows = [
      { asset_no: '', distance_km: 10 },
      { distance_km: 20 },
      { asset_no: 'A1', distance_km: 30 },
    ]
    const totals = perAssetTotals(rows)
    expect(totals).toHaveLength(1)
    expect(totals[0].asset_no).toBe('A1')
  })

  it('breaks a distance tie deterministically by asset_no', () => {
    const rows = [
      { asset_no: 'B', distance_km: 100 },
      { asset_no: 'A', distance_km: 100 },
    ]
    expect(perAssetTotals(rows).map((t) => t.asset_no)).toEqual(['A', 'B'])
  })
})
