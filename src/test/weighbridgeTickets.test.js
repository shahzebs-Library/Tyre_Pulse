import { describe, it, expect } from 'vitest'
import {
  toFiniteNumber, netWeight, overloadKg, isOverweight, summariseTickets,
} from '../lib/weighbridgeTickets'

describe('weighbridgeTickets — toFiniteNumber', () => {
  it('parses numbers, numeric strings, and rejects junk', () => {
    expect(toFiniteNumber(42)).toBe(42)
    expect(toFiniteNumber('18,000')).toBe(18000)
    expect(toFiniteNumber('')).toBeNull()
    expect(toFiniteNumber(null)).toBeNull()
    expect(toFiniteNumber('abc')).toBeNull()
  })
})

describe('weighbridgeTickets — netWeight', () => {
  it('prefers an explicit net_weight_kg', () => {
    expect(netWeight({ net_weight_kg: 11000, gross_weight_kg: 18000, tare_weight_kg: 7000 })).toBe(11000)
  })

  it('derives gross − tare when net is absent', () => {
    expect(netWeight({ gross_weight_kg: 18000, tare_weight_kg: 7000 })).toBe(11000)
  })

  it('coerces numeric strings when deriving', () => {
    expect(netWeight({ gross_weight_kg: '18,000', tare_weight_kg: '7,000' })).toBe(11000)
  })

  it('returns null when it cannot be resolved', () => {
    expect(netWeight({ gross_weight_kg: 18000 })).toBeNull()
    expect(netWeight({})).toBeNull()
    expect(netWeight(null)).toBeNull()
  })
})

describe('weighbridgeTickets — overloadKg', () => {
  it('returns the positive overload when over the limit', () => {
    expect(overloadKg({ gross_weight_kg: 18000, gross_limit_kg: 17000 })).toBe(1000)
  })

  it('returns 0 when within the limit', () => {
    expect(overloadKg({ gross_weight_kg: 16000, gross_limit_kg: 17000 })).toBe(0)
    expect(overloadKg({ gross_weight_kg: 17000, gross_limit_kg: 17000 })).toBe(0)
  })

  it('returns 0 when gross or limit is missing', () => {
    expect(overloadKg({ gross_weight_kg: 18000 })).toBe(0)
    expect(overloadKg({ gross_limit_kg: 17000 })).toBe(0)
    expect(overloadKg({})).toBe(0)
  })
})

describe('weighbridgeTickets — isOverweight', () => {
  it('is true only when there is a positive overload', () => {
    expect(isOverweight({ gross_weight_kg: 18000, gross_limit_kg: 17000 })).toBe(true)
    expect(isOverweight({ gross_weight_kg: 16000, gross_limit_kg: 17000 })).toBe(false)
    expect(isOverweight({ gross_weight_kg: 18000 })).toBe(false)
  })
})

describe('weighbridgeTickets — summariseTickets', () => {
  it('returns zeroes for empty / non-array input', () => {
    const zero = {
      totalTickets: 0, totalNetKg: 0, overweightCount: 0,
      maxOverloadKg: 0, avgNetKg: 0, distinctAssets: 0,
    }
    expect(summariseTickets([])).toEqual(zero)
    expect(summariseTickets()).toEqual(zero)
    expect(summariseTickets(null)).toEqual(zero)
  })

  it('aggregates net weight, overweight count, max overload and distinct assets', () => {
    const rows = [
      { asset_no: 'A1', gross_weight_kg: 18000, tare_weight_kg: 7000, gross_limit_kg: 17000 }, // net 11000, over 1000
      { asset_no: 'A1', net_weight_kg: 9000, gross_weight_kg: 16000, gross_limit_kg: 17000 },  // net 9000, within limit
      { asset_no: 'A2', gross_weight_kg: 20000, tare_weight_kg: 6000, gross_limit_kg: 17000 }, // net 14000, over 3000
    ]
    const s = summariseTickets(rows)
    expect(s.totalTickets).toBe(3)
    expect(s.totalNetKg).toBe(34000)
    expect(s.overweightCount).toBe(2)
    expect(s.maxOverloadKg).toBe(3000)
    expect(s.avgNetKg).toBeCloseTo(34000 / 3, 6)
    expect(s.distinctAssets).toBe(2)
  })

  it('only averages rows that have a resolvable net weight', () => {
    const rows = [
      { asset_no: 'A1', net_weight_kg: 10000 },
      { asset_no: 'A2', gross_weight_kg: 5000 }, // net unresolved
    ]
    const s = summariseTickets(rows)
    expect(s.totalNetKg).toBe(10000)
    expect(s.avgNetKg).toBe(10000)
    expect(s.distinctAssets).toBe(2)
  })
})
