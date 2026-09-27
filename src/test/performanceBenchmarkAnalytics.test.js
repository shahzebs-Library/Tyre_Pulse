import { describe, it, expect } from 'vitest'
import {
  formatBenchmark, benchmarkRating, scopeInspections, measureFleet, benchmarkRows,
  overallScore, brandBenchmarks, improvementTargets, recordCountries,
} from '../lib/performanceBenchmarkAnalytics'

const tyre = (o) => ({ country: 'KSA', site: 'NHC', brand: 'A', cost_per_tyre: 1000, qty: 1, km_at_fitment: 1000, km_at_removal: 101000, asset_no: 'TM1', ...o })

describe('performanceBenchmarkAnalytics', () => {
  it('rates and formats with honest Not measured', () => {
    expect(benchmarkRating('cpk', null)).toEqual({ rating: 'Not measured', score: null, tone: 'none' })
    expect(benchmarkRating('cpk', 0.5).rating).toBe('World Class')
    expect(benchmarkRating('tyre_life', 40000).rating).toBe('Poor')
    expect(formatBenchmark('cpk', 1.234, 'SAR')).toBe('SAR 1.23/km')
    expect(formatBenchmark('tyre_life', 120000)).toBe('120k km')
    expect(formatBenchmark('scrap_rate', null)).toBe('N/A')
  })

  it('measures from the kpiEngine and never fabricates defaults', () => {
    const recs = [tyre({}), tyre({ category: 'Scrap' }), tyre({ asset_no: 'TM2', km_at_removal: null, cost_per_tyre: null })]
    const m = measureFleet(recs, [])
    expect(m.mixedCurrency).toBe(false)
    expect(m.values.tyre_life).toBe(100000)
    expect(m.values.scrap_rate).toBe(50)
    expect(m.values.pressure_compliance).toBeNull()
    expect(m.values.failure_rate).toBeNull()
    expect(m.values.inspection_compliance).toBe(0)
    expect(m.values.cpk).toBeCloseTo(0.01, 5)
  })

  it('withholds cost when currencies are mixed', () => {
    const recs = [tyre({}), tyre({ country: 'UAE' }), tyre({}), tyre({})]
    expect(recordCountries(recs)).toEqual(['KSA', 'UAE'])
    const m = measureFleet(recs, [])
    expect(m.values.cpk).toBeNull()
    expect(brandBenchmarks(recs, { mixedCurrency: true })).toEqual([])
  })

  it('averages only measured metrics', () => {
    const rows = benchmarkRows({ cpk: 0.5, tyre_life: null, failure_rate: 30 })
    expect(rows).toHaveLength(6)
    expect(overallScore(rows)).toBe(55)
    expect(overallScore(benchmarkRows({}))).toBeNull()
    expect(improvementTargets(rows).map((r) => r.key)).toEqual(['failure_rate'])
    expect(rows.find((r) => r.key === 'tyre_life').better).toBeNull()
  })

  it('scopes inspections null-safely by country and site', () => {
    const insp = [{ country: 'KSA', site: 'NHC' }, { country: 'UAE', site: 'NHC' }, { country: null, site: 'JED' }]
    expect(scopeInspections(insp, { country: 'KSA' })).toHaveLength(2)
    expect(scopeInspections(insp, { country: 'KSA', site: 'NHC' })).toHaveLength(1)
    expect(scopeInspections(insp, { country: 'All' })).toHaveLength(3)
  })

  it('ranks brands with at least three costed tyres', () => {
    const recs = [tyre({}), tyre({}), tyre({}), tyre({ brand: 'B' })]
    const b = brandBenchmarks(recs)
    expect(b.map((x) => x.brand)).toEqual(['A'])
    expect(b[0].rank).toBe(1)
  })
})
