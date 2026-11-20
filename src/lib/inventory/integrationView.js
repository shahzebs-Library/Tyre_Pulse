/**
 * Shaping for the views the DB lane added in the client-integration round
 * (pure, no I/O): v_inv_valuation, v_inv_pending_approvals,
 * inventory_cost_reconciliations and v_inv_erp_reconciliation.
 *
 * The screens read those views with `select('*')` because the DB lane owns
 * their shape; these helpers accept the documented column names plus the
 * obvious alternates, so a rename on either side degrades to "N/A" for one
 * field instead of a broken screen.
 *
 * OWNER RULE: unknown cost is never zero and never invented. A value that is
 * missing stays null (rendered "N/A"), a valuation with unvalued quantity is
 * flagged incomplete, and a partial value is never labelled a total.
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
 * `complete` is the server flag when present, otherwise derived: complete
 * only when there is no unvalued quantity at all. Unknown stays unknown.
 */
export function normaliseValuationRow(row = {}) {
  const valuedQty = num(pick(row, ['valued_qty', 'qty_valued']))
  const unvaluedQty = num(pick(row, ['unvalued_qty', 'qty_unvalued']))
  const amount = num(pick(row, ['valued_amount', 'valued_value', 'value_valued']))
  const flag = pick(row, ['valuation_complete', 'complete', 'is_complete'])
  let complete
  if (flag !== null) complete = truthy(flag)
  else if (unvaluedQty === null) complete = null
  else complete = unvaluedQty === 0
  return {
    key: row.id || [row.country, row.site, row.location_code, row.currency].filter(Boolean).join('|') || 'all',
    country: row.country || null,
    site: row.site || null,
    location: pick(row, ['location_code', 'location']),
    currency: upper(row.currency),
    valuedQty,
    unvaluedQty,
    valuedAmount: amount,
    complete,
    openReconciliations: num(pick(row, ['open_reconciliations', 'open_reconciliation_count', 'open_cost_reconciliations', 'reconciliations_open'])),
  }
}

/**
 * Totals PER CURRENCY (never blended). A currency is complete only if every
 * contributing row is complete; any unknown flag makes it unknown, never
 * complete. Rows with no currency are kept under `null` and flagged.
 */
export function summariseValuation(rows = []) {
  const byCurrency = new Map()
  let unvaluedQty = 0
  let unvaluedKnown = true
  let openReconciliations = 0
  let reconKnown = false
  for (const raw of rows) {
    const r = raw && raw.valuedQty !== undefined ? raw : normaliseValuationRow(raw)
    const k = r.currency || null
    const cur = byCurrency.get(k) || { currency: k, valuedQty: 0, unvaluedQty: 0, valuedAmount: 0, amountKnown: true, complete: true }
    cur.valuedQty += r.valuedQty || 0
    cur.unvaluedQty += r.unvaluedQty || 0
    if (r.valuedAmount === null) cur.amountKnown = false
    else cur.valuedAmount += r.valuedAmount
    if (r.complete === false) cur.complete = false
    else if (r.complete === null && cur.complete !== false) cur.complete = null
    byCurrency.set(k, cur)
    if (r.unvaluedQty === null) unvaluedKnown = false
    else unvaluedQty += r.unvaluedQty
    if (r.openReconciliations !== null) { reconKnown = true; openReconciliations += r.openReconciliations }
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
        id: b.id,
        country: b.country,
        site: b.site,
        location_code: b.location_code,
        currency: b.currency,
        valued_qty: valuedQty,
        unvalued_qty: unvaluedQty,
        valued_amount: cost === null || valuedQty === null ? null : cost * valuedQty,
      })
    })
}

// ── Approvals ────────────────────────────────────────────────────────────────

