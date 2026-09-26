import { describe, it, expect } from 'vitest'
import {
  buildForecastModel, linearRegression, projectSeries, modelConfidence, dataAnchor,
  monthKeysBack, nextMonthLabels, lineCost, unitsOf, stockStatus, vendorPriority,
  forecastExportRows, trendDirection,
} from '../lib/forecastingEngineAnalytics'

const NOW = new Date(2026, 8, 26)
const rec = (issue_date, extra = {}) => ({ issue_date, site: 'NHC', brand: 'ROADX', qty: 1, cost_per_tyre: 1000, ...extra })

describe('forecastingEngineAnalytics helpers', () => {
  it('prices only tyres that carry a price, and counts units from qty', () => {
    expect(lineCost({ cost_per_tyre: 500, qty: 2 })).toBe(1000)
    expect(lineCost({ cost_per_tyre: null, qty: 2 })).toBeNull()
    expect(lineCost({ cost_per_tyre: 0 })).toBeNull()
    expect(unitsOf({ qty: 0 })).toBe(1)
    expect(unitsOf({ qty: '4' })).toBe(4)
  })

  it('regression skips null months instead of reading them as zero', () => {
    const r = linearRegression([10, null, 30])
    expect(r.points).toBe(2)
    expect(r.slope).toBeCloseTo(10)
    expect(projectSeries([], 3)).toEqual([null, null, null])
    expect(projectSeries([5, 4, 3, 2, 1, 0], 2)).toEqual([0, 0])
  })

  it('anchors on the newest dated row, parsed locally, else the clock', () => {
    const a = dataAnchor([rec('2026-03-15'), rec('2026-07-02')], NOW)
    expect(a.getFullYear()).toBe(2026)
    expect(a.getMonth()).toBe(6)
    expect(dataAnchor([], NOW)).toBe(NOW)
  })

  it('builds month axes from the anchor', () => {
    const keys = monthKeysBack(new Date(2026, 6, 2), 12)
    expect(keys[0]).toBe('2025-08')
    expect(keys[11]).toBe('2026-07')
    expect(nextMonthLabels(new Date(2026, 6, 2), 2)).toEqual(['Aug 2026', 'Sep 2026'])
  })

  it('classifies stock gaps and vendor priority by the stated bands', () => {
    expect(stockStatus(25).key).toBe('under')
    expect(stockStatus(6).key).toBe('monitor')
    expect(stockStatus(-6).key).toBe('over')
    expect(stockStatus(0).key).toBe('ok')
    expect(stockStatus(null).label).toBe('N/A')
    expect(vendorPriority(51)).toBe('High')
    expect(vendorPriority(21)).toBe('Medium')
    expect(vendorPriority(3)).toBe('Low')
    expect(trendDirection(1)).toBe('up')
    expect(trendDirection(0)).toBe('flat')
  })

  it('confidence needs six months of history', () => {
    expect(modelConfidence([1, 2, 3])).toBeNull()
    expect(modelConfidence([2, 2, 2, 2, 2, 2])).toBe(100)
  })
})

describe('buildForecastModel', () => {
  const records = [
    rec('2026-05-01', { qty: 2 }),
    rec('2026-06-01'),
    rec('2026-07-01', { cost_per_tyre: null, risk_level: 'High' }),
    rec('2025-07-01', { site: 'JED' }),
  ]

  it('withholds every money figure when money would blend currencies', () => {
    const m = buildForecastModel({ records, fleet: [{ monthly_tyre_budget: 500 }], moneyAllowed: false, now: NOW })
    expect(m.annualBudget).toBeNull()
    expect(m.monthlyAvgBudget).toBeNull()
    expect(m.recommendedAnnualBudget).toBeNull()
    expect(m.avgCostPerTyre).toBeNull()
    expect(m.lastYearActual).toBeNull()
    expect(m.fleetMonthlyBudgetTarget).toBeNull()
    expect(m.monthsOverBudget).toBeNull()
    expect(m.brands[0].estCost12).toBeNull()
    expect(m.monthlySpend.every((v) => v == null)).toBe(true)
    // demand is currency-free and survives
    expect(m.annualDemand).toBeGreaterThan(0)
  })

  it('averages cost over priced units only and reports the priced share', () => {
    const m = buildForecastModel({ records, moneyAllowed: true, now: NOW })
    expect(m.avgCostPerTyre).toBe(1000)
    // 4 units in the last 12 months (2 + 1 + 1), 3 of them priced
    expect(m.pricedShare).toBeCloseTo(0.75)
  })

  it('months with no records carry no failure rate', () => {
    const m = buildForecastModel({ records, moneyAllowed: true, now: NOW })
    const nulls = m.failureHistory.filter((v) => v == null).length
    expect(nulls).toBeGreaterThan(0)
    expect(m.failureHistory.at(-1)).toBe(100)
  })

  it('scopes to a site and keeps fitted-only sites in the inventory table', () => {
    const m = buildForecastModel({
      records: [...records, { site: 'RUMAH', issue_date: '2020-01-01', km_at_removal: null }],
      site: 'all', moneyAllowed: true, now: NOW,
    })
    expect(m.sites).toEqual(['JED', 'NHC', 'RUMAH'])
    const rumah = m.siteForecast.find((s) => s.site === 'RUMAH')
    expect(rumah.currentStock).toBe(1)
    expect(rumah.forecast12).toBe(0)
    const nhcOnly = buildForecastModel({ records, site: 'JED', moneyAllowed: true, now: NOW })
    expect(nhcOnly.scopedCount).toBe(1)
  })

  it('exports N/A for unmeasurable months', () => {
    const m = buildForecastModel({ records, moneyAllowed: false, now: NOW })
    const rows = forecastExportRows(m, 2, ['Aug 2026', 'Sep 2026'])
    expect(rows).toHaveLength(2)
    expect(rows[0].budget_forecast).toBe('N/A')
    expect(typeof rows[0].demand_forecast).toBe('number')
  })
})
