/**
 * Shaping for the views the DB lane added in the client-integration round
 * (pure, no I/O): v_inv_valuation, v_inv_pending_approvals,
 * v_inv_cost_reconciliations, v_inv_erp_reconciliation and the posting answers.
 * Column names follow docs/inventory/10_DB_IMPLEMENTATION.md section 6.
 *
 * OWNER RULE: unknown cost is never zero and never invented. A value that is
 * missing stays null (rendered "N/A"), a valuation with unvalued or
 * not-yet-allocated quantity is flagged incomplete, and a partial value is
 * never labelled a total.
 */

/** First defined, non-empty value among `keys`. */
export function pick(row, keys) {
  for (const k of keys) {
    const v = row?.[k]
    if (v !== undefined && v !== null && v !== '') return v
  }
  return null
}

export const num = (v) => {
  if (v === null || v === undefined || v === '') return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

const upper = (s) => (s ? String(s).trim().toUpperCase() : null)

const truthy = (v) => v === true || v === 'true' || v === 't' || v === 1

// ── Valuation ────────────────────────────────────────────────────────────────

/**
 * One v_inv_valuation row -> a stable shape.
 * Pending allocation (doc 10 section 6.1: an issue or transfer from a balance
 * holding both valued and unvalued units leaves the ambiguous part undecided
 * until an approved split) is a THIRD figure beside valued and unvalued: any
 * pending quantity or open allocation makes the row incomplete even if the
 * server flag said complete.
 */
export function normaliseValuationRow(row = {}) {
  const valuedQty = num(row.valued_qty)
  const unvaluedQty = num(row.unvalued_qty)
  const pendingAllocationQty = num(row.pending_allocation_qty)
  const pendingOutQty = num(row.pending_allocation_out_qty)
  const pendingInQty = num(row.pending_allocation_in_qty)
  const openAllocations = num(row.open_allocations)
  const amount = num(pick(row, ['valued_amount', 'valued_value']))
  const flag = pick(row, ['valuation_complete'])
  let complete
  if (flag !== null) complete = truthy(flag)
  else if (unvaluedQty === null) complete = null
  else complete = unvaluedQty === 0
  if ((pendingAllocationQty ?? 0) > 0 || (pendingOutQty ?? 0) > 0 || (pendingInQty ?? 0) > 0 || (openAllocations ?? 0) > 0) complete = false
  return {
    key: row.stock_id || row.id || [row.country, row.site, row.location_id, row.currency].filter(Boolean).join('|') || 'all',
    stockId: row.stock_id || row.id || null,
    itemCode: row.item_code || null,
    description: row.description || null,
    country: row.country || null,
    site: row.site || null,
    location: pick(row, ['location_code', 'location_id']),
    ownership: row.ownership || 'owned',
    currency: upper(row.currency),
    qtyOnHand: num(row.qty_on_hand),
    valuedQty,
    unvaluedQty,
    pendingAllocationQty,
    pendingOutQty,
    pendingInQty,
    openAllocations,
    valuedAmount: amount,
    avgUnitCost: num(row.avg_unit_cost),
    complete,
    status: row.valuation_status || null,
    openReconciliations: num(row.open_reconciliations),
  }
}

/** Undecided-split quantity of one row: the view's total, else out + in. */
export function pendingOf(r) {
  if (r.pendingAllocationQty !== null && r.pendingAllocationQty !== undefined) return r.pendingAllocationQty
  return (r.pendingOutQty || 0) + (r.pendingInQty || 0)
}

/**
 * Totals PER CURRENCY (never blended), owned stock only (consignment and
 * supplier stock are not the company's value). A currency is complete only if
 * every contributing row is complete; any unknown flag makes it unknown, never
 * complete. Rows with no currency are kept under `null` and flagged.
 */
export function summariseValuation(rows = []) {
  const byCurrency = new Map()
  let unvaluedQty = 0
  let unvaluedKnown = true
  let pendingAllocationQty = 0
  let openAllocations = 0
  let openReconciliations = 0
  let reconKnown = false
  for (const raw of rows) {
    const r = raw && raw.valuedQty !== undefined ? raw : normaliseValuationRow(raw)
    if (r.ownership && r.ownership !== 'owned') continue
    const k = r.currency || null
    const cur = byCurrency.get(k) || { currency: k, valuedQty: 0, unvaluedQty: 0, pendingAllocationQty: 0, valuedAmount: 0, amountKnown: true, complete: true }
    cur.valuedQty += r.valuedQty || 0
    cur.unvaluedQty += r.unvaluedQty || 0
    const pending = pendingOf(r)
    cur.pendingAllocationQty += pending
    if (r.valuedAmount === null) cur.amountKnown = false
    else cur.valuedAmount += r.valuedAmount
    if (r.complete === false) cur.complete = false
    else if (r.complete === null && cur.complete !== false) cur.complete = null
    byCurrency.set(k, cur)
    if (r.unvaluedQty === null) unvaluedKnown = false
    else unvaluedQty += r.unvaluedQty
    pendingAllocationQty += pending
    openAllocations += r.openAllocations || 0
    if (r.openReconciliations !== null && r.openReconciliations !== undefined) { reconKnown = true; openReconciliations += r.openReconciliations }
  }
  const currencies = [...byCurrency.values()].map((c) => ({
    ...c,
    valuedAmount: c.amountKnown ? Math.round(c.valuedAmount * 100) / 100 : null,
  }))
  const allComplete = currencies.length > 0 && currencies.every((c) => c.complete === true)
  const anyIncomplete = currencies.some((c) => c.complete === false)
  return {
    currencies,
    mixedCurrency: currencies.filter((c) => c.currency).length > 1,
    unvaluedQty: unvaluedKnown ? unvaluedQty : null,
    pendingAllocationQty,
    openAllocations,
    openReconciliations: reconKnown ? openReconciliations : null,
    /** true = every currency fully valued; false = at least one has unvalued stock; null = unknown. */
    complete: currencies.length === 0 ? null : allComplete ? true : anyIncomplete ? false : null,
  }
}

/**
 * The headline label for a valued amount: never "total" unless complete.
 * Returns a translation key suffix.
 */
export function valueLabelKey(complete) {
  if (complete === true) return 'totalValue'
  if (complete === false) return 'partialValue'
  return 'valueUnknownCompleteness'
}

/** Fallback when v_inv_valuation is not installed: same shape from v_inv_balances. */
export function valuationFromBalances(balances = []) {
  return balances
    .filter((b) => !b.ownership || b.ownership === 'owned')
    .map((b) => {
      const qty = num(b.qty_on_hand)
      const valuedQty = num(b.valued_qty) ?? (num(b.avg_unit_cost) !== null ? qty : 0)
      const unvaluedQty = num(b.unvalued_qty) ?? (num(b.avg_unit_cost) === null ? qty : 0)
      const cost = num(b.avg_unit_cost)
      return normaliseValuationRow({
        stock_id: b.id,
        item_code: b.item_code,
        description: b.description,
        country: b.country,
        site: b.site,
        location_code: b.location_code,
        currency: b.currency,
        qty_on_hand: qty,
        valued_qty: valuedQty,
        unvalued_qty: unvaluedQty,
        valued_amount: cost === null || valuedQty === null ? null : cost * valuedQty,
      })
    })
}

/**
 * Posting answer -> how much moved at known and unknown cost, or null when the
 * server did not say (older answer shapes). Multi-line answers are summed.
 */
export function movedSplit(result) {
  if (!result || typeof result !== 'object') return null
  const parts = [result, ...['lines', 'results', 'postings', 'movements'].flatMap((k) => (Array.isArray(result[k]) ? result[k] : []))]
  let seen = false
  let valued = 0
  let unvalued = 0
  let pending = 0
  for (const p of parts) {
    const v = num(p?.valued_qty_moved)
    const u = num(p?.unvalued_qty_moved)
    const d = num(p?.pending_allocation_qty)
    if (v === null && u === null && d === null) continue
    seen = true
    valued += Math.abs(v || 0)
    unvalued += Math.abs(u || 0)
    pending += Math.abs(d || 0)
  }
  return seen ? { valued, unvalued, pending } : null
}

// ── Approvals ────────────────────────────────────────────────────────────────

/** One v_inv_pending_approvals row. `canDecide` is the server's answer, never guessed. */
export function normaliseApproval(row = {}) {
  const stages = Array.isArray(row.stages) ? row.stages : []
  const idx = num(row.current_stage)
  const blocked = row.blocked_reason ? String(row.blocked_reason) : null
  return {
    id: row.id || null,
    entityType: row.entity_type || null,
    entityId: row.entity_id || null,
    entityRef: row.entity_ref || null,
    proposal: row.proposal && typeof row.proposal === 'object' ? row.proposal : null,
    reason: row.reason || null,
    requestedBy: row.requested_by || null,
    requestedAt: row.requested_at || null,
    status: row.status || 'pending',
    stageName: row.stage_name || null,
    stageIndex: idx,
    stageCount: num(row.stage_count) ?? (stages.length || null),
    routeSource: row.route_source || null,
    canDecide: row.can_decide === undefined ? null : truthy(row.can_decide),
    blockedReason: blocked,
    site: row.site || null,
    country: row.country || null,
  }
}

// ── Cost reconciliations ─────────────────────────────────────────────────────

export function normaliseCostReconciliation(row = {}) {
  return {
    id: row.id || null,
    stockId: row.stock_id || null,
    itemCode: row.item_code || null,
    location: row.location_id || null,
    site: row.site || null,
    kind: row.kind || null,
    consumed: truthy(row.consumed),
    unvaluedQty: num(row.unvalued_qty),
    proposedResolution: row.proposed_resolution || null,
    proposedCost: num(row.proposed_unit_cost),
    isAllocation: row.kind === 'issue_allocation',
    allocationQty: num(row.allocation_qty) ?? (row.kind === 'issue_allocation' ? num(row.unvalued_qty) : null),
    snapshot: row.snapshot && typeof row.snapshot === 'object' ? row.snapshot : null,
    holderStockId: row.holder_stock_id || null,
    proposedValuedQty: num(row.proposed_valued_qty),
    resolvedValuedQty: num(row.resolved_valued_qty),
    resolvedUnvaluedQty: num(row.resolved_unvalued_qty),
    resolvedCost: num(row.resolved_unit_cost),
    resolvedValue: num(row.resolved_value),
    currency: upper(row.currency),
    approvalRequestId: row.approval_request_id || null,
    status: row.status || 'open',
    createdBy: row.created_by || null,
    createdAt: row.created_at || null,
    notes: row.notes || null,
  }
}

export const COST_RECON_TONE = { open: 'warning', resolved: 'good', written_off: 'muted', cancelled: 'muted' }

// ── ERP reconciliation ───────────────────────────────────────────────────────

export function normaliseErpRow(row = {}) {
  const invQty = num(row.inventory_qty)
  const erpQty = num(row.erp_qty)
  const invValue = num(row.inventory_value)
  const erpValue = num(row.erp_value)
  let qtyDiff = num(row.qty_difference)
  if (qtyDiff === null && invQty !== null && erpQty !== null) qtyDiff = invQty - erpQty
  const valueDiff = num(row.value_difference)
  return {
    id: [row.month, row.country, row.site, row.item_code, row.currency].map((x) => x ?? '').join('|'),
    month: row.month || null,
    itemCode: row.item_code || null,
    site: row.site || null,
    country: row.country || null,
    currency: upper(row.currency),
    invQty, erpQty, qtyDiff, invValue, erpValue, valueDiff,
    invUnvaluedQty: num(row.inventory_unvalued_qty),
    invMovements: num(row.inventory_movements),
    erpLines: num(row.erp_lines),
    status: row.status || 'unknown',
  }
}

export const ERP_STATUS_TONE = {
  matched: 'good', qty_diff: 'warning', value_diff: 'warning', unvalued: 'warning',
  inventory_only: 'bad', erp_only: 'bad', unknown: 'muted',
}

/** Export rows (plain values, money beside its currency, nothing blended). */
export function erpExportRows(rows = []) {
  const na = (v) => (v === null || v === undefined || v === '' ? 'N/A' : v)
  return rows.map((raw) => {
    const r = raw && raw.qtyDiff !== undefined ? raw : normaliseErpRow(raw)
    return {
      month: na(r.month), item_code: na(r.itemCode), site: na(r.site), country: na(r.country),
      inventory_qty: na(r.invQty), inventory_unvalued_qty: na(r.invUnvaluedQty), erp_qty: na(r.erpQty), qty_difference: na(r.qtyDiff),
      inventory_value: na(r.invValue), erp_value: na(r.erpValue), value_difference: na(r.valueDiff),
      currency: na(r.currency), status: na(r.status),
    }
  })
}

export const ERP_EXPORT_COLUMNS = [
  ['month', 'Month'], ['item_code', 'Item code'], ['site', 'Site'], ['country', 'Country'],
  ['inventory_qty', 'Inventory qty'], ['inventory_unvalued_qty', 'Inventory qty at unknown cost'], ['erp_qty', 'ERP qty'],
  ['qty_difference', 'Qty difference'], ['inventory_value', 'Inventory value (valued part)'], ['erp_value', 'ERP value'],
  ['value_difference', 'Value difference'], ['currency', 'Currency'], ['status', 'Status'],
]

// ── Transfers ────────────────────────────────────────────────────────────────

/** Lines still awaiting receipt (dispatched minus received minus returned). */
export function openTransferLines(transfer = {}) {
  return (transfer.lines || []).map((l) => {
    const sent = num(pick(l, ['qty_dispatched', 'dispatched_qty', 'qty'])) || 0
    const got = num(pick(l, ['qty_received', 'received_qty'])) || 0
    const back = num(pick(l, ['qty_returned', 'returned_qty'])) || 0
    return { ...l, outstanding: Math.max(0, sent - got - back), sent, got }
  }).filter((l) => l.outstanding > 0)
}
