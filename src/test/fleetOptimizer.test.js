import { describe, it, expect } from 'vitest'
import {
  toFiniteNumber,
  costPerKm,
  suggestRecommendation,
  summariseOptimizer,
  byRecommendation,
  underutilised,
} from '../lib/fleetOptimizer'

describe('fleetOptimizer — toFiniteNumber', () => {
  it('parses numbers, numeric strings, and rejects junk', () => {
    expect(toFiniteNumber(42)).toBe(42)
    expect(toFiniteNumber('1,200')).toBe(1200)
    expect(toFiniteNumber('')).toBeNull()
    expect(toFiniteNumber(null)).toBeNull()
    expect(toFiniteNumber(undefined)).toBeNull()
    expect(toFiniteNumber('abc')).toBeNull()
  })
})

describe('fleetOptimizer — costPerKm', () => {
  it('computes annual_cost / annual_km', () => {
    expect(costPerKm({ annual_cost: 12000, annual_km: 60000 })).toBeCloseTo(0.2)
  })

  it('returns null on divide-by-zero (annual_km = 0)', () => {
    expect(costPerKm({ annual_cost: 12000, annual_km: 0 })).toBeNull()
  })

  it('returns null when km is negative or non-numeric', () => {
    expect(costPerKm({ annual_cost: 12000, annual_km: -5 })).toBeNull()
    expect(costPerKm({ annual_cost: 12000, annual_km: 'x' })).toBeNull()
  })

  it('returns null when cost is missing', () => {
    expect(costPerKm({ annual_km: 60000 })).toBeNull()
    expect(costPerKm(null)).toBeNull()
    expect(costPerKm({})).toBeNull()
  })

  it('coerces numeric strings', () => {
    expect(costPerKm({ annual_cost: '10,000', annual_km: '50,000' })).toBeCloseTo(0.2)
  })
})

describe('fleetOptimizer — suggestRecommendation', () => {
  it('returns review when no signals are present', () => {
    expect(suggestRecommendation({})).toBe('review')
    expect(suggestRecommendation(null)).toBe('review')
    expect(suggestRecommendation({ annual_cost: 5000 })).toBe('review')
  })

  it('disposes chronically idle old assets (util < 30 && age >= 7)', () => {
    expect(suggestRecommendation({ utilization_pct: 20, age_years: 7 })).toBe('dispose')
    expect(suggestRecommendation({ utilization_pct: 29, age_years: 9 })).toBe('dispose')
  })

  it('replaces on end of economic life (age >= 8 || downtime > 45)', () => {
    // age >= 8 with healthy utilisation (not a dispose case)
    expect(suggestRecommendation({ utilization_pct: 80, age_years: 8 })).toBe('replace')
    // high downtime, young asset
    expect(suggestRecommendation({ utilization_pct: 80, age_years: 2, downtime_days: 60 })).toBe('replace')
  })

  it('prioritises dispose over replace when both apply', () => {
    // util < 30 && age >= 7, and age >= 8 → dispose wins (evaluated first)
    expect(suggestRecommendation({ utilization_pct: 10, age_years: 9 })).toBe('dispose')
  })

  it('redeploys under-utilised but viable assets (util < 40)', () => {
    expect(suggestRecommendation({ utilization_pct: 35, age_years: 3 })).toBe('redeploy')
    // util < 40 but age < 30-threshold and not old → redeploy, not dispose
    expect(suggestRecommendation({ utilization_pct: 25, age_years: 4 })).toBe('redeploy')
  })

  it('keeps assets performing within targets', () => {
    expect(suggestRecommendation({ utilization_pct: 70, age_years: 3, downtime_days: 5 })).toBe('keep')
    expect(suggestRecommendation({ utilization_pct: 40, age_years: 1 })).toBe('keep')
  })

  it('does not dispose when age signal is missing even if idle', () => {
    // util < 30 but no age → cannot confirm dispose; falls to redeploy (util < 40)
    expect(suggestRecommendation({ utilization_pct: 20 })).toBe('redeploy')
  })
})

