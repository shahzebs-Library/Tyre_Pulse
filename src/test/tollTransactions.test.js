import { describe, it, expect } from 'vitest'
import { toFiniteNumber, summariseTolls, byAsset, byPlaza } from '../lib/tollTransactions'

describe('tollTransactions — toFiniteNumber', () => {
  it('parses numbers, numeric strings, and rejects junk', () => {
    expect(toFiniteNumber(42)).toBe(42)
    expect(toFiniteNumber('1,200.50')).toBe(1200.5)
    expect(toFiniteNumber('')).toBeNull()
    expect(toFiniteNumber(null)).toBeNull()
    expect(toFiniteNumber('abc')).toBeNull()
  })
})

describe('tollTransactions — summariseTolls', () => {
  it('returns zeroes for empty / non-array input', () => {
    const zero = {
      totalTransactions: 0, totalAmount: 0, distinctAssets: 0,
      disputedCount: 0, disputedAmount: 0, avgAmount: 0,
    }
    expect(summariseTolls([])).toEqual(zero)
    expect(summariseTolls()).toEqual(zero)
    expect(summariseTolls(null)).toEqual(zero)
  })

  it('sums amounts, counts distinct assets, and averages', () => {
    const rows = [
      { asset_no: 'A1', amount: 10, status: 'posted' },
      { asset_no: 'A1', amount: 20, status: 'reconciled' },
      { asset_no: 'A2', amount: 30, status: 'posted' },
    ]
    const s = summariseTolls(rows)
    expect(s.totalTransactions).toBe(3)
    expect(s.totalAmount).toBe(60)
    expect(s.distinctAssets).toBe(2)
    expect(s.avgAmount).toBe(20)
  })

  it('tracks disputed count and amount (case-insensitive status)', () => {
    const rows = [
      { asset_no: 'A1', amount: 15, status: 'Disputed' },
      { asset_no: 'A2', amount: 25, status: 'disputed' },
      { asset_no: 'A3', amount: 40, status: 'posted' },
    ]
    const s = summariseTolls(rows)
    expect(s.disputedCount).toBe(2)
    expect(s.disputedAmount).toBe(40)
    expect(s.totalAmount).toBe(80)
  })

  it('coerces string amounts and tolerates missing amounts', () => {
    const rows = [
      { asset_no: 'A1', amount: '12.50' },
      { asset_no: 'A2', amount: null },
      { asset_no: 'A3' },
    ]
    const s = summariseTolls(rows)
    expect(s.totalAmount).toBe(12.5)
    expect(s.distinctAssets).toBe(3)
    expect(s.avgAmount).toBeCloseTo(12.5 / 3)
  })
})

describe('tollTransactions — byAsset', () => {
  it('returns [] for empty input', () => {
    expect(byAsset([])).toEqual([])
    expect(byAsset()).toEqual([])
  })

  it('aggregates count and amount per asset, sorted by amount desc', () => {
    const rows = [
      { asset_no: 'A1', amount: 10 },
      { asset_no: 'A2', amount: 50 },
      { asset_no: 'A1', amount: 15 },
    ]
    const out = byAsset(rows)
    expect(out).toEqual([
      { asset_no: 'A2', count: 1, amount: 50 },
      { asset_no: 'A1', count: 2, amount: 25 },
    ])
  })

  it('ignores rows with a blank/missing asset_no', () => {
    const rows = [
      { asset_no: '', amount: 100 },
      { amount: 200 },
      { asset_no: 'A1', amount: 30 },
    ]
    const out = byAsset(rows)
    expect(out).toHaveLength(1)
    expect(out[0].asset_no).toBe('A1')
  })
})

describe('tollTransactions — byPlaza', () => {
  it('aggregates count and amount per plaza, sorted by amount desc', () => {
    const rows = [
      { plaza_name: 'North', amount: 10 },
      { plaza_name: 'South', amount: 40 },
      { plaza_name: 'North', amount: 20 },
    ]
    const out = byPlaza(rows)
    expect(out).toEqual([
      { plaza: 'South', count: 1, amount: 40 },
      { plaza: 'North', count: 2, amount: 30 },
    ])
  })

  it('ignores rows without a plaza name', () => {
    const rows = [
      { plaza_name: '', amount: 5 },
      { amount: 5 },
      { plaza_name: 'East', amount: 5 },
    ]
    const out = byPlaza(rows)
    expect(out).toHaveLength(1)
    expect(out[0].plaza).toBe('East')
  })
})
