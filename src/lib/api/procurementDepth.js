/**
 * Procurement depth service (migration 20261124130000): approved suppliers,
 * RFQ + quotation comparison, PO approval limits, emergency purchases,
 * backorders, supplier returns, three-way match and supplier performance.
 *
 * Every write is a SECURITY DEFINER RPC that re-checks company, country, site
 * and capability in the database (inv_can('procure') / 'receive'); the screens
 * only decide what to show. Reads go through RLS (security_invoker views).
 * Until the migration is applied each read answers { status: 'not_provisioned' }
 * and each write throws the shared "not set up" message.
 */
import { supabase, applyCountry, toServiceError, isNotProvisioned, isMissingColumn, ServiceError } from './_client'
import { newIdempotencyKey } from './inventory'

export { newIdempotencyKey }

export const NOT_SET_UP = 'This part of procurement is not switched on yet. Ask an administrator to apply the procurement update.'

async function rpc(fn, payload, key) {
  const { data, error } = await supabase.rpc(fn, { p_payload: { ...payload, idempotency_key: key || newIdempotencyKey() } })
  if (error) {
    if (isNotProvisioned(error)) throw new ServiceError(NOT_SET_UP, 'PROC_NOT_SET_UP', error)
    throw toServiceError(error)
  }
  return data
}

async function read(query, what) {
  const { data, error } = await query
  if (error) {
    // A missing column (42703 / PGRST204) means the procurement migration that
    // adds it is not applied yet: same honest "not set up" state, not an error.
    if (isNotProvisioned(error) || isMissingColumn(error)) return { status: 'not_provisioned', rows: [] }
    throw toServiceError(error, `Could not load ${what}.`)
  }
  return { status: 'ok', rows: data || [] }
}

const withSite = (q, site) => (site ? q.eq('site', String(site).toUpperCase()) : q)

// ── Approved supplier list ──────────────────────────────────────────────────

export function listSuppliersForApproval({ country } = {}) {
  let q = supabase.from('suppliers')
    .select('id,supplier_name,supplier_code,country,status,approved_for_purchasing,approval_note,approved_at,created_by')
  q = applyCountry(q, country)
  return read(q.order('supplier_name').order('id').limit(500), 'suppliers')
}

export function setSupplierApproval({ supplierId, approved, note }, key) {
  if (!supplierId) return Promise.reject(new ServiceError('Choose a supplier.', 'PROC_NO_SUPPLIER'))
  return rpc('inv_supplier_set_approval', { supplier_id: supplierId, approved: !!approved, note: note || null }, key)
}

// ── RFQ ─────────────────────────────────────────────────────────────────────

export function listRfqs({ country, site, status } = {}) {
  let q = supabase.from('procurement_rfqs')
    .select('id,rfq_no,country,site,status,title,needed_by,requisition_id,awarded_po_id,award_reason,awarded_at,created_at,' +
      'lines:procurement_rfq_lines(id,line_no,qty,description,item_id,item:material_master(item_code,item_name,base_uom)),' +
      'quotes:procurement_quotes(id,supplier_id,currency,lead_time_days,valid_until,quote_ref,status,' +
      'supplier:suppliers(supplier_name),lines:procurement_quote_lines(rfq_line_id,unit_price,qty_offered,lead_time_days))')
  q = withSite(applyCountry(q, country), site)
  if (status) q = q.eq('status', status)
  return read(q.order('created_at', { ascending: false }).order('id').limit(100), 'quotation requests').then((r) => ({
    ...r,
    rows: r.rows.map((x) => ({
      ...x,
      lines: (x.lines || []).sort((a, b) => a.line_no - b.line_no).map(({ item, ...l }) => ({
        ...l, item_code: item?.item_code || null, item_name: item?.item_name || l.description || null, uom: item?.base_uom || null,
      })),
      quotes: (x.quotes || []).map(({ supplier, ...q2 }) => ({ ...q2, supplier_name: supplier?.supplier_name || 'Supplier' })),
    })),
  }))
}

/**
 * The open quotation request raised from a requisition, or null. A missing
 * table (procurement migration not applied) answers null: nothing to block.
 */
export async function findOpenRfqForRequisition(requisitionId) {
  if (!requisitionId) return null
  const { data, error } = await supabase.from('procurement_rfqs').select('id,rfq_no,status')
    .eq('requisition_id', requisitionId).eq('status', 'open').order('created_at').limit(1)
  if (error) {
    if (isNotProvisioned(error) || isMissingColumn(error)) return null
    throw toServiceError(error, 'Could not check for an open quotation request.')
  }
  return data?.[0] || null
}

export const RFQ_BLOCKED_BY_PO =
  'This requisition already has a purchase order. Raise a quotation request only for a requisition that has no purchase order.'

