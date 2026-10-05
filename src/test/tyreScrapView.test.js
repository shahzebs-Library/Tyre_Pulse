import { describe, it, expect } from 'vitest'
import {
  moneyScope, pctChange, previousWindowKpis, scrapTrends, trendBars, reasonSegments,
  governanceRows, disposalStatusOptions, selectedTyreFacts,
} from '../lib/tyreScrapView'

describe('tyreScrapView', () => {
  it('refuses to add money across currencies on the All view', () => {
    expect(moneyScope([{ country: 'KSA' }, { country: 'UAE' }], 'All', 'SAR').ok).toBe(false)
    expect(moneyScope([{ country: 'UAE' }], 'All', 'SAR')).toEqual({ ok: true, currency: 'AED' })
    expect(moneyScope([{ country: 'KSA' }, { country: 'UAE' }], 'KSA', 'SAR')).toEqual({ ok: true, currency: 'SAR' })
  })

  it('pctChange is null without a usable previous value', () => {
    expect(pctChange(10, 0)).toBeNull()
    expect(pctChange(null, 5)).toBeNull()
    expect(pctChange(15, 10)).toBe(50)
    expect(pctChange(5, 10)).toBe(-50)
  })

  it('previous window is the same length, immediately before, and null for all time', () => {
    const anchor = new Date('2026-06-30T00:00:00Z')
    const rows = [
      { removal_date: '2026-05-15', risk_level: 'Critical' }, // in current 30d? no: current is Jun 1..Jun 30
      { removal_date: '2026-05-20', category: 'Scrap' },
      { removal_date: '2026-06-20', risk_level: 'Critical' },
      { removal_date: '2026-03-01', risk_level: 'Critical' },
    ]
    const prev = previousWindowKpis(rows, 30, anchor)
    expect(prev.scrapCount).toBe(2)
    expect(previousWindowKpis(rows, null, anchor)).toBeNull()
    expect(previousWindowKpis([], 30, anchor)).toBeNull()
  })

  it('scrapTrends is all null without a previous window', () => {
    expect(scrapTrends({ scrapCount: 3 }, null)).toEqual({ count: null, cost: null, life: null, rate: null, retread: null })
    expect(scrapTrends({ scrapCount: 3, totalCost: null }, { scrapCount: 2, totalCost: 100 }).count).toBe(50)
  })

  it('trendBars scales to the tallest month and keeps zero months', () => {
    const bars = trendBars([{ key: 'a', count: 0 }, { key: 'b', count: 4 }, { key: 'c', count: 2 }], 9)
    expect(bars.map((b) => b.pct)).toEqual([0, 100, 50])
    expect(trendBars([{ key: 'a', count: 0 }]).map((b) => b.pct)).toEqual([0])
  })

  it('reasonSegments folds the tail into Other reasons', () => {
    const segs = reasonSegments([
      { label: 'A', count: 5 }, { label: 'B', count: 4 }, { label: 'C', count: 1 },
    ], ['#1', '#2'], 2)
    expect(segs.map((s) => [s.label, s.count])).toEqual([['A', 5], ['B', 4], ['Other reasons', 1]])
  })

  it('governance shows N/A (null) for fields the migration has not added', () => {
    const disposals = [
      { status: 'Pending' }, { status: 'Retreaded' }, { status: 'Disposed' },
      { status: 'Recycled' }, { status: 'Pending', collection_due: '2026-07-05' },
      { status: 'Disposed', collection_due: '2026-07-02' },
    ]
    const now = new Date('2026-07-01T10:00:00Z')
    const before = Object.fromEntries(governanceRows(disposals, { registerTotal: 10, withDisposal: 6, ready: false, now }).map((g) => [g.key, g.count]))
    expect(before).toMatchObject({ not_started: 4, pending: 2, retread: 1, disposed: 2, recycled: null, destroyed: null, due: null })
    const after = Object.fromEntries(governanceRows(disposals, { registerTotal: 10, withDisposal: 6, ready: true, now }).map((g) => [g.key, g.count]))
    expect(after).toMatchObject({ recycled: 1, destroyed: 0, due: 1 })
    expect(governanceRows([], {}).find((g) => g.key === 'not_started').count).toBeNull()
  })

  it('offers recycled and destroyed only once the columns exist', () => {
    expect(disposalStatusOptions(false)).not.toContain('Recycled')
    expect(disposalStatusOptions(true)).toContain('Destroyed')
  })

  it('selectedTyreFacts only states what is recorded', () => {
    expect(selectedTyreFacts(null)).toEqual([])
    const f = selectedTyreFacts({ asset_no: 'PM-001', km_run: 50000, cost_per_tyre: 1000, reason: 'Wear' })
    expect(f).toContain('Life: 50,000 km')
    expect(f).toContain('CPK: 0.020 per km')
    expect(f.some((x) => x.startsWith('Tread'))).toBe(false)
  })
})
