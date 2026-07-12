import { describe, it, expect } from 'vitest'
import { toFiniteNumber, utilization, isOverloaded, summariseLoadPlans } from '../lib/loadPlans'

describe('loadPlans — toFiniteNumber', () => {
  it('parses numbers, numeric strings, and rejects junk', () => {
    expect(toFiniteNumber(42)).toBe(42)
    expect(toFiniteNumber('18,000')).toBe(18000)
    expect(toFiniteNumber('')).toBeNull()
    expect(toFiniteNumber(null)).toBeNull()
    expect(toFiniteNumber('abc')).toBeNull()
  })
})

describe('loadPlans — utilization', () => {
  it('computes weight and volume utilisation as a percentage of capacity', () => {
    const u = utilization({ cargo_weight_kg: 12000, max_payload_kg: 24000, volume_m3: 38, max_volume_m3: 76 })
    expect(u.weightPct).toBe(50)
    expect(u.volumePct).toBe(50)
  })

  it('returns null for a missing or zero capacity (divide-by-zero guard)', () => {
    expect(utilization({ cargo_weight_kg: 1000, max_payload_kg: 0 }).weightPct).toBeNull()
    expect(utilization({ cargo_weight_kg: 1000, max_payload_kg: null }).weightPct).toBeNull()
    expect(utilization({ volume_m3: 10 }).volumePct).toBeNull()
  })

  it('does not clamp overload above 100 but clamps negative load to 0', () => {
    expect(utilization({ cargo_weight_kg: 30000, max_payload_kg: 24000 }).weightPct).toBe(125)
    expect(utilization({ cargo_weight_kg: -500, max_payload_kg: 1000 }).weightPct).toBe(0)
  })

  it('returns null when the load value itself is not numeric', () => {
    expect(utilization({ cargo_weight_kg: null, max_payload_kg: 1000 }).weightPct).toBeNull()
  })

  it('tolerates a null/empty plan', () => {
    expect(utilization()).toEqual({ weightPct: null, volumePct: null })
    expect(utilization(null)).toEqual({ weightPct: null, volumePct: null })
  })
})

describe('loadPlans — isOverloaded', () => {
  it('flags a plan over its rated payload', () => {
    expect(isOverloaded({ cargo_weight_kg: 25000, max_payload_kg: 24000 })).toBe(true)
  })

  it('flags a plan over its rated volume', () => {
    expect(isOverloaded({ volume_m3: 80, max_volume_m3: 76 })).toBe(true)
  })

  it('is false at or under capacity, and when capacities are unknown', () => {
    expect(isOverloaded({ cargo_weight_kg: 24000, max_payload_kg: 24000 })).toBe(false)
    expect(isOverloaded({ cargo_weight_kg: 12000, max_payload_kg: 24000 })).toBe(false)
    expect(isOverloaded({ cargo_weight_kg: 99999 })).toBe(false)
  })
})

describe('loadPlans — summariseLoadPlans', () => {
  it('returns zeroes for empty / non-array input', () => {
    const zero = {
      totalPlans: 0, totalWeightKg: 0, avgWeightUtilPct: 0,
      avgVolumeUtilPct: 0, overloadedCount: 0, dispatchedCount: 0,
    }
    expect(summariseLoadPlans([])).toEqual(zero)
    expect(summariseLoadPlans()).toEqual(zero)
    expect(summariseLoadPlans(null)).toEqual(zero)
  })

  it('rolls up totals, average utilisation, overloads and dispatched count', () => {
    const rows = [
      { cargo_weight_kg: 12000, max_payload_kg: 24000, volume_m3: 38, max_volume_m3: 76, status: 'planned' },
      { cargo_weight_kg: 30000, max_payload_kg: 24000, volume_m3: 76, max_volume_m3: 76, status: 'dispatched' },
      { cargo_weight_kg: '6,000', max_payload_kg: 24000, status: 'delivered' },
    ]
    const s = summariseLoadPlans(rows)
    expect(s.totalPlans).toBe(3)
    expect(s.totalWeightKg).toBe(48000) // 12000 + 30000 + 6000
    // weight utils: 50, 125, 25 -> mean 66.67 -> 67
    expect(s.avgWeightUtilPct).toBe(67)
    // volume utils measurable on two rows: 50, 100 -> mean 75
    expect(s.avgVolumeUtilPct).toBe(75)
    expect(s.overloadedCount).toBe(1) // only the 125% weight row
    expect(s.dispatchedCount).toBe(2) // dispatched + delivered
  })

  it('ignores non-numeric weights in the total and averages only measurable plans', () => {
    const rows = [
      { cargo_weight_kg: 'n/a', max_payload_kg: 24000 },
      { cargo_weight_kg: 12000, max_payload_kg: 24000 },
    ]
    const s = summariseLoadPlans(rows)
    expect(s.totalWeightKg).toBe(12000)
    expect(s.avgWeightUtilPct).toBe(50) // only the second row is measurable
    expect(s.avgVolumeUtilPct).toBe(0) // none measurable
  })
})
