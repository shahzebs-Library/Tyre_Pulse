import { describe, it, expect } from 'vitest'
import {
  fmtMoney, fmtPct, grainLabels, tyreSharePct, periodTableRows,
  countrySummaryRows, scopeEntries, expenseExportRows, EXPORT_COLUMNS,
} from '../lib/expenseTrendsAnalytics'
import { buildCountryTrend } from '../lib/expenseTrends'

const KSA = {
  country: 'KSA', currency: 'SAR',
  years: [
    { period: '2023', label: '2023', tyre: 100, spare: 200, lubricant: 50, total: 350, lines: 10 },
    { period: '2024', label: '2024', tyre: 150, spare: 250, lubricant: 60, total: 460, lines: 12 },
    { period: '2025', label: '2025', tyre: 0, spare: 0, lubricant: 0, total: 0, lines: 0 },
  ],
}
const UAE = {
  country: 'UAE', currency: 'AED',
  years: [{ period: '2025', label: '2025', tyre: 10, spare: 20, lubricant: 5, total: 35, lines: 3 }],
}

describe('expenseTrendsAnalytics formatting', () => {
  it('renders unmeasurable values as N/A, never 0', () => {
    expect(fmtMoney(null, 'SAR')).toBe('N/A')
    expect(fmtMoney('', 'SAR')).toBe('N/A')
    expect(fmtMoney(1234.6, 'SAR')).toBe('SAR 1,235')
    expect(fmtPct(null)).toBe('N/A')
    expect(fmtPct(12.34)).toBe('+12.3%')
    expect(fmtPct(-5)).toBe('-5%')
  })
  it('names the grain', () => {
    expect(grainLabels('month')).toEqual({ per: 'Month', change: 'MoM', short: 'mo' })
    expect(grainLabels('quarter').change).toBe('QoQ')
    expect(grainLabels().per).toBe('Year')
  })
  it('tyre share is null for a period with no spend', () => {
    expect(tyreSharePct({ tyre: 0, total: 0 })).toBeNull()
    expect(tyreSharePct(null)).toBeNull()
    expect(tyreSharePct({ tyre: 25, total: 100 })).toBe(25)
  })
})

describe('periodTableRows', () => {
  it('labels actuals and forecasts and keeps the timeline order', () => {
    const rows = periodTableRows(buildCountryTrend(KSA, 'year'))
    const kinds = rows.map((r) => r.kind)
    expect(kinds.slice(0, 3)).toEqual(['Actual', 'Actual', 'Actual'])
    expect(kinds.slice(3).every((k) => k === 'Forecast')).toBe(true)
    expect(rows.map((r) => r.order)).toEqual(rows.map((_, i) => i))
    expect(rows[0].change).toBeNull()
    expect(rows[1].change).toBeCloseTo(31.43, 1)
    expect(rows[2].tyreShare).toBeNull()
    expect(rows.find((r) => r.kind === 'Forecast').change).toBeNull()
  })
  it('is empty-safe', () => {
    expect(periodTableRows(null)).toEqual([])
  })
})

describe('countrySummaryRows', () => {
  it('keeps each country in its own currency and sums only its own periods', () => {
    const [ksa, uae] = countrySummaryRows([KSA, UAE], 'year')
    expect(ksa).toMatchObject({ country: 'KSA', currency: 'SAR', periods: 3, total: 810, tyre: 250, lines: 22 })
    expect(ksa.tyreShare).toBeNull() // latest period had no spend
    expect(uae).toMatchObject({ currency: 'AED', total: 35, periods: 1 })
    expect(uae.cagr).toBeNull() // one period cannot grow
    expect(uae.nextForecast).toBeNull()
  })
})

describe('scopeEntries + export', () => {
  it('builds per-country totals without blending', () => {
    expect(scopeEntries([KSA, UAE])).toEqual([
      { country: 'KSA', currency: 'SAR', total: 810, lines: 22 },
      { country: 'UAE', currency: 'AED', total: 35, lines: 3 },
    ])
  })
  it('exports actuals then labelled forecasts per country', () => {
    const rows = expenseExportRows([KSA], 'year')
    expect(rows.filter((r) => r.kind === 'Actual')).toHaveLength(3)
    expect(rows.filter((r) => r.kind === 'Forecast').length).toBeGreaterThan(0)
    expect(rows.every((r) => r.currency === 'SAR')).toBe(true)
    expect(EXPORT_COLUMNS.map(([k]) => k)).toContain('kind')
  })
})
