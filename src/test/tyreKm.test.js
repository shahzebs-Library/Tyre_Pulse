import { describe, it, expect } from 'vitest'
import { tyreKmAssessment, tyreLifeCapKm } from '../lib/tyreKm'

/**
 * The T7 km rule (docs/tyre/BUSINESS_RULES.md), pinned. MIRROR of SQL
 * public.tyre_km_life / tyre_life_km_cap - a change here is a change to a
 * business rule, argue it, do not re-baseline.
 */
describe('tyreLifeCapKm - class caps (owner-confirmed 2026-11-04)', () => {
  it('mixer 80k, pump 56k, loader 15k, else 100k', () => {
    expect(tyreLifeCapKm('TR-MIXER')).toBe(80000)
    expect(tyreLifeCapKm('CONCRETE PUMP')).toBe(56000)
    expect(tyreLifeCapKm('WHEEL_LOADER')).toBe(15000)
    expect(tyreLifeCapKm('BUS')).toBe(100000)
    expect(tyreLifeCapKm(null)).toBe(100000)
  })
})

describe('tyreKmAssessment - the six T7 cases', () => {
  const t = (o) => ({ vehicle_type: 'TR-MIXER', ...o })
  it('measured: fitment > 1 and removal > fitment', () => {
    const a = tyreKmAssessment(t({ km_at_fitment: 10000, km_at_removal: 55000 }))
    expect([a.status, a.km]).toEqual(['measured', 45000])
  })
  it('measured via total_km when fitment > 1', () => {
    const a = tyreKmAssessment(t({ km_at_fitment: 2, total_km: 40000 }))
    expect([a.status, a.km]).toEqual(['measured', 40000])
  })
  it('placeholder: fitment odometer typed as 1 -> unknown', () => {
    const a = tyreKmAssessment(t({ km_at_fitment: 1, km_at_removal: 230000, total_km: 229999 }))
    expect([a.status, a.km]).toEqual(['placeholder', null])
  })
  it('factory: fitted new at 0 km -> real, km = removal/total', () => {
    const a = tyreKmAssessment(t({ km_at_fitment: 0, km_at_removal: 45000 }))
    expect([a.status, a.km]).toEqual(['factory', 45000])
  })
  it('over_cap: a mixer life above the 80k cap is a reading error -> unknown', () => {
    const a = tyreKmAssessment(t({ km_at_fitment: 10000, km_at_removal: 100000 }))
    expect([a.status, a.km]).toEqual(['over_cap', null])
    expect(a.reportedKm).toBe(90000)
  })
  it('missing: nothing recorded -> unknown', () => {
    const a = tyreKmAssessment(t({}))
    expect([a.status, a.km]).toEqual(['missing', null])
  })
})

describe('tyreKmAssessment - class fallback (F-E-04)', () => {
  it('uses the row vehicle_type when present', () => {
    // mixer cap 80k: 95k over cap on a mixer row
    const a = tyreKmAssessment({ vehicle_type: 'TR-MIXER', km_at_fitment: 10000, km_at_removal: 95000 })
    expect(a.status).toBe('over_cap')
    expect(a.cap).toBe(80000)
  })
  it('falls back to opts.vehicleClass only when the row has no class', () => {
    // blank row type + fleet class mixer: 85k is over the 80k mixer cap
    const a = tyreKmAssessment({ vehicle_type: '', km_at_fitment: 10000, km_at_removal: 95000 }, { vehicleClass: 'TR-MIXER' })
    expect(a.cap).toBe(80000)
    expect(a.status).toBe('over_cap')
  })
  it('a correct row type is never overridden by a junk fleet class', () => {
    // row says BUS (cap 100k), fleet junk type -> keep the row's cap, 95k measured
    const a = tyreKmAssessment({ vehicle_type: 'BUS', km_at_fitment: 10000, km_at_removal: 95000 }, { vehicleClass: 'VEH TYPE/CATEGORY' })
    expect(a.cap).toBe(100000)
    expect([a.status, a.km]).toEqual(['measured', 85000])
  })
  it('with no option and no row type it is the 100k default (unchanged)', () => {
    const a = tyreKmAssessment({ km_at_fitment: 10000, km_at_removal: 95000 })
    expect(a.cap).toBe(100000)
    expect([a.status, a.km]).toEqual(['measured', 85000])
  })
})
