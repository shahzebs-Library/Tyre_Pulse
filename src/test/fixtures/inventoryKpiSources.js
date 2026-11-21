/** Shared fixture: raw rows as src/lib/api/inventoryKpi.js returns them. */
const ok = (rows) => ({ status: 'ok', rows, truncated: false, error: null })

export const NOW = new Date('2026-11-21T12:00:00Z')

export function populatedSources() {
  const issue = (id, month, value) => ({ id, movement_type: 'issue', item_id: 'i1', stock_id: 's1', site: 'NHC', country: 'KSA', qty_change: -1, value_change: value, currency: 'SAR', ownership: 'owned', posted_at: `2026-${month}-05T08:00:00Z` })
  return {
    valuation: ok([
      { stock_id: 's1', item_id: 'i1', country: 'KSA', site: 'NHC', ownership: 'owned', currency: 'SAR', qty_on_hand: 10, qty_reserved: 3, valued_qty: 10, unvalued_qty: 0, valued_value: 1000, avg_unit_cost: 100, last_issue_at: '2026-11-05T08:00:00Z' },
      { stock_id: 's2', item_id: 'i2', country: 'KSA', site: 'NHC', ownership: 'owned', currency: 'SAR', qty_on_hand: 5, qty_reserved: 0, valued_qty: 2, unvalued_qty: 3, valued_value: 100, avg_unit_cost: 50, last_issue_at: null },
      { stock_id: 's3', item_id: 'i3', country: 'KSA', site: 'NHC', ownership: 'consignment', owner_supplier_id: 'sup1', currency: 'SAR', qty_on_hand: 4, qty_reserved: 0, valued_qty: 0, unvalued_qty: 4, valued_value: null, last_issue_at: null },
    ]),
    items: ok([
      { id: 'i1', organisation_id: 'o', item_code: 'P-1', item_name: 'Brake pad', category: 'spare', criticality: 'vital', status: 'active', safety_stock: 2, max_qty: 8, created_at: '2025-01-01T00:00:00Z' },
      { id: 'i2', organisation_id: 'o', item_code: 'P-2', item_name: 'Old filter', category: 'spare', criticality: null, status: 'obsolete', safety_stock: null, max_qty: null, created_at: '2025-01-01T00:00:00Z' },
      { id: 'i3', organisation_id: 'o', item_code: 'P-3', item_name: 'Consigned oil', category: 'oil', criticality: 'essential', status: 'active', created_at: '2025-01-01T00:00:00Z' },
    ]),
    movements: ok([
      issue('m1', '06', -100), issue('m2', '07', -100), issue('m3', '08', -100), issue('m4', '09', -100),
      issue('m5', '10', -100), issue('m6', '11', -100),
      { id: 'm7', movement_type: 'adjustment_up', item_id: 'i2', stock_id: 's2', site: 'NHC', country: 'KSA', qty_change: 1, value_change: 50, currency: 'SAR', ownership: 'owned', posted_at: '2026-11-10T08:00:00Z' },
    ]),
    ledgerStartAt: '2025-06-01T00:00:00Z',
    reservations: ok([{ id: 'r1', stock_id: 's1', qty: 3, qty_released: 0, qty_consumed: 1, status: 'active', created_at: '2026-10-01T00:00:00Z' }]),
    exceptions: ok([{ id: 'x1', exception_type: 'shortage', item_id: 'i1', qty: 2, created_at: '2026-11-01T00:00:00Z' }]),
    orders: ok([{ id: 'o1', po_number: 'PO-1', supplier_id: 'sup1', order_date: '2026-10-01', expected_delivery: '2026-10-10', priority: 'Emergency', status: 'Open', total_amount: 500, currency: 'SAR' }]),
    poLines: ok([{ id: 'l1', po_id: 'o1', item_id: 'i1', qty_ordered: 10, qty_received: 4, qty_accepted: 4, unit_price: 50, currency: 'SAR', status: 'partial' }]),
    grnLines: ok([{ id: 'gl1', grn_id: 'g1', po_line_id: 'l1', qty_accepted: 4 }]),
    grns: ok([{ id: 'g1', po_id: 'o1', received_date: '2026-10-09', created_at: '2026-10-09T00:00:00Z' }]),
    agreements: ok([{ id: 'a1', supplier_id: 'sup1', agreement_type: 'consignment', lead_time_days: 5, max_qty: 10, status: 'active' }]),
    consumptions: ok([{ id: 'c1', supplier_id: 'sup1', qty: 2, created_at: '2026-11-02T00:00:00Z' }]),
    audit: { id: 'aud1', ref: 'AUD-1', status: 'reconciliation', created_at: '2026-11-15T00:00:00Z' },
    count: {
      status: 'ok', truncated: false, error: null,
      snapshot: [{ id: 'sn1', audit_id: 'aud1', location_id: 'L1', item_id: 'i1', serial_no: null, expected_qty: 10, unit_cost: 100, currency: 'SAR' }],
      counts: [{ id: 'cl1', audit_id: 'aud1', location_id: 'L1', item_id: 'i1', serial_no: null, counted_qty: 9, confirmed_zero: false, round: 1, counted_at: '2026-11-16T00:00:00Z' }],
    },
  }
}

export function emptySources() {
  const e = ok([])
  return {
    valuation: e, items: e, movements: e, ledgerStartAt: null, reservations: e, exceptions: e, orders: e, poLines: e,
    grnLines: e, grns: e, agreements: e, consumptions: e, audit: null, count: { status: 'ok', snapshot: [], counts: [], truncated: false, error: null },
  }
}
