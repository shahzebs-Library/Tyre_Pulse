import { describe, it, expect } from 'vitest'
import { buildBrandMetrics, summarizeBrands, brandExportRows } from '../lib/brandPerformanceAnalytics'
import { MOVED, REFIT } from './lifetimeFixture.helpers'

describe('brandPerformanceAnalytics on physical tyres', () => {
  it('one tyre on three vehicles: one tyre, priced once, km summed', () => {
    const a = buildBrandMetrics(MOVED)[0]
    expect(a.tyres).toBe(1)
    expect(a.pricedCount).toBe(1)
    expect(a.totalCost).toBe(900)
    expect(a.avgCost).toBe(900)
    expect(a.avgLifeKm).toBe(80000)
    expect(a.lifetimeCpk).toBeCloseTo(900 / 80000, 10)
    expect(a.cpkKind).toBe('fleet_aggregate')
  })

  it('a refit is not a second purchase', () => {
    const b = buildBrandMetrics(REFIT)[0]
    expect(b.totalCost).toBe(800) // was 1600
    expect(b.pricedCount).toBe(1) // was 2 priced rows
    expect(b.avgCost).toBe(800)
    expect(b.lifetimeCpk).toBeCloseTo(800 / 40000, 10)
    const s = summarizeBrands(buildBrandMetrics(REFIT))
    expect(s.pricedPct).toBe(100) // 1 priced of 1 physical tyre
    const ex = brandExportRows(buildBrandMetrics(REFIT))[0]
    expect(ex.tyres).toBe(1)
    expect(ex.lifetime_cpk).toBeCloseTo(0.02, 5)
  })

  it('event metrics stay per fitment row', () => {
    const a = buildBrandMetrics(MOVED)[0]
    expect(a.count).toBe(3)
    expect(a.ratedCount).toBe(3)
    expect(a.highRiskCount).toBe(1)
    expect(a.failureRate).toBeCloseTo(100 / 3)
  })
})
