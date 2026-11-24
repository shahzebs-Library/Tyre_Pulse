import { describe, it, expect } from 'vitest'
import {
  custodyStatus, openCustody, summarizeTools, heldByPerson,
  repairState, repairableRows, summarizeRepairables, repairLocationCoverage,
  stockWarrantyDraft, claimsByStock, scrapProposal,
  buildFinanceRecon, stockValueBySite, financeTotals, reconFinding, monthsAgoStart,
} from '../lib/inventory/warehouseAssets'

const NOW = Date.parse('2026-11-24T12:00:00Z')

describe('tool custody', () => {
  it('returned wins, missing due date is never overdue, past due is overdue', () => {
    expect(custodyStatus({ issued_at: '2026-11-01', due_back_at: '2026-11-05', returned_at: '2026-11-10' }, NOW).status).toBe('returned')
    expect(custodyStatus({ issued_at: '2026-11-01' }, NOW)).toMatchObject({ status: 'no_due_date', daysOverdue: null })
    const o = custodyStatus({ issued_at: '2026-11-01', due_back_at: '2026-11-20' }, NOW)
    expect(o.status).toBe('overdue')
    expect(o.daysOverdue).toBe(5)
    expect(custodyStatus({ issued_at: '2026-11-20', due_back_at: '2026-12-01' }, NOW).status).toBe('out')
  })

  it('orders open custody overdue first and drops returned rows', () => {
    const rows = openCustody([
      { id: 'a', issued_at: '2026-11-20', due_back_at: '2026-12-01' },
      { id: 'b', issued_at: '2026-10-01', due_back_at: '2026-10-10' },
      { id: 'c', issued_at: '2026-10-01', returned_at: '2026-10-02' },
    ], NOW)
    expect(rows.map((r) => r.id)).toEqual(['b', 'a'])
  })

  it('never guesses a holder: in-use tools without custody are unknown', () => {
    const tools = [{ id: 't1', status: 'in_use' }, { id: 't2', status: 'in_use' }, { id: 't3', status: 'available' }]
    const s = summarizeTools(tools, [{ equipment_id: 't1', holder_name: 'Ali', issued_at: '2026-11-01', due_back_at: '2026-11-02' }], NOW)
    expect(s).toMatchObject({ tools: 3, open: 1, overdue: 1, holders: 1, inUseUnknownHolder: 1, custodyTracked: true })
    expect(summarizeTools(tools, null, NOW)).toMatchObject({ custodyTracked: false, open: 0, inUseUnknownHolder: 2 })
  })

  it('nets issues against returns per holder and item', () => {
    const held = heldByPerson([
      { doc_type: 'MIS', issued_to: 'Ali', issued_at: '2026-11-01', lines: [{ item_code: 'x1', qty: 3 }] },
      { doc_type: 'MRT', issued_to: 'ali', issued_at: '2026-11-02', lines: [{ item_code: 'X1', qty: 1 }] },
      { doc_type: 'MIS', issued_to: 'Sara', lines: [{ item_code: 'Y', qty: 1 }] },
      { doc_type: 'MRT', issued_to: 'Sara', lines: [{ item_code: 'Y', qty: 1 }] },
      { doc_type: 'MIS', issued_to: '', lines: [{ item_code: 'Z', qty: 1 }] },
    ])
    expect(held).toEqual([expect.objectContaining({ holder: 'Ali', item_code: 'X1', qty: 2 })])
  })
})

