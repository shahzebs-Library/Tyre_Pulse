import { describe, it, expect } from 'vitest'
import { currencyFor, comparability, bestValue, pricedCoverage, trendByCountry, comparisonExportRows } from '../lib/countryComparisonAnalytics'

describe('countryComparisonAnalytics', () => {
  it('knows each country currency and refuses cross-currency comparison', () => {
    expect(currencyFor('UAE')).toBe('AED')
    expect(currencyFor('Mars')).toBeNull()
    expect(comparability('currency', ['KSA', 'UAE']).comparable).toBe(false)
    expect(comparability('currency', ['KSA']).comparable).toBe(true)
    expect(comparability('pct', ['KSA', 'UAE']).comparable).toBe(true)
    expect(comparability('cpk', ['KSA', 'Mars']).reason).toMatch(/unknown/)
  })
  it('picks a best value only when comparable', () => {
    expect(bestValue([1, 3, null], true)).toBe(1)
    expect(bestValue([1, 3], false, false)).toBeNull()
    expect(bestValue([1])).toBeNull()
  })
  it('measures priced coverage', () => {
    const c = pricedCoverage([{ country: 'KSA', cost_per_tyre: 10 }, { country: 'KSA' }, { country: 'UAE' }])
    expect(c.KSA.pct).toBe(50)
    expect(c.UAE.pct).toBe(0)
  })
  it('builds per-country trends in their own currency', () => {
    const t = trendByCountry([
      { country: 'KSA', period: '2026-02', currency: 'SAR', total: 200, tyre: 50 },
      { country: 'KSA', period: '2026-01', currency: 'SAR', total: 100, tyre: 20 },
      { country: 'UAE', period: '2026-01', currency: 'AED', total: 70 },
    ], { countries: ['KSA'] })
    expect(t).toHaveLength(1)
    expect(t[0]).toMatchObject({ currency: 'SAR', latest: 200, changePct: 100, periodTotal: 300 })
    expect(t[0].points.map(p => p.period)).toEqual(['2026-01', '2026-02'])
  })
  it('exports with a comparability flag', () => {
    const rows = comparisonExportRows([{ key: 'totalCost', label: 'Total', format: 'currency' }], [{ country: 'KSA', totalCost: 1 }, { country: 'UAE', totalCost: 2 }], (k, v, c) => `${c}:${v}`)
    expect(rows[0]).toEqual({ metric: 'Total', KSA: 'KSA:1', UAE: 'UAE:2', comparable: 'No' })
  })
})
