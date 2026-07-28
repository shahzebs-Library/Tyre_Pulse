import { describe, it, expect } from 'vitest'
import {
  byCountry, yoyTable, latestShare, linearFit, cagr, forecast, insights, buildCountryTrend,
  periodLabel, nextPeriod, periodBounds, filterPeriods, availableYears,
} from '../lib/expenseTrends'

const rows = [
  { country: 'KSA', year: '2023', currency: 'SAR', lines: 10, tyre: 200, spare: 300, lubricant: 100, total: 600 },
  { country: 'KSA', year: '2024', currency: 'SAR', lines: 12, tyre: 300, spare: 320, lubricant: 100, total: 720 },
  { country: 'KSA', year: '2025', currency: 'SAR', lines: 15, tyre: 400, spare: 340, lubricant: 100, total: 840 },
  { country: 'UAE', year: '2025', currency: 'AED', lines: 5, tyre: 50, spare: 50, lubricant: 0, total: 100 },
]

describe('byCountry', () => {
  it('groups per country, keeps currency, sorts years', () => {
    const g = byCountry(rows)
    expect(g.map((c) => c.country)).toEqual(['KSA', 'UAE'])
    const ksa = g[0]
    expect(ksa.currency).toBe('SAR')
    expect(ksa.years.map((y) => y.year)).toEqual(['2023', '2024', '2025'])
  })
  it('never blends currencies', () => {
    const g = byCountry(rows)
    expect(g[1].currency).toBe('AED')
  })
})

describe('yoyTable', () => {
  it('computes delta and pct vs prior year, null for first', () => {
    const y = yoyTable(byCountry(rows)[0].years)
    expect(y[0].pct).toBeNull()
    expect(y[1].delta).toBe(120)
    expect(Math.round(y[1].pct)).toBe(20) // 600 -> 720
    expect(Math.round(y[2].pct)).toBe(17) // 720 -> 840
  })
})

describe('latestShare', () => {
  it('splits the latest year into category percentages', () => {
    const s = latestShare(byCountry(rows)[0].years)
    const tyre = s.find((x) => x.category === 'tyre')
    expect(tyre.value).toBe(400)
    expect(Math.round(tyre.pct)).toBe(48) // 400/840
  })
})

describe('linearFit + forecast', () => {
  it('fits a perfect line and predicts the next point', () => {
    const fit = linearFit([100, 200, 300])
    expect(fit.slope).toBe(100)
    expect(fit.predict(3)).toBe(400)
  })
  it('returns null with fewer than 2 points', () => {
    expect(linearFit([5])).toBeNull()
  })
  it('forecast extrapolates totals and floors at 0', () => {
    const f = forecast(byCountry(rows)[0].years, 2)
    expect(f).toHaveLength(2)
    expect(f[0].year).toBe('2026')
    expect(f[0].forecast).toBe(true)
    expect(f[0].total).toBe(960) // 600,720,840 -> +120/yr -> 960
    expect(f[1].total).toBe(1080)
  })
  it('forecast is empty when history too short', () => {
    expect(forecast(byCountry(rows)[1].years)).toEqual([])
  })
})

describe('cagr + insights', () => {
  it('cagr over the series', () => {
    const c = cagr(byCountry(rows)[0].years)
    expect(Math.round(c)).toBe(18) // (840/600)^(1/2)-1
  })
  it('insights are honest and non-empty for a real series', () => {
    const ins = insights(byCountry(rows)[0].years)
    expect(ins.length).toBeGreaterThan(0)
    expect(ins.every((i) => typeof i.text === 'string')).toBe(true)
  })
  it('buildCountryTrend bundles everything', () => {
    const t = buildCountryTrend(byCountry(rows)[0])
    expect(t.country).toBe('KSA')
    expect(t.currency).toBe('SAR')
    expect(t.yoy).toHaveLength(3)
    expect(t.forecast).toHaveLength(2)
    expect(t.cagr).not.toBeNull()
  })
})

describe('period grain (quarter / month)', () => {
  it('periodLabel formats year, quarter and month', () => {
    expect(periodLabel('2024')).toBe('2024')
    expect(periodLabel('2024-Q3')).toBe('Q3 2024')
    expect(periodLabel('2024-01')).toBe('Jan 2024')
  })
  it('nextPeriod steps each grain, rolling over the year', () => {
    expect(nextPeriod('2024', 'year')).toBe('2025')
    expect(nextPeriod('2024-Q4', 'quarter')).toBe('2025-Q1')
    expect(nextPeriod('2024-12', 'month')).toBe('2025-01')
    expect(nextPeriod('2024-03', 'month')).toBe('2024-04')
  })
  it('byCountry accepts a `period` field and sorts + labels it', () => {
    const g = byCountry([
      { country: 'KSA', period: '2024-02', currency: 'SAR', tyre: 1, spare: 2, lubricant: 3, total: 6 },
      { country: 'KSA', period: '2024-01', currency: 'SAR', tyre: 1, spare: 1, lubricant: 1, total: 3 },
    ])
    expect(g[0].years.map((y) => y.period)).toEqual(['2024-01', '2024-02'])
    expect(g[0].years[0].label).toBe('Jan 2024')
  })
  it('forecast produces grain-correct future period labels', () => {
    const years = [
      { period: '2024-Q1', total: 100, tyre: 100, spare: 0, lubricant: 0 },
      { period: '2024-Q2', total: 200, tyre: 200, spare: 0, lubricant: 0 },
    ]
    const f = forecast(years, 2, 'quarter')
    expect(f.map((x) => x.period)).toEqual(['2024-Q3', '2024-Q4'])
    expect(f[0].total).toBe(300)
  })
})

describe('date-range window', () => {
  it('periodBounds covers the right months for each grain', () => {
    expect(periodBounds('2024')).toEqual({ start: '2024-01', end: '2024-12' })
    expect(periodBounds('2024-Q2')).toEqual({ start: '2024-04', end: '2024-06' })
    expect(periodBounds('2024-03')).toEqual({ start: '2024-03', end: '2024-03' })
  })
  it('filterPeriods keeps only overlapping periods', () => {
    const years = ['2023-01', '2023-06', '2024-02', '2024-11'].map((p) => ({ period: p }))
    expect(filterPeriods(years, '2023-05', '2024-03').map((y) => y.period)).toEqual(['2023-06', '2024-02'])
    expect(filterPeriods(years, null, null)).toHaveLength(4)
    expect(filterPeriods(years, '2024-01', null).map((y) => y.period)).toEqual(['2024-02', '2024-11'])
  })
  it('year/quarter periods overlap a partial-month window', () => {
    expect(filterPeriods([{ period: '2024' }], '2024-06', '2024-06')).toHaveLength(1)
    expect(filterPeriods([{ period: '2024-Q1' }], '2024-03', '2024-03')).toHaveLength(1)
    expect(filterPeriods([{ period: '2024-Q1' }], '2024-04', '2024-12')).toHaveLength(0)
  })
  it('availableYears lists distinct years ascending', () => {
    const c = byCountry([
      { country: 'KSA', period: '2024-01', total: 1 },
      { country: 'KSA', period: '2023-05', total: 1 },
      { country: 'UAE', period: '2024-07', total: 1 },
    ])
    expect(availableYears(c)).toEqual(['2023', '2024'])
  })
})