describe('repairable parts', () => {
  const locs = [{ id: 'L1', location_type: 'supplier_custody', code: 'VEND-A' }, { id: 'L2', location_type: 'bin', code: 'B1' }]
  it('location wins over condition; ordinary stock is not repairable', () => {
    expect(repairState({ condition: 'damaged' }, locs[0])).toBe('at_vendor')
    expect(repairState({ condition: 'repairable' }, locs[1])).toBe('awaiting_repair')
    expect(repairState({ condition: 'new' }, locs[1])).toBeNull()
  })
  it('lists only non-zero repairable balances and keeps unvalued quantity apart', () => {
    const rows = repairableRows([
      { stock_id: 's1', location_id: 'L1', condition: 'new', qty_on_hand: 2, valued_amount: 100, valued_qty: 2, unvalued_qty: 0, currency: 'SAR' },
      { stock_id: 's2', location_id: 'L2', condition: 'damaged', qty_on_hand: 3, valued_amount: 0, valued_qty: 0, unvalued_qty: 3, currency: 'SAR' },
      { stock_id: 's3', location_id: 'L2', condition: 'scrap', qty_on_hand: 0 },
      { stock_id: 's4', location_id: 'L2', condition: 'new', qty_on_hand: 5 },
    ], locs)
    expect(rows.map((r) => r.stock_id)).toEqual(['s1', 's2'])
    const s = summarizeRepairables(rows)
    expect(s.byState.at_vendor.rows).toBe(1)
    expect(s.unvaluedQty).toBe(3)
    expect(s.totals).toEqual([{ currency: 'SAR', amount: 100, rows: 2 }])
  })
  it('reports which repair location types are missing', () => {
    const cov = repairLocationCoverage(locs)
    expect(cov.find((c) => c.type === 'supplier_custody').present).toBe(true)
    expect(cov.find((c) => c.type === 'scrap').present).toBe(false)
  })
})

describe('warranty and scrap for stock', () => {
  const stock = { stock_id: 's1', item_id: 'i1', item_code: 'P-1', description: 'Pump', qty_on_hand: 4, site: 'NHC', country: 'KSA' }
  it('builds a Submitted claim with no credit amount and the stock link', () => {
    const { payload, error } = stockWarrantyDraft(stock, { failure_type: 'Manufacturing defect', qty: 2, supplier: ' Acme ' })
    expect(error).toBeUndefined()
    expect(payload.claim_status).toBe('Submitted')
    expect('credit_amount' in payload).toBe(false)
    expect(payload.supplier).toBe('Acme')
    expect(payload.custom_data).toMatchObject({ source: 'inventory', stock_id: 's1', item_code: 'P-1', qty: 2 })
  })
  it('refuses a claim without a failure, above on hand, or Other without detail', () => {
    expect(stockWarrantyDraft(stock, { qty: 1 }).error).toMatch(/what went wrong/i)
    expect(stockWarrantyDraft(stock, { failure_type: 'Other', qty: 1 }).error).toMatch(/describe/i)
    expect(stockWarrantyDraft(stock, { failure_type: 'Damaged on arrival', qty: 9 }).error).toMatch(/more than/)
    expect(stockWarrantyDraft(stock, { failure_type: 'Damaged on arrival', qty: 0 }).error).toMatch(/how many/)
  })
  it('groups claims by stock line newest first', () => {
    const m = claimsByStock([
      { id: 'a', created_at: '2026-11-01', custom_data: { stock_id: 's1' } },
      { id: 'b', created_at: '2026-11-03', custom_data: { stock_id: 's1' } },
      { id: 'c', created_at: '2026-11-02', custom_data: {} },
    ])
    expect(m.get('s1').map((c) => c.id)).toEqual(['b', 'a'])
    expect(m.size).toBe(1)
  })
  it('scrap needs a quantity within on hand and a real reason', () => {
    expect(scrapProposal(stock, { qty: 1, reason: 'no' }).error).toMatch(/reason/)
    expect(scrapProposal(stock, { qty: 5, reason: 'cracked housing' }).error).toMatch(/more than/)
    expect(scrapProposal(stock, { qty: 1, reason: 'cracked housing' }).proposal).toEqual({ stock_id: 's1', qty: 1, reason: 'cracked housing' })
  })
})

