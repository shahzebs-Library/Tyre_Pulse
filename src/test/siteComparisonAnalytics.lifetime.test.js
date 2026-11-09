import { describe, it, expect } from 'vitest'
import { siteRegister, buildPeriodBuckets, summarizeSites } from '../lib/siteComparisonAnalytics'
import { MOVED, REFIT } from './lifetimeFixture.helpers'

describe('siteComparisonAnalytics with one price per tyre', () => {
  it('one tyre on three vehicles: one tyre, priced once, lifetime km summed', () => {
    const nhc = siteRegister(MOVED).find((r) => r.site === 'NHC')
    expect(nhc.totalCost).toBe(900)
    expect(nhc.avgCost).toBe(900)
    expect(nhc.tyres).toBe(1)
    expect(nhc.avgLifeKm).toBe(80000)
    expect(nhc.lifetimeCpk).toBeCloseTo(900 / 80000, 10)
  })

  it('a refit is not a second purchase', () => {
    const jed = siteRegister(REFIT).find((r) => r.site === 'JED')
    expect(jed.totalCost).toBe(800) // was 1600
    expect(jed.avgCost).toBe(800)
    expect(jed.pricedPct).toBe(100) // refit row counts as priced (bought once)
    const b = buildPeriodBuckets(REFIT, 'Yearly')
    expect(b).toEqual([{ period: '2025', total: 800, count: 2, priced: 2 }])
    expect(summarizeSites(siteRegister(REFIT)).avgCostPerPriced).toBe(800)
  })

  it('record and risk counts stay per fitment row', () => {
    const nhc = siteRegister(MOVED).find((r) => r.site === 'NHC')
    expect(nhc.count).toBe(3)
    expect(nhc.ratedCount).toBe(3)
    expect(nhc.highRiskCount).toBe(1)
  })
})
