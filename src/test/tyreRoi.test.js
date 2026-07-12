import { describe, it, expect } from 'vitest'
import { computeTyreRoi, ROI_DEFAULTS } from '../lib/tyreRoi'

describe('computeTyreRoi', () => {
  it('produces a coherent result set from the defaults', () => {
    const r = computeTyreRoi(ROI_DEFAULTS)
    expect(r.totalTyres).toBe(ROI_DEFAULTS.fleet_size * ROI_DEFAULTS.avg_tyres_per_vehicle) // 300
    expect(r.totalAnnualSavings).toBeGreaterThan(0)
    expect(r.programmeAnnualCost).toBe(300 * 35 * 12)
    expect(r.netAnnualBenefit).toBe(r.totalAnnualSavings - r.programmeAnnualCost)
    expect(r.breakdown.every((b) => b.value > 0)).toBe(true)
    expect(r.projection).toHaveLength(3)
    // cumulative: year 2 savings == 2× year 1
    expect(r.projection[1].savings).toBe(r.projection[0].savings * 2)
  })

  it('improves CPKM and never below the floor', () => {
    expect(computeTyreRoi({ current_cpkm: 0.04 }).improvedCpkm).toBeCloseTo(0.0328, 4)
    expect(computeTyreRoi({ current_cpkm: 0.01 }).improvedCpkm).toBe(0.02) // floor
  })

  it('retread adoption adds savings', () => {
    const without = computeTyreRoi({ retread_adoption_pct: 0 }).totalAnnualSavings
    const with40 = computeTyreRoi({ retread_adoption_pct: 40 }).totalAnnualSavings
    expect(with40).toBeGreaterThan(without)
  })

  it('is null-safe on empty / garbage input', () => {
    const r = computeTyreRoi({ fleet_size: '', avg_tyres_per_vehicle: 'x', avg_tyre_life_km: 0 })
    expect(Number.isFinite(r.totalAnnualSavings)).toBe(true)
    expect(r.paybackMonths === null || Number.isFinite(r.paybackMonths)).toBe(true)
  })
})
