/**
 * Procurement chain service: the writes and reads that join supplier ->
 * requisition -> purchase order -> goods receipt -> stock.
 *
 * Every write goes through a path the live database accepts (verified against
 * pg_policies / pg_proc on 2026-11-23):
 *   - suppliers           insert/update need inv_can('procure')
 *   - purchase_orders     insert/update need inv_can('procure')
 *   - purchase_order_lines  no direct write policy; ONLY the inv_po_add_line RPC
 *   - goods receipts into stock  ONLY the inv_receive_goods RPC (via
 *                         receiveGoods in ./inventory), which posts the ledger
 *                         movement. Stock is never written directly here.
 *   - requisitions        approve / reject / ordered need inv_can('procure')
 *
 * Capabilities are asked of the SERVER (inv_can / app_can_admin_delete) so a
 * button is only shown when the database would accept the action.
 */
import { supabase, unwrap, applyCountry, toServiceError, isNotProvisioned, ServiceError } from './_client'
import { receiveGoods, newIdempotencyKey, searchItems } from './inventory'
import { sanitizeSearchTerm, escapeLike } from '../searchFilter'

export { newIdempotencyKey, searchItems }

async function rpcBool(fn, args) {
  const { data, error } = await supabase.rpc(fn, args)
  if (error) return false
  return data === true
}

/**
 * The signed-in person's procurement rights, as the database decides them.
 * Fails closed: an unreadable answer is "no".
 */
export async function getProcurementCaps() {
  const [procure, receive, adminDelete] = await Promise.all([
    rpcBool('inv_can', { p_cap: 'procure' }),
    rpcBool('inv_can', { p_cap: 'receive' }),
    rpcBool('app_can_admin_delete'),
  ])
  return { procure, receive, adminDelete }
}

// ── Suppliers (the supplier master; supplier_id on POs and GRNs) ─────────────

export const SUPPLIER_COLS =
  'id,supplier_name,supplier_code,supplier_type,contact_person,phone,email,site,region,country,status,notes,created_at,updated_at'

export const SUPPLIER_STATUSES = ['active', 'inactive']

/** Supplier master list, country-scoped (null-safe), bounded and ordered. */
export async function listSuppliers({ country, search, limit = 200 } = {}) {
  let q = supabase.from('suppliers').select(SUPPLIER_COLS)
  q = applyCountry(q, country)
  const s = sanitizeSearchTerm(search)
  if (s) {
    const like = `%${escapeLike(s)}%`
    q = q.or(`supplier_name.ilike.${like},supplier_code.ilike.${like},contact_person.ilike.${like}`)
  }
  const { data, error } = await q.order('supplier_name').order('id').limit(Math.min(Math.max(1, limit), 500))
  if (error) {
    if (isNotProvisioned(error)) return []
    throw toServiceError(error, 'Could not load suppliers.')
  }
  return data || []
}

function supplierPayload(values = {}) {
  const name = String(values.supplier_name || '').trim()
  if (!name) throw new ServiceError('A supplier name is required.', 'PROC_SUPPLIER_NAME')
  const clip = (v, n) => { const t = v == null ? '' : String(v).trim(); return t ? t.slice(0, n) : null }
  const email = clip(values.email, 200)
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new ServiceError('Enter a valid email address.', 'PROC_SUPPLIER_EMAIL')
  return {
    supplier_name: name.slice(0, 200),
    supplier_code: clip(values.supplier_code, 60),
    supplier_type: clip(values.supplier_type, 60),
    contact_person: clip(values.contact_person, 200),
    phone: clip(values.phone, 60),
    email,
    site: clip(values.site, 120),
    region: clip(values.region, 120),
    country: clip(values.country, 60),
    status: SUPPLIER_STATUSES.includes(values.status) ? values.status : 'active',
    notes: clip(values.notes, 4000),
  }
}

export async function createSupplier(values) {
  return unwrap(await supabase.from('suppliers').insert(supplierPayload(values)).select(SUPPLIER_COLS).single())
}

export async function updateSupplier(id, values) {
  return unwrap(await supabase.from('suppliers').update(supplierPayload(values)).eq('id', id).select(SUPPLIER_COLS).single())
}

// ── Purchase orders with real lines ──────────────────────────────────────────

const PO_HEADER_COLS = 'id,po_number,vendor_name,supplier_name,supplier_id,status,site,country,currency,order_date,total_amount'

/**
 * Insert a PO header and add its catalogued lines through inv_po_add_line
 * (the only writer of purchase_order_lines). Returns { po, lineIds, failedLines }.
 * A line failure does not hide the PO: the header exists and the screen says
 * which lines did not save.
 */
export async function createPurchaseOrderWithLines(header, lines = []) {
  let poNumber = header.po_number
  if (!poNumber) {
    const { data, error } = await supabase.rpc('generate_po_number')
    if (error) throw toServiceError(error, 'Could not get a PO number.')
    poNumber = data
  }
  const po = unwrap(await supabase.from('purchase_orders')
    .insert({ ...header, po_number: poNumber }).select(PO_HEADER_COLS).single())
  const res = await addPurchaseOrderLines(po.id, lines)
  return { po, ...res }
}

