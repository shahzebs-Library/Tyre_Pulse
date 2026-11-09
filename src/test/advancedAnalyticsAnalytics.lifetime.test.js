import { describe, it, expect } from 'vitest'
import { summarizeKpis, buildBranch, buildVehicle, buildBrand, buildFailure, ADVANCED_CPK_KIND } from '../lib/advancedAnalyticsAnalytics'
import { MOVED, REFIT } from './lifetimeFixture.helpers'

describe('advancedAnalyticsAnalytics on physical tyres', () => {
  it('one tyre on three vehicles: one tyre, priced once, km summed', () => {
    const k = summarizeKpis(MOVED)
    expect(k.tyres).toBe(1)
    expect(k.totalCost).toBe(900)
    expect(k.avgLife).toBe(80000)
    expect(k.avgCpk).toBeCloseTo(900 / 80000, 10) // was mean of 3 stint ratios
    expect(k.cpkKind).toBe(ADVANCED_CPK_KIND)
    const v = buildVehicle(MOVED).vehicles
    expect(v.find((x) => x.assetNo === 'TM3').avgCpk).toBeCloseTo(900 / 80000, 10)
    expect(v.find((x) => x.assetNo === 'TM1').avgCpk).toBeNull()
  })

  it('a refit is not a second purchase', () => {
    const k = summarizeKpis(REFIT)
    expect(k.totalCost).toBe(800) // was 1600
    expect(k.avgCpk).toBeCloseTo(800 / 40000, 10)
    const br = buildBrand(REFIT).brands[0]
    expect(br.avgCpk).toBeCloseTo(800 / 40000, 10)
    const branch = buildBranch(REFIT).branches[0]
    expect(branch.avgLife).toBe(40000)
  })

  it('records, failures and km-at-removal buckets stay per fitment row', () => {
    const all = [...MOVED, ...REFIT]
    const k = summarizeKpis(all)
    expect(k.records).toBe(5)
    expect(k.highRisk).toBe(2)
    expect(buildFailure(all).kmCounts.reduce((s, b) => s + b.count, 0)).toBe(5)
  })
})
