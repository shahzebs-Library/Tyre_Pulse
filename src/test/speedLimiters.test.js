import { describe, it, expect } from 'vitest'
import {
  summarizeSpeedLimiters, SPEED_LIMITER_STATUSES, SPEED_LIMITER_STATUS_META,
} from '../lib/speedLimiters'

describe('speedLimiters — summarizeSpeedLimiters', () => {
  const rows = [
    { id: '1', status: 'active', limit_kph: 80 },
    { id: '2', status: 'active', limit_kph: 90 },
    { id: '3', status: 'disabled', limit_kph: 100 },
    { id: '4', status: 'fault', limit_kph: 60 },
    { id: '5', status: 'fault', limit_kph: null },
  ]

  it('counts every status bucket', () => {
    const s = summarizeSpeedLimiters(rows)
    expect(s.byStatus).toEqual({ active: 2, disabled: 1, fault: 2 })
  })

  it('reports the total row count', () => {
    expect(summarizeSpeedLimiters(rows).total).toBe(5)
  })

  it('surfaces the fault count as `faults`', () => {
    expect(summarizeSpeedLimiters(rows).faults).toBe(2)
  })

  it('averages present limit_kph values and ignores nulls', () => {
    // (80 + 90 + 100 + 60) / 4 = 82.5
    expect(summarizeSpeedLimiters(rows).avgLimit).toBe(82.5)
  })

  it('rounds the average to one decimal place', () => {
    const s = summarizeSpeedLimiters([
      { status: 'active', limit_kph: 80 },
      { status: 'active', limit_kph: 85 },
      { status: 'active', limit_kph: 81 },
    ])
    // 246 / 3 = 82
    expect(s.avgLimit).toBe(82)
    const s2 = summarizeSpeedLimiters([
      { status: 'active', limit_kph: 80 },
      { status: 'active', limit_kph: 81 },
    ])
    expect(s2.avgLimit).toBe(80.5)
  })

  it('coerces numeric-string limits', () => {
    const s = summarizeSpeedLimiters([
      { status: 'active', limit_kph: '80' },
      { status: 'active', limit_kph: '100' },
    ])
    expect(s.avgLimit).toBe(90)
  })

  it('returns avgLimit null when no limits are present', () => {
    const s = summarizeSpeedLimiters([
      { status: 'active', limit_kph: null },
      { status: 'fault', limit_kph: '' },
    ])
    expect(s.avgLimit).toBeNull()
  })

  it('ignores unknown status values in the buckets', () => {
    const s = summarizeSpeedLimiters([
      { status: 'active', limit_kph: 80 },
      { status: 'bogus', limit_kph: 80 },
    ])
    expect(s.byStatus).toEqual({ active: 1, disabled: 0, fault: 0 })
    expect(s.total).toBe(2)
  })

  it('handles an empty list', () => {
    const s = summarizeSpeedLimiters([])
    expect(s).toEqual({ total: 0, byStatus: { active: 0, disabled: 0, fault: 0 }, faults: 0, avgLimit: null })
  })

  it('handles null / undefined / non-array input safely', () => {
    for (const bad of [null, undefined, 'x', 42, {}]) {
      const s = summarizeSpeedLimiters(bad)
      expect(s.total).toBe(0)
      expect(s.faults).toBe(0)
      expect(s.avgLimit).toBeNull()
    }
  })

  it('handles rows missing a status field', () => {
    const s = summarizeSpeedLimiters([{ limit_kph: 70 }, { limit_kph: 90 }])
    expect(s.byStatus).toEqual({ active: 0, disabled: 0, fault: 0 })
    expect(s.avgLimit).toBe(80)
    expect(s.total).toBe(2)
  })
})

describe('speedLimiters — status metadata', () => {
  it('exposes the three lifecycle statuses', () => {
    expect(SPEED_LIMITER_STATUSES).toEqual(['active', 'disabled', 'fault'])
  })

  it('has a label for every status', () => {
    for (const s of SPEED_LIMITER_STATUSES) {
      expect(SPEED_LIMITER_STATUS_META[s]?.label).toBeTruthy()
    }
  })
})
