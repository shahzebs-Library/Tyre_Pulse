import { describe, it, expect } from 'vitest'
import {
  filterWashes, byType, bySite, monthlyTrend, summarizeWashes,
} from '../lib/washAnalytics'

const rows = [
  { wash_date: '2026-07-10', asset_no: 'A1', wash_type: 'Full', site: 'NHC', area: 'North', cost: 100, water_liters: 200, duration_min: 30 },
  { wash_date: '2026-07-15', asset_no: 'A1', wash_type: 'Exterior', site: 'NHC', area: 'North', cost: 50, water_liters: 120, duration_min: 15 },
  { wash_date: '2026-06-20', asset_no: 'A2', wash_type: 'Full', site: 'METRO', area: 'South', cost: 120, water_liters: 220 },
  { wash_date: '2026-05-01', asset_no: 'A3', wash_type: 'Steam', site: 'METRO', area: 'South', cost: null, water_liters: 0, duration_min: null },
]

describe('filterWashes', () => {
  it('filters by inclusive date range (both ends)', () => {
    const out = filterWashes(rows, { from: '2026-06-20', to: '2026-07-10' })
    expect(out.map((r) => r.wash_date).sort()).toEqual(['2026-06-20', '2026-07-10'])
  })

  it('filters by site, area and type independently', () => {
    expect(filterWashes(rows, { site: 'NHC' })).toHaveLength(2)
    expect(filterWashes(rows, { area: 'South' })).toHaveLength(2)
    expect(filterWashes(rows, { type: 'Full' })).toHaveLength(2)
  })

  it('ignores blank / All filters and returns all rows', () => {
    expect(filterWashes(rows, { site: 'All', type: '', from: '' })).toHaveLength(4)
  })

  it('returns [] for non-array input', () => {
    expect(filterWashes(null)).toEqual([])
  })
})

describe('byType / bySite grouping', () => {
  it('groups by wash type with counts and summed cost', () => {
    const t = byType(rows)
    const full = t.find((g) => g.key === 'Full')
    expect(full.count).toBe(2)
    expect(full.cost).toBe(220)
  })

  it('groups by site', () => {
    const s = bySite(rows)
    expect(s.find((g) => g.key === 'NHC').count).toBe(2)
    expect(s.find((g) => g.key === 'METRO').count).toBe(2)
  })

  it('buckets blank keys as Unspecified', () => {
    const t = byType([{ wash_date: '2026-07-01', asset_no: 'X' }])
    expect(t[0].key).toBe('Unspecified')
  })
})

describe('monthlyTrend', () => {
  it('returns 12 ordered buckets ending at the anchor month', () => {
    const out = monthlyTrend(rows, new Date('2026-07-31T00:00:00Z'))
    expect(out).toHaveLength(12)
    expect(out[11].month).toBe('2026-07')
    expect(out[0].month).toBe('2025-08')
  })

  it('accumulates count / cost / water into the right month', () => {
    const out = monthlyTrend(rows, new Date('2026-07-31T00:00:00Z'))
    const jul = out.find((b) => b.month === '2026-07')
    expect(jul.count).toBe(2)
    expect(jul.cost).toBe(150)
    expect(jul.water).toBe(320)
  })
})

describe('summarizeWashes', () => {
  it('computes honest KPIs over all rows', () => {
    const k = summarizeWashes(rows, {}, new Date('2026-07-31T00:00:00Z'))
    expect(k.totalWashes).toBe(4)
    expect(k.distinctAssets).toBe(3)
    expect(k.totalCost).toBe(270)
    // avgCost over rows that HAVE a cost (3 rows: 100,50,120 -> 270/3)
    expect(k.avgCost).toBe(90)
    expect(k.totalWater).toBe(540)
    // avgDuration over rows that HAVE a duration (2 rows: 30,15 -> 22.5)
    expect(k.avgDuration).toBe(22.5)
  })

  it('applies filters before summarising', () => {
    const k = summarizeWashes(rows, { site: 'NHC' }, new Date('2026-07-31T00:00:00Z'))
    expect(k.totalWashes).toBe(2)
    expect(k.distinctAssets).toBe(1)
    expect(k.totalCost).toBe(150)
  })

  it('returns honest zeros on empty input', () => {
    const k = summarizeWashes([], {}, new Date('2026-07-31T00:00:00Z'))
    expect(k).toMatchObject({
      totalWashes: 0, distinctAssets: 0, totalCost: 0, avgCost: 0, totalWater: 0, avgDuration: 0,
    })
    expect(k.byType).toEqual([])
    expect(k.bySite).toEqual([])
    expect(k.monthlyTrend).toHaveLength(12)
  })
})
