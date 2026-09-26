import { describe, it, expect } from 'vitest'
import {
  calcCpk, normaliseRecords, filterRecords, optionsFrom, scopeCurrency,
  groupBySite, groupByBrand, groupByVehicle, groupByMonth, buildRecordKpis,
  buildSpendKpis, periodMonths, cpkDelta, buildAnomalies, roiFor, topShare,
  movingAvg, monthKey, monthLabel, productionSummary,
} from '../lib/costCenterAnalytics'

const ksa = (o) => ({ country: 'KSA', ...o })

describe('calcCpk', () => {
  it('divides cost by the km run', () => {
    expect(calcCpk(1000, 0, 50000)).toBeCloseTo(0.02)
    expect(calcCpk('1000', '10000', '60000')).toBeCloseTo(0.02)
  })
  it('is null when unmeasurable, never 0', () => {
    expect(calcCpk(null, 0, 1000)).toBeNull()
    expect(calcCpk(0, 0, 1000)).toBeNull()
    expect(calcCpk(1000, 5000, 5000)).toBeNull()
    expect(calcCpk(1000, 0, null)).toBeNull()
  })
})

describe('normalise + filter', () => {
  const rows = normaliseRecords([
    ksa({ asset_no: 'TM1', site: 'NHC', brand: 'TRIANGLE', cost_per_tyre: 1000, km_at_fitment: 0, km_at_removal: 50000, removal_reason: 'Burst', risk_level: 'High' }),
    ksa({ asset_no: 'TM2', site: 'JED', brand: 'PIRELLI', cost_per_tyre: null }),
  ])
  it('marks priced rows and keeps unpriced cost at 0 without counting it', () => {
    expect(rows[0].priced).toBe(true)
    expect(rows[1].priced).toBe(false)
    expect(rows[0].currency).toBe('SAR')
    expect(rows[0].failed).toBe(true)
    expect(rows[0].highRisk).toBe(true)
  })
  it('filters by site, brand and search', () => {
    expect(filterRecords(rows, { site: 'NHC' })).toHaveLength(1)
    expect(filterRecords(rows, { brand: 'PIRELLI' })).toHaveLength(1)
    expect(filterRecords(rows, { q: 'tm2' })).toHaveLength(1)
    expect(filterRecords(rows, {})).toHaveLength(2)
    expect(optionsFrom(rows, 'siteKey')).toEqual(['JED', 'NHC'])
  })
})

describe('currency safety', () => {
  const mixed = normaliseRecords([
    ksa({ asset_no: 'A', site: 'S1', brand: 'B', cost_per_tyre: 100, km_at_removal: 1000 }),
    { country: 'UAE', asset_no: 'C', site: 'S1', brand: 'B', cost_per_tyre: 100, km_at_removal: 1000 },
  ])
  it('never sums a group that spans currencies', () => {
    const [site] = groupBySite(mixed)
    expect(site.mixedCurrency).toBe(true)
    expect(site.totalCost).toBeNull()
    expect(site.avgCpk).toBeNull()
  })
  it('reports a mixed scope and withholds the fleet CPK', () => {
    expect(scopeCurrency(mixed)).toBe('MIXED')
    const k = buildRecordKpis(mixed)
    expect(k.mixedCurrency).toBe(true)
    expect(k.fleetAvgCpk).toBeNull()
  })
  it('uses the fallback currency for rows with no known country', () => {
    expect(scopeCurrency(normaliseRecords([{ cost_per_tyre: 5 }]), 'SAR')).toBe('SAR')
  })
})

describe('groupings', () => {
  const rows = normaliseRecords([
    ksa({ asset_no: 'A', site: 'N', brand: 'X', cost_per_tyre: 300, km_at_removal: 10000, created_at: '2026-01-05' }),
    ksa({ asset_no: 'A', site: 'N', brand: 'X', cost_per_tyre: 100, km_at_removal: 10000, created_at: '2026-02-05', removal_reason: 'damage' }),
    ksa({ asset_no: 'B', site: 'J', brand: 'Y', cost_per_tyre: null, created_at: '2026-02-09' }),
  ])
  it('averages cost over PRICED tyres only', () => {
    const n = groupBySite(rows).find(s => s.site === 'N')
    expect(n.totalCost).toBe(400)
    expect(n.avgCost).toBe(200)
    const j = groupBySite(rows).find(s => s.site === 'J')
    expect(j.totalCost).toBeNull()
    expect(j.avgCost).toBeNull()
  })
  it('ranks brands by CPK with unmeasurable last, and reports failure rate', () => {
    const b = groupByBrand(rows)
    expect(b[0].brand).toBe('X')
    expect(b[0].rank).toBe(1)
    expect(b[0].failureRate).toBe(50)
    expect(b[1].avgCpk).toBeNull()
  })
  it('flags vehicle trend against the fleet average and unknown without one', () => {
    const v = groupByVehicle(rows, { fleetAvgCpk: 0.01 })
    expect(v.find(x => x.asset === 'A').trend).toBe('up')
    expect(groupByVehicle(rows).find(x => x.asset === 'A').trend).toBe('unknown')
  })
  it('groups months oldest first', () => {
    expect(groupByMonth(rows).map(m => m.month)).toEqual(['2026-01', '2026-02'])
  })
})

