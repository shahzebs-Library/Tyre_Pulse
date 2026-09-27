import { describe, it, expect } from 'vitest'
import { computeAllKpis } from '../lib/kpiEngine'
import {
  presetRange, monthAxis, headlineMetrics, assetCpkRows, brandScorecardRows, gridCostTrend,
  costModeFigure, failureBySite, inspectionSeries, filterKpiCards, statusCounts, kpiExportRows,
  cpkStatus, lifeStatus, lowerIsBetterPctStatus, higherIsBetterPctStatus, ratedFailurePct, linearFit,
} from '../lib/engineeringKpiAnalytics'

const NOW = new Date(2026, 8, 15) // 15 Sep 2026

const rec = (o) => ({ asset_no: 'TM1', brand: 'A', site: 'NHC', qty: 1, issue_date: '2026-08-01', ...o })

describe('engineeringKpiAnalytics', () => {
  it('presetRange uses the injected clock', () => {
    expect(presetRange('ytd', NOW)).toEqual({ from: '2026-01-01', to: '2026-09-15' })
    expect(presetRange('30d', NOW).to).toBe('2026-09-15')
    expect(presetRange('nope', NOW)).toEqual({ from: '', to: '' })
  })

  it('monthAxis ends at the current month', () => {
    const axis = monthAxis(3, NOW)
    expect(axis).toEqual(['2026-07', '2026-08', '2026-09'])
  })

  it('status bands are neutral for unmeasured values', () => {
    expect(cpkStatus(null)).toBe('neutral')
    expect(cpkStatus(0.5)).toBe('good')
    expect(cpkStatus(2.5)).toBe('critical')
    expect(lifeStatus(0)).toBe('neutral')
    expect(lowerIsBetterPctStatus(null, 15, 30)).toBe('neutral')
    expect(lowerIsBetterPctStatus(40, 15, 30)).toBe('critical')
    expect(higherIsBetterPctStatus(null, 85, 60)).toBe('neutral')
    expect(higherIsBetterPctStatus(90, 85, 60)).toBe('good')
  })

  it('ratedFailurePct is null when nothing is rated, never 0', () => {
    expect(ratedFailurePct([rec({}), rec({})])).toBeNull()
    expect(ratedFailurePct([rec({ risk_level: 'High' }), rec({ risk_level: 'Low' }), rec({})])).toBe(50)
  })

  it('headlineMetrics refuses to report availability or failure without risk ratings', () => {
    const records = [rec({ cost_per_tyre: 1000, km_at_fitment: 1000, km_at_removal: 51000 })]
    const kpis = computeAllKpis(records, [], [], 10)
    const h = headlineMetrics(kpis, { inspectionsLoaded: 0 })
    expect(h.failurePct).toBeNull()
    expect(h.availabilityPct).toBeNull()
    expect(h.inspectionPct).toBeNull()
    expect(h.cpk).toBeCloseTo(0.02, 5)
    expect(h.avgLifeKm).toBe(50000)
  })

  it('assetCpkRows reads tyre spend from the grid only', () => {
    const records = [
      rec({ asset_no: 'TM1', cost_per_tyre: 1000, km_at_fitment: 1000, km_at_removal: 11000, risk_level: 'High' }),
      rec({ asset_no: 'TM2', cost_per_tyre: 500, km_at_fitment: 1000, km_at_removal: 51000 }),
    ]
    const kpis = computeAllKpis(records, [], [], 0)
    const rows = assetCpkRows(kpis, records, new Map([['TM1', 4200]]))
    const tm1 = rows.find(r => r.assetNo === 'TM1')
    const tm2 = rows.find(r => r.assetNo === 'TM2')
    expect(rows[0].assetNo).toBe('TM1') // worst CPK first
    expect(tm1.totalCost).toBe(4200)
    expect(tm2.totalCost).toBeNull() // not a cost_per_tyre sum
    expect(tm1.failurePct).toBe(100)
    expect(tm2.failurePct).toBeNull()
    expect(assetCpkRows(kpis, records, null).every(r => r.totalCost === null)).toBe(true)
  })

  it('brandScorecardRows uses rated failure % and tiers', () => {
    const records = [
      rec({ brand: 'A', cost_per_tyre: 100, km_at_fitment: 1, km_at_removal: 50001 }),
      rec({ brand: 'B', cost_per_tyre: 900, km_at_fitment: 1, km_at_removal: 10001, risk_level: 'Critical' }),
      rec({ brand: 'C', cost_per_tyre: 400, km_at_fitment: 1, km_at_removal: 20001, risk_level: 'Low' }),
    ]
    const rows = brandScorecardRows(computeAllKpis(records, [], [], 0), records)
    expect(rows).toHaveLength(3)
    expect(rows[0].tier).toBe('top')
    expect(rows[2].tier).toBe('middle') // floor(3 * 0.3) = 0 brands in the bottom band
    const a = rows.find(r => r.brand === 'A')
    expect(a.failurePct).toBeNull()
    expect(rows.find(r => r.brand === 'B').failurePct).toBe(100)
  })

  it('gridCostTrend refuses a blended split and fits a line otherwise', () => {
    expect(gridCostTrend({ blended: true, byMonth: [{ month: '2026-01', tyre: 1 }] })).toBeNull()
    expect(gridCostTrend(null)).toBeNull()
    const t = gridCostTrend({ currency: 'SAR', byMonth: [
      { month: '2026-01', tyre: 100, maintenance: 0 },
      { month: '2026-02', tyre: 200, maintenance: 0 },
      { month: '2026-03', tyre: 300, maintenance: 0 },
    ] })
    expect(t.trend).toBe('worsening')
    expect(t.slope).toBeCloseTo(100)
    expect(t.forecastNextMonth).toBeCloseTo(400)
    expect(t.currency).toBe('SAR')
    const one = gridCostTrend({ byMonth: [{ month: '2026-01', tyre: 5 }] })
    expect(one.trend).toBe('insufficient')
    expect(one.forecastNextMonth).toBeNull()
  })

  it('linearFit needs two points', () => {
    expect(linearFit([1])).toBeNull()
    expect(linearFit([0, 2, 4]).slope).toBeCloseTo(2)
  })

  it('costModeFigure never blends currencies', () => {
    const blended = costModeFigure({ blended: true, byCountry: [
      { country: 'KSA', currency: 'SAR', tyre: 10, maintenance: 5 },
      { country: 'UAE', currency: 'AED', tyre: 3, maintenance: 1 },
    ] }, 'combined')
    expect(blended.amount).toBeNull()
    expect(blended.byCountry).toEqual([
      { country: 'KSA', currency: 'SAR', amount: 15 },
      { country: 'UAE', currency: 'AED', amount: 4 },
    ])
    const single = costModeFigure({ blended: false, tyre: 10, maintenance: 5, currency: 'SAR' }, 'maintenance')
    expect(single).toMatchObject({ amount: 5, currency: 'SAR', blended: false })
    expect(costModeFigure(null).amount).toBeNull()
  })

  it('failureBySite skips unrated sites and inspectionSeries leaves gaps null', () => {
    const kpis = { failureRate: { bySite: [{ site: 'A', rate: 0.5, count: 2 }, { site: 'B', rate: null, count: 0 }] },
      inspectionCompliance: { byMonth: [{ month: '2026-08', compliancePct: 90 }] } }
    expect(failureBySite(kpis)).toEqual([{ site: 'A', pct: 50, count: 2 }])
    expect(inspectionSeries(kpis, ['2026-07', '2026-08'])).toEqual([null, 90])
  })

  it('card filtering, counts and export rows', () => {
    const cards = [
      { title: '01. CPK', value: 'SAR 1', status: 'good' },
      { title: '02. Failure', value: 'N/A', status: 'neutral', subValue: 'No tyres rated' },
    ]
    expect(filterKpiCards(cards, { query: 'rated' })).toHaveLength(1)
    expect(filterKpiCards(cards, { status: 'good' })[0].title).toBe('01. CPK')
    expect(statusCounts(cards)).toMatchObject({ all: 2, good: 1, neutral: 1 })
    const rows = kpiExportRows(cards)
    expect(rows[1]).toMatchObject({ no: 2, value: 'N/A', status: 'Not measured' })
  })
})
