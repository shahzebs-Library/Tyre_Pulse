import { describe, it, expect } from 'vitest'
import { receiptShortfall, summarizeGoodsReceipts } from '../lib/goodsReceipts'

describe('goodsReceipts — receiptShortfall', () => {
  it('returns ordered − received when both are present', () => {
    expect(receiptShortfall({ qty_ordered: 100, qty_received: 80 })).toBe(20)
  })

  it('returns 0 when the full order was received', () => {
    expect(receiptShortfall({ qty_ordered: 50, qty_received: 50 })).toBe(0)
  })

  it('returns a negative value on an over-delivery', () => {
    expect(receiptShortfall({ qty_ordered: 40, qty_received: 45 })).toBe(-5)
  })

  it('accepts numeric strings', () => {
    expect(receiptShortfall({ qty_ordered: '100', qty_received: '30' })).toBe(70)
  })

  it('returns null when either quantity is missing', () => {
    expect(receiptShortfall({ qty_ordered: 100, qty_received: null })).toBeNull()
    expect(receiptShortfall({ qty_ordered: null, qty_received: 80 })).toBeNull()
    expect(receiptShortfall({ qty_received: 80 })).toBeNull()
    expect(receiptShortfall({ qty_ordered: 100 })).toBeNull()
    expect(receiptShortfall({})).toBeNull()
  })

  it('returns null for empty-string quantities', () => {
    expect(receiptShortfall({ qty_ordered: '', qty_received: '' })).toBeNull()
  })

  it('returns null for unparseable quantities', () => {
    expect(receiptShortfall({ qty_ordered: 'abc', qty_received: 10 })).toBeNull()
  })

  it('handles null / undefined input safely', () => {
    expect(receiptShortfall(null)).toBeNull()
    expect(receiptShortfall(undefined)).toBeNull()
  })
})

describe('goodsReceipts — summarizeGoodsReceipts', () => {
  const rows = [
    { status: 'received', qty_ordered: 100, qty_received: 100 }, // no shortfall
    { status: 'partial', qty_ordered: 100, qty_received: 60 },   // shortfall 40, outstanding
    { status: 'pending', qty_ordered: 50, qty_received: 0 },     // shortfall 50, outstanding
    { status: 'rejected', qty_ordered: 20, qty_received: 20 },   // no shortfall
    { status: 'received', qty_ordered: 30, qty_received: 35 },   // over-delivery (ignored)
    { status: 'received', qty_received: 10 },                    // no ordered qty -> no shortfall
  ]

  it('counts receipts by status', () => {
    const s = summarizeGoodsReceipts(rows)
    expect(s.total).toBe(6)
    expect(s.byStatus).toEqual({ pending: 1, partial: 1, received: 3, rejected: 1 })
  })

  it('sums total received units across all rows', () => {
    const s = summarizeGoodsReceipts(rows)
    // 100 + 60 + 0 + 20 + 35 + 10
    expect(s.totalReceived).toBe(225)
  })

  it('counts outstanding (partial + pending) receipts', () => {
    const s = summarizeGoodsReceipts(rows)
    expect(s.outstanding).toBe(2)
  })

  it('sums only positive shortfalls (over-deliveries do not offset)', () => {
    const s = summarizeGoodsReceipts(rows)
    // 40 (partial) + 50 (pending); over-delivery of -5 ignored
    expect(s.shortfallUnits).toBe(90)
  })

  it('handles empty / non-array input safely', () => {
    expect(summarizeGoodsReceipts([]).total).toBe(0)
    expect(summarizeGoodsReceipts([]).shortfallUnits).toBe(0)
    expect(summarizeGoodsReceipts([]).totalReceived).toBe(0)
    expect(summarizeGoodsReceipts(null).total).toBe(0)
    expect(summarizeGoodsReceipts(undefined).byStatus).toEqual({ pending: 0, partial: 0, received: 0, rejected: 0 })
    expect(summarizeGoodsReceipts(null).outstanding).toBe(0)
  })
})
