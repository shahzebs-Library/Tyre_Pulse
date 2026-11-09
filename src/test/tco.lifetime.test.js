import { describe, it, expect } from 'vitest'
import { computeFleetActuals, computeAssetsActualTco, deriveSavingsInputs, computeMonthlyActualCpk } from '../lib/tco'
import { computeCombinationRollup } from '../lib/combinations'
import { CPK_KIND_LABEL } from '../lib/tyreLifetime'
import { threeVehicles, refitSameVehicle } from './lifetimeFixtures.groupB'

describe('TCO actuals on physical tyres', () => {
  it('one tyre on three vehicles: price once, fleet lifetime CPK over summed km', () => {
    const a = computeFleetActuals(threeVehicles())
    expect(a.rollup.total_tco).toBe(900)
    expect(a.rollup.fleet_lifetime_cpk).toBeCloseTo(900 / 80000, 3)
    expect(a.rollup.fleet_lifetime_cpk_label).toBe(CPK_KIND_LABEL.fleet_aggregate)
    expect(a.savings.tyreCount).toBe(1)
    expect(a.savings.avgTyreCost).toBe(900)
    // The tyre's later assets carry the km they ran but no second purchase.
    const assets = computeAssetsActualTco(threeVehicles())
    expect(assets.find((x) => x.asset_no === 'TM2').tyre_procurement).toBe(0)
    expect(assets.find((x) => x.asset_no === 'TM2').km).toBe(25000)
  })
  it('a same-vehicle refit is not a second purchase', () => {
    const [asset] = computeAssetsActualTco(refitSameVehicle())
    expect(asset.tyre_procurement).toBe(800)
    expect(asset.km).toBe(40000)
    expect(asset.cost_per_km).toBe(0.02)
    expect(deriveSavingsInputs(refitSameVehicle()).tyreCount).toBe(1)
  })
  it('per-asset fitments and monthly buckets stay per fitment row', () => {
    const [asset] = computeAssetsActualTco(refitSameVehicle())
    expect(asset.fitments).toBe(2)
    expect(computeMonthlyActualCpk(threeVehicles())).toHaveLength(3)
  })
})

describe('combination rollup on physical tyres', () => {
  const combo = { prime_mover_no: 'TM1', trailer_nos: 'TM2, TM3' }
  const vehicles = [{ asset_no: 'TM1' }, { asset_no: 'TM2' }, { asset_no: 'TM3' }]
  it('one tyre moved across the unit is ONE tyre, price once, lifetime km', () => {
    const r = computeCombinationRollup(combo, threeVehicles(), vehicles)
    expect(r.tyreCount).toBe(1)
    expect(r.fitments).toBe(3)
    expect(r.totalSpend).toBe(900)
    expect(r.totalKm).toBe(80000)
    expect(r.avgTyreLifeKm).toBe(80000)
    expect(r.blendedCpk).toBeCloseTo(900 / 80000, 3)
    expect(r.canonicalCpk.fleetAvgCpk).toBeCloseTo(900 / 80000, 10)
  })
  it('a same-vehicle refit is not a second purchase', () => {
    const r = computeCombinationRollup({ prime_mover_no: 'TM9' }, refitSameVehicle(), [{ asset_no: 'TM9' }])
    expect(r.totalSpend).toBe(800)
    expect(r.blendedCpk).toBeCloseTo(0.02, 3)
    expect(r.fitments).toBe(2)
  })
})
