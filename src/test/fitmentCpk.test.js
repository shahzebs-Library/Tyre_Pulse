import { describe, it, expect } from 'vitest'
import { fitmentCpk, fmtCpk } from '../lib/tyreLifetime'

/**
 * The one per-fitment CPK (F-A-02). Proves the single source handles every km rule
 * identically, so no page engine can disagree: placeholder fit=1 and over-cap read
 * N/A, factory fit=0 is real, an unpriced row is N/A (never 0). The old copies each
 * got one of these wrong (calcCpk defaulted missing km to 0; recordCpk nulled a
 * factory 0; tyreCpk used raw total_km with no cap).
 */
describe('fitmentCpk: one source, every km rule', () => {
  it('measured stint (fit > 1, rem > fit): price / (rem - fit)', () => {
    expect(fitmentCpk({ cost_per_tyre: 1800, km_at_fitment: 1000, km_at_removal: 90000 }))
      .toBeCloseTo(1800 / 89000, 10)
  })

  it('factory fit = 0 is a real stint, not "missing"', () => {
    expect(fitmentCpk({ cost_per_tyre: 1800, km_at_fitment: 0, total_km: 50000 }))
      .toBeCloseTo(1800 / 50000, 10)
  })

  it('placeholder fit = 1 is unknown km -> null, never computed from the odometer', () => {
    expect(fitmentCpk({ cost_per_tyre: 1800, km_at_fitment: 1, km_at_removal: 90000 })).toBe(null)
  })

  it('a stint over the class cap is unknown -> null (else cap 100k; mixer cap 80k)', () => {
    expect(fitmentCpk({ cost_per_tyre: 1800, km_at_fitment: 1000, km_at_removal: 200000 })).toBe(null)
    expect(fitmentCpk({ cost_per_tyre: 1800, km_at_fitment: 1000, km_at_removal: 90000, vehicle_type: 'TR-MIXER' })).toBe(null)
    // the same mixer stint under the else cap would measure
    expect(fitmentCpk({ cost_per_tyre: 1800, km_at_fitment: 1000, km_at_removal: 90000 })).toBeCloseTo(1800 / 89000, 10)
  })

  it('no price, zero price or zero km -> null, never a flattering 0', () => {
    expect(fitmentCpk({ cost_per_tyre: null, km_at_fitment: 1000, km_at_removal: 90000 })).toBe(null)
    expect(fitmentCpk({ cost_per_tyre: 0, km_at_fitment: 1000, km_at_removal: 90000 })).toBe(null)
    expect(fitmentCpk({ cost_per_tyre: 1800, km_at_fitment: 1000, km_at_removal: 1000 })).toBe(null)
    expect(fitmentCpk(null)).toBe(null)
  })

  it('opts.vehicleClass supplies the cap when the row has no vehicle_type', () => {
    // 90k stint, loader cap 15k -> over cap -> null
    expect(fitmentCpk({ cost_per_tyre: 1800, km_at_fitment: 1000, km_at_removal: 90000 }, { vehicleClass: 'WHEEL LOADER' })).toBe(null)
  })
})

describe('fmtCpk: one formatter', () => {
  it('currency ahead, unit after, 4 decimals', () => {
    expect(fmtCpk(0.0202, 'SAR')).toBe('SAR 0.0202/km')
    expect(fmtCpk(0.0202, 'SAR', 'hr')).toBe('SAR 0.0202/hr')
    expect(fmtCpk(0.5, '')).toBe('0.5000/km')
  })
  it('null / non-finite -> N/A, never 0.0000', () => {
    expect(fmtCpk(null, 'SAR')).toBe('N/A')
    expect(fmtCpk(undefined)).toBe('N/A')
    expect(fmtCpk(Infinity, 'SAR')).toBe('N/A')
  })
})
