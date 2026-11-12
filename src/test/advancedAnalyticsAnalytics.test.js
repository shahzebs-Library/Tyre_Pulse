import { describe, it, expect } from 'vitest'
import {
  cutoffDate, isoDay, kmLife, filterRecords, uniqueSites, summarizeKpis,
  applyLR, trendDirection, addForecastMonthLabels, buildTrend, buildSeasonal,
  buildGeo, buildCountry, buildBranch, buildVehicle, buildDriver, buildBrand,
  buildFailure, heatColor, isHighRisk,
} from '../lib/advancedAnalyticsAnalytics'

const NOW = new Date(2026, 8, 26) // 26 Sep 2026, local

const rec = (o) => ({
  asset_no: 'TM1', site: 'NHC', brand: 'TRIANGLE', position: 'LHF1 Steer', risk_level: 'Low',
  category: 'Worn', km_at_fitment: 1000, km_at_removal: 51000, cost_per_tyre: 1000,
  issue_date: '2026-05-10', ...o,
})

const ROWS = [
  rec({}),
  rec({ asset_no: 'TM2', site: 'DIRIYAH-G1', brand: 'PIRELLI', risk_level: 'High', category: 'Blowout', issue_date: '2026-06-02', position: 'Drive RHR1' }),
  rec({ asset_no: 'TM2', site: 'DIRIYAH-G1', brand: 'PIRELLI', risk_level: 'Critical', category: 'Blowout', issue_date: '2026-06-15', km_at_removal: null, cost_per_tyre: 2000 }),
  rec({ asset_no: 'TM3', site: 'NHC', issue_date: '2024-01-01', position: 'Spare' }),
]

describe('advancedAnalyticsAnalytics', () => {
  it('computes preset cutoffs from local calendar days', () => {
    expect(cutoffDate('all', NOW)).toBeNull()
    expect(cutoffDate('3mo', NOW)).toBe('2026-06-26')
    expect(cutoffDate('1yr', NOW)).toBe('2025-09-26')
    expect(cutoffDate('bogus', NOW)).toBe('2025-09-26')
    expect(isoDay(new Date(2026, 0, 5))).toBe('2026-01-05')
  })

  it('kmLife is null when not measurable', () => {
    expect(kmLife(rec({}))).toBe(50000)
    expect(kmLife(rec({ km_at_removal: null }))).toBeNull()
    expect(kmLife(rec({ km_at_removal: 500 }))).toBeNull()
  })

  it('filters by preset, site, position and search', () => {
    expect(filterRecords(ROWS, { preset: '1yr' }, NOW)).toHaveLength(3)
    expect(filterRecords(ROWS, { preset: 'all' }, NOW)).toHaveLength(4)
    expect(filterRecords(ROWS, { preset: 'all', site: 'NHC' }, NOW)).toHaveLength(2)
    expect(filterRecords(ROWS, { preset: 'all', position: 'Drive' }, NOW)).toHaveLength(1)
    expect(filterRecords(ROWS, { preset: 'all', position: 'Other' }, NOW)).toHaveLength(1)
    expect(filterRecords(ROWS, { preset: 'all', search: 'pirelli' }, NOW)).toHaveLength(2)
    expect(uniqueSites(ROWS)).toEqual(['DIRIYAH-G1', 'NHC'])
  })

  it('summarizes KPIs and returns nulls for an empty set', () => {
    const k = summarizeKpis(filterRecords(ROWS, { preset: '1yr' }, NOW))
    expect(k.records).toBe(3)
    expect(k.totalCost).toBe(4000)
    expect(k.highRisk).toBe(2)
    expect(k.failureRate).toBeCloseTo(66.67, 1)
    expect(k.avgLife).toBe(50000)
    expect(k.vehicles).toBe(2)
    const empty = summarizeKpis([])
    expect(empty.totalCost).toBeNull()
    expect(empty.failureRate).toBeNull()
    expect(empty.avgCpk).toBeNull()
    expect(empty.avgLife).toBeNull()
  })

  it('forecasts and classifies trend direction', () => {
    const f = applyLR([1, 2, 3], 2)
    expect(f.forecast).toEqual([4, 5])
    expect(trendDirection(f.slope)).toBe('worsening')
    expect(trendDirection(-1)).toBe('improving')
    expect(trendDirection(0)).toBe('stable')
    expect(applyLR([5, 3, 1], 3).forecast.every(v => v >= 0)).toBe(true)
    expect(addForecastMonthLabels(['2026-11', '2026-12'], 2)).toEqual(['2027-01 (F)', '2027-02 (F)'])
    expect(addForecastMonthLabels([], 2)).toEqual([])
  })

  it('builds trend data with null CPK for unmeasurable months', () => {
    const t = buildTrend([rec({ km_at_removal: null, issue_date: '2026-01-01' }), rec({ issue_date: '2026-02-01' })])
    expect(t.labels).toEqual(['2026-01', '2026-02'])
    expect(t.cpkVals[0]).toBeNull()
    expect(t.cpkVals[1]).toBeCloseTo(0.02)
    expect(buildTrend([])).toBeNull()
  })

  it('seasonal months without records read null, not 0', () => {
    const s = buildSeasonal(ROWS)
    const jan = s.seasons.find(x => x.key === '01')
    const mar = s.seasons.find(x => x.key === '03')
    expect(jan.count).toBe(1)
    expect(mar.failPct).toBeNull()
    expect(mar.avgCost).toBeNull()
    expect(s.cpkByMonth[2]).toBeNull()
    expect(s.worstCostMonth.key).toBe('06')
  })

  it('builds geo, country, branch and brand views', () => {
    const f = filterRecords(ROWS, { preset: 'all' }, NOW)
    const geo = buildGeo(f)
    expect(geo.sites.length).toBe(2)
    expect(geo.heatmap[0].row.some(v => v === null)).toBe(true)
    const c = buildCountry(f)
    expect(c.regions.map(r => r.region).sort()).toEqual(['DIRIYAH', 'NHC'])
    const b = buildBranch(f)
    expect(b.branches[0].rank).toBe(1)
    expect(b.branches.every(x => Number.isFinite(x.compositeScore))).toBe(true)
    const br = buildBrand(f)
    expect(br.brands[0].rank).toBe(1)
    expect(br.brandMonthly.length).toBeGreaterThan(0)
  })

  it('flags CPK outliers and ranks worst vehicles', () => {
    const rows = Array.from({ length: 10 }, (_, i) => rec({ asset_no: `A${i}`, cost_per_tyre: 1000 }))
    rows.push(rec({ asset_no: 'OUT', cost_per_tyre: 100000 }))
    const v = buildVehicle(rows)
    expect(v.outlierCount).toBe(1)
    expect(v.vehicles.find(x => x.assetNo === 'OUT').isOutlier).toBe(true)
    const d = buildDriver(rows, v)
    expect(d.worst10[0].assetNo).toBe('OUT')
    expect(d.worst10[0].rank).toBe(1)
    const none = buildVehicle([rec({ km_at_removal: null })])
    expect(none.cpkMean).toBeNull()
    expect(none.outlierCount).toBe(0)
  })

  it('builds failure patterns over High and Critical only', () => {
    const f = buildFailure(filterRecords(ROWS, { preset: 'all' }, NOW))
    expect(f.totalFailures).toBe(2)
    expect(f.catEntries[0]).toEqual(['Blowout', 2])
    expect(f.kmCounts.find(b => b.label === '30-60K').count).toBe(3)
    expect(isHighRisk({ risk_level: 'Critical' })).toBe(true)
    expect(isHighRisk({ risk_level: 'Medium' })).toBe(false)
  })

  it('heatColor clamps and handles a flat range', () => {
    expect(heatColor(5, 5, 5)).toBe('rgba(59,130,246,0.3)')
    expect(heatColor(100, 0, 10)).toBe(heatColor(10, 0, 10))
  })
})

