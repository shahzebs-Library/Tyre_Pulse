import { describe, it, expect } from 'vitest'
import { aggregateDrivers, driverKpis } from '../lib/driverManagementAnalytics'
import { threeVehicles, sameVehicleRefit, SER_CPK, OTHER_CPK, REFIT_CPK } from './lifetimeFixture.groupD'

describe('driverManagementAnalytics on physical tyres', () => {
  it('a tyre fitted on 3 vehicles is one tyre, price once, km summed', () => {
    const drivers = aggregateDrivers(threeVehicles())
    const ali = drivers.find((d) => d.name === 'Ali')
    expect(ali.totalTyres).toBe(1)
    expect(ali.totalCost).toBe(1000)
    expect(ali.avgCpk).toBeCloseTo(SER_CPK, 10)
    expect(ali.avgTyreLife).toBe(60000)
    const k = driverKpis(drivers, 4)
    expect(k.fleetAvgCpk).toBeCloseTo(3000 / 100000, 10) // weighted, not (SER+OTHER)/2
    expect(k.fleetAvgCpk).not.toBeCloseTo((SER_CPK + OTHER_CPK) / 2, 6)
  })
  it('a refit on the same vehicle is not a second purchase', () => {
    const [ali] = aggregateDrivers(sameVehicleRefit())
    expect(ali.totalCost).toBe(1000)
    expect(ali.avgCpk).toBeCloseTo(REFIT_CPK, 10)
  })
  it('rated failures stay per fitment row (events)', () => {
    const ali = aggregateDrivers(threeVehicles()).find((d) => d.name === 'Ali')
    expect(ali.fitments).toBe(3)
    expect(ali.ratedTyres).toBe(3)
    expect(ali.highRiskCount).toBe(1)
  })
})
