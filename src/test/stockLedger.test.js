import { describe, it, expect } from 'vitest'
import { classifyMovement, summarizeLedger, dailyLedger, tyresFitted, utilisationGap } from '../lib/stockLedger'

const mv = (o) => ({ id: Math.random().toString(36).slice(2), stock_id: 's1', site: 'NHC', description: 'Tyre', ...o })

describe('stockLedger', () => {
  it('classifies types and flags unknown ones', () => {
    expect(classifyMovement('Receipt').group).toBe('received')
    expect(classifyMovement('issue').group).toBe('utilised')
    expect(classifyMovement('stocktake').group).toBe('count')
    expect(classifyMovement('adjustment_down').group).toBe('adjustment')
    expect(classifyMovement('mystery').known).toBe(false)
  })

  it('keeps counts, receipts and issues apart with opening and closing', () => {
    const { rows, totals } = summarizeLedger([
      mv({ movement_type: 'receipt', qty_before: 10, qty_change: 5, qty_after: 15, created_at: '2026-10-01T08:00:00Z' }),
      mv({ movement_type: 'issue', qty_before: 15, qty_change: -4, qty_after: 11, created_at: '2026-10-02T08:00:00Z' }),
      mv({ movement_type: 'stocktake', qty_before: 11, qty_change: 3, qty_after: 14, created_at: '2026-10-03T08:00:00Z' }),
    ])
    expect(rows[0]).toMatchObject({ opening: 10, closing: 14, received: 5, utilised: 4, countAdj: 3, net: 4 })
    expect(totals).toMatchObject({ received: 5, utilised: 4, countAdj: 3, net: 4 })
  })

  it('a count that raises the balance is never counted as received', () => {
    const { totals } = summarizeLedger([mv({ movement_type: 'stocktake', qty_before: 2, qty_change: 8, qty_after: 10, created_at: '2026-10-01T08:00:00Z' })])
    expect(totals.received).toBe(0)
    expect(totals.countAdj).toBe(8)
  })

  it('orders by time regardless of input order and reports unknown types', () => {
    const out = summarizeLedger([
      mv({ movement_type: 'issue', qty_before: 5, qty_change: -1, qty_after: 4, created_at: '2026-10-02T08:00:00Z' }),
      mv({ movement_type: 'zzz', qty_before: 4, qty_change: 1, qty_after: 5, created_at: '2026-10-03T08:00:00Z' }),
      mv({ movement_type: 'receipt', qty_before: 0, qty_change: 5, qty_after: 5, created_at: '2026-10-01T08:00:00Z' }),
    ])
    expect(out.rows[0].opening).toBe(0)
    expect(out.rows[0].closing).toBe(5)
    expect(out.unknownTypes).toEqual(['zzz'])
  })

  it('daily ledger groups by local day, newest first', () => {
    const days = dailyLedger([
      mv({ movement_type: 'receipt', qty_change: 2, created_at: '2026-10-01T10:00:00' }),
      mv({ movement_type: 'issue', qty_change: -1, created_at: '2026-10-02T10:00:00' }),
    ])
    expect(days.map(d => d.date)).toEqual(['2026-10-02', '2026-10-01'])
    expect(days[0].utilised).toBe(1)
  })

  it('compares fitments with utilisation honestly', () => {
    expect(tyresFitted([{ qty: 2 }, { qty: null }, {}])).toBe(4)
    expect(utilisationGap(0, 0).note).toBe('')
    expect(utilisationGap(16, 0).gap).toBe(16)
    expect(utilisationGap(3, 5).gap).toBe(0)
  })
})
