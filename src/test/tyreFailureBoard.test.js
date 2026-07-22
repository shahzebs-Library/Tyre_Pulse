import { describe, it, expect } from 'vitest'
import { buildTyreFailureBoard } from '../lib/tyreFailureBoard'

// A small fixture: active + removed rows with real CPK-computable data.
// A record is "CPK valid" when km_at_fitment > 0, km_at_removal > fitment, cost > 0.
const FIXTURE = [
  // Removed, valid CPK: 100 / (60000-10000) = 0.002
  { serial_no: 'S1', asset_no: 'A1', brand: 'BrandX', position: 'Steer', site: 'NHC', status: 'Removed', removal_reason: 'Puncture', cost_per_tyre: 100, km_at_fitment: 10000, km_at_removal: 60000, qty: 1 },
  // Removed, valid CPK: 200 / (80000-20000) = 0.00333
  { serial_no: 'S2', asset_no: 'A1', brand: 'BrandX', position: 'Drive', site: 'NHC', status: 'Removed', removal_reason: 'Worn Out', cost_per_tyre: 200, km_at_fitment: 20000, km_at_removal: 80000, qty: 1 },
  // Removed, valid CPK on asset A2: 300 / (50000-5000) = 0.00667
  { serial_no: 'S3', asset_no: 'A2', brand: 'BrandY', position: 'Steer', site: 'RED SEA', status: 'Removed', removal_reason: 'Puncture', cost_per_tyre: 300, km_at_fitment: 5000, km_at_removal: 50000, qty: 1 },
  // Active, has price but not removed (no km_at_removal -> not CPK valid)
  { serial_no: 'S4', asset_no: 'A3', brand: 'BrandY', position: 'Drive', site: 'RED SEA', status: 'Active', removal_reason: null, cost_per_tyre: 150, km_at_fitment: 3000, km_at_removal: null, qty: 1 },
  // Active, no price
  { serial_no: 'S5', asset_no: 'A3', brand: 'BrandX', position: 'Trailer', site: 'NHC', status: 'Active', removal_reason: null, cost_per_tyre: null, km_at_fitment: 0, km_at_removal: null, qty: 1 },
]

describe('tyreFailureBoard engine', () => {
  it('returns honest empty structure for empty input', () => {
    const b = buildTyreFailureBoard([])
    expect(b.kpis.totalCount).toBe(0)
    expect(b.kpis.activeCount).toBe(0)
    expect(b.kpis.removedCount).toBe(0)
    expect(b.kpis.withPriceCount).toBe(0)
    expect(b.kpis.fleetAvgCpk).toBeNull()
    expect(b.kpis.avgLifeKm).toBeNull()
    expect(b.kpis.failureRatePct).toBeNull()
    expect(b.failureReasons.labels).toEqual([])
    expect(b.worstAssets).toEqual([])
    expect(b.statusSplit.labels).toEqual(['Active', 'Removed'])
    expect(b.statusSplit.datasets[0].data).toEqual([0, 0])
  })

  it('handles non-array input defensively', () => {
    const b = buildTyreFailureBoard(null)
    expect(b.kpis.totalCount).toBe(0)
  })

  it('counts status split, active/removed and priced correctly', () => {
    const b = buildTyreFailureBoard(FIXTURE)
    expect(b.kpis.totalCount).toBe(5)
    expect(b.kpis.removedCount).toBe(3)
    expect(b.kpis.activeCount).toBe(2)
    expect(b.kpis.withPriceCount).toBe(4) // 4 rows have cost > 0
    expect(b.statusSplit.datasets[0].data).toEqual([2, 3])
    // failure rate = removed / total = 3/5 = 60%
    expect(b.kpis.failureRatePct).toBe(60)
  })

  it('buckets failure reasons over removed rows, sorted desc', () => {
    const b = buildTyreFailureBoard(FIXTURE)
    // Puncture x2 (S1, S3), Worn Out x1 (S2)
    expect(b.failureReasons.labels[0]).toBe('Puncture')
    expect(b.failureReasons.datasets[0].data[0]).toBe(2)
    expect(b.failureReasons.labels).toContain('Worn Out')
    // active rows (null reason) are NOT counted
    const total = b.failureReasons.datasets[0].data.reduce((s, v) => s + v, 0)
    expect(total).toBe(3)
  })

  it('computes fleet avg CPK and avg life from valid rows only', () => {
    const b = buildTyreFailureBoard(FIXTURE)
    expect(b.kpis.fleetAvgCpk).toBeGreaterThan(0)
    expect(b.kpis.avgLifeKm).toBeGreaterThan(0)
  })

  it('groups removed tyres by position', () => {
    const b = buildTyreFailureBoard(FIXTURE)
    // removed positions: Steer x2, Drive x1
    const byLabel = Object.fromEntries(b.byPosition.labels.map((l, i) => [l, b.byPosition.datasets[0].data[i]]))
    expect(byLabel.Steer).toBe(2)
    expect(byLabel.Drive).toBe(1)
    expect(byLabel.Trailer).toBeUndefined() // active tyre excluded
  })

  it('returns worst assets sorted by CPK descending', () => {
    const b = buildTyreFailureBoard(FIXTURE)
    expect(b.worstAssets.length).toBeGreaterThan(0)
    // A2 (0.00667) has worse CPK than A1 (avg of 0.002 and 0.00333)
    expect(b.worstAssets[0].asset_no).toBe('A2')
    for (let i = 1; i < b.worstAssets.length; i++) {
      expect(b.worstAssets[i - 1].avgCpk).toBeGreaterThanOrEqual(b.worstAssets[i].avgCpk)
    }
  })

  it('emits chart data without colour keys', () => {
    const b = buildTyreFailureBoard(FIXTURE)
    for (const cd of [b.statusSplit, b.failureReasons, b.cpkByBrand, b.cpkBySite, b.lifeByBrand, b.byPosition]) {
      expect(cd.datasets[0]).not.toHaveProperty('backgroundColor')
      expect(cd.datasets[0]).not.toHaveProperty('borderColor')
    }
  })
})
