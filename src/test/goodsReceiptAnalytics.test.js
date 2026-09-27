import { describe, it, expect } from 'vitest'
import {
  enrichReceipts, filterReceipts, hasReceiptFilters, receiptKpis, fillRatePct,
  supplierScorecard, shortShipments, receiptExportRows, receiptSupplierOptions, RECEIPT_FILTERS,
} from '../lib/goodsReceiptAnalytics'

const lines = [
  { id: 1, grn_no: 'GRN-1', supplier: 'Gulf', item: 'Steer', qty_ordered: 100, qty_received: 80, condition: 'good', status: 'partial', received_date: '2026-09-01' },
  { id: 2, grn_no: 'GRN-2', supplier: 'Gulf', item: 'Drive', qty_ordered: 50, qty_received: 60, condition: 'damaged', status: 'received', received_date: '2026-09-10T08:00:00Z' },
  { id: 3, grn_no: 'GRN-3', supplier: 'Delta', item: 'Valve', qty_ordered: '', qty_received: 5, condition: 'rejected', status: 'rejected', received_date: null },
]

describe('goodsReceiptAnalytics', () => {
  it('enriches shortfall and over-delivery flags without inventing a shortfall', () => {
    const e = enrichReceipts(lines)
    expect(e[0]).toMatchObject({ _shortfall: 20, _isShort: true, _isOver: false, _statusLabel: 'Partial' })
    expect(e[1]).toMatchObject({ _shortfall: -10, _isOver: true, _conditionLabel: 'Damaged', _date: '2026-09-10' })
    expect(e[2]._shortfall).toBeNull()
    expect(e[2]._date).toBeNull()
  })

  it('filters by status, supplier, condition, date window and text', () => {
    const e = enrichReceipts(lines)
    expect(filterReceipts(e, { ...RECEIPT_FILTERS, supplier: 'Gulf' })).toHaveLength(2)
    expect(filterReceipts(e, { ...RECEIPT_FILTERS, condition: 'damaged' }).map((r) => r.id)).toEqual([2])
    expect(filterReceipts(e, { ...RECEIPT_FILTERS, from: '2026-09-05' }).map((r) => r.id)).toEqual([2])
    expect(filterReceipts(e, { ...RECEIPT_FILTERS, to: '2026-09-05' }).map((r) => r.id)).toEqual([1])
    expect(filterReceipts(e, { ...RECEIPT_FILTERS, search: 'valve' }).map((r) => r.id)).toEqual([3])
    expect(hasReceiptFilters(RECEIPT_FILTERS)).toBe(false)
    expect(hasReceiptFilters({ ...RECEIPT_FILTERS, to: '2026-01-01' })).toBe(true)
  })

  it('caps over-delivery in the fill rate and returns null when unmeasurable', () => {
    // (80 + min(60,50)) / (100 + 50) = 130/150 = 86.7
    expect(fillRatePct(lines)).toBe(86.7)
    expect(fillRatePct([lines[2]])).toBeNull()
    expect(fillRatePct([])).toBeNull()
  })

  it('builds the KPI strip with an honest quality rate', () => {
    const k = receiptKpis(lines)
    expect(k).toMatchObject({ total: 3, received: 1, outstanding: 1, rejected: 1, shortfallUnits: 20, shortLines: 1, overLines: 1, suppliers: 2, qualityIssues: 2 })
    expect(k.qualityIssuePct).toBe(66.7)
    expect(receiptKpis([{ status: 'pending' }]).qualityIssuePct).toBeNull()
  })

  it('ranks suppliers by worst fill rate with unmeasured last', () => {
    const card = supplierScorecard([...lines, { supplier: '', qty_ordered: 10, qty_received: 1 }])
    expect(card[0].supplier).toBe('Supplier not recorded')
    expect(card[card.length - 1]).toMatchObject({ supplier: 'Delta', fillRatePct: null })
  })

  it('lists short shipments biggest first and exports N/A for unknown shortfall', () => {
    const e = enrichReceipts([...lines, { id: 4, qty_ordered: 10, qty_received: 0 }])
    expect(shortShipments(e).map((r) => r.id)).toEqual([1, 4])
    const out = receiptExportRows(e)
    expect(out[2].shortfall).toBe('N/A')
    expect(out[0]).toMatchObject({ grn_no: 'GRN-1', status: 'Partial', condition: 'Good' })
    expect(receiptSupplierOptions(lines)).toEqual(['Delta', 'Gulf'])
  })
})
