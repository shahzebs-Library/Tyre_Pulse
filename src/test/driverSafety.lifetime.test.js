import { describe, it, expect } from 'vitest'
import { driverTyreCorrelation } from '../lib/driverSafety'
import { threeVehicles, sameVehicleRefit, SER_CPK, REFIT_CPK } from './lifetimeFixture.groupD'

describe('driverSafety.driverTyreCorrelation on physical tyres', () => {
  it('a tyre fitted on 3 vehicles is one tyre, price once, km summed', () => {
    const ali = driverTyreCorrelation(threeVehicles()).drivers.find((d) => d.driver_name === 'Ali')
    expect(ali.tyres).toBe(1)
    expect(ali.totalCost).toBe(1000)
    expect(ali.lifeKm).toBe(60000)
    expect(ali.driverCpk).toBeCloseTo(Math.round(SER_CPK * 1000) / 1000, 6)
  })
  it('a refit on the same vehicle is not a second purchase', () => {
    const ali = driverTyreCorrelation(sameVehicleRefit()).drivers[0]
    expect(ali.totalCost).toBe(1000)
    expect(ali.driverCpk).toBeCloseTo(Math.round(REFIT_CPK * 1000) / 1000, 6)
  })
  it('removals and fitments stay per row (events)', () => {
    const ali = driverTyreCorrelation(threeVehicles()).drivers.find((d) => d.driver_name === 'Ali')
    expect(ali.fitments).toBe(3)
    expect(ali.removals).toBe(3)
  })
})