export async function createRfq({ country, site, title, neededBy, requisitionId, lines, supplierIds }, key) {
  // A requisition is bought one way: by a quotation request OR a direct PO.
  if (requisitionId) {
    const { data, error } = await supabase.from('requisitions').select('id,status,po_ref').eq('id', requisitionId).maybeSingle()
    if (error) throw toServiceError(error, 'Could not check the requisition.')
    if (data && (data.po_ref || String(data.status).toLowerCase() === 'ordered')) {
      throw new ServiceError(RFQ_BLOCKED_BY_PO, 'PROC_REQ_HAS_PO')
    }
  }
  return rpc('inv_rfq_create', {
    country: country || null, site: site || null, title: title || null, needed_by: neededBy || null,
    requisition_id: requisitionId || null, supplier_ids: supplierIds || [],
    lines: (lines || []).map((l) => ({ item_id: l.item_id || null, description: l.description || null, qty: Number(l.qty) })),
  }, key)
}

export function recordQuote({ rfqId, supplierId, currency, leadTimeDays, validUntil, quoteRef, lines }, key) {
  return rpc('inv_rfq_quote_record', {
    rfq_id: rfqId, supplier_id: supplierId, currency: String(currency || '').toUpperCase(),
    lead_time_days: leadTimeDays === '' || leadTimeDays == null ? null : Number(leadTimeDays),
    valid_until: validUntil || null, quote_ref: quoteRef || null,
    lines: (lines || []).map((l) => ({
      rfq_line_id: l.rfq_line_id, unit_price: l.unit_price === '' || l.unit_price == null ? null : Number(l.unit_price),
      qty_offered: l.qty_offered === '' || l.qty_offered == null ? null : Number(l.qty_offered),
    })),
  }, key)
}

export function awardRfq({ rfqId, quoteId, reason }, key) {
  return rpc('inv_rfq_award', { rfq_id: rfqId, quote_id: quoteId, reason: reason || null }, key)
}

export function cancelRfq({ rfqId, reason }, key) {
  return rpc('inv_rfq_cancel', { rfq_id: rfqId, reason }, key)
}

// ── Backorders + emergency purchases ────────────────────────────────────────

export function listBackorders({ country, site, onlyOpen = true } = {}) {
  let q = supabase.from('v_po_backorders').select('*')
  q = withSite(applyCountry(q, country), site)
  if (onlyOpen) q = q.gt('qty_outstanding', 0)
  return read(q.order('expected_delivery', { ascending: true, nullsFirst: false }).order('po_line_id').limit(500), 'backorders')
}

export function listEmergencyPurchases({ country, site } = {}) {
  let q = supabase.from('purchase_orders')
    .select('id,po_number,supplier_name,vendor_name,country,site,status,currency,total_amount,order_date,created_by,' +
      'is_emergency,emergency_reason,emergency_declared_by,emergency_declared_at,emergency_approved_by,emergency_approved_at,' +
      'emergency_category,emergency_category_note,emergency_asset_no,emergency_job_card_no,emergency_work_order_id,' +
      'emergency_downtime_hours,emergency_impact,emergency_est_value,emergency_est_currency,emergency_attachment_path,' +
      'emergency_requested_by_name')
    .eq('is_emergency', true)
  q = withSite(applyCountry(q, country), site)
  return read(q.order('emergency_declared_at', { ascending: false }).order('id').limit(200), 'emergency purchases')
}

// `overrunReason` is required by the database when the PO lines exceed the
// emergency estimate by more than 10% (or are unpriced / mixed currency).
export function approveEmergencyPurchase(poId, key, overrunReason) {
  const reason = String(overrunReason ?? '').trim()
  return rpc('inv_po_emergency_approve', reason ? { po_id: poId, overrun_reason: reason } : { po_id: poId }, key)
}

// ── Purchase order approval limits (admin) ──────────────────────────────────
// Rows of inventory_approval_limits with entity_type 'purchase_order'. Writes
// go through inv_approval_limit_upsert, which refuses anyone but a super admin
// or Admin in the database. Removing a limit sets active = false.

export function listPurchaseApprovalLimits() {
  return read(supabase.from('inventory_approval_limits')
    .select('id,approver_role,country,site,currency,max_value,active,updated_at,created_at')
    .eq('entity_type', 'purchase_order')
    .order('approver_role').order('id').limit(500), 'purchase approval limits')
}

/** Roles the database accepts for a purchase order limit (inv_approver_roles). */
export async function listPurchaseApproverRoles() {
  const { data, error } = await supabase.rpc('inv_approver_roles', { p_entity_type: 'purchase_order' })
  if (error) {
    if (isNotProvisioned(error)) return { status: 'not_provisioned', rows: [] }
    throw toServiceError(error, 'Could not load the approver roles.')
  }
  return { status: 'ok', rows: Array.isArray(data) ? data : [] }
}

