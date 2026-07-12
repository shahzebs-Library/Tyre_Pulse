import { describe, it, expect } from 'vitest'
import {
  toFiniteNumber, costPerKm, kmUtilization, mrr, daysToRenewal,
  summariseTaas, byPlan,
} from '../lib/taas'

// Deterministic clock for every now-dependent assertion.
const NOW = Date.parse('2026-07-12T00:00:00.000Z')
const inDays = (n) => new Date(NOW + n * 86_400_000).toISOString().slice(0, 10)

describe('taas — toFiniteNumber', () => {
  it('parses numbers, numeric strings, and currency-formatted strings', () => {
    expect(toFiniteNumber(1200)).toBe(1200)
    expect(toFiniteNumber('1500')).toBe(1500)
    expect(toFiniteNumber('SAR 2,400.50')).toBe(2400.5)
    expect(toFiniteNumber('-3')).toBe(-3)
  })

  it('returns null for empty / null / non-numeric input', () => {
    expect(toFiniteNumber('')).toBeNull()
    expect(toFiniteNumber(null)).toBeNull()
    expect(toFiniteNumber(undefined)).toBeNull()
    expect(toFiniteNumber('abc')).toBeNull()
  })
})

describe('taas — costPerKm', () => {
  it('divides billed_to_date by actual_km', () => {
    expect(costPerKm({ billed_to_date: 10000, actual_km: 40000 })).toBe(0.25)
  })

  it('returns null on divide-by-zero (actual_km = 0)', () => {
    expect(costPerKm({ billed_to_date: 10000, actual_km: 0 })).toBeNull()
  })

  it('returns null when inputs are missing or non-numeric', () => {
    expect(costPerKm({ billed_to_date: 10000 })).toBeNull()
    expect(costPerKm({ actual_km: 40000 })).toBeNull()
    expect(costPerKm({ billed_to_date: 'x', actual_km: 'y' })).toBeNull()
    expect(costPerKm(null)).toBeNull()
  })
})

describe('taas — kmUtilization', () => {
  it('returns actual/committed as a percentage', () => {
    expect(kmUtilization({ actual_km: 30000, committed_km: 60000 })).toBe(50)
  })

  it('allows over-commitment above 100%', () => {
    expect(kmUtilization({ actual_km: 90000, committed_km: 60000 })).toBe(150)
  })

  it('guards divide-by-zero and missing inputs', () => {
    expect(kmUtilization({ actual_km: 30000, committed_km: 0 })).toBeNull()
    expect(kmUtilization({ actual_km: 30000 })).toBeNull()
    expect(kmUtilization(null)).toBeNull()
  })
})

describe('taas — mrr', () => {
  it('sums monthly_fee across active and trial subscriptions only', () => {
    const rows = [
      { status: 'active', monthly_fee: 1000 },
      { status: 'trial', monthly_fee: 500 },
      { status: 'paused', monthly_fee: 9999 },
      { status: 'cancelled', monthly_fee: 9999 },
      { status: 'expired', monthly_fee: 9999 },
    ]
    expect(mrr(rows)).toBe(1500)
  })

  it('ignores non-numeric fees and handles empty input', () => {
    expect(mrr([{ status: 'active', monthly_fee: 'abc' }])).toBe(0)
    expect(mrr([])).toBe(0)
    expect(mrr()).toBe(0)
  })
})

describe('taas — daysToRenewal', () => {
  it('returns whole days until the renewal date', () => {
    expect(daysToRenewal({ renewal_date: inDays(10) }, NOW)).toBe(10)
  })

  it('returns a negative number for overdue renewals', () => {
    expect(daysToRenewal({ renewal_date: inDays(-5) }, NOW)).toBe(-5)
  })

  it('returns null for missing or invalid dates', () => {
    expect(daysToRenewal({ renewal_date: null }, NOW)).toBeNull()
    expect(daysToRenewal({ renewal_date: 'not-a-date' }, NOW)).toBeNull()
    expect(daysToRenewal({}, NOW)).toBeNull()
  })
})

describe('taas — summariseTaas', () => {
  const rows = [
    { status: 'active', monthly_fee: 1000, tyres_covered: 6, renewal_date: inDays(10) },
    { status: 'active', monthly_fee: 800, tyres_covered: 4, renewal_date: inDays(45) },
    { status: 'trial', monthly_fee: 200, tyres_covered: 2, renewal_date: inDays(5) },
    { status: 'paused', monthly_fee: 500, tyres_covered: 10, renewal_date: inDays(3) },
    { status: 'cancelled', monthly_fee: 300, tyres_covered: 3, renewal_date: inDays(-2) },
  ]

  it('rolls up counts, MRR, tyres, and 30-day renewals', () => {
    const s = summariseTaas(rows, NOW)
    expect(s.totalSubscriptions).toBe(5)
    expect(s.activeCount).toBe(2)
    expect(s.trialCount).toBe(1)
    expect(s.mrr).toBe(2000) // 1000 + 800 + 200
    expect(s.totalTyresCovered).toBe(25) // 6+4+2+10+3
    // active@10d and trial@5d qualify; active@45d too far; paused excluded (not live)
    expect(s.renewalsDue30d).toBe(2)
  })

  it('handles empty / non-array input safely', () => {
    const s = summariseTaas([], NOW)
    expect(s).toEqual({
      totalSubscriptions: 0, activeCount: 0, trialCount: 0,
      mrr: 0, totalTyresCovered: 0, renewalsDue30d: 0,
    })
    expect(summariseTaas(null, NOW).totalSubscriptions).toBe(0)
  })

  it('excludes overdue live renewals from renewalsDue30d', () => {
    const overdue = [{ status: 'active', monthly_fee: 100, renewal_date: inDays(-1) }]
    expect(summariseTaas(overdue, NOW).renewalsDue30d).toBe(0)
  })
})

describe('taas — byPlan', () => {
  it('groups by plan_type with count and MRR, sorted by MRR desc', () => {
    const rows = [
      { plan_type: 'per_km', status: 'active', monthly_fee: 300 },
      { plan_type: 'per_km', status: 'trial', monthly_fee: 200 },
      { plan_type: 'per_month', status: 'active', monthly_fee: 1000 },
      { plan_type: 'per_tyre', status: 'cancelled', monthly_fee: 5000 },
    ]
    const result = byPlan(rows)
    expect(result[0]).toEqual({ plan_type: 'per_month', count: 1, mrr: 1000 })
    expect(result[1]).toEqual({ plan_type: 'per_km', count: 2, mrr: 500 })
    // per_tyre only has a cancelled contract -> MRR 0, sorts last
    expect(result[2]).toEqual({ plan_type: 'per_tyre', count: 1, mrr: 0 })
  })

  it('buckets missing plan_type as "unspecified" and handles empty input', () => {
    expect(byPlan([{ status: 'active', monthly_fee: 100 }])[0].plan_type).toBe('unspecified')
    expect(byPlan([])).toEqual([])
    expect(byPlan()).toEqual([])
  })
})
