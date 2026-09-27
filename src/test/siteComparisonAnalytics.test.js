import { describe, it, expect } from 'vitest'
import {
  periodKey, buildPeriodBuckets, slicePeriods, trendSeries, riskBand,
  siteRegister, summarizeSites, filterSites, siteExportRows,
} from '../lib/siteComparisonAnalytics'

const recs = [
  { site: 'NHC', issue_date: '2026-01-05', cost_per_tyre: 1000, qty: 2, risk_level: 'High', brand: 'A', category: 'Drive' },
  { site: 'NHC', issue_date: '2026-02-05', cost_per_tyre: 500, qty: 1, risk_level: 'Low', brand: 'A', category: 'Drive' },
  { site: 'NHC', issue_date: '2026-02-09', cost_per_tyre: null, qty: 1, risk_level: null, brand: 'B', category: 'Steer' },
  { site: 'JED', issue_date: '2026-01-10', cost_per_tyre: 800, qty: 1, risk_level: null, brand: 'C', category: null },
  { site: 'RUMAH', issue_date: '2026-03-01', cost_per_tyre: null, qty: 1, risk_level: null, brand: null, category: null },
]

describe('siteComparisonAnalytics', () => {
  it('builds period keys per granularity and rejects bad dates', () => {
    expect(periodKey('2026-05-14', 'Monthly')).toBe('2026-05')
    expect(periodKey('2026-05-14', 'Quarterly')).toBe('2026 Q2')
    expect(periodKey('2026-05-14', 'Yearly')).toBe('2026')
    expect(periodKey('nope')).toBeNull()
    expect(periodKey(null)).toBeNull()
  })

  it('buckets priced cost only and slices to the window', () => {
    const b = buildPeriodBuckets(recs.filter((r) => r.site === 'NHC'), 'Monthly')
    expect(b).toEqual([
      { period: '2026-01', total: 2000, count: 1, priced: 1 },
      { period: '2026-02', total: 500, count: 2, priced: 1 },
    ])
    const many = Array.from({ length: 20 }, (_, i) => ({ period: String(i) }))
    expect(slicePeriods(many, 'Monthly')).toHaveLength(12)
    expect(slicePeriods(many, 'Quarterly')).toHaveLength(8)
    expect(slicePeriods(many, 'Yearly')).toHaveLength(5)
  })

  it('trend series share an axis and leave unpriced periods null', () => {
    const t = trendSeries(recs, ['NHC', 'RUMAH'], 'Monthly')
    expect(t.periods).toEqual(['2026-01', '2026-02', '2026-03'])
    expect(t.series[0].values).toEqual([2000, 500, null])
    expect(t.series[1].values).toEqual([null, null, null])
  })

  it('bands risk honestly, unrated is not normal', () => {
    expect(riskBand(null)).toBe('Unrated')
    expect(riskBand(50)).toBe('High')
    expect(riskBand(20)).toBe('Elevated')
    expect(riskBand(0)).toBe('Normal')
  })

  it('register carries coverage and never fabricates a 0% risk rate', () => {
    const reg = siteRegister(recs, { selected: ['NHC'] })
    const nhc = reg.find((r) => r.site === 'NHC')
    const rumah = reg.find((r) => r.site === 'RUMAH')
    const jed = reg.find((r) => r.site === 'JED')
    expect(nhc.totalCost).toBe(2500)
    expect(nhc.pricedCount).toBe(2)
    expect(nhc.pricedPct).toBe(67)
    expect(nhc.ratedCount).toBe(2)
    expect(nhc.highRiskPct).toBe(50)
    expect(nhc.selected).toBe(true)
    expect(jed.highRiskPct).toBeNull()
    expect(jed.riskBand).toBe('Unrated')
    expect(jed.topCategory).toBe('N/A')
    expect(rumah.totalCost).toBeNull()
    expect(rumah.costShare).toBeNull()
    expect(rumah.costIndex).toBeNull()
    expect(nhc.costShare + jed.costShare).toBeCloseTo(100)
    // average priced site = (2500 + 800) / 2 = 1650
    expect(nhc.costIndex).toBe(Math.round((2500 / 1650) * 100))
  })

  it('summarises the scope with nulls where unmeasurable', () => {
    const s = summarizeSites(siteRegister(recs))
    expect(s.sites).toBe(3)
    expect(s.records).toBe(5)
    expect(s.totalCost).toBe(3300)
    expect(s.pricedPct).toBe(60)
    expect(s.ratedPct).toBe(40)
    expect(s.highRiskPct).toBe(50)
    expect(s.topCostSite).toBe('NHC')
    expect(s.riskiestSite).toBe('NHC')
    expect(s.costSpread).toBeCloseTo(2500 / 800)
    const empty = summarizeSites([])
    expect(empty.totalCost).toBeNull()
    expect(empty.highRiskPct).toBeNull()
    expect(empty.pricedPct).toBeNull()
  })

  it('filters by search, band and comparison scope', () => {
    const reg = siteRegister(recs, { selected: ['JED'] })
    expect(filterSites(reg, { search: 'jed' }).map((r) => r.site)).toEqual(['JED'])
    expect(filterSites(reg, { band: 'Unrated' }).map((r) => r.site).sort()).toEqual(['JED', 'RUMAH'])
    expect(filterSites(reg, { scope: 'selected' }).map((r) => r.site)).toEqual(['JED'])
    expect(filterSites(reg, { search: 'drive' }).map((r) => r.site)).toEqual(['NHC'])
  })

  it('export rows print N/A instead of zero', () => {
    const rows = siteExportRows(siteRegister(recs))
    const rumah = rows.find((r) => r.site === 'RUMAH')
    expect(rumah.totalCost).toBe('N/A')
    expect(rumah.highRiskPct).toBe('N/A')
    expect(rumah.topBrand).toBe('N/A')
  })
})
