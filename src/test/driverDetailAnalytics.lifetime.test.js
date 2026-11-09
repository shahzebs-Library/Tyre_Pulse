import { describe, it, expect } from 'vitest'
import { buildDriverView, enrichRecords, aggregateDriver } from '../lib/driverDetailAnalytics'
import { threeVehicles, sameVehicleRefit, SER_CPK, REFIT_CPK } from './lifetimeFixture.groupD'

describe('driverDetailAnalytics on physical tyres', () => {
  it('a tyre fitted on 3 vehicles is one tyre, price once, km summed', () => {
    const v = buildDriverView('Ali', threeVehicles())
    expect(v.totalTyres).toBe(1)
    expect(v.totalCost).toBe(1000)
    expect(v.avgCpk).toBeCloseTo(SER_CPK, 10)
    expect(v.avgTyreLife).toBe(60000)
  })
  it('a refit on the same vehicle is not a second purchase (headline and record table)', () => {
    const a = aggregateDriver('Ali', sameVehicleRefit())
    expect(a.totalCost).toBe(1000)
    expect(a.avgCpk).toBeCloseTo(REFIT_CPK, 10)
    const e = enrichRecords(sameVehicleRefit())
    expect(e[0]._cpk).toBeCloseTo(1000 / 20000, 10) // per-fitment stint
    expect(e[1]._cpk).toBeNull()                     // refit row: no new price
  })
  it('fitments stay per row (events)', () => {
    expect(buildDriverView('Ali', threeVehicles()).fitments).toBe(3)
  })
})
