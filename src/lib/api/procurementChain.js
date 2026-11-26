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

/** The payload one line sends to inv_po_add_line (the bulk call sends the same). */
function poLinePayload(poId, l, i) {
  return {
    po_id: poId, idempotency_key: l.idempotency_key || `po:${poId}:line:${i}:${l.item_id}`,
    item_id: l.item_id, description: l.description || null, qty_ordered: l.qty_ordered,
    unit_price: l.unit_price ?? null, currency: l.currency || null,
  }
}

/** Lines per bulk call (the server refuses more than 200). */
export const PO_LINES_PER_CALL = 100

// Set once the database answers that inv_po_add_lines is not installed, so
// later saves in this session go straight to the per-line path.
let bulkPoLinesMissing = false
/** Test hook: forget what was learned about the bulk RPC. */
export function _resetPoLinesBulkProbe() { bulkPoLinesMissing = false }

/**
 * Add lines to an existing Draft / Submitted PO.
 * Each pending line carries its own idempotency key, minted by the form when
 * the line was added (newIdempotencyKey()) and kept with the line, so every
 * retry or later edit of the same PO replays that line instead of adding it
 * twice. A key built from the line's index would replay an earlier line when a
 * later call adds a different line at the same index. Lines saved before keys
 * were kept with the line have none; they keep the old index-based key so a
 * re-edit of an old PO does not duplicate them.
 *
 * Speed: the lines go in ONE request through inv_po_add_lines (each line was a
 * full ~400 ms round trip from Saudi Arabia). That function passes every line's
 * payload to inv_po_add_line unchanged, in order, and reports each line's
 * outcome, so the keys, the saved lines and the failures are the same as one
 * call per line. When the bulk function is not installed yet (42883 /
 * PGRST202) this falls back to one call per line, in order, as before.
 */
export async function addPurchaseOrderLines(poId, lines = []) {
  const list = lines || []
  const lineIds = []
  const failedLines = []
  if (!list.length) return { lineIds, failedLines }
  const fail = (i, l, error) =>
    failedLines.push({ index: i, key: l.idempotency_key || null, message: toServiceError(error, 'Line not saved.').message })

  let start = 0
  while (!bulkPoLinesMissing && start < list.length) {
    const part = list.slice(start, start + PO_LINES_PER_CALL)
    const { data, error } = await supabase.rpc('inv_po_add_lines', {
      p_payload: { po_id: poId, lines: part.map((l, k) => poLinePayload(poId, l, start + k)) },
    })
    if (error && isNotProvisioned(error)) { bulkPoLinesMissing = true; break }
    const results = Array.isArray(data?.results) ? data.results : null
    // The call itself failed (network, refusal) or answered in a shape we do
    // not know: send this part and the rest one line at a time instead. Every
    // line carries its idempotency key, so a line the bulk call did save is
    // replayed, never added twice.
    if (error || !results) break
    part.forEach((l, k) => {
      const r = results.find((x) => x && x.index === k)
      if (r && r.ok) lineIds.push(r.result)
      else fail(start + k, l, r ? { code: r.code, message: r.message } : new Error('Line not saved.'))
    })
    start += part.length
  }

  // Per-line path (bulk function missing, or a bulk call that failed): one RPC
  // per line, in order, so the server still numbers the lines as entered.
  for (let i = start; i < list.length; i += 1) {
    const l = list[i]
    const { data, error } = await supabase.rpc('inv_po_add_line', { p_payload: poLinePayload(poId, l, i) })
    if (error) fail(i, l, error)
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
  if (!row) {
    // A retry after a lost response: the first call may already have linked it.
    const cur = unwrap(await supabase.from('requisitions').select('id,status,po_ref').eq('id', id).maybeSingle())
    if (cur && cur.po_ref === poNumber) return cur
  }
  if (!row) throw new ServiceError('The requisition could not be linked: it is not approved, or you do not have permission.', 'PROC_LINK_REFUSED')
  return row
}

// ── Store keeper phone receipts (inv_store_receipt_*, migration 20261126180000) ─
//
// A store keeper records a delivery on the phone against one open PO line;
// nothing moves in stock until a DIFFERENT person holding "receive" approves.
// The server refuses a self-decision and posts through inv_receive_goods at
// the PO line price. Read through RLS (recorder, or receive holders in scope).

export const STORE_RECEIPT_COLS =
  'id,status,country,site,qty_received,qty_rejected,rejection_reason,delivery_note_no,delivery_note_path,notes,' +
  'submitted_by,submitted_at,decided_at,decision_note,grn_id,' +
  'purchase_orders(po_number,supplier_name,vendor_name),material_master(item_code,item_name,uom),inventory_locations(code,name)'

/** Pending phone receipts the caller may see. `[]` until the migration is applied. */
export async function listPendingStoreReceipts({ country } = {}) {
  let q = supabase.from('inv_store_receipt_requests').select(STORE_RECEIPT_COLS)
    .eq('status', 'pending').order('submitted_at', { ascending: true }).order('id').limit(200)
  q = applyCountry(q, country)
  const { data, error } = await q
  if (error) {
    if (isNotProvisioned(error)) return []
    throw toServiceError(error)
  }
  return data || []
}

/** Approve (posts the GRN) or reject (reason required) a phone receipt. */
export async function decideStoreReceipt(requestId, decision, note) {
  if (!requestId) throw new ServiceError('Choose a receipt.', 'SR_NO_ID')
  if (decision === 'reject' && !(note || '').trim()) {
    throw new ServiceError('Say why the receipt is rejected.', 'SR_NO_REASON')
  }
  const { data, error } = await supabase.rpc('inv_store_receipt_decide', {
    p_payload: { request_id: requestId, decision, note: (note || '').trim() || null },
  })
  if (error) throw toServiceError(error)
  return data
}
