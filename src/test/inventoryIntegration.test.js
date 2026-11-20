/**
 * Client integration with the DB lane's contract (docs/inventory/10 + 91):
 * reads go through the v_inv_* views, writes send one p_payload with an
 * idempotency key, server refusals are surfaced as written, and the valuation
 * shaping never blends currencies or calls a partial value a total.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const state = { result: { data: [], error: null, count: 0 }, rpc: { data: null, error: null }, calls: [] }

function builder(table) {
  const b = {
    select: (...a) => { state.calls.push(['select', table, ...a]); return b },
    eq: (...a) => { state.calls.push(['eq', ...a]); return b },
    neq: (...a) => { state.calls.push(['neq', ...a]); return b },
    not: (...a) => { state.calls.push(['not', ...a]); return b },
    in: (...a) => { state.calls.push(['in', ...a]); return b },
    or: (...a) => { state.calls.push(['or', ...a]); return b },
    gte: () => b, lte: () => b, is: () => b, limit: () => b,
    order: (...a) => { state.calls.push(['order', table, ...a]); return b },
    range: (...a) => { state.calls.push(['range', ...a]); return b },
    maybeSingle: () => Promise.resolve(state.result),
    then: (res, rej) => Promise.resolve(state.result).then(res, rej),
  }
  return b
}

vi.mock('../lib/supabase', () => ({
  supabase: {
    from: (t) => builder(t),
    rpc: (fn, args) => { state.calls.push(['rpc', fn, args]); return Promise.resolve(state.rpc) },
  },
}))

import {
  listBalances, listMovements, listDiscrepancies, listAdjustments, listOpeningBatches, listMasterReviews,
  listTyreItems, listCustodyConflicts, listSupplierAgreements, listPoLines, listGrnLines, overviewCounts,
  decideAdjustment, recountDiscrepancies, requestApproval, reconcileCost, receiveGoods, reserveStock, issueStock,
  dispatchTransfer, receiveTransfer, listTransfers, listPendingApprovals, listErpReconciliation, loadReconciliation,
  inventoryRefusalText, flattenEmbed, loadReportRows, VIEWS,
} from '../lib/api/inventory'
import { toUserMessage } from '../lib/inventory/errorText'
import {
  normaliseValuationRow, summariseValuation, valueLabelKey, valuationFromBalances, normaliseErpRow, erpExportRows,
  normaliseApproval, openTransferLines,
} from '../lib/inventory/integrationView'

beforeEach(() => {
  state.result = { data: [], error: null, count: 0 }
  state.rpc = { data: null, error: null }
  state.calls = []
})

const selects = () => state.calls.filter((c) => c[0] === 'select').map((c) => c[1])
const lastRpc = () => state.calls.filter((c) => c[0] === 'rpc').pop()

describe('reads use the web-named views', () => {
  it('every list read hits its v_inv_* view, never the base table', async () => {
    await Promise.all([
      listBalances({}), listMovements({}), listDiscrepancies({}), listAdjustments({}), listOpeningBatches({}),
      listMasterReviews({}), listTyreItems({}), listCustodyConflicts({}), listSupplierAgreements({}), listPoLines({}), listGrnLines({}),
    ])
    expect(selects().sort()).toEqual([
      'v_inv_adjustments', 'v_inv_balances', 'v_inv_custody_conflicts', 'v_inv_discrepancies', 'v_inv_grn_lines',
      'v_inv_master_reviews', 'v_inv_movements', 'v_inv_opening_batches', 'v_inv_po_lines', 'v_inv_supplier_agreements', 'v_inv_tyre_items',
    ])
    for (const t of ['stock_records', 'stock_movements', 'inventory_discrepancies', 'tyre_items', 'material_master_reviews']) {
      expect(selects()).not.toContain(t)
    }
  })

  it('reports read the views too', async () => {
    for (const s of ['balances', 'movements', 'discrepancies', 'tyreItems', 'conflicts']) await loadReportRows(s, {})
    expect(selects()).toEqual([VIEWS.balances, VIEWS.movements, VIEWS.discrepancies, VIEWS.tyreItems, VIEWS.conflicts])
  })

  it('maps the DB status words: pending review = submitted, pending adjustment = proposed', async () => {
    await listMasterReviews({ status: 'pending' })
    expect(state.calls).toContainEqual(['eq', 'status', 'submitted'])
    state.calls = []
    await overviewCounts({})
    expect(state.calls).toContainEqual(['eq', 'status', 'proposed'])
    expect(state.calls.filter((c) => c[0] === 'not').map((c) => c[3])).toContain('(closed,posted,rejected,written_off,superseded)')
  })

  it('reads audit lines with real columns and the codes through foreign keys', async () => {
    state.result = { data: [{ id: 'a', serial_no: 'S1', loc: { code: 'B04' }, itm: { item_code: 'X', item_name: 'Tyre' } }], error: null }
    const r = await loadReconciliation('aud')
    const cols = state.calls.filter((c) => c[0] === 'select').map((c) => c[2])
    expect(cols[0]).toContain('serial_no:serial')
    expect(cols[0]).toContain('expected_cost:unit_cost')
    expect(cols[0].split(', loc:')[0]).not.toMatch(/location_code|item_code/)
    expect(r.snapshot[0]).toMatchObject({ location_code: 'B04', item_code: 'X', description: 'Tyre' })
    expect(flattenEmbed({ id: 1 })).toEqual({ id: 1, location_code: null, item_code: null, description: null })
  })

  it('orders transfers by dispatched_at (stock_transfers has no created_at)', async () => {
    await listTransfers({ status: 'open' })
    expect(state.calls.find((c) => c[0] === 'order')).toEqual(['order', 'stock_transfers', 'dispatched_at', { ascending: false }])
    expect(state.calls).toContainEqual(['in', 'status', ['dispatched', 'in_transit', 'partially_received']])
  })

  it('reads the DB-lane views with select(*) and no guessed ordering column', async () => {
    await listPendingApprovals({ entityType: 'adjustment' })
    await listErpReconciliation({ status: 'differences' })
    expect(selects()).toEqual(['v_inv_pending_approvals', 'v_inv_erp_reconciliation'])
    expect(state.calls.filter((c) => c[0] === 'order').map((c) => c[2])).toEqual(['id', 'id'])
    expect(state.calls).toContainEqual(['neq', 'status', 'matched'])
  })
})

describe('writes', () => {
  it('approval decisions are approve / reject / hold; a recount goes to inv_recount_assign with a named counter', async () => {
    await expect(decideAdjustment({ discrepancyId: 'd', decision: 'recount' }, 'k')).rejects.toMatchObject({ code: 'INV_BAD_DECISION' })
    await decideAdjustment({ discrepancyId: 'd', decision: 'hold', note: 'n' }, 'k1')
    expect(lastRpc()[1]).toBe('inv_adjustment_approve')
    await recountDiscrepancies({ auditId: 'a', recounterId: 'u2', discrepancyIds: ['d'] }, 'k2')
    expect(lastRpc()).toEqual(['rpc', 'inv_recount_assign', { p_payload: { audit_id: 'a', recount_counter_id: 'u2', discrepancy_ids: ['d'], idempotency_key: 'k2' } }])
  })

  it('requests an approval with entity type + id + key', async () => {
    await requestApproval({ entityType: 'opening_batch', entityId: 'b1' }, 'k')
    expect(lastRpc()).toEqual(['rpc', 'inv_request_approval', { p_payload: { entity_type: 'opening_batch', entity_id: 'b1', idempotency_key: 'k' } }])
    await expect(requestApproval({ entityType: 'stock', entityId: 'x' }, 'k')).rejects.toMatchObject({ code: 'INV_BAD_ENTITY' })
  })

  it('a cost is never sent as zero or blank', async () => {
    await expect(reconcileCost({ reconciliationId: 'r', unitCost: '', currency: 'SAR' }, 'k')).rejects.toMatchObject({ code: 'INV_NO_COST' })
    await expect(reconcileCost({ reconciliationId: 'r', unitCost: 0, currency: 'SAR' }, 'k')).rejects.toMatchObject({ code: 'INV_NO_COST' })
    await expect(reconcileCost({ reconciliationId: 'r', unitCost: 10, currency: '' }, 'k')).rejects.toMatchObject({ code: 'INV_NO_CURRENCY' })
    expect(state.calls.filter((c) => c[0] === 'rpc')).toHaveLength(0)
    await reconcileCost({ reconciliationId: 'r', unitCost: '12.5', currency: 'sar', source: 'INV-1' }, 'k')
    expect(lastRpc()[2].p_payload).toMatchObject({ unit_cost: 12.5, currency: 'SAR', decision: 'propose', idempotency_key: 'k' })
    await reconcileCost({ reconciliationId: 'r', decision: 'reject', note: 'dup' }, 'k3')
    expect(lastRpc()[2].p_payload).toMatchObject({ unit_cost: null, currency: null, decision: 'reject' })
  })

  it('receive keeps an unknown cost as null, never 0', async () => {
    await receiveGoods({ country: 'KSA', site: 'NHC', lines: [{ item_id: 'i', location_id: 'l', qty_received: '5', unit_cost: '' }, { item_id: 'i' }] }, 'k')
    const p = lastRpc()[2].p_payload
    expect(p.lines).toHaveLength(1)
    expect(p.lines[0]).toMatchObject({ qty_received: 5, qty_rejected: 0, unit_cost: null, ownership: 'owned' })
  })

  it('reserve, issue, dispatch and receive send the documented payloads', async () => {
    await reserveStock({ stockId: 's', qty: '2', sourceDocId: 'JC1' }, 'k1')
    expect(lastRpc()[1]).toBe('inv_reserve')
    expect(lastRpc()[2].p_payload).toMatchObject({ stock_id: 's', qty: 2, source_doc_type: 'job_card', source_doc_id: 'JC1' })
    await issueStock({ stockId: 's', qty: 1, reservationId: 'r' }, 'k2')
    expect(lastRpc()[2].p_payload).toMatchObject({ stock_id: 's', qty: 1, reservation_id: 'r' })
    await expect(issueStock({ stockId: 's', qty: 0 }, 'k')).rejects.toMatchObject({ code: 'INV_BAD_QTY' })
    await expect(dispatchTransfer({ fromLocationId: 'a', toLocationId: 'a', lines: [] }, 'k')).rejects.toMatchObject({ code: 'INV_BAD_LOCATIONS' })
    await dispatchTransfer({ fromLocationId: 'a', toLocationId: 'b', lines: [{ stock_id: 's', qty: 3 }] }, 'k3')
    expect(lastRpc()[2].p_payload).toMatchObject({ from_location_id: 'a', to_location_id: 'b', lines: [{ stock_id: 's', qty: 3 }] })
    await receiveTransfer({ transferId: 't', lines: [{ line_id: 'l1', received_qty: '2' }, { line_id: 'l2', received_qty: '' }] }, 'k4')
    expect(lastRpc()[2].p_payload.lines).toEqual([{ line_id: 'l1', received_qty: 2, condition: 'good', remarks: null }])
  })
})

describe('server refusals', () => {
  it('shows the sentence the server wrote for segregation of duties', async () => {
    state.rpc = { data: null, error: { code: '42501', message: 'The approver cannot be the person who counted these lines.' } }
    const err = await decideAdjustment({ discrepancyId: 'd', decision: 'approve' }, 'k').catch((e) => e)
    expect(err.code).toBe('INV_REFUSED')
    expect(toUserMessage(err)).toBe('The approver cannot be the person who counted these lines.')
  })

  it('never shows database internals', () => {
    expect(inventoryRefusalText({ code: '42501', message: 'permission denied for function inv_issue' })).toBeNull()
    expect(inventoryRefusalText({ code: '22023', message: 'invalid input syntax for type uuid: "x"' })).toBeNull()
    expect(inventoryRefusalText({ code: '23505', message: 'Stock permission "issue" is required.' })).toBeNull()
    expect(inventoryRefusalText({ code: '22023', message: 'Choose two different locations in your company.' })).toBe('Choose two different locations in your company.')
    expect(toUserMessage({ code: '42501', message: 'x' })).toBe('You do not have permission to do that.')
  })
})

describe('valuation shaping (owner rule: unknown cost is never zero)', () => {
  it('flags incomplete when any unvalued qty exists and never labels a partial value total', () => {
    const s = summariseValuation([
      { currency: 'SAR', valued_qty: 10, unvalued_qty: 0, valued_amount: 1000 },
      { currency: 'SAR', valued_qty: 2, unvalued_qty: 3, valued_amount: 200 },
    ])
    expect(s.complete).toBe(false)
    expect(s.currencies[0]).toMatchObject({ currency: 'SAR', valuedQty: 12, unvaluedQty: 3, valuedAmount: 1200, complete: false })
    expect(valueLabelKey(s.complete)).toBe('partialValue')
    expect(valueLabelKey(true)).toBe('totalValue')
    expect(valueLabelKey(null)).toBe('valueUnknownCompleteness')
  })

  it('keeps currencies apart and honours the server completeness flag', () => {
    const s = summariseValuation([
      { currency: 'SAR', valued_qty: 1, unvalued_qty: 0, valued_amount: 10, valuation_complete: true },
      { currency: 'aed', valued_qty: 1, unvalued_qty: 0, valued_amount: 5, valuation_complete: true },
    ])
    expect(s.mixedCurrency).toBe(true)
    expect(s.currencies.map((c) => [c.currency, c.valuedAmount])).toEqual([['SAR', 10], ['AED', 5]])
    expect(s.complete).toBe(true)
  })

  it('an unknown amount stays null, and missing unvalued qty is unknown, not complete', () => {
    expect(normaliseValuationRow({ currency: 'SAR', valued_qty: 1 }).complete).toBeNull()
    const s = summariseValuation([{ currency: 'SAR', valued_qty: 1, unvalued_qty: 0, valued_amount: null }])
    expect(s.currencies[0].valuedAmount).toBeNull()
    expect(summariseValuation([]).complete).toBeNull()
  })

  it('falls back to balance lines without inventing a cost', () => {
    const rows = valuationFromBalances([
      { id: 1, currency: 'SAR', qty_on_hand: 4, avg_unit_cost: null, ownership: 'owned' },
      { id: 2, currency: 'SAR', qty_on_hand: 2, avg_unit_cost: 10, valued_qty: 2, unvalued_qty: 0 },
      { id: 3, currency: 'SAR', qty_on_hand: 9, avg_unit_cost: 1, ownership: 'consignment' },
    ])
    expect(rows).toHaveLength(2)
    expect(rows[0]).toMatchObject({ unvaluedQty: 4, valuedQty: 0, complete: false })
    expect(rows[1]).toMatchObject({ valuedAmount: 20, complete: true })
  })
})

describe('ERP reconciliation and approvals shaping', () => {
  it('derives differences only when both sides are known', () => {
    expect(normaliseErpRow({ item_code: 'A', inventory_qty: 5, erp_qty: 3, inventory_value: 50, erp_value: 30.5, currency: 'sar', status: 'qty_difference' }))
      .toMatchObject({ qtyDiff: 2, valueDiff: 19.5, currency: 'SAR' })
    expect(normaliseErpRow({ item_code: 'B', erp_qty: 3 }).qtyDiff).toBeNull()
    expect(erpExportRows([{ item_code: 'B', erp_qty: 3 }])[0]).toMatchObject({ inventory_qty: 'N/A', erp_qty: 3, qty_difference: 'N/A', status: 'unknown' })
  })

  it('approvals and transfer lines tolerate column variants', () => {
    expect(normaliseApproval({ id: 'x', entity_type: 'recount', entity_id: 'e', created_at: 't' })).toMatchObject({ entityType: 'recount', entityId: 'e', requestedAt: 't', status: 'pending' })
    expect(openTransferLines({ lines: [{ id: 1, qty_dispatched: 5, qty_received: 2 }, { id: 2, qty_dispatched: 1, qty_received: 1 }] }))
      .toEqual([expect.objectContaining({ id: 1, outstanding: 3 })])
  })
})

describe('scheduled inventory digest', () => {
  it('registers report_type inventory over v_inv_report_snapshot as a current-state snapshot', async () => {
    const sched = await import('../lib/api/scheduledReports')
    expect(sched.REPORT_TYPES.some((r) => r.value === 'inventory')).toBe(true)
    const ds = sched.datasetFor('inventory')
    expect(ds).toMatchObject({ table: 'v_inv_report_snapshot', dateCol: null, currentState: true })
    expect(ds.cols).toHaveLength(ds.headers.length)
    expect(ds.cols).toEqual(expect.arrayContaining(['currency', 'valued_amount', 'unvalued_qty', 'valuation_complete']))
    await sched.fetchReportRows('inventory', { from: '2026-01-01', to: '2026-01-31' })
    const orders = state.calls.filter((c) => c[0] === 'order' && c[1] === 'v_inv_report_snapshot').map((c) => c[2])
    expect(orders).toEqual(['id'])
  })
})
