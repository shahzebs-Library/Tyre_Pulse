import { describe, it, expect } from 'vitest'
import { classifyAll, computeCauseStats, cpkOf, lineCost, worstVehicles } from '../lib/rootCauseEngineAnalytics'
import { threeVehicles, sameVehicleRefit, SER_CPK, REFIT_CPK } from './lifetimeFixture.groupD'

describe('rootCauseEngineAnalytics on physical tyres', () => {
  it('a tyre fitted on 3 vehicles is one tyre: price once, km summed', () => {
    const rows = threeVehicles().filter((r) => r.serial_no === 'SER1234567')
    expect(cpkOf(classifyAll(rows))).toBeCloseTo(SER_CPK, 10)
  })

  it('a refit on the same vehicle is not a second purchase', () => {
    const c = classifyAll(sameVehicleRefit())
    expect(lineCost(c[0])).toBe(1000)
    expect(lineCost(c[1])).toBeNull() // refit row carries no new purchase
    expect(cpkOf(c)).toBeCloseTo(REFIT_CPK, 10)
  })

  it('cause counts stay per fitment row (events)', () => {
    const rows = sameVehicleRefit().map((r) => ({ ...r, findings: 'low pressure' }))
    const stats = computeCauseStats(classifyAll(rows))
    expect(stats['Under Inflation'].count).toBe(2)
    expect(stats['Under Inflation'].totalCost).toBe(1000)
    expect(worstVehicles(classifyAll(rows))[0].records).toBe(2)
  })
})
