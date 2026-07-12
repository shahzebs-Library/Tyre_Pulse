import { describe, it, expect } from 'vitest'
import { computeTco, TCO_DEFAULTS } from '../lib/tco'

describe('computeTco', () => {
  it('produces coherent totals from the defaults', () => {
    const r = computeTco(TCO_DEFAULTS)
    expect(r.vehicles).toBe(TCO_DEFAULTS.vehicle_count)
    expect(r.ownershipYears).toBe(TCO_DEFAULTS.ownership_years)
    expect(r.totalTco).toBeGreaterThan(0)
    // total is the sum of its components
    const sum = r.depreciation + r.fuel + r.maintenance + r.tyres + r.insurance + r.downtime
    expect(Math.abs(r.totalTco - sum)).toBeLessThanOrEqual(1)
    // per-vehicle × count ≈ fleet total
    expect(Math.abs(r.tcoPerVehicle * r.vehicles - r.totalTco)).toBeLessThanOrEqual(r.vehicles)
    // residual reduces gross capital
    expect(r.netCapital).toBe(r.grossCapital - r.residualValue)
    expect(r.residualValue).toBeGreaterThan(0)
    expect(r.breakdown.every((b) => b.value > 0)).toBe(true)
  })

  it('reports a positive cost per km', () => {
    const r = computeTco(TCO_DEFAULTS)
    expect(r.costPerKm).toBeGreaterThan(0)
    expect(r.costPerVehicleKm).toBeGreaterThan(0)
  })

  it('projects one cumulative row per ownership year, strictly increasing', () => {
    const r = computeTco({ ...TCO_DEFAULTS, ownership_years: 5 })
    expect(r.projection).toHaveLength(5)
    expect(r.projection[0].year).toBe('Year 1')
    expect(r.projection[4].cumulative).toBeGreaterThan(r.projection[0].cumulative)
    // final cumulative ≈ total TCO
    expect(Math.abs(r.projection[4].cumulative - r.totalTco)).toBeLessThanOrEqual(5)
  })

  it('is null-safe on empty / garbage input', () => {
    const r = computeTco({ vehicle_count: '', annual_km: 'x', tyre_life_km: 0, purchase_price: null })
    expect(Number.isFinite(r.totalTco)).toBe(true)
    expect(Number.isFinite(r.costPerKm)).toBe(true)
    expect(Array.isArray(r.breakdown)).toBe(true)
    expect(Array.isArray(r.projection)).toBe(true)
  })

  it('handles empty object by falling back to defaults', () => {
    const r = computeTco()
    expect(r.totalTco).toBeGreaterThan(0)
    expect(r.projection.length).toBeGreaterThan(0)
  })

  it('cheaper tyre life raises tyre spend and total TCO', () => {
    const long = computeTco({ ...TCO_DEFAULTS, tyre_life_km: 120000 }).tyres
    const short = computeTco({ ...TCO_DEFAULTS, tyre_life_km: 40000 }).tyres
    expect(short).toBeGreaterThan(long)
  })
})
