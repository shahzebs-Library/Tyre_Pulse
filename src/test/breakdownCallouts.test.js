import { describe, it, expect } from 'vitest'
import {
  toFiniteNumber, responseMinutes, resolutionMinutes, summariseCallouts, byType,
} from '../lib/breakdownCallouts'

describe('breakdownCallouts — toFiniteNumber', () => {
  it('parses numbers, numeric strings, and messy strings', () => {
    expect(toFiniteNumber(850)).toBe(850)
    expect(toFiniteNumber('850')).toBe(850)
    expect(toFiniteNumber('SAR 1,250.50')).toBe(1250.5)
    expect(toFiniteNumber(-40)).toBe(-40)
  })

  it('returns null for empty / non-numeric input', () => {
    expect(toFiniteNumber('')).toBeNull()
    expect(toFiniteNumber(null)).toBeNull()
    expect(toFiniteNumber(undefined)).toBeNull()
    expect(toFiniteNumber('abc')).toBeNull()
  })
})

describe('breakdownCallouts — responseMinutes', () => {
  it('returns whole minutes between reported and dispatched', () => {
    expect(responseMinutes({
      reported_at: '2026-07-12T08:00:00Z',
      dispatched_at: '2026-07-12T08:25:00Z',
    })).toBe(25)
  })

  it('returns null when a timestamp is missing', () => {
    expect(responseMinutes({ reported_at: '2026-07-12T08:00:00Z' })).toBeNull()
    expect(responseMinutes({ dispatched_at: '2026-07-12T08:25:00Z' })).toBeNull()
    expect(responseMinutes({})).toBeNull()
    expect(responseMinutes(null)).toBeNull()
  })

  it('returns null when dispatch predates report (invalid ordering)', () => {
    expect(responseMinutes({
      reported_at: '2026-07-12T09:00:00Z',
      dispatched_at: '2026-07-12T08:00:00Z',
    })).toBeNull()
  })
})

describe('breakdownCallouts — resolutionMinutes', () => {
  it('returns whole minutes between reported and resolved', () => {
    expect(resolutionMinutes({
      reported_at: '2026-07-12T08:00:00Z',
      resolved_at: '2026-07-12T10:30:00Z',
    })).toBe(150)
  })

  it('returns null on missing/invalid timestamps', () => {
    expect(resolutionMinutes({ reported_at: '2026-07-12T08:00:00Z' })).toBeNull()
    expect(resolutionMinutes({
      reported_at: '2026-07-12T08:00:00Z',
      resolved_at: 'not-a-date',
    })).toBeNull()
  })
})

describe('breakdownCallouts — summariseCallouts', () => {
  const rows = [
    { status: 'reported', severity: 'critical', cost: 850, reported_at: '2026-07-12T08:00:00Z', dispatched_at: '2026-07-12T08:20:00Z', resolved_at: '2026-07-12T09:00:00Z' },
    { status: 'dispatched', severity: 'high', cost: '1,200', reported_at: '2026-07-12T09:00:00Z', dispatched_at: '2026-07-12T09:40:00Z' },
    { status: 'resolved', severity: 'critical', cost: 300, reported_at: '2026-07-12T07:00:00Z', dispatched_at: '2026-07-12T07:10:00Z', resolved_at: '2026-07-12T08:00:00Z' },
    { status: 'cancelled', severity: 'low' },
  ]

  it('counts totals, open, and critical-open correctly', () => {
    const s = summariseCallouts(rows)
    expect(s.totalCallouts).toBe(4)
    expect(s.openCount).toBe(2) // reported + dispatched (resolved & cancelled excluded)
    expect(s.criticalOpenCount).toBe(1) // only the open critical row
  })

  it('sums cost across parseable values and averages timings', () => {
    const s = summariseCallouts(rows)
    expect(s.totalCost).toBe(850 + 1200 + 300)
    // response: 20, 40, 10 -> avg 23.33 -> 23
    expect(s.avgResponseMinutes).toBe(23)
    // resolution: 60, 60 -> avg 60
    expect(s.avgResolutionMinutes).toBe(60)
  })

  it('returns null averages and zeroed counts for empty input', () => {
    const s = summariseCallouts([])
    expect(s).toEqual({
      totalCallouts: 0, openCount: 0, criticalOpenCount: 0,
      totalCost: 0, avgResponseMinutes: null, avgResolutionMinutes: null,
    })
    expect(summariseCallouts(null).totalCallouts).toBe(0)
  })
})

describe('breakdownCallouts — byType', () => {
  it('groups by breakdown_type sorted by count desc, accumulating cost', () => {
    const rows = [
      { breakdown_type: 'tyre', cost: 500 },
      { breakdown_type: 'tyre', cost: '300' },
      { breakdown_type: 'engine', cost: 2000 },
      { breakdown_type: 'tyre', cost: 100 },
    ]
    const out = byType(rows)
    expect(out).toHaveLength(2)
    expect(out[0]).toEqual({ type: 'tyre', count: 3, cost: 900 })
    expect(out[1]).toEqual({ type: 'engine', count: 1, cost: 2000 })
  })

  it('buckets missing type under "other" and handles empty input', () => {
    const out = byType([{ cost: 50 }, { breakdown_type: '', cost: 10 }])
    expect(out).toEqual([{ type: 'other', count: 2, cost: 60 }])
    expect(byType([])).toEqual([])
    expect(byType(null)).toEqual([])
  })
})
