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
  inventoryRefusalText, flattenEmbed, loadReportRows, VIEWS, decideApproval, getApprovalState, listCostReconciliations,
  COST_RECON_STATUSES,
} from '../lib/api/inventory'
import { toUserMessage } from '../lib/inventory/errorText'
import {
  normaliseValuationRow, summariseValuation, valueLabelKey, valuationFromBalances, normaliseErpRow, erpExportRows,
  normaliseApproval, openTransferLines, movedSplit,
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

  it('reads the DB-lane views and pages them on a real unique key (the ERP view has no id)', async () => {
    await listPendingApprovals({ entityType: 'stock_adjustment' })
    expect(selects()).toEqual(['v_inv_pending_approvals'])
    expect(state.calls.filter((c) => c[0] === 'order').map((c) => c[2])).toEqual(['requested_at', 'id'])
    expect(state.calls).toContainEqual(['eq', 'entity_type', 'stock_adjustment'])
    state.calls = []
    // One page and its total from one server pass when the function is installed.
    state.rpc = { data: { total: 3, rows: [{ item_code: 'TY-1' }] }, error: null }
    const viaRpc = await listErpReconciliation({ country: 'KSA', site: 'all', status: 'differences', search: 'TY-1', page: 2, pageSize: 10 })
    expect(viaRpc).toEqual({ status: 'ok', rows: [{ item_code: 'TY-1' }], total: 3 })
    expect(lastRpc()).toEqual(['rpc', 'inv_erp_reconciliation_page', {
      p_country: 'KSA', p_site: null, p_status: 'differences', p_month: null, p_month_from: null,
      p_item_like: '%TY-1%', p_offset: 20, p_limit: 10,
    }])
    expect(selects()).toEqual([])
    // Not installed yet: the view read, same filters and total order as before.
    state.calls = []
    state.rpc = { data: null, error: { code: 'PGRST202', message: 'Could not find the function' } }
    await listErpReconciliation({ status: 'differences', search: 'TY-1' })
    expect(selects()).toEqual(['v_inv_erp_reconciliation'])
    expect(state.calls.filter((c) => c[0] === 'order').map((c) => c[2])).toEqual(['month', 'country', 'site', 'item_code', 'currency'])
    expect(state.calls).toContainEqual(['neq', 'status', 'matched'])
    state.calls = []
    await listCostReconciliations({ status: 'open' })
    expect(selects()).toEqual(['v_inv_cost_reconciliations'])
    expect(state.calls).toContainEqual(['eq', 'status', 'open'])
    expect(COST_RECON_STATUSES).toEqual(['open', 'resolved', 'written_off', 'cancelled'])
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

  it('requests an approval with the DB entity types; a recount names its counter', async () => {
    await requestApproval({ entityType: 'opening_balance_batch', entityId: 'b1' }, 'k')
    expect(lastRpc()).toEqual(['rpc', 'inv_request_approval', { p_payload: { entity_type: 'opening_balance_batch', entity_id: 'b1', reason: null, evidence: [], idempotency_key: 'k' } }])
    await expect(requestApproval({ entityType: 'opening_batch', entityId: 'x' }, 'k')).rejects.toMatchObject({ code: 'INV_BAD_ENTITY' })
    await expect(requestApproval({ entityType: 'recount_assignment', entityId: 'a' }, 'k')).rejects.toMatchObject({ code: 'INV_NO_RECOUNTER' })
    await requestApproval({ entityType: 'recount_assignment', entityId: 'aud', proposal: { counter_id: 'u2' } }, 'k2')
    expect(lastRpc()[2].p_payload).toMatchObject({ entity_type: 'recount_assignment', entity_id: 'aud', proposal: { counter_id: 'u2' } })
  })

  it('a cost is proposed through approval, never sent as zero or blank, and posting carries no cost', async () => {
    const ask = (proposal, extra = {}) => requestApproval({ entityType: 'cost_reconciliation', entityId: 'r', proposal, ...extra }, 'k')
    await expect(ask({ resolution: 'resolved', unit_cost: '' }, { reason: 'INV-1' })).rejects.toMatchObject({ code: 'INV_NO_COST' })
    await expect(ask({ resolution: 'resolved', unit_cost: -1 }, { reason: 'INV-1' })).rejects.toMatchObject({ code: 'INV_NO_COST' })
    await expect(ask({ resolution: 'resolved', unit_cost: 10 })).rejects.toMatchObject({ code: 'INV_NO_EVIDENCE' })
    await expect(ask({ resolution: 'written_off' })).rejects.toMatchObject({ code: 'INV_NO_REASON' })
    expect(state.calls.filter((c) => c[0] === 'rpc')).toHaveLength(0)
    await ask({ resolution: 'resolved', unit_cost: '12.5' }, { reason: 'INV-1', evidence: 'invoice scan' })
    expect(lastRpc()[2].p_payload).toMatchObject({
      entity_type: 'cost_reconciliation', proposal: { resolution: 'resolved', unit_cost: 12.5 }, reason: 'INV-1',
      evidence: [{ type: 'note', text: 'invoice scan' }],
    })
    await reconcileCost({ reconciliationId: 'r', note: 'approved' }, 'k3')
    expect(lastRpc()).toEqual(['rpc', 'inv_cost_reconcile', { p_payload: { reconciliation_id: 'r', note: 'approved', idempotency_key: 'k3' } }])
  })

  it('an undecided split proposes valued_qty within the undecided units, with evidence; never a write-off', async () => {
    const ask = (proposal, extra = {}) => requestApproval({ entityType: 'cost_reconciliation', entityId: 'alloc', proposal, ...extra }, 'k')
    await expect(ask({ valued_qty: '', max_qty: 3 }, { reason: 'GRN-1' })).rejects.toMatchObject({ code: 'INV_BAD_SPLIT' })
    await expect(ask({ valued_qty: 4, max_qty: 3 }, { reason: 'GRN-1' })).rejects.toMatchObject({ code: 'INV_BAD_SPLIT' })
    await expect(ask({ valued_qty: 1, max_qty: 3 })).rejects.toMatchObject({ code: 'INV_NO_EVIDENCE' })
    expect(state.calls.filter((c) => c[0] === 'rpc')).toHaveLength(0)
    await ask({ valued_qty: '0', max_qty: 3 }, { evidence: 'batch B-7 label' })
    expect(lastRpc()[2].p_payload.proposal).toEqual({ resolution: 'resolved', valued_qty: 0 })
  })

  it('new allocation refusals reach the user in plain words', () => {
    const say = (message) => inventoryRefusalText({ code: '22023', message })
    expect(say('This balance has an undecided issue allocation; resolve it before assigning a cost.')).toMatch(/undecided cost split.*before pricing the units still in stock/)
    expect(say('This balance has an undecided issue allocation; resolve it before an opening correction.')).toMatch(/before posting an opening correction/)
    expect(say('This item is serial or lot tracked: name the receipt the units come from (source_receipt_movement_id).')).toMatch(/^This item is tracked by serial or lot.*goods receipt/)
    expect(say('proposal.valued_qty must be between 0 and 3.')).toBe('The units at known cost must be between 0 and 3.')
    expect(inventoryRefusalText({ code: '42501', message: 'An approved cost reconciliation approval is required before this can be posted (inv_request_approval, inv_approval_decide).' }))
      .toBe('This needs an approved cost reconciliation request first. Ask for approval, and post once another person has approved it.')
    for (const s of ['This item is serial or lot tracked: name the receipt the units come from (source_receipt_movement_id).', 'allocation_side must be source or holder.']) {
      expect(String(say(s) ?? '')).not.toMatch(/_id|_side/)
    }
  })

  it('decides an approval: approve or reject, a rejection needs a note', async () => {
    await expect(decideApproval({ requestId: 'q', decision: 'hold' }, 'k')).rejects.toMatchObject({ code: 'INV_BAD_DECISION' })
    await expect(decideApproval({ requestId: 'q', decision: 'reject' }, 'k')).rejects.toMatchObject({ code: 'INV_NO_NOTE' })
    await decideApproval({ requestId: 'q', decision: 'approve' }, 'k1')
    expect(lastRpc()).toEqual(['rpc', 'inv_approval_decide', { p_payload: { request_id: 'q', decision: 'approve', note: null, signature: null, idempotency_key: 'k1' } }])
  })

  it('reads the newest approval request for a record, null when unreadable', async () => {
    state.result = { data: [{ id: 'q', status: 'approved' }], error: null }
    expect(await getApprovalState('stock_adjustment', 'adj')).toMatchObject({ status: 'approved' })
    expect(selects()).toEqual(['inventory_approval_requests'])
    state.result = { data: null, error: { code: '42P01', message: 'x' } }
    expect(await getApprovalState('stock_adjustment', 'adj')).toBeNull()
    expect(await getApprovalState('stock_adjustment', null)).toBeNull()
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
    await issueStock({ stockId: 's', qty: 1, sourceReceiptMovementId: 'm1' }, 'k5')
    expect(lastRpc()[2].p_payload).toMatchObject({ stock_id: 's', source_receipt_movement_id: 'm1' })
    await dispatchTransfer({ fromLocationId: 'a', toLocationId: 'b', lines: [{ stock_id: 's', qty: 1, source_receipt_movement_id: 'm2' }] }, 'k6')
    expect(lastRpc()[2].p_payload.lines).toEqual([{ stock_id: 's', qty: 1, source_receipt_movement_id: 'm2' }])
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
  it('reads the view columns; a masked value stays null and is never derived', () => {
    expect(normaliseErpRow({ month: '2026-10-01', item_code: 'A', inventory_qty: 5, erp_qty: 3, inventory_value: 50, erp_value: 30.5,
      qty_difference: 2, value_difference: 19.5, inventory_unvalued_qty: 1, currency: 'sar', status: 'qty_diff' }))
      .toMatchObject({ qtyDiff: 2, valueDiff: 19.5, currency: 'SAR', invUnvaluedQty: 1, month: '2026-10-01', status: 'qty_diff' })
    // inventory_value NULL = masked without view_value: the difference is not invented.
    expect(normaliseErpRow({ item_code: 'B', inventory_qty: 1, erp_qty: 1, inventory_value: null, erp_value: 9, value_difference: null }).valueDiff).toBeNull()
    expect(erpExportRows([{ item_code: 'B', erp_qty: 3 }])[0]).toMatchObject({ inventory_qty: 'N/A', erp_qty: 3, qty_difference: 'N/A', status: 'unknown' })
  })

  it('approvals carry the server answer for who may decide; it is never guessed', () => {
    expect(normaliseApproval({ id: 'x', entity_type: 'recount_assignment', entity_id: 'e', requested_at: 't', can_decide: false, blocked_reason: 'You counted this audit.', stage_name: 'Elevated approver', stage_count: 1, current_stage: 0 }))
      .toMatchObject({ entityType: 'recount_assignment', canDecide: false, blockedReason: 'You counted this audit.', stageName: 'Elevated approver', stageCount: 1 })
    expect(normaliseApproval({ id: 'y', can_decide: true }).canDecide).toBe(true)
    expect(normaliseApproval({ id: 'z' }).canDecide).toBeNull()
    expect(openTransferLines({ lines: [{ id: 1, qty_dispatched: 5, qty_received: 2 }, { id: 2, qty_dispatched: 1, qty_received: 1 }] }))
      .toEqual([expect.objectContaining({ id: 1, outstanding: 3 })])
  })

  it('posting answers report what moved at known and unknown cost', () => {
    expect(movedSplit({ status: 'posted', valued_qty_moved: 4, unvalued_qty_moved: 1 })).toEqual({ valued: 4, unvalued: 1, pending: 0 })
    expect(movedSplit({ status: 'posted', lines: [{ valued_qty_moved: -2, unvalued_qty_moved: 0 }, { valued_qty_moved: 1, unvalued_qty_moved: 3 }] })).toEqual({ valued: 3, unvalued: 3, pending: 0 })
    expect(movedSplit({ status: 'posted', valued_qty_moved: 4, unvalued_qty_moved: 2, pending_allocation_qty: 1 })).toEqual({ valued: 4, unvalued: 2, pending: 1 })
    expect(movedSplit({ status: 'posted' })).toBeNull()
  })

  it('valued, unvalued and undecided are three separate figures; an undecided split is never valued', () => {
    const s = summariseValuation([
      { stock_id: 'a', currency: 'SAR', valued_qty: 4, unvalued_qty: 2, pending_allocation_out_qty: 1, pending_allocation_in_qty: 0, open_allocations: 1, valued_amount: 40, valuation_complete: false },
      { stock_id: 'b', currency: 'SAR', valued_qty: 5, unvalued_qty: 0, pending_allocation_qty: 0, pending_allocation_in_qty: 2, open_allocations: 0, valued_amount: 50, valuation_complete: true },
    ])
    expect(s.currencies[0]).toMatchObject({ valuedQty: 9, unvaluedQty: 2, valuedAmount: 90, complete: false })
    // row a: no total given -> out + in = 1; row b: the view total 0 wins, but pending_in 2 still marks it incomplete
    expect(s.pendingAllocationQty).toBe(1)
    expect(s.openAllocations).toBe(1)
    expect(normaliseValuationRow({ currency: 'SAR', valued_qty: 5, unvalued_qty: 0, pending_allocation_in_qty: 2, valuation_complete: true }).complete).toBe(false)
    expect(valueLabelKey(s.complete)).toBe('partialValue')
  })

  it('unallocated issued units keep the valuation incomplete', () => {
    const row = normaliseValuationRow({ stock_id: 's', currency: 'SAR', valued_qty: 3, unvalued_qty: 0, valuation_complete: true, pending_allocation_qty: 2 })
    expect(row.complete).toBe(false)
    const s = summariseValuation([row])
    expect(s.complete).toBe(false)
    expect(s.pendingAllocationQty).toBe(2)
    expect(summariseValuation([{ currency: 'SAR', valued_qty: 1, unvalued_qty: 5, ownership: 'consignment' }]).currencies).toHaveLength(0)
  })
})

describe('scheduled inventory digest', () => {
  it('registers report_type inventory over v_inv_report_snapshot as a current-state snapshot', async () => {
    const sched = await import('../lib/api/scheduledReports')
    expect(sched.REPORT_TYPES.some((r) => r.value === 'inventory')).toBe(true)
    const ds = sched.datasetFor('inventory')
    expect(ds).toMatchObject({ table: 'v_inv_report_snapshot', dateCol: null, currentState: true })
    expect(ds.cols).toHaveLength(ds.headers.length)
    expect(ds.cols).toEqual(expect.arrayContaining(['currency', 'owned_valued_amount', 'owned_unvalued_qty', 'valuation_complete', 'pending_approvals']))
    await sched.fetchReportRows('inventory', { from: '2026-01-01', to: '2026-01-31' })
    const orders = state.calls.filter((c) => c[0] === 'order' && c[1] === 'v_inv_report_snapshot').map((c) => c[2])
    // The view has no id: it pages on its own key.
    expect(orders).toEqual(['country', 'site', 'currency'])
  })
})