describe('applyGridAssetCost (one tyre cost source per vehicle)', () => {
  const base = {
    vehicles: [
      { assetNo: 'TM1', totalCost: 100, avgCpk: 0.01 },
      { assetNo: 'tm2 ', totalCost: 900, avgCpk: 0.02 },
      { assetNo: 'TM3', totalCost: 500, avgCpk: null },
    ],
    top20Cost: [],
  }
  it('takes each vehicle cost from the grid map and rebuilds the ranking', async () => {
    const { applyGridAssetCost } = await import('../lib/advancedAnalyticsAnalytics')
    const map = new Map([['TM1', { amount: 700, currency: 'SAR' }], ['TM2', { amount: 50, currency: 'SAR' }]])
    const out = applyGridAssetCost(base, map)
    expect(out.costBasis).toBe('grid')
    expect(out.vehicles.map((v) => v.totalCost)).toEqual([700, 50, null])
    expect(out.top20Cost.map((v) => v.assetNo)).toEqual(['TM1', 'tm2 '])
    // CPK is not a cost total and stays on the per-fitment rule.
    expect(out.vehicles[0].avgCpk).toBe(0.01)
  })
  it('a vehicle with no grid line reads null, never 0', async () => {
    const { applyGridAssetCost } = await import('../lib/advancedAnalyticsAnalytics')
    expect(applyGridAssetCost(base, new Map()).vehicles.every((v) => v.totalCost === null)).toBe(true)
  })
  it('keeps tyre record prices, and says so, when there is no grid map', async () => {
    const { applyGridAssetCost } = await import('../lib/advancedAnalyticsAnalytics')
    const out = applyGridAssetCost(base, null)
    expect(out.costBasis).toBe('tyre_records')
    expect(out.vehicles[1].totalCost).toBe(900)
    expect(applyGridAssetCost(null, new Map())).toBeNull()
  })
})
