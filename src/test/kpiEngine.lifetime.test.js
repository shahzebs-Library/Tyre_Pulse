import { describe, it, expect } from 'vitest'
import {
  computeCpkFleet, computeCpkByBrand, computeCpkByAsset, computeCpkBySite,
  computeVendorPerformance, computeWorkshopPerformance, computeReplacementRate,
  computeRetreadPerformance, computeAvgTyreLife,
} from '../lib/kpiEngine'
import { CPK_KIND } from '../lib/tyreLifetime'
import { threeVehicles, sameVehicleRefit, SER_CPK, OTHER_CPK, REFIT_CPK } from './lifetimeFixture.groupD'

describe('kpiEngine on physical tyres (Group D)', () => {
  it('one tyre fitted on 3 vehicles is ONE tyre, priced once, km summed', () => {
    const fleet = computeCpkFleet(threeVehicles())
    expect(fleet.totalCount).toBe(2)          // physical tyres
    expect(fleet.fitmentRows).toBe(4)
    expect(fleet.fleetAvgCpk).toBeCloseTo((1000 + 2000) / (60000 + 40000), 10) // weighted
    expect(fleet.cpkKind).toBe(CPK_KIND.FLEET_AGGREGATE)
    expect(computeAvgTyreLife(threeVehicles()).avgKm).toBeCloseTo((60000 + 40000) / 2, 6)
  })

  it('a refit on the same vehicle is not a second purchase', () => {
    const fleet = computeCpkFleet(sameVehicleRefit())
    expect(fleet.totalCount).toBe(1)
    expect(fleet.fleetAvgCpk).toBeCloseTo(REFIT_CPK, 10)
    const [asset] = computeCpkByAsset(sameVehicleRefit())
    expect(asset.totalCost).toBe(1000)
    expect(asset.avgCpk).toBeCloseTo(REFIT_CPK, 10)
  })

  it('group CPK is weighted (avgCpk), the old mean is kept as meanOfRatios', () => {
    const [site] = computeCpkBySite(threeVehicles().map((r) => ({ ...r, site: 'ONE' })))
    expect(site.avgCpk).toBeCloseTo(3000 / 100000, 10)
    expect(site.weightedCpk).toBe(site.avgCpk)
    expect(site.meanOfRatios).toBeCloseTo((SER_CPK + OTHER_CPK) / 2, 10)
    expect(site.cpkKind).toBe(CPK_KIND.TYRE_LIFETIME)
    expect(site.count).toBe(2)
  })

  it('collapses BEFORE grouping: a tyre whose rows carry two brands is counted once (latest brand)', () => {
    const rows = threeVehicles()
    rows[0].brand = 'Alpha-old' // first fitment typed under another brand
    const brands = computeCpkByBrand(rows)
    expect(brands.find((b) => b.brand === 'Alpha-old')).toBeUndefined()
    expect(brands.find((b) => b.brand === 'Alpha').avgCpk).toBeCloseTo(SER_CPK, 10)
    const vendors = computeVendorPerformance(rows)
    expect(vendors.reduce((s, v) => s + v.count, 0)).toBe(2) // physical tyres, not split
    const alpha = vendors.find((v) => v.brand === 'Alpha')
    expect(alpha.avgCpk).toBeCloseTo(SER_CPK, 10)
    // failure stays per fitment EVENT under the row's own brand
    const old = vendors.find((v) => v.brand === 'Alpha-old')
    expect(old.count).toBe(0)
    expect(old.fitmentCount).toBe(1)
    expect(old.failureRate).toBe(1)
  })

  it('workshop performance groups physical tyres by latest site, risk per row', () => {
    const rows = threeVehicles()
    rows[0].site = 'OLD' // first fitment at another site
    const { bySite } = computeWorkshopPerformance(rows, [])
    const nhc = bySite.find((s) => s.site === 'NHC')
    expect(nhc.avgCpk).toBeCloseTo(SER_CPK, 10)
    expect(nhc.tyreCount).toBe(1)
    const old = bySite.find((s) => s.site === 'OLD')
    expect(old.recordCount).toBe(1)     // event row
    expect(old.highRiskPct).toBe(100)   // per fitment row
    expect(old.tyreCount).toBe(0)
  })

  it('retread vs new CPK is weighted per group', () => {
    const rows = [
      { id: 1, category: 'Retread', cost_per_tyre: 100, km_at_fitment: 0, km_at_removal: 1000 },
      { id: 2, category: 'Retread', cost_per_tyre: 900, km_at_fitment: 0, km_at_removal: 9000 },
      { id: 3, category: 'New', cost_per_tyre: 1000, km_at_fitment: 0, km_at_removal: 10000 },
      { id: 4, category: 'New', cost_per_tyre: 3000, km_at_fitment: 0, km_at_removal: 10000 },
    ]
    const r = computeRetreadPerformance(rows)
    expect(r.retreadCpk).toBeCloseTo(1000 / 10000, 10)
    expect(r.newCpk).toBeCloseTo(4000 / 20000, 10)
  })

  it('replacement rate stays per fitment event', () => {
    expect(computeReplacementRate(threeVehicles()).totalReplacements).toBe(4)
  })
})
