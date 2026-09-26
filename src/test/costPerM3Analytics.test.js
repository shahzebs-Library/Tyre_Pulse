import { describe, it, expect } from 'vitest'
import {
  buildSiteManagerReview, reviewText, rateOf, measurability, regionTableRows, filterRegions,
  REGION_SORT_ACCESSORS, sortRows, pctChange, monthTableRows, costPerM3Kpis, regionExportRows,
  REGION_EXPORT_COLS, regionExportHeaders, monthExportRows, studioCatalogFor, TOO_LITTLE,
} from '../lib/costPerM3Analytics'

const TOTAL = { internal_cost: 90000, tyre_cost: 20000, sco_cost: 5000, sany_cost: 5000, grand_total: 100000, production_m3: 8524, cost_per_m3: 11.73 }
const REGIONS = [
  { region: 'Central', internal_cost: 60000, sco_cost: 3000, sany_cost: 2000, grand_total: 65000, production_m3: 8000, cost_per_m3: 8.125 },
  { region: 'Western', internal_cost: 25000, sco_cost: 2000, sany_cost: 3000, grand_total: 30000, production_m3: 524, cost_per_m3: 57.25 },
  { region: 'Unassigned', internal_cost: 5000, sco_cost: 0, sany_cost: 0, grand_total: 5000, production_m3: 0, cost_per_m3: null },
]

describe('costPerM3Analytics - guard and rates', () => {
  it('classifies measurability against MIN_M3_FOR_RATE', () => {
    expect(measurability(REGIONS[0])).toBe('measurable')
    expect(measurability(REGIONS[1])).toBe('too_little')
    expect(measurability(REGIONS[2])).toBe('no_production')
  })
  it('rateOf prefers the RPC figure and falls back to grand / production', () => {
    expect(rateOf({ cost_per_m3: 5 })).toBe(5)
    expect(rateOf({ grand_total: 100, production_m3: 50 })).toBe(2)
    expect(rateOf({ grand_total: 100, production_m3: 0 })).toBeNull()
  })
  it('region rows withhold an unreadable rate and carry the share of total', () => {
    const rows = regionTableRows(REGIONS, TOTAL)
    expect(rows[0]._rate).toBeCloseTo(8.125)
    expect(rows[1]._rate).toBeNull()
    expect(rows[0]._share).toBeCloseTo(65)
  })
})

describe('costPerM3Analytics - filters and sorting', () => {
  const rows = regionTableRows(REGIONS, TOTAL)
  it('filters by search and measurability', () => {
    expect(filterRegions(rows, { search: 'west' }).map((r) => r.region)).toEqual(['Western'])
    expect(filterRegions(rows, { measure: 'too_little' }).map((r) => r.region)).toEqual(['Western'])
    expect(filterRegions(rows, {})).toHaveLength(3)
  })
  it('sorts unreadable rates last in either direction', () => {
    const asc = sortRows(rows, { key: 'rate', dir: 'asc' }, REGION_SORT_ACCESSORS).map((r) => r.region)
    const desc = sortRows(rows, { key: 'rate', dir: 'desc' }, REGION_SORT_ACCESSORS).map((r) => r.region)
    expect(asc[0]).toBe('Central')
    expect(desc[0]).toBe('Central')
  })
})

describe('costPerM3Analytics - months', () => {
  const MONTHS = [
    { month: '2026-03', grand_total: 120, production_m3: 2000, cost_per_m3: 0.06 },
    { month: '2026-01', grand_total: 100, production_m3: 2000, cost_per_m3: 0.05 },
    { month: '2026-02', grand_total: 0, production_m3: 500, cost_per_m3: 0 },
  ]
  it('pctChange is null without an honest base', () => {
    expect(pctChange(0, 10)).toBeNull()
    expect(pctChange(null, 10)).toBeNull()
    expect(pctChange(100, 120)).toBeCloseTo(20)
  })
  it('computes chronological change and peak share whatever the input order', () => {
    const rows = monthTableRows(MONTHS)
    const mar = rows.find((r) => r.month === '2026-03')
    const jan = rows.find((r) => r.month === '2026-01')
    expect(jan._momGrand).toBeNull()
    expect(mar._momGrand).toBeNull() // Feb grand is 0: no base
    expect(mar._pctOfPeak).toBe(100)
    expect(rows.find((r) => r.month === '2026-02')._measure).toBe('too_little')
  })
})