describe('spend KPIs from the governed split', () => {
  const split = { tyre: 12000, maintenance: 3000, blended: false, currency: 'SAR', byMonth: [{ month: '2026-01' }] }
  it('derives burn and annualised from the grid figure, not records', () => {
    const k = buildSpendKpis(split, { from: '2026-01-01', to: '2026-12-31', fleetAvgCpk: 2 })
    expect(k.spend).toBe(12000)
    expect(k.monthlyBurn).toBeGreaterThan(900)
    expect(k.annualized).toBeCloseTo(k.monthlyBurn * 12)
    expect(k.savings).toBeCloseTo(k.annualized * 0.15)
  })
  it('savings read 0 when within benchmark, null when CPK unknown', () => {
    expect(buildSpendKpis(split, { from: '2026-01-01', to: '2026-12-31', fleetAvgCpk: 1 }).savings).toBe(0)
    expect(buildSpendKpis(split, { from: '2026-01-01', to: '2026-12-31' }).savings).toBeNull()
  })
  it('withholds money for a blended scope', () => {
    const k = buildSpendKpis({ ...split, blended: true }, { from: '2026-01-01', to: '2026-12-31' })
    expect(k.spend).toBeNull()
    expect(k.monthlyBurn).toBeNull()
  })
  it('is all null with no split', () => {
    expect(buildSpendKpis(null).spend).toBeNull()
  })
})

describe('periodMonths', () => {
  const now = new Date('2026-07-01T00:00:00Z')
  it('measures a bounded window', () => {
    expect(periodMonths({ from: '2026-01-01', to: '2026-07-01', now })).toBeCloseTo(181 / 30.44, 1)
  })
  it('falls back to the first data month for an open start', () => {
    expect(periodMonths({ to: '2026-07-01', firstMonth: '2026-04', now })).toBeGreaterThan(2)
  })
  it('is null when unmeasurable instead of inventing 12', () => {
    expect(periodMonths({ now })).toBeNull()
  })
})

describe('anomalies, ROI and helpers', () => {
  it('flags vehicles over 2x and sites over 1.3x the fleet CPK', () => {
    const items = buildAnomalies({
      vehicles: [{ asset: 'A', avgCpk: 3 }, { asset: 'B', avgCpk: 1 }],
      sites: [{ site: 'S', avgCpk: 1.5 }],
      brands: [{ brand: 'X', failureRate: 30, failures: 3, count: 10 }, { brand: 'Y', failureRate: null }],
      fleetAvgCpk: 1,
    })
    expect(items.map(i => `${i.type}:${i.id}`)).toEqual(['vehicle:A', 'site:S', 'brand:X'])
  })
  it('skips CPK anomalies with no fleet average', () => {
    expect(buildAnomalies({ vehicles: [{ asset: 'A', avgCpk: 3 }] })).toEqual([])
  })
  it('ROI is null without a burn rate', () => {
    expect(roiFor(10, null).annualSavings).toBeNull()
    const r = roiFor(10, 1000)
    expect(r.monthlySavings).toBe(100)
    expect(r.annualSavings).toBe(1200)
    expect(r.paybackMonths).toBeCloseTo(0.5)
  })
  it('cpkDelta bands and nulls', () => {
    expect(cpkDelta(1.02, 1).direction).toBe('flat')
    expect(cpkDelta(1.5, 1).direction).toBe('up')
    expect(cpkDelta(null, 1)).toBeNull()
  })
  it('topShare, movingAvg, month helpers, production summary', () => {
    expect(topShare([{ totalCost: 80 }, { totalCost: 20 }, { totalCost: null }], 1)).toBe(80)
    expect(topShare([])).toBeNull()
    expect(movingAvg([1, 2, 3], 2)).toEqual([1, 1.5, 2.5])
    expect(monthKey('2026-03-15')).toBe('2026-03')
    expect(monthKey(null)).toBe('Unknown')
    expect(monthLabel('2026-03')).toBe('Mar 2026')
    expect(productionSummary([{ m3: 10, site: 'A' }, { m3: '5', site: 'A' }, { m3: null, site: 'B' }])).toEqual({ entries: 3, m3: 15, sites: 2 })
  })
})
