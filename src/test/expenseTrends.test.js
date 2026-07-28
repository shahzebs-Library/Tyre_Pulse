import { describe, it, expect } from 'vitest'
import {
  byCountry, yoyTable, latestShare, linearFit, cagr, forecast, insights, buildCountryTrend,
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
