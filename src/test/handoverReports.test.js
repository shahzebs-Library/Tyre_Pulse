import { describe, it, expect } from 'vitest'
import {
  toFiniteNumber,
  damageCount,
  summariseHandovers,
  byCondition,
} from '../lib/handoverReports'

// ─────────────────────────────────────────────────────────────────────────────
// toFiniteNumber
// ─────────────────────────────────────────────────────────────────────────────
describe('toFiniteNumber', () => {
  it('parses numeric strings and numbers, stripping units', () => {
    expect(toFiniteNumber(42)).toBe(42)
    expect(toFiniteNumber('45000')).toBe(45000)
    expect(toFiniteNumber('75 %')).toBe(75)
    expect(toFiniteNumber('-3')).toBe(-3)
  })

  it('returns null for blank / null / non-numeric', () => {
    expect(toFiniteNumber('')).toBeNull()
    expect(toFiniteNumber(null)).toBeNull()
    expect(toFiniteNumber(undefined)).toBeNull()
    expect(toFiniteNumber('abc')).toBeNull()
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// damageCount
// ─────────────────────────────────────────────────────────────────────────────
describe('damageCount', () => {
  it('prefers an explicit non-negative damage_count', () => {
    expect(damageCount({ damage_count: 3, damages: [{}, {}] })).toBe(3)
    expect(damageCount({ damage_count: '4' })).toBe(4)
    expect(damageCount({ damage_count: 0, damages: [{}, {}] })).toBe(0)
  })

  it('derives from the damages array when no explicit count', () => {
    expect(damageCount({ damages: [{ area: 'front' }, { area: 'rear' }] })).toBe(2)
    expect(damageCount({ damages: [] })).toBe(0)
    expect(damageCount({ damage_count: null, damages: [{}, {}, {}] })).toBe(3)
  })

  it('returns 0 for missing / non-array damages and bad input', () => {
    expect(damageCount({})).toBe(0)
    expect(damageCount({ damages: { note: 'not an array' } })).toBe(0)
    expect(damageCount(null)).toBe(0)
    expect(damageCount(undefined)).toBe(0)
  })

  it('truncates a fractional explicit count and ignores a negative one', () => {
    expect(damageCount({ damage_count: 2.9 })).toBe(2)
    // negative explicit count is not usable → falls back to the damages array
    expect(damageCount({ damage_count: -1, damages: [{}, {}] })).toBe(2)
    expect(damageCount({ damage_count: -1 })).toBe(0)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// summariseHandovers
// ─────────────────────────────────────────────────────────────────────────────
describe('summariseHandovers', () => {
  const rows = [
    { asset_no: 'TRK-1', handover_type: 'checkout', condition_rating: 'good', damages: [{}, {}] },
    { asset_no: 'TRK-1', handover_type: 'checkin', condition_rating: 'poor', damage_count: 3 },
    { asset_no: 'TRK-2', handover_type: 'checkout', condition_rating: 'excellent' },
    { asset_no: 'TRK-2', handover_type: 'checkin', condition_rating: 'poor', damages: [{}] },
  ]

  it('rolls up totals, type counts, distinct assets, poor + damages', () => {
    const s = summariseHandovers(rows)
    expect(s.totalReports).toBe(4)
    expect(s.checkoutCount).toBe(2)
    expect(s.checkinCount).toBe(2)
    expect(s.distinctAssets).toBe(2)
    expect(s.poorConditionCount).toBe(2)
    expect(s.totalDamages).toBe(6) // 2 + 3 + 0 + 1
  })

  it('is safe on empty / non-array input', () => {
    const empty = summariseHandovers([])
    expect(empty).toEqual({
      totalReports: 0, checkoutCount: 0, checkinCount: 0,
      distinctAssets: 0, poorConditionCount: 0, totalDamages: 0,
    })
    expect(summariseHandovers(null).totalReports).toBe(0)
    expect(summariseHandovers(undefined).distinctAssets).toBe(0)
  })

  it('ignores blank asset numbers when counting distinct assets', () => {
    const s = summariseHandovers([
      { asset_no: '', handover_type: 'checkout' },
      { asset_no: '   ', handover_type: 'checkin' },
      { asset_no: 'TRK-9', handover_type: 'checkout' },
    ])
    expect(s.distinctAssets).toBe(1)
    expect(s.totalReports).toBe(3)
  })

  it('does not count unknown handover types as check-in or check-out', () => {
    const s = summariseHandovers([
      { asset_no: 'TRK-1', handover_type: 'checkout' },
      { asset_no: 'TRK-2', handover_type: 'transfer' },
      { asset_no: 'TRK-3' },
    ])
    expect(s.checkoutCount).toBe(1)
    expect(s.checkinCount).toBe(0)
    expect(s.totalReports).toBe(3)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// byCondition
// ─────────────────────────────────────────────────────────────────────────────
describe('byCondition', () => {
  it('tallies a count per condition_rating present', () => {
    const counts = byCondition([
      { condition_rating: 'good' },
      { condition_rating: 'good' },
      { condition_rating: 'poor' },
      { condition_rating: 'excellent' },
    ])
    expect(counts).toEqual({ good: 2, poor: 1, excellent: 1 })
  })

  it('ignores rows with missing / blank rating and handles empty input', () => {
    const counts = byCondition([
      { condition_rating: 'fair' },
      { condition_rating: '' },
      { condition_rating: null },
      {},
    ])
    expect(counts).toEqual({ fair: 1 })
    expect(byCondition([])).toEqual({})
    expect(byCondition(null)).toEqual({})
  })
})
