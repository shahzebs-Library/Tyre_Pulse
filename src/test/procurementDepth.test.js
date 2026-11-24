import { describe, it, expect } from 'vitest'
import {
  compareQuotes, awardNeedsReason, summariseBackorders, rateSupplier, returnableQty, rejectionReasonText, formatMoneyIn,
} from '../lib/procurement/procurementDepth'

const lines = [{ id: 'l1', line_no: 1, qty: 10 }, { id: 'l2', line_no: 2, qty: 2 }]

describe('compareQuotes (mirrors inv_rfq_award)', () => {
  it('picks the lowest full quote per currency and never adds currencies', () => {
    const c = compareQuotes(lines, [
      { id: 'a', currency: 'sar', status: 'received', lines: [{ rfq_line_id: 'l1', unit_price: 100 }, { rfq_line_id: 'l2', unit_price: 50 }] },
      { id: 'b', currency: 'SAR', status: 'received', lines: [{ rfq_line_id: 'l1', unit_price: 90 }, { rfq_line_id: 'l2', unit_price: 60 }] },
      { id: 'c', currency: 'AED', status: 'received', lines: [{ rfq_line_id: 'l1', unit_price: 1 }] },
    ])
    expect(c.currencies).toEqual(['AED', 'SAR'])
    expect(c.mixedCurrency).toBe(true)
    expect(c.quotes.find((q) => q.id === 'a').total).toBe(1100)
    expect(c.quotes.find((q) => q.id === 'b').total).toBe(1020)
    expect(c.lowestByCurrency).toEqual({ SAR: 'b' })          // AED quote is incomplete: no lowest
    expect(c.quotes.find((q) => q.id === 'c').complete).toBe(false)
    expect(c.lineBest.l2.SAR).toBe('a')
    expect(awardNeedsReason(c, 'b')).toBe(true)               // mixed currencies always need a reason
  })

  it('needs no reason for the lowest quote in a single currency, and one for any other', () => {
    const c = compareQuotes(lines, [
      { id: 'a', currency: 'SAR', lines: [{ rfq_line_id: 'l1', unit_price: 100 }, { rfq_line_id: 'l2', unit_price: 50 }] },
      { id: 'b', currency: 'SAR', lines: [{ rfq_line_id: 'l1', unit_price: 90 }, { rfq_line_id: 'l2', unit_price: 60 }] },
    ])
    expect(awardNeedsReason(c, 'b')).toBe(false)
    expect(awardNeedsReason(c, 'a')).toBe(true)
  })

  it('keeps a missing price as null, never 0', () => {
    const c = compareQuotes(lines, [{ id: 'a', currency: 'SAR', lines: [{ rfq_line_id: 'l1', unit_price: null }] }])
    expect(c.quotes[0].total).toBeNull()
    expect(c.quotes[0].cells[0].amount).toBeNull()
    expect(formatMoneyIn(null, 'SAR')).toBe('No price')
  })
})

describe('backorders, performance, returns', () => {
  it('summarises outstanding value per currency and counts unpriced lines', () => {
    const s = summariseBackorders([
      { po_id: 'p1', qty_outstanding: 6, unit_price: 90, currency: 'SAR', is_overdue: true, days_overdue: 4 },
      { po_id: 'p1', qty_outstanding: 0, unit_price: 5, currency: 'SAR' },
      { po_id: 'p2', qty_outstanding: 1, unit_price: null, currency: 'AED' },
      { po_id: 'p3', qty_outstanding: 2, unit_price: 10, currency: 'AED' },
    ])
    expect(s).toMatchObject({ openLines: 3, overdueLines: 1, openPos: 3, maxDaysOverdue: 4, unvaluedLines: 1 })
    expect(s.valueByCurrency).toEqual({ SAR: 540, AED: 20 })
  })

  it('rates honestly: nothing measured reads "Not measured yet"', () => {
    expect(rateSupplier({}).band).toBe('not_measured')
    expect(rateSupplier({ on_time_pct: 50, on_time: 1, late: 1 }).band).toBe('watch')
    expect(rateSupplier({ on_time_pct: 100, on_time: 5, late: 0, reject_pct: 0 }).band).toBe('good')
  })

  it('never offers more to return than was received, net of earlier returns', () => {
    const r = returnableQty({ id: 'g1', qty_rejected: 2, qty_accepted: 4 }, [
      { grn_line_id: 'g1', source: 'rejected', qty: 2 }, { grn_line_id: 'g1', source: 'accepted', qty: 1 }, { grn_line_id: 'x', source: 'accepted', qty: 9 },
    ])
    expect(r).toEqual({ rejected: 0, accepted: 3 })
  })

  it('writes the rejection reason the receipt engine reads', () => {
    expect(rejectionReasonText('damaged', 'crushed box')).toBe('damaged: crushed box')
    expect(rejectionReasonText('wrong_part', '')).toBe('wrong_part')
    expect(rejectionReasonText('', 'note only')).toBe('note only')
  })
})
