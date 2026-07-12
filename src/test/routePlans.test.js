import { describe, it, expect } from 'vitest'
import { computeSavings, summariseRoutePlans, toFiniteNumber } from '../lib/routePlans'

describe('routePlans — computeSavings', () => {
  it('computes km and % saved from total vs optimised distance', () => {
    const s = computeSavings({ total_distance_km: 100, optimized_distance_km: 80 })
    expect(s.savingsKm).toBe(20)
    expect(s.savingsPct).toBe(20)
  })

  it('returns zero savings when the distances are missing', () => {
    expect(computeSavings({})).toEqual({ savingsKm: 0, savingsPct: 0 })
    expect(computeSavings({ total_distance_km: 100 })).toEqual({ savingsKm: 0, savingsPct: 0 })
  })

  it('guards divide-by-zero: zero total distance yields 0% (no NaN/Infinity)', () => {
    const s = computeSavings({ total_distance_km: 0, optimized_distance_km: 0 })
    expect(s.savingsKm).toBe(0)
    expect(s.savingsPct).toBe(0)
    expect(Number.isFinite(s.savingsPct)).toBe(true)
  })

  it('clamps the percentage into 0..100 for absurd optimised values', () => {
    // Optimised larger than total → negative saving, pct clamps to 0.
    const worse = computeSavings({ total_distance_km: 100, optimized_distance_km: 130 })
    expect(worse.savingsKm).toBe(-30)
    expect(worse.savingsPct).toBe(0)
    // Negative optimised → savingsKm > total, pct clamps to 100.
    const absurd = computeSavings({ total_distance_km: 100, optimized_distance_km: -50 })
    expect(absurd.savingsPct).toBe(100)
  })

  it('coerces numeric strings before computing', () => {
    const s = computeSavings({ total_distance_km: '320', optimized_distance_km: '240' })
    expect(s.savingsKm).toBe(80)
    expect(s.savingsPct).toBeCloseTo(25, 5)
  })
})

describe('routePlans — summariseRoutePlans', () => {
  it('returns zeroes for empty / non-array input', () => {
    const zero = {
      totalPlans: 0, totalStops: 0, totalDistanceKm: 0, totalOptimizedKm: 0,
      totalSavingsKm: 0, avgSavingsPct: 0, optimizedCount: 0,
    }
    expect(summariseRoutePlans([])).toEqual(zero)
    expect(summariseRoutePlans()).toEqual(zero)
    expect(summariseRoutePlans(null)).toEqual(zero)
  })

  it('aggregates stops, distances, savings and optimised count', () => {
    const rows = [
      { stops_count: 10, total_distance_km: 100, optimized_distance_km: 80 },
      { stops_count: 5, total_distance_km: 200, optimized_distance_km: 150 },
      { stops_count: 3, total_distance_km: 50, optimized_distance_km: 50 }, // no saving
    ]
    const s = summariseRoutePlans(rows)
    expect(s.totalPlans).toBe(3)
    expect(s.totalStops).toBe(18)
    expect(s.totalDistanceKm).toBe(350)
    expect(s.totalOptimizedKm).toBe(280)
    expect(s.totalSavingsKm).toBe(70) // 20 + 50 + 0
    expect(s.optimizedCount).toBe(2)
    // avg pct over positive-baseline plans: (20 + 25 + 0) / 3
    expect(s.avgSavingsPct).toBeCloseTo(15, 5)
  })

  it('only excludes zero-baseline plans from the average, not the totals', () => {
    const rows = [
      { total_distance_km: 0, optimized_distance_km: 0 },
      { total_distance_km: 100, optimized_distance_km: 60 },
    ]
    const s = summariseRoutePlans(rows)
    // Only the second plan has a positive baseline → avg is its 40%.
    expect(s.avgSavingsPct).toBeCloseTo(40, 5)
    expect(s.totalDistanceKm).toBe(100)
    expect(s.totalSavingsKm).toBe(40)
  })

  it('tolerates missing/partial fields without throwing', () => {
    const s = summariseRoutePlans([{}, { stops_count: 4 }, { total_distance_km: 10 }])
    expect(s.totalPlans).toBe(3)
    expect(s.totalStops).toBe(4)
    expect(s.totalDistanceKm).toBe(10)
    expect(s.totalSavingsKm).toBe(0)
  })
})

describe('routePlans — toFiniteNumber', () => {
  it('parses numbers, numeric strings, and rejects junk', () => {
    expect(toFiniteNumber(42)).toBe(42)
    expect(toFiniteNumber('1,200')).toBe(1200)
    expect(toFiniteNumber('')).toBeNull()
    expect(toFiniteNumber(null)).toBeNull()
    expect(toFiniteNumber('abc')).toBeNull()
  })
})