/** payload from purchaseLimits.limitPayload(). */
export function savePurchaseApprovalLimit(payload, key) {
  if (!payload?.approver_role || !payload?.currency) {
    return Promise.reject(new ServiceError('Choose a role and a currency.', 'PROC_LIMIT_INCOMPLETE'))
  }
  return rpc('inv_approval_limit_upsert', { ...payload, entity_type: 'purchase_order' }, key)
}

// ── Supplier returns ────────────────────────────────────────────────────────

export function listReturnableReceipts({ country, site } = {}) {
  let q = supabase.from('goods_receipts')
    .select('id,grn_no,country,site,received_date,supplier,supplier_id,po_id,' +
      'lines:goods_receipt_lines(id,line_no,item_id,qty_received,qty_accepted,qty_rejected,rejection_code,rejection_reason,unit_cost,currency,' +
      'item:material_master(item_code,item_name))')
  q = withSite(applyCountry(q, country), site)
  return read(q.order('received_date', { ascending: false }).order('id').limit(100), 'goods receipts')
}

export function listSupplierReturns({ country, site } = {}) {
  let q = supabase.from('supplier_returns')
    .select('id,return_no,country,site,reason,created_at,grn_id,supplier:suppliers(supplier_name),' +
      'lines:supplier_return_lines(id,grn_line_id,source,qty,reason_code,movement_id)')
  q = withSite(applyCountry(q, country), site)
  return read(q.order('created_at', { ascending: false }).order('id').limit(200), 'supplier returns')
}

export function postSupplierReturn({ grnId, reason, lines }, key) {
  const clean = (lines || []).filter((l) => l.grn_line_id && Number(l.qty) > 0)
  if (!clean.length) return Promise.reject(new ServiceError('Enter a quantity to return on at least one line.', 'PROC_NO_LINES'))
  return rpc('inv_supplier_return', {
    grn_id: grnId, reason,
    lines: clean.map((l) => ({ grn_line_id: l.grn_line_id, source: l.source, qty: Number(l.qty), reason_code: l.reason_code || null })),
  }, key)
}

// ── Three-way match ─────────────────────────────────────────────────────────

export function listSupplierInvoices({ country } = {}) {
  let q = supabase.from('supplier_invoices')
    .select('id,invoice_no,invoice_date,currency,country,po_id,total_amount,match_status,match_details,status,price_tolerance_pct,' +
      'created_at,supplier:suppliers(supplier_name),po:purchase_orders(po_number)')
  q = applyCountry(q, country)
  return read(q.order('created_at', { ascending: false }).order('id').limit(200), 'supplier invoices')
}

export function createSupplierInvoice({ country, supplierId, invoiceNo, invoiceDate, currency, poId, tolerancePct, lines }, key) {
  return rpc('inv_supplier_invoice_create', {
    country, supplier_id: supplierId, invoice_no: invoiceNo, invoice_date: invoiceDate || null,
    currency: String(currency || '').toUpperCase(), po_id: poId || null,
    price_tolerance_pct: tolerancePct === '' || tolerancePct == null ? 0 : Number(tolerancePct),
    lines: (lines || []).filter((l) => Number(l.qty) > 0 && l.unit_price !== '' && l.unit_price != null).map((l) => ({
      po_line_id: l.po_line_id || null, item_id: l.item_id || null, qty: Number(l.qty), unit_price: Number(l.unit_price),
    })),
  }, key)
}

export function matchSupplierInvoice(invoiceId, key) {
  return rpc('inv_supplier_invoice_match', { invoice_id: invoiceId }, key)
}

/** Lines of a PO for invoicing (ordered / accepted / price), RLS scoped. */
export function listPoLinesForInvoice(poId) {
  if (!poId) return Promise.resolve({ status: 'ok', rows: [] })
  return read(supabase.from('v_po_backorders').select('po_line_id,line_no,item_id,item_code,item_name,qty_ordered,qty_accepted,unit_price,currency')
    .eq('po_id', poId).order('line_no').limit(500), 'PO lines')
}

export function listInvoiceablePurchaseOrders({ country } = {}) {
  let q = supabase.from('purchase_orders').select('id,po_number,supplier_id,supplier_name,currency,country,status')
    .in('status', ['Ordered', 'Partial Delivery', 'Delivered', 'Closed']).not('supplier_id', 'is', null)
  q = applyCountry(q, country)
  return read(q.order('order_date', { ascending: false }).order('id').limit(200), 'purchase orders')
}

// ── Supplier performance ────────────────────────────────────────────────────

export function listSupplierPerformance({ country } = {}) {
  let q = supabase.from('v_supplier_delivery_performance').select('*')
  q = applyCountry(q, country)
  return read(q.order('supplier_name').limit(500), 'supplier performance')
}