describe('financial reconciliation', () => {
  const erpRows = [
    { site: 'NHC', month: '2026-10-01', currency: 'SAR', country: 'KSA', erp_lines: 4, erp_qty: 10, erp_value: 500, inventory_movements: 0, inventory_qty: 0, inventory_value: 0, inventory_unvalued_qty: 0 },
    { site: 'NHC', month: '2026-10-01', currency: 'SAR', country: 'KSA', erp_lines: 1, erp_qty: 2, erp_value: 50, inventory_movements: 2, inventory_qty: 2, inventory_value: null, inventory_unvalued_qty: 1 },
    { site: 'DXB', month: '2026-10-01', currency: 'AED', country: 'UAE', erp_lines: 3, erp_qty: 3, erp_value: 300, inventory_movements: 0 },
  ]
  const receipts = [
    { site: 'NHC', currency: 'SAR', qty_change: 5, value_change: 120, unvalued_qty_change: 0, effective_at: '2026-10-15T10:00:00Z' },
    { site: 'NHC', currency: 'SAR', qty_change: 2, value_change: null, unvalued_qty_change: 2, effective_at: '2026-11-02T10:00:00Z' },
  ]
  it('groups per site, month and currency and never invents a value', () => {
    const rows = buildFinanceRecon({ erpRows, receipts })
    const oct = rows.find((r) => r.site === 'NHC' && r.month === '2026-10')
    expect(oct).toMatchObject({ erpLines: 5, erpQty: 12, erpValue: 550, invIssueQty: 2, invIssueValue: null, invIssueValueHidden: true, invIssueUnvaluedQty: 1, receiptValue: 120 })
    const nov = rows.find((r) => r.site === 'NHC' && r.month === '2026-11')
    expect(nov).toMatchObject({ receiptQty: 2, receiptValue: null, receiptUnvaluedQty: 2, erpValue: null })
    expect(rows.find((r) => r.site === 'DXB').invIssueQty).toBeNull()
  })
  it('totals per currency only, never across currencies', () => {
    const { totals } = financeTotals(buildFinanceRecon({ erpRows, receipts }))
    expect(totals.map((t) => t.currency)).toEqual(['AED', 'SAR'])
    expect(totals.find((t) => t.currency === 'SAR')).toMatchObject({ erpValue: 550, receiptValue: 120, invIssueValue: null, invIssueValueHidden: true })
    expect(totals.find((t) => t.currency === 'AED').erpValue).toBe(300)
  })
  it('stock value keeps unvalued quantity apart and hides a value it cannot see', () => {
    const s = stockValueBySite([
      { site: 'NHC', currency: 'SAR', qty_on_hand: 10, valued_qty: 2, unvalued_qty: 8, valued_amount: 40 },
      { site: 'NHC', currency: 'SAR', qty_on_hand: 5, valued_qty: 0, unvalued_qty: 5, valued_amount: 0 },
      { site: 'JED', currency: 'SAR', qty_on_hand: 3, valued_qty: 3, unvalued_qty: 0, valued_amount: null },
    ])
    expect(s.find((r) => r.site === 'NHC')).toMatchObject({ qtyOnHand: 15, unvaluedQty: 13, valuedAmount: 40, valueHidden: false })
    expect(s.find((r) => r.site === 'JED')).toMatchObject({ valuedAmount: null, valueHidden: true })
  })
  it('explains each row in plain words', () => {
    expect(reconFinding({ erpLines: 2, invIssueQty: null })).toMatch(/ERP, not recorded/)
    expect(reconFinding({ erpLines: 0, invIssueQty: 1 })).toMatch(/not in the ERP/)
    expect(reconFinding({ erpLines: 1, invIssueQty: 1, invIssueUnvaluedQty: 1 })).toMatch(/unknown, not zero/)
    expect(reconFinding({ erpLines: 1, erpQty: 1, invIssueQty: 1, invIssueUnvaluedQty: 0 })).toMatch(/agree/)
  })
  it('computes the window start month', () => {
    expect(monthsAgoStart(0, new Date('2026-11-24T00:00:00Z'))).toBe('2026-11-01')
    expect(monthsAgoStart(11, new Date('2026-11-24T00:00:00Z'))).toBe('2025-12-01')
  })
})
