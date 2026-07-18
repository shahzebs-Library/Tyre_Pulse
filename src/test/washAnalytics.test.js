import { describe, it, expect } from 'vitest'
import {
  filterWashes, byType, bySite, monthlyTrend, summarizeWashes,
} from '../lib/washAnalytics'

const rows = [
  { wash_date: '2026-07-10', asset_no: 'A1', wash_type: 'Full', site: 'NHC', area: 'North', status: 'Completed' },
  { wash_date: '2026-07-15', asset_no: 'A1', wash_type: 'Exterior', site: 'NHC', area: 'North', status: 'In Progress' },
  { wash_date: '2026-06-20', asset_no: 'A2', wash_type: 'Full', site: 'METRO', area: 'South', status: 'Completed' },
  { wash_date: '2026-05-01', asset_no: 'A3', wash_type: 'Steam', site: 'METRO', area: 'South', status: 'Completed' },
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
  it('groups by wash type with counts', () => {
    const t = byType(rows)
    const full = t.find((g) => g.key === 'Full')
    expect(full.count).toBe(2)
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

  it('accumulates count into the right month', () => {
    const out = monthlyTrend(rows, new Date('2026-07-31T00:00:00Z'))
    const jul = out.find((b) => b.month === '2026-07')
    expect(jul.count).toBe(2)
  })
})

describe('summarizeWashes', () => {
  it('computes honest volume KPIs over all rows', () => {
    const k = summarizeWashes(rows, {}, new Date('2026-07-31T00:00:00Z'))
    expect(k.totalWashes).toBe(4)
    expect(k.distinctAssets).toBe(3)
    expect(k.byType.length).toBeGreaterThan(0)
    expect(k.bySite.length).toBeGreaterThan(0)
  })

  it('applies filters before summarising', () => {
    const k = summarizeWashes(rows, { site: 'NHC' }, new Date('2026-07-31T00:00:00Z'))
    expect(k.totalWashes).toBe(2)
    expect(k.distinctAssets).toBe(1)
  })

  it('returns honest zeros on empty input', () => {
    const k = summarizeWashes([], {}, new Date('2026-07-31T00:00:00Z'))
    expect(k).toMatchObject({ totalWashes: 0, distinctAssets: 0 })
    expect(k.byType).toEqual([])
    expect(k.bySite).toEqual([])
    expect(k.monthlyTrend).toHaveLength(12)
  })

  it('does not expose removed cost / water / duration metrics', () => {
    const k = summarizeWashes(rows, {}, new Date('2026-07-31T00:00:00Z'))
    expect(k.totalCost).toBeUndefined()
    expect(k.avgCost).toBeUndefined()
    expect(k.totalWater).toBeUndefined()
    expect(k.avgDuration).toBeUndefined()
  })
})
