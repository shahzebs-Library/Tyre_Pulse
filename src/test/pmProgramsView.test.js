import { describe, it, expect } from 'vitest'
import {
  pillClass, isSingleCountry, pageCurrency, dueDateText, dueMeterText, heroStat,
  kpiValues, bucketRows, segments, barRows, dueQueue, money,
} from '../lib/pmProgramsView'

describe('pmProgramsView', () => {
  it('maps engine tones to kit pills and falls back to muted', () => {
    expect(pillClass('green')).toBe('good')
    expect(pillClass('red')).toBe('bad')
    expect(pillClass('sky')).toBe('info')
    expect(pillClass('nonsense')).toBe('muted')
  })

  it('knows a single-country scope and its currency', () => {
    expect(isSingleCountry('KSA')).toBe(true)
    expect(isSingleCountry('All')).toBe(false)
    expect(isSingleCountry('')).toBe(false)
    expect(pageCurrency('UAE')).toBe('AED')
    expect(pageCurrency('All', 'SAR')).toBeNull()
    expect(pageCurrency('Oman', 'OMR')).toBe('OMR')
  })

  it('writes due text honestly', () => {
    expect(dueDateText(null)).toBeNull()
    expect(dueDateText(0)).toBe('due today')
    expect(dueDateText(1)).toBe('in 1 day')
    expect(dueDateText(-3)).toBe('3 days overdue')
    expect(dueMeterText(1200, 'km')).toBe('1,200 km left')
    expect(dueMeterText(-300, 'h')).toBe('300 h over')
    expect(dueMeterText(500, '')).toBeNull()
    expect(dueMeterText(null, 'km')).toBeNull()
  })

  it('only shows a hero stat when compliance is measurable', () => {
    expect(heroStat({ compliantPct: null }, true)).toBeUndefined()
    expect(heroStat({ compliantPct: 80 }, false)).toBeUndefined()
    expect(heroStat({ compliantPct: 80 }, true).value).toBe('80%')
  })

  it('withholds service cost across countries and leaves unloaded KPIs null', () => {
    const summary = { active: 10, overdue: 2, dueSoon: 3, compliantPct: 80 }
    expect(kpiValues({ summary, monthlyServiceTotal: 500, singleCountry: true, loaded: true }).serviceCost12m).toBe(500)
    const all = kpiValues({ summary, monthlyServiceTotal: 500, singleCountry: false, loaded: true })
    expect(all.serviceCost12m).toBeNull()
    expect(all.costReason).toMatch(/currencies/)
    expect(kpiValues({ summary, loaded: false }).active).toBeNull()
  })

  it('builds bucket rows as a share of active plans, never dividing by zero', () => {
    const rows = bucketRows({ d30: 2, d60: 4, d90: 5 }, 10)
    expect(rows.map((r) => r.pct)).toEqual([20, 40, 50])
    expect(bucketRows({ d30: 1 }, 0)[0].pct).toBe(0)
  })

  it('drops empty donut segments and colours the rest', () => {
    const seg = segments([{ category: 'vehicle', count: 3 }, { category: 'plant', count: 0 }], {
      keyOf: (c) => c.category, labelOf: (c) => c.category.toUpperCase(), colors: ['#111111'],
    })
    expect(seg).toEqual([{ key: 'vehicle', label: 'VEHICLE', count: 3, color: '#111111' }])
  })

  it('ranks bar rows against the largest value and drops zeros', () => {
    const rows = barRows([{ id: 'a', total: 50 }, { id: 'b', total: 100 }, { id: 'c', total: 0 }], { valueOf: (r) => r.total })
    expect(rows.map((r) => [r.id, r.pct])).toEqual([['b', 100], ['a', 50]])
    expect(barRows([{ total: 1 }, { total: 2 }], { valueOf: (r) => r.total, limit: 1 })).toHaveLength(1)
  })

  it('caps the due queue and reports the rest', () => {
    const q = dueQueue([1, 2, 3, 4], 3)
    expect(q.rows).toEqual([1, 2, 3])
    expect(q.more).toBe(1)
    expect(q.total).toBe(4)
  })

  it('formats money compactly and never invents a value', () => {
    expect(money(null, 'SAR')).toBe('N/A')
    expect(money(950, 'SAR')).toBe('SAR 950')
    expect(money(25000, null)).toBe('25.0K')
    expect(money(2500000, 'AED')).toBe('AED 2.50M')
  })
})
