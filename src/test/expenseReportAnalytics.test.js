import { describe, it, expect } from 'vitest'
import {
  aggregateTyres, buildExpenseExport, monthLabel, currencyForCountryCode,
  siteTableRows, siteTableSummary, filterSiteRows, cpkTypeRows, cpkTypeSummary,
} from '../lib/expenseReportAnalytics'

describe('expenseReportAnalytics - site register', () => {
  const rows = [
    { site: 'NHC', tyre: 10, spare: 5, oil: 1, total: 16, lines: 4 },
    { site: 'Unmapped: RM01', tyre: 2, spare: null, oil: 1, total: 3, lines: 1 },
    { site: 'JED', total: null, lines: 2 },
  ]

  it('flags unmapped store codes and keeps missing amounts null', () => {
    const out = siteTableRows(rows)
    expect(out[1]).toMatchObject({ unmapped: true, storeCode: 'RM01', label: 'RM01' })
    expect(out[1].spare).toBeNull()
    expect(out[2].total).toBeNull()
    expect(out[0].unmapped).toBe(false)
  })

  it('summarises spend, top site and the unmapped share', () => {
    const s = siteTableSummary(rows)
    expect(s.sites).toBe(3)
    expect(s.total).toBe(19)
    expect(s.lines).toBe(7)
    expect(s.topSite).toBe('NHC')
    expect(s.unmapped).toBe(1)
    expect(s.unmappedShare).toBeCloseTo(3 / 19)
  })

  it('reports N/A (null) totals when nothing is measurable', () => {
    const s = siteTableSummary([{ site: 'X', total: null }])
    expect(s.total).toBeNull()
    expect(s.unmappedShare).toBeNull()
    expect(siteTableSummary([]).total).toBeNull()
  })

  it('filters by mapping state and search text', () => {
    const shaped = siteTableRows(rows)
    expect(filterSiteRows(shaped, { mapping: 'unmapped' })).toHaveLength(1)
    expect(filterSiteRows(shaped, { mapping: 'mapped' })).toHaveLength(2)
    expect(filterSiteRows(shaped, { search: 'rm0' })).toHaveLength(1)
  })
})

describe('expenseReportAnalytics - CPK by type', () => {
  it('keeps CPK null without a denominator and finds the worst measurable type', () => {
    const src = [
      { vehicle_type: 'MIXER', country: 'KSA', currency: 'SAR', unit: 'km', cpk_total: 0.5, distance_or_hours: 100 },
      { vehicle_type: 'PUMP', country: 'KSA', unit: 'engine_hours', cpk_total: null },
      { vehicle_type: 'LOADER', country: 'UAE', currency: 'AED', unit: 'km', cpk_total: 0.9 },
    ]
    const rows = cpkTypeRows(src)
    expect(rows[1].cpk_total).toBeNull()
    expect(rows[1].currency).toBe('KSA')
    const s = cpkTypeSummary(src)
    expect(s).toMatchObject({ types: 3, measured: 2, unmeasured: 1, worstType: 'LOADER', worstCountry: 'UAE' })
  })
})

describe('expenseReportAnalytics - shared helpers', () => {
  it('labels months and passes other keys through', () => {
    expect(monthLabel('2026-03')).toMatch(/Mar/)
    expect(monthLabel('Q1')).toBe('Q1')
  })

  it('resolves currency per country with a fallback', () => {
    expect(currencyForCountryCode('UAE')).toBe('AED')
    expect(currencyForCountryCode('Mars', 'USD')).toBe('USD')
  })

  it('never blends currencies in the All-countries export', () => {
    const out = buildExpenseExport({
      isAll: true,
      byCountry: [{ country: 'KSA', total: 10, tyre: 1, spare: 2, oil: 3, lines: 1 }, { country: 'UAE', total: 5 }],
    })
    expect(out.columns).toEqual(['country', 'section', 'name', 'SAR', 'AED', 'count'])
  })

  it('aggregates tyre quantity only inside the window', () => {
    const agg = aggregateTyres([
      { site: 'A', issue_date: '2026-01-10', qty: 2, cost_per_tyre: 100, total_km: 1000 },
      { site: 'A', issue_date: '2025-01-10', qty: 5 },
    ], '2026-01-01', '2026-12-31')
    expect(agg.total).toBe(2)
    expect(agg.cpkSite[0].value).toBeCloseTo(0.2)
  })
})
