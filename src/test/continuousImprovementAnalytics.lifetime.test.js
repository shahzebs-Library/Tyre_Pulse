import { describe, it, expect } from 'vitest'
import { computeMetrics, avgCpkOf, meanLifeKm, failureRateOf, cpkTrend, CI_CPK_KIND } from '../lib/continuousImprovementAnalytics'
import { MOVED, REFIT } from './lifetimeFixture.helpers'

describe('continuousImprovementAnalytics on physical tyres', () => {
  it('one tyre on three vehicles: one tyre, priced once, km summed', () => {
    expect(meanLifeKm(MOVED)).toBe(80000) // was 26,667 (mean of 3 stints)
    expect(avgCpkOf(MOVED)).toBeCloseTo(900 / 80000, 10)
    const m = computeMetrics(MOVED)
    expect(m.tyres).toBe(1)
    expect(m.avgCostPerTyre).toBe(900)
    expect(m.cpkKind).toBe(CI_CPK_KIND)
  })

  it('a refit is not a second purchase', () => {
    const m = computeMetrics(REFIT)
    expect(m.totalCost).toBe(800) // was 1600
    expect(m.avgCostPerTyre).toBe(800)
    expect(m.avgCpk).toBeCloseTo(800 / 40000, 10) // was mean of 800/20000 and 800/20000 = 0.04
    const t = cpkTrend(REFIT, new Date(2025, 11, 15))
    expect(t.values.filter((v) => v != null)).toEqual([800 / 40000])
  })

  it('failure rate and record count stay per fitment row', () => {
    expect(failureRateOf([...MOVED, ...REFIT])).toBeCloseTo((2 / 5) * 100)
    expect(computeMetrics([...MOVED, ...REFIT]).records).toBe(5)
  })
})
