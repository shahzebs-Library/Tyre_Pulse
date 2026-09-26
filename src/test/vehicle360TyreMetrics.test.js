import { describe, it, expect } from 'vitest'
import { tyreKmRun, tyreCost, tyreMetrics, isHighRiskTyre } from '../lib/vehicle360Analytics'

describe('vehicle360 tyre metrics', () => {
  it('measures a run only when both readings exist and are plausible', () => {
    expect(tyreKmRun({ km_at_fitment: 1000, km_at_removal: 41000 })).toBe(40000)
    expect(tyreKmRun({ km_at_fitment: 1000, km_at_removal: null })).toBeNull()
    expect(tyreKmRun({ km_at_fitment: 5000, km_at_removal: 1000 })).toBeNull()
    expect(tyreKmRun({ km_at_fitment: 0, km_at_removal: 900000 })).toBeNull()
  })

  it('treats an unpriced tyre as unpriced, not free', () => {
    expect(tyreCost({ cost_per_tyre: 800, qty: 2 })).toBe(1600)
    expect(tyreCost({ cost_per_tyre: null })).toBeNull()
    expect(tyreCost({ cost_per_tyre: 0 })).toBeNull()
  })

  it('returns null ratios for a vehicle with no tyres', () => {
    const m = tyreMetrics([])
    expect(m.total).toBe(0)
    expect(m.highRate).toBeNull()
    expect(m.health).toBeNull()
    expect(m.avgLifeKm).toBeNull()
    expect(m.cpk).toBeNull()
    expect(m.lifeVsTargetPct).toBeNull()
  })

  it('computes cpk over priced and measured tyres only', () => {
    const m = tyreMetrics([
      { km_at_fitment: 0, km_at_removal: 10000, cost_per_tyre: 1000, risk_level: 'High' },
      { km_at_fitment: 0, km_at_removal: 20000, cost_per_tyre: null },
      { km_at_fitment: 0, km_at_removal: null, cost_per_tyre: 500 },
    ], { targetKm: 30000 })
    expect(m.cpk).toBeCloseTo(0.1)
    expect(m.cpkSample).toBe(1)
    expect(m.priced).toBe(2)
    expect(m.avgLifeKm).toBe(15000)
    expect(m.lifeVsTargetPct).toBeCloseTo(50)
    expect(m.critical).toBe(1)
    expect(m.highRate).toBeCloseTo(33.33, 1)
    expect(isHighRiskTyre({ risk_level: 'Critical' })).toBe(true)
  })

  it('does not invent a life target', () => {
    const m = tyreMetrics([{ km_at_fitment: 0, km_at_removal: 10000 }])
    expect(m.lifeVsTargetPct).toBeNull()
  })
})