export function normaliseApproval(row = {}) {
  return {
    id: row.id || row.approval_id || null,
    entityType: pick(row, ['entity_type', 'type']),
    entityId: pick(row, ['entity_id', 'record_id']),
    entityRef: pick(row, ['entity_ref', 'reference', 'ref', 'entity_label']),
    requestedBy: pick(row, ['requested_by_name', 'requested_by']),
    requestedAt: pick(row, ['requested_at', 'created_at']),
    status: pick(row, ['status', 'approval_status']) || 'pending',
    summary: pick(row, ['summary', 'reason', 'note', 'description']),
    site: row.site || null,
    country: row.country || null,
  }
}

// ── Cost reconciliations ─────────────────────────────────────────────────────

export function normaliseCostReconciliation(row = {}) {
  return {
    id: row.id || null,
    stockId: pick(row, ['stock_id', 'stock_record_id']),
    itemCode: pick(row, ['item_code', 'item']),
    description: pick(row, ['description', 'item_name']),
    location: pick(row, ['location_code', 'site']),
    unvaluedQty: num(pick(row, ['unvalued_qty', 'qty_unvalued', 'qty'])),
    proposedCost: num(pick(row, ['proposed_unit_cost', 'unit_cost', 'proposed_cost'])),
    currency: upper(pick(row, ['currency', 'proposed_currency'])),
    source: pick(row, ['source', 'cost_source']),
    status: pick(row, ['status']) || 'open',
    createdAt: pick(row, ['created_at', 'opened_at']),
  }
}

// ── ERP reconciliation ───────────────────────────────────────────────────────

export function normaliseErpRow(row = {}) {
  const invQty = num(pick(row, ['inventory_qty', 'inv_qty', 'qty_inventory']))
  const erpQty = num(pick(row, ['erp_qty', 'qty_erp']))
  const invValue = num(pick(row, ['inventory_value', 'inv_value', 'value_inventory']))
  const erpValue = num(pick(row, ['erp_value', 'value_erp']))
  let qtyDiff = num(pick(row, ['qty_difference', 'qty_diff', 'difference_qty']))
  if (qtyDiff === null && invQty !== null && erpQty !== null) qtyDiff = invQty - erpQty
  let valueDiff = num(pick(row, ['value_difference', 'value_diff', 'difference_value']))
  if (valueDiff === null && invValue !== null && erpValue !== null) valueDiff = Math.round((invValue - erpValue) * 100) / 100
  return {
    id: row.id || [row.item_code, row.site, row.currency].filter(Boolean).join('|'),
    itemCode: pick(row, ['item_code', 'item']),
    description: pick(row, ['description', 'item_name']),
    site: row.site || null,
    country: row.country || null,
    currency: upper(row.currency),
    invQty, erpQty, qtyDiff, invValue, erpValue, valueDiff,
    status: pick(row, ['status', 'reconciliation_status']) || 'unknown',
  }
}

export const ERP_STATUS_TONE = {
  matched: 'good', qty_difference: 'warning', value_difference: 'warning',
  missing_in_erp: 'bad', missing_in_inventory: 'bad', unknown: 'muted',
}

/** Export rows (plain values, money beside its currency, nothing blended). */
export function erpExportRows(rows = []) {
  const na = (v) => (v === null || v === undefined || v === '' ? 'N/A' : v)
  return rows.map((raw) => {
    const r = raw && raw.qtyDiff !== undefined ? raw : normaliseErpRow(raw)
    return {
      item_code: na(r.itemCode), description: na(r.description), site: na(r.site), country: na(r.country),
      inventory_qty: na(r.invQty), erp_qty: na(r.erpQty), qty_difference: na(r.qtyDiff),
      inventory_value: na(r.invValue), erp_value: na(r.erpValue), value_difference: na(r.valueDiff),
      currency: na(r.currency), status: na(r.status),
    }
  })
}

export const ERP_EXPORT_COLUMNS = [
  ['item_code', 'Item code'], ['description', 'Description'], ['site', 'Site'], ['country', 'Country'],
  ['inventory_qty', 'Inventory qty'], ['erp_qty', 'ERP qty'], ['qty_difference', 'Qty difference'],
  ['inventory_value', 'Inventory value'], ['erp_value', 'ERP value'], ['value_difference', 'Value difference'],
  ['currency', 'Currency'], ['status', 'Status'],
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