describe('fleetOptimizer — summariseOptimizer', () => {
  it('returns zeroed summary for empty / non-array input', () => {
    expect(summariseOptimizer([])).toEqual({
      totalAssets: 0, keepCount: 0, replaceCount: 0, redeployCount: 0,
      disposeCount: 0, totalProjectedSaving: 0, avgUtilization: 0,
    })
    expect(summariseOptimizer()).toEqual({
      totalAssets: 0, keepCount: 0, replaceCount: 0, redeployCount: 0,
      disposeCount: 0, totalProjectedSaving: 0, avgUtilization: 0,
    })
  })

  it('counts recommendations, sums saving and averages utilisation', () => {
    const rows = [
      { recommendation: 'keep', projected_saving: 0, utilization_pct: 80 },
      { recommendation: 'replace', projected_saving: 5000, utilization_pct: 60 },
      { recommendation: 'redeploy', projected_saving: 2000, utilization_pct: 30 },
      { recommendation: 'dispose', projected_saving: 8000, utilization_pct: 10 },
      { recommendation: 'review', projected_saving: null, utilization_pct: null },
    ]
    const s = summariseOptimizer(rows)
    expect(s.totalAssets).toBe(5)
    expect(s.keepCount).toBe(1)
    expect(s.replaceCount).toBe(1)
    expect(s.redeployCount).toBe(1)
    expect(s.disposeCount).toBe(1)
    expect(s.totalProjectedSaving).toBe(15000)
    // avg over the 4 rows that report utilisation: (80+60+30+10)/4 = 45
    expect(s.avgUtilization).toBe(45)
  })

  it('coerces string savings and utilisation', () => {
    const rows = [
      { recommendation: 'dispose', projected_saving: '1,500', utilization_pct: '20' },
    ]
    const s = summariseOptimizer(rows)
    expect(s.totalProjectedSaving).toBe(1500)
    expect(s.avgUtilization).toBe(20)
  })
})

describe('fleetOptimizer — byRecommendation', () => {
  it('groups by recommendation sorted by saving desc', () => {
    const rows = [
      { recommendation: 'keep', projected_saving: 0 },
      { recommendation: 'replace', projected_saving: 3000 },
      { recommendation: 'replace', projected_saving: 2000 },
      { recommendation: 'dispose', projected_saving: 9000 },
    ]
    const out = byRecommendation(rows)
    expect(out[0]).toEqual({ recommendation: 'dispose', count: 1, saving: 9000 })
    expect(out[1]).toEqual({ recommendation: 'replace', count: 2, saving: 5000 })
    expect(out[2]).toEqual({ recommendation: 'keep', count: 1, saving: 0 })
  })

  it('buckets missing recommendation under review', () => {
    const out = byRecommendation([{ projected_saving: 100 }])
    expect(out).toHaveLength(1)
    expect(out[0].recommendation).toBe('review')
    expect(out[0].count).toBe(1)
    expect(out[0].saving).toBe(100)
  })

  it('returns [] for empty input', () => {
    expect(byRecommendation([])).toEqual([])
    expect(byRecommendation()).toEqual([])
  })
})

describe('fleetOptimizer — underutilised', () => {
  it('returns assets below 40% utilisation, worst first', () => {
    const rows = [
      { asset_no: 'A', utilization_pct: 80 },
      { asset_no: 'B', utilization_pct: 35 },
      { asset_no: 'C', utilization_pct: 10 },
      { asset_no: 'D', utilization_pct: 39 },
    ]
    const out = underutilised(rows)
    expect(out.map((r) => r.asset_no)).toEqual(['C', 'B', 'D'])
  })

  it('excludes rows without a numeric utilisation and at/above 40%', () => {
    const rows = [
      { asset_no: 'A', utilization_pct: 40 },
      { asset_no: 'B', utilization_pct: null },
      { asset_no: 'C' },
      { asset_no: 'D', utilization_pct: 15 },
    ]
    expect(underutilised(rows).map((r) => r.asset_no)).toEqual(['D'])
  })

  it('returns [] for empty / non-array input', () => {
    expect(underutilised([])).toEqual([])
    expect(underutilised()).toEqual([])
  })
})
