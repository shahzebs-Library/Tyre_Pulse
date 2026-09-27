import { describe, it, expect } from 'vitest'
import {
  calcItemTotal, calcSubtotal, daysBetween, receiptProgress, filterOrdersBase, filterOrdersByStatus,
  procurementKpis, budgetPosition, vendorMonthlySpend, statusCounts, cumulativeSpend, optionsOf, orderExportRows,
} from '../lib/procurementAnalytics'

const orders = [
  { id: 1, po_number: 'PO-1', vendor_name: 'Alpha', site: 'NHC', status: 'Delivered', order_date: '2026-08-05', actual_delivery: '2026-08-15', total_amount: '1000', items: [{ quantity: 2, received_qty: 2 }] },
  { id: 2, po_number: 'PO-2', vendor_name: 'Beta', site: 'JED', status: 'Ordered', order_date: '2026-09-01', total_amount: 500, items: [] },
  { id: 3, po_number: 'PO-3', vendor_name: 'Alpha', site: 'NHC', status: 'Closed', order_date: '2025-12-20', actual_delivery: '2026-01-02', total_amount: 300 },
  { id: 4, po_number: 'PO-4', vendor_name: 'Beta', site: 'JED', status: 'Draft', order_date: null, total_amount: null },
]
const now = new Date(2026, 8, 20)

describe('procurementAnalytics', () => {
  it('does line-item maths and date spans', () => {
    expect(calcItemTotal({ quantity: '3', unit_price: '2.5' })).toBe(7.5)
    expect(calcSubtotal([{ quantity: 1, unit_price: 10 }, { quantity: 2, unit_price: 'x' }])).toBe(10)
    expect(daysBetween('2026-01-01', '2026-01-11')).toBe(10)
    expect(daysBetween(null, '2026-01-11')).toBeNull()
    expect(receiptProgress([{ quantity: 4, received_qty: 1 }]).pct).toBe(25)
    expect(receiptProgress([]).pct).toBeNull()
  })

  it('filters by everything except status, then by status newest first', () => {
    expect(filterOrdersBase(orders, { vendor: 'Alpha' }).map(o => o.id)).toEqual([1, 3])
    expect(filterOrdersBase(orders, { search: 'po-2' }).map(o => o.id)).toEqual([2])
    expect(filterOrdersBase(orders, { from: '2026-01-01' }).map(o => o.id)).toEqual([1, 2])
    expect(filterOrdersByStatus(orders).map(o => o.id)).toEqual([2, 1, 3, 4])
    expect(filterOrdersByStatus(orders, 'Ordered').map(o => o.id)).toEqual([2])
  })

  it('computes KPIs with an honest null lead time', () => {
    const k = procurementKpis(orders, { now })
    expect(k).toMatchObject({ totalPOs: 2, spend: 1300, pendingDelivery: 1, pendingValue: 500, avgLeadTime: 12, leadTimeSample: 2 })
    expect(procurementKpis([orders[1]], { now }).avgLeadTime).toBeNull()
  })

  it('positions spend against the budget, null when no budget set', () => {
    expect(budgetPosition(orders, 2600)).toMatchObject({ spend: 1300, remaining: 1300, variance: 50 })
    expect(budgetPosition(orders, 0)).toMatchObject({ remaining: null, variance: null })
  })

  it('builds vendor, status and cumulative series', () => {
    const v = vendorMonthlySpend(orders, { now })
    expect(v.months).toEqual(['2026-04', '2026-05', '2026-06', '2026-07', '2026-08', '2026-09'])
    expect(v.series[0].vendor).toBe('Alpha')
    expect(v.series[0].data[4]).toBe(1000)
    expect(statusCounts(orders)).toEqual({ Delivered: 1, Ordered: 1, Closed: 1, Draft: 1 })
    const c = cumulativeSpend(orders, 1200, { now })
    expect(c.spend[7]).toBe(1000)
    expect(c.budget[11]).toBeCloseTo(1200)
    expect(cumulativeSpend(orders, 0, { now }).budget).toBeNull()
  })

  it('lists options and export rows', () => {
    expect(optionsOf(orders, 'vendor_name')).toEqual(['All', 'Alpha', 'Beta'])
    const r = orderExportRows([orders[0]])[0]
    expect(r).toMatchObject({ 'PO Number': 'PO-1', Items: 1, Total: 1000 })
  })
})
