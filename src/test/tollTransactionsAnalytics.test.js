import { describe, it, expect } from 'vitest'
import {
  filterTolls, currencyOf, currencyBreakdown, summarizeTollAnalytics, monthlyTrend,
  methodMix, rollupsForCurrency, tollExportRows, EXPORT_COLS,
} from '../lib/tollTransactionsAnalytics'

const NOW = new Date('2026-09-27T12:00:00Z')
const rows = [
  { id: 1, asset_no: 'A1', plaza_name: 'North', amount: 10, currency: 'sar', status: 'posted', payment_method: 'tag', transaction_at: '2026-09-20T08:00:00Z' },
  { id: 2, asset_no: 'A1', plaza_name: 'North', amount: 20, currency: 'SAR', status: 'disputed', payment_method: 'cash', transaction_at: '2026-08-10T08:00:00Z' },
  { id: 3, asset_no: 'A2', plaza_name: 'South', amount: 30, currency: 'AED', status: 'reconciled', payment_method: 'tag', transaction_at: '2026-09-01T08:00:00Z' },
  { id: 4, asset_no: 'A3', plaza_name: null, amount: null, currency: '', status: 'posted', transaction_at: null },
]

describe('tollTransactionsAnalytics', () => {
  it('normalises currency and marks a missing one as Unspecified', () => {
    expect(currencyOf(rows[0])).toBe('SAR')
    expect(currencyOf(rows[3])).toBe('Unspecified')
  })

  it('filters by search, status, method, currency and date window', () => {
    expect(filterTolls(rows, { search: 'south' }).map((r) => r.id)).toEqual([3])
    expect(filterTolls(rows, { status: 'DISPUTED' }).map((r) => r.id)).toEqual([2])
    expect(filterTolls(rows, { method: 'tag' }).map((r) => r.id)).toEqual([1, 3])
    expect(filterTolls(rows, { currency: 'SAR' }).map((r) => r.id)).toEqual([1, 2])
    // an active date window excludes the undated row
    expect(filterTolls(rows, { from: '2026-09-01' }).map((r) => r.id)).toEqual([1, 3])
  })

  it('never adds money across currencies', () => {
    const s = summarizeTollAnalytics(rows, { now: NOW })
    expect(s.mixedCurrency).toBe(true)
    expect(s.totalAmount).toBeNull()
    expect(s.disputedAmount).toBeNull()
    expect(s.avgAmount).toBeNull()
    const sar = currencyBreakdown(rows).find((c) => c.currency === 'SAR')
    expect(sar.amount).toBe(30)
    expect(sar.disputedAmount).toBe(20)
  })

  it('reports money when one currency is in scope', () => {
    const s = summarizeTollAnalytics(filterTolls(rows, { currency: 'SAR' }), { now: NOW })
    expect(s.currency).toBe('SAR')
    expect(s.totalAmount).toBe(30)
    expect(s.avgAmount).toBe(15)
    expect(s.disputeRatePct).toBe(50)
    expect(s.last30Count).toBe(1)
  })

  it('returns null rates for an empty scope, not zero', () => {
    const s = summarizeTollAnalytics([], { now: NOW })
    expect(s.disputeRatePct).toBeNull()
    expect(s.reconciledPct).toBeNull()
    expect(s.totalAmount).toBeNull()
  })

  it('builds a 12 month trend ending at now', () => {
    const t = monthlyTrend(rows, { now: NOW, currency: 'SAR' })
    expect(t).toHaveLength(12)
    expect(t[11].month).toBe('2026-09')
    expect(t[11]).toMatchObject({ count: 2, amount: 10 })
    expect(t[10]).toMatchObject({ month: '2026-08', count: 1, amount: 20 })
    expect(monthlyTrend(rows, { now: NOW })[11].amount).toBeNull()
  })

  it('counts payment methods with an honest bucket for missing ones', () => {
    expect(methodMix(rows)).toEqual([
      { label: 'Tag', count: 2 }, { label: 'Cash', count: 1 }, { label: 'Not recorded', count: 1 },
    ])
  })

  it('ranks assets within one currency only', () => {
    const { assets } = rollupsForCurrency(rows, 'SAR')
    expect(assets).toEqual([{ asset_no: 'A1', count: 2, amount: 30 }])
    expect(rollupsForCurrency(rows, null).assets).toEqual([])
  })

  it('shapes export rows with N/A for missing values', () => {
    const out = tollExportRows(rows)
    expect(Object.keys(out[0])).toEqual(EXPORT_COLS)
    expect(out[3].amount).toBe('N/A')
    expect(out[3].currency).toBe('Unspecified')
  })
})