describe('costPerM3Analytics - KPIs', () => {
  it('passes the RPC headline through and ranks regions', () => {
    const k = costPerM3Kpis({ total: TOTAL, regions: REGIONS, months: [], rejections: { ok: true, total: 76 } })
    expect(k.costPerM3).toBe(11.73)
    expect(k.periodMeasurable).toBe(true)
    expect(k.topRegion.region).toBe('Central')
    expect(k.measurableRegions).toBe(1)
    expect(k.unmeasurableRegions).toBe(2)
    expect(k.cheapestRegion.region).toBe('Central')
    expect(k.dearestRegion).toBeNull()
    expect(k.rejectedM3).toBe(76)
    expect(k.rejectedShare).toBeCloseTo((76 / (8524 + 76)) * 100)
  })
  it('keeps unavailable pieces null, never zero', () => {
    const k = costPerM3Kpis({ total: null, regions: [], months: [], rejections: { ok: false, total: null } })
    expect(k.grandTotal).toBeNull()
    expect(k.costPerM3).toBeNull()
    expect(k.rejectedM3).toBeNull()
    expect(k.rolling.rate).toBeNull()
    expect(k.rolling.grand).toBeNull()
  })
  it('withholds a thin rolling rate', () => {
    const thin = costPerM3Kpis({ months: [{ month: '2026-01', grand_total: 900, production_m3: 500 }] })
    expect(thin.rolling.measurable).toBe(false)
    expect(thin.rolling.rate).toBeNull()
    const ok = costPerM3Kpis({ months: [{ month: '2026-01', grand_total: 1000, production_m3: 2000 }] })
    expect(ok.rolling.rate).toBeCloseTo(0.5)
  })
})

describe('costPerM3Analytics - exports and review', () => {
  it('region export rows are guarded and reconcile to a TOTAL row', () => {
    const out = regionExportRows(regionTableRows(REGIONS, TOTAL), TOTAL)
    expect(Object.keys(out[0]).sort()).toEqual([...REGION_EXPORT_COLS].sort())
    expect(regionExportHeaders('SAR')).toHaveLength(REGION_EXPORT_COLS.length)
    expect(out[0].cost_per_m3).toBe('8.13')
    expect(out[1].cost_per_m3).toBe(TOO_LITTLE)
    expect(out[2].cost_per_m3).toBe('N/A')
    expect(out[3]).toMatchObject({ region: 'TOTAL', grand_total: 100000, cost_per_m3: '11.73' })
  })
  it('month export carries the change column', () => {
    const out = monthExportRows(monthTableRows([
      { month: '2026-01', grand_total: 100, production_m3: 2000 },
      { month: '2026-02', grand_total: 150, production_m3: 2000 },
    ]))
    expect(out.find((r) => r.month === '2026-02').mom).toBe('+50.0%')
    expect(out.find((r) => r.month === '2026-01').mom).toBe('N/A')
  })
  it('site-manager review flags cost with no production and outliers', () => {
    const review = buildSiteManagerReview({ regions: REGIONS, total: TOTAL, currency: 'SAR', label: 'This month', rejections: { ok: true, total: 10, by_site: [{ site: 'NHC', rejected_m3: 10 }], by_reason: [] } })
    expect(review.lines[0]).toContain('SAR 100,000')
    expect(review.issues.some((i) => i.startsWith('Unassigned recorded'))).toBe(true)
    expect(review.issues.some((i) => i.includes('Western cost/m3'))).toBe(true)
    expect(review.issues.some((i) => i.includes('Most at NHC'))).toBe(true)
    const text = reviewText({ review, country: 'KSA', label: 'This month' })
    expect(text).toContain('Issues to action:')
    expect(text).not.toMatch(/[–—]/)
  })
  it('review says so when nothing was recorded', () => {
    expect(buildSiteManagerReview({ label: 'X' }).lines[0]).toBe('No cost or approved production was recorded for X.')
  })
  it('studio catalog leaves unreadable regions out of the rate chart', () => {
    const cat = studioCatalogFor(REGIONS, [])
    expect(cat.find((c) => c.key === 'cpm3_region').rows.map((r) => r.label)).toEqual(['Central'])
  })
})