/** Add lines to an existing Draft / Submitted PO, one RPC call per line. */
export async function addPurchaseOrderLines(poId, lines = []) {
  const lineIds = []
  const failedLines = []
  for (const [i, l] of (lines || []).entries()) {
    const { data, error } = await supabase.rpc('inv_po_add_line', {
      p_payload: {
        po_id: poId, idempotency_key: `po:${poId}:line:${i}:${l.item_id}`,
        item_id: l.item_id, description: l.description || null, qty_ordered: l.qty_ordered,
        unit_price: l.unit_price ?? null, currency: l.currency || null,
      },
    })
    if (error) failedLines.push({ index: i, message: toServiceError(error, 'Line not saved.').message })
    else lineIds.push(data)
  }
  return { lineIds, failedLines }
}

const PO_LINE_COLS =
  'id,po_id,line_no,item_id,description,location_id,qty_ordered,unit_price,currency,qty_received,qty_accepted,qty_rejected,status,' +
  'item:material_master(item_code,item_name,base_uom)'

/** Lines of one PO, flattened with the Material Master code and name. */
export async function listPurchaseOrderLines(poId) {
  if (!poId) return []
  const { data, error } = await supabase.from('purchase_order_lines').select(PO_LINE_COLS)
    .eq('po_id', poId).order('line_no').limit(500)
  if (error) {
    if (isNotProvisioned(error)) return []
    throw toServiceError(error, 'Could not load the PO lines.')
  }
  return (data || []).map(({ item, ...r }) => ({
    ...r, item_code: item?.item_code || null, item_name: item?.item_name || null, uom: item?.base_uom || null,
  }))
}

/** POs goods can be received against (Approved / Ordered / Partial Delivery). */
export async function listReceivablePurchaseOrders({ country } = {}) {
  let q = supabase.from('purchase_orders').select(PO_HEADER_COLS)
    .in('status', ['Approved', 'Ordered', 'Partial Delivery'])
  q = applyCountry(q, country)
  const { data, error } = await q.order('order_date', { ascending: false }).order('id').limit(200)
  if (error) throw toServiceError(error, 'Could not load purchase orders.')
  return data || []
}

/**
 * Receive goods against a PO into stock. Delegates to receiveGoods (the
 * inv_receive_goods RPC), which writes the GRN, its lines, the ledger movement
 * and the PO line / PO status in one transaction.
 */
export function receiveAgainstPo({ po, site, grnNo, lines }, key) {
  return receiveGoods({
    country: po?.country || null, site, grnNo, poId: po?.id, supplierId: po?.supplier_id || null, lines,
  }, key)
}

/** Line totals for a page of GRNs (bounded: at most 500 ids per call). */
export async function listGrnLineTotals(grnIds = []) {
  const ids = [...new Set((grnIds || []).filter(Boolean))].slice(0, 500)
  if (!ids.length) return []
  const { data, error } = await supabase.from('goods_receipt_lines')
    .select('id,grn_id,qty_received,qty_accepted,qty_rejected,item:material_master(item_code,item_name)')
    .in('grn_id', ids).order('id').limit(999)
  if (error) {
    if (isNotProvisioned(error)) return []
    throw toServiceError(error, 'Could not load receipt lines.')
  }
  return (data || []).map(({ item, ...r }) => ({ ...r, item_code: item?.item_code || null, item_name: item?.item_name || null }))
}

// ── Requisition decisions ────────────────────────────────────────────────────

/**
 * Approve or reject a submitted requisition (needs inv_can('procure')).
 * Once migration 20261124090000 is applied the database ignores approverName:
 * it stamps approved_by / approved_by_id from auth.uid() and refuses a decision
 * on the caller's own requisition (42501). Before it, the name is what is stored.
 */
export async function decideRequisition(id, decision, { approverName } = {}) {
  if (!['approved', 'rejected'].includes(decision)) throw new ServiceError('Unknown decision.', 'PROC_BAD_DECISION')
  const row = unwrap(await supabase.from('requisitions')
    .update({ status: decision, approved_by: approverName ? String(approverName).slice(0, 200) : null })
    .eq('id', id).eq('status', 'submitted')
    .select('id,status,approved_by,decided_at').maybeSingle())
  // RLS refuses an update silently (0 rows): say so instead of doing nothing.
  if (!row) throw new ServiceError(NO_ROW_DECISION, 'PROC_DECISION_REFUSED')
  return row
}

export const NO_ROW_DECISION =
  'You do not have permission to decide this requisition, or it is no longer waiting for a decision.'

/** Mark an approved requisition as ordered and link it to its PO number. */
export async function linkRequisitionToPo(id, poNumber) {
  const row = unwrap(await supabase.from('requisitions')
    .update({ status: 'ordered', po_ref: poNumber })
    .eq('id', id).eq('status', 'approved')
    .select('id,status,po_ref').maybeSingle())
  if (!row) throw new ServiceError('The requisition could not be linked: it is not approved, or you do not have permission.', 'PROC_LINK_REFUSED')
  return row
}
