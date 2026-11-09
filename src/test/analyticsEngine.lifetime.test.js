import { describe, it, expect } from 'vitest'
import {
  computeBrandMetrics, computeSiteMetrics, computeAssetMetrics, computeCountryMetrics,
  computeMonthlyKpiActuals, computeTyreLifeAnalysis, computeCpkAnalysis, monthlyTrendWithForecast,
  computeSeasonalTrends, lifetimeMetrics, lifetimeGroups,
} from '../lib/analyticsEngine'
import { CPK_KIND, CPK_KIND_LABEL } from '../lib/tyreLifetime'

const fit = (o) => ({ country: 'KSA', vehicle_type: 'TRUCK', qty: 1, status: 'Removed', ...o })

// One tyre fitted on three vehicles (price once, km 40k + 25k + 15k = 80k).
const MOVED = [
  fit({ id: 'a1', serial_no: 'YMA55310', brand: 'A', site: 'JED', asset_no: 'TM1', issue_date: '2025-01-01', removal_date: '2025-04-01', km_at_fitment: 10000, km_at_removal: 50000, cost_per_tyre: 900, risk_level: 'High' }),
  fit({ id: 'a2', serial_no: 'YMA55310', brand: 'A', site: 'NHC', asset_no: 'TM2', issue_date: '2025-05-01', removal_date: '2025-08-01', km_at_fitment: 200000, km_at_removal: 225000 }),
  fit({ id: 'a3', serial_no: 'YMA55310', brand: 'A', site: 'NHC', asset_no: 'TM3', issue_date: '2025-09-01', removal_date: '2025-12-01', km_at_fitment: 5000, km_at_removal: 20000, risk_level: 'Low' }),
]
// One tyre refitted on the same vehicle; the ERP priced the refit again.
const REFIT = [
  fit({ id: 'b1', serial_no: 'EP0604207', brand: 'B', site: 'NHC', asset_no: 'TM9', issue_date: '2025-01-10', removal_date: '2025-03-01', km_at_fitment: 1000, km_at_removal: 21000, cost_per_tyre: 800 }),
  fit({ id: 'b2', serial_no: 'EP0604207', brand: 'B', site: 'NHC', asset_no: 'TM9', issue_date: '2025-06-10', removal_date: '2025-09-01', km_at_fitment: 40000, km_at_removal: 60000, cost_per_tyre: 800, risk_level: 'High' }),
]
const ALL = [...MOVED, ...REFIT]

describe('analyticsEngine on the physical-tyre lifetime layer', () => {
  it('one tyre on three vehicles is ONE tyre, priced once, km summed', () => {
    const a = computeBrandMetrics(MOVED)[0]
    expect(a.tyres).toBe(1)
    expect(a.count).toBe(3) // fitment rows stay an event count
    expect(a.totalCost).toBe(900)
    expect(a.avgCost).toBe(900)
    expect(a.avgLifeKm).toBe(80000)
    expect(a.lifetimeCpk).toBeCloseTo(900 / 80000, 10)
    expect(a.cpkKind).toBe(CPK_KIND.FLEET_AGGREGATE)
    expect(a.cpkKindLabel).toBe(CPK_KIND_LABEL.fleet_aggregate)
    expect(a.kmCoverage).toEqual({ complete: 1, partial: 0, none: 0 })
  })

  it('a refit on the same vehicle is not a second purchase', () => {
    const b = computeBrandMetrics(REFIT)[0]
    expect(b.totalCost).toBe(800) // was 1600 (refit priced again)
    expect(b.avgCost).toBe(800) // was 800 per row but over 2 rows; now per 1 physical tyre
    expect(b.lifetimeCpk).toBeCloseTo(800 / 40000, 10)
    expect(b.tyres).toBe(1)
    const m = computeMonthlyKpiActuals(REFIT, [], '2025-06')
    expect(m.count).toBe(1) // the refit is still a fitment event
    expect(m.totalCost).toBe(0) // but not a purchase
    expect(m.avgCostPerTyre).toBeNull()
    const trend = monthlyTrendWithForecast(REFIT, 0)
    expect(trend.filter((b) => !b.isForecast).reduce((s, b) => s + b.value, 0)).toBe(800)
    const seasonal = computeSeasonalTrends(REFIT)
    expect(seasonal.reduce((s, m) => s + m.cost, 0)).toBe(800)
  })

  it('groups tyres AFTER collapsing: the tyre goes to the site / asset of its latest fitment', () => {
    const sites = computeSiteMetrics(MOVED)
    const nhc = sites.find((s) => s.site === 'NHC')
    const jed = sites.find((s) => s.site === 'JED')
    expect(nhc.tyres).toBe(1)
    expect(nhc.lifetimeCpk).toBeCloseTo(900 / 80000, 10)
    expect(jed.tyres).toBe(0)
    expect(jed.lifetimeCpk).toBeNull() // not 0
    expect(jed.count).toBe(1) // the JED fitment still counts as an event
    expect(jed.totalCost).toBe(900) // the purchase stays with the first fitment's row
    const assets = computeAssetMetrics(MOVED)
    expect(assets.find((a) => a.assetNo === 'TM3').tyres).toBe(1)
    expect(assets.find((a) => a.assetNo === 'TM1').tyres).toBe(0)
    expect(assets.find((a) => a.assetNo === 'TM1').count).toBe(1)
  })

  it('country CPK is weighted (total cost / total km), not an average of row ratios', () => {
    const [ksa] = computeCountryMetrics(ALL)
    expect(ksa.avgCpk).toBeCloseTo((900 + 800) / (80000 + 40000), 10)
    expect(ksa.tyres).toBe(2)
    expect(ksa.avgCostPerTyre).toBe(850)
    expect(ksa.count).toBe(5)
    expect(ksa.cpkKind).toBe('fleet_aggregate')
  })

  it('tyre life in km is per physical tyre; the replacement interval stays per event', () => {
    const life = computeTyreLifeAnalysis(ALL)
    expect(life.avgLifeKm).toBe(60000) // (80k + 40k) / 2; was 24k (mean of 5 stints)
    expect(life.lifeKmTyres).toBe(2)
    expect(life.lifeKmBasis).toBe('physical_tyre')
    expect(life.totalSamples).toBeGreaterThan(0)
  })

  it('event metrics stay per fitment row', () => {
    const a = computeBrandMetrics(MOVED)[0]
    expect(a.highRiskCount).toBe(1)
    expect(a.failureRate).toBeCloseTo(100 / 3)
    expect(computeBrandMetrics(REFIT)[0].highRiskCount).toBe(1)
  })

  it('unmeasurable values are null, never 0', () => {
    const m = lifetimeMetrics([])
    expect(m.lifetimeCpk).toBeNull()
    expect(m.avgLifeKm).toBeNull()
    expect(m.avgCostPerTyre).toBeNull()
    expect(computeCpkAnalysis(ALL)).toBeNull() // fewer than 3 measurable tyres
    expect(lifetimeGroups(ALL, (t) => t.brand).size).toBe(2)
  })
})
