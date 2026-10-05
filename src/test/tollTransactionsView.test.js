import { describe, it, expect } from 'vitest'
import {
  reconBucket, reconOverview, routeSpend, dailyTrend, tagSummary, previousWindow, changePct,
  selectionNav, statusPill, mapImportRows, fieldForHeader,
} from '../lib/tollTransactionsView'

const NOW = Date.UTC(2026, 9, 5, 12)
const rows = [
  { id: 1, asset_no: 'TM1', tag_id: 'T1', highway: 'M1', amount: 10, currency: 'SAR', status: 'reconciled', transaction_at: '2026-10-04T08:00:00Z' },
  { id: 2, asset_no: 'TM1', tag_id: 'T1', highway: 'M1', amount: 5, currency: 'SAR', status: 'posted', transaction_at: '2026-10-03T08:00:00Z' },
  { id: 3, asset_no: 'TM2', tag_id: 'T2', highway: 'A2', amount: 20, currency: 'SAR', status: 'disputed', transaction_at: '2026-09-01T08:00:00Z' },
  { id: 4, asset_no: 'TM3', highway: '', amount: 7, currency: 'AED', status: 'refunded', transaction_at: '2026-10-04T09:00:00Z' },
  { id: 5, asset_no: 'TM3', amount: null, currency: 'SAR' },
]

describe('tollTransactionsView', () => {
  it('buckets reconciliation by stored status', () => {
    expect(reconBucket(rows[0])).toBe('reconciled')
    expect(reconBucket(rows[3])).toBe('reconciled')
    expect(reconBucket(rows[2])).toBe('disputed')
    expect(reconBucket(rows[1])).toBe('unreconciled')
    expect(reconBucket(rows[4])).toBe('unreconciled')
    expect(statusPill(rows[1]).label).toBe('Unreconciled')
    expect(statusPill(rows[4]).label).toBe('No status')
  })

  it('reconOverview counts and shares, null shares when empty', () => {
    const o = reconOverview(rows)
    expect([o.reconciled, o.unreconciled, o.disputed, o.total]).toEqual([2, 2, 1, 5])
    expect(o.disputedPct).toBe(20)
    expect(reconOverview([]).disputedPct).toBeNull()
  })

  it('routeSpend ranks one currency only and never blends', () => {
    expect(routeSpend(rows, null)).toEqual([])
    const r = routeSpend(rows, 'SAR')
    expect(r[0]).toMatchObject({ route: 'A2', amount: 20 })
    expect(r[1]).toMatchObject({ route: 'M1', amount: 15, count: 2 })
    const aed = routeSpend(rows, 'AED')
    expect(aed).toEqual([{ route: 'Route not recorded', amount: 7, count: 1 }])
  })

  it('routeSpend folds the tail into Others', () => {
    const many = Array.from({ length: 10 }, (_, i) => ({ highway: `R${i}`, amount: 10 - i, currency: 'SAR' }))
    const r = routeSpend(many, 'SAR', { limit: 3 })
    expect(r).toHaveLength(4)
    expect(r[3].route).toBe('Others')
    expect(r[3].amount).toBe(7 + 6 + 5 + 4 + 3 + 2 + 1)
  })

  it('dailyTrend sums one currency, counts otherwise', () => {
    const d = dailyTrend(rows, { now: NOW, currency: 'SAR' })
    expect(d.series).toHaveLength(30)
    expect(d.metric).toBe('amount')
    const oct4 = d.series.find((s) => s.day === '2026-10-04')
    expect(oct4).toMatchObject({ count: 2, amount: 10 })
    const c = dailyTrend(rows, { now: NOW })
    expect(c.metric).toBe('count')
    expect(c.series.find((s) => s.day === '2026-10-04').amount).toBeNull()
    expect(dailyTrend([], { now: NOW }).any).toBe(false)
  })

  it('tagSummary counts distinct tags and assets', () => {
    expect(tagSummary(rows)).toEqual({ tags: 2, assets: 2 })
  })

  it('previousWindow and changePct', () => {
    expect(previousWindow('2026-10-01', '2026-10-10')).toEqual({ from: '2026-09-21', to: '2026-09-30' })
    expect(previousWindow('', '2026-10-10')).toBeNull()
    expect(changePct(12, 10)).toBe(20)
    expect(changePct(5, 0)).toBeNull()
    expect(changePct(null, 4)).toBeNull()
  })

  it('selectionNav', () => {
    const n = selectionNav(rows, 2)
    expect(n.index).toBe(1)
    expect(n.prev.id).toBe(1)
    expect(n.next.id).toBe(3)
    expect(selectionNav(rows, 99).index).toBe(-1)
  })

  it('maps import headers and skips rows with no asset', () => {
    expect(fieldForHeader('Toll Point')).toBe('plaza_name')
    expect(fieldForHeader('Payment Type')).toBe('payment_method')
    expect(fieldForHeader('Nonsense')).toBeNull()
    const { rows: out, skipped } = mapImportRows([
      { Asset: ' TM9 ', Amount: '1,250.50', Currency: 'SAR', 'Toll point': 'North' },
      { Asset: '', Amount: '5' },
    ])
    expect(skipped).toBe(1)
    expect(out).toEqual([{ asset_no: 'TM9', amount: 1250.5, currency: 'SAR', plaza_name: 'North' }])
  })
})

describe('tollTransactionsView: card periods', () => {
  it('filters rows to this month / this quarter, all keeps everything', async () => {
    const { periodRows } = await import('../lib/tollTransactionsView')
    expect(periodRows(rows, 'month', NOW).map((r) => r.id)).toEqual([1, 2, 4])
    expect(periodRows(rows, 'quarter', NOW).map((r) => r.id)).toEqual([1, 2, 4])
    expect(periodRows(rows, 'all', NOW)).toHaveLength(5)
    expect(periodRows(rows, 'quarter', Date.UTC(2026, 8, 15)).map((r) => r.id)).toEqual([3])
  })
})
