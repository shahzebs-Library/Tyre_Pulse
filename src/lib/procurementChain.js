/**
 * Procurement chain rules (pure, no I/O):
 * supplier -> requisition -> approval -> purchase order -> goods receipt -> stock.
 *
 * Every rule here mirrors a server rule measured on the live database
 * (2026-11-23) so the screens never offer an action the database refuses:
 *
 *   requisitions_own_insert   a requester may only create draft / submitted rows
 *   requisitions_cap_update   the requester may edit only while draft; moving a
 *                             requisition to approved / rejected / ordered needs
 *                             the stock "procure" capability (inv_can('procure'))
 *   admin_only_delete_guard   deletes on requisitions / purchase_orders /
 *                             goods_receipts are Admin or super admin only
 *   purchase_orders_status_check  Draft, Submitted, Approved, Ordered,
 *                             Partial Delivery, Delivered, Cancelled, Closed
 *   _inv_po_add_line          lines only on a Draft or Submitted PO, qty > 0
 *   _inv_receive_goods        a PO line can never receive more than ordered,
 *                             the location must be at the GRN site, rejected qty
 *                             never enters stock
 *
 * Money is never added across currencies: SAR, AED and EGP stay separate.
 *
 * Validation messages are English unless the caller passes `t` (the
 * LanguageContext translator), see src/lib/wmsText.js.
 */
import { textFn } from './wmsText'

export const COUNTRY_CURRENCY = Object.freeze({ KSA: 'SAR', UAE: 'AED', Egypt: 'EGP' })

/** Currency a country reports in, or null when the country is unknown. */
export function currencyForCountry(country) {
  if (!country) return null
  const key = String(country).trim()
  if (COUNTRY_CURRENCY[key]) return COUNTRY_CURRENCY[key]
  const hit = Object.keys(COUNTRY_CURRENCY).find((k) => k.toLowerCase() === key.toLowerCase())
  return hit ? COUNTRY_CURRENCY[hit] : null
}

/** The country to stamp on a new record: the active country, never the "All" view. */
export function scopedCountry(activeCountry) {
  if (!activeCountry || activeCountry === 'All' || activeCountry === 'all') return null
  return activeCountry
}

/**
 * Which single currency a set of records is in. `mixed` is true when more than
 * one currency is present, so a total must not be shown as one number.
 * Records with no derivable currency are counted in `unknown`.
 * @param {Array<{currency?:string, country?:string}>} rows
 */
export function currencyScope(rows = []) {
  const set = new Set()
  let unknown = 0
  for (const r of rows || []) {
    const c = (r && r.currency) || currencyForCountry(r && r.country)
    if (c) set.add(String(c).toUpperCase())
    else unknown += 1
  }
  const currencies = [...set].sort()
  return { currencies, mixed: currencies.length > 1, currency: currencies.length === 1 ? currencies[0] : null, unknown }
}

/** Sum a money field per currency. Blank values are skipped, never read as 0. */
export function sumByCurrency(rows = [], field, { currencyOf } = {}) {
  const out = {}
  for (const r of rows || []) {
    const v = r?.[field]
    if (v === null || v === undefined || v === '') continue
    const n = Number(v)
    if (!Number.isFinite(n)) continue
    const c = (currencyOf ? currencyOf(r) : (r.currency || currencyForCountry(r.country))) || 'UNKNOWN'
    out[c] = Math.round(((out[c] || 0) + n) * 100) / 100
  }
  return out
}

// ── Requisitions ─────────────────────────────────────────────────────────────

export const REQUISITION_FLOW = Object.freeze(['draft', 'submitted', 'approved', 'rejected', 'ordered'])
const REQUESTER_STATUSES = ['draft', 'submitted']

/**
 * Statuses a person may choose in the requisition form.
 * - Procurement (inv_can('procure')) may set any status except "ordered",
 *   which is only reached by raising a purchase order.
 * - Everyone else may only keep a request as draft or submit it.
 * The current status always stays in the list so an existing row still shows it.
 */
export function requisitionStatusOptions({ canProcure = false, current = null } = {}) {
  const base = canProcure ? ['draft', 'submitted', 'approved', 'rejected'] : [...REQUESTER_STATUSES]
  if (current && !base.includes(current)) base.push(current)
  return REQUISITION_FLOW.filter((s) => base.includes(s))
}

/**
 * Whether the signed-in person may edit a requisition (mirrors
 * requisitions_cap_update: own draft, or the procure capability).
 */
export function canEditRequisition(row, { canProcure = false, userId = null } = {}) {
  if (!row) return true // a new requisition
  if (canProcure) return true
  return !!userId && row.created_by === userId && row.status === 'draft'
}

/**
 * Approve / reject is offered only to procurement, only on a submitted request,
 * and never to the person who raised it (WP4: the database refuses a
 * self-decision for everyone, super admins included).
 */
export function canDecideRequisition(row, { canProcure = false, userId = null } = {}) {
  if (!canProcure || row?.status !== 'submitted') return false
  return !(userId && row?.created_by && row.created_by === userId)
}

/**
 * The Material Master item a requisition already points at (requisitions.item_id,
 * WP4), shaped like a MaterialPicker value so Raise PO does not ask again.
 * The display text was saved as "CODE name" by the requisition form.
 * Returns null when the requisition has no item_id (or the column is absent).
 */
export function requisitionMaterial(req) {
  if (!req?.item_id) return null
  const text = String(req.item || '').trim()
  const cut = text.indexOf(' ')
  const code = cut > 0 ? text.slice(0, cut) : text
  const name = cut > 0 ? text.slice(cut + 1).trim() : ''
  return { id: req.item_id, item_code: code || null, item_name: name || text || null }
}

/** A purchase order can be raised from an approved requisition that has none yet. */
export function canRaisePo(row, { canProcure = false } = {}) {
  return !!canProcure && row?.status === 'approved' && !row?.po_ref
}

/**
 * Build the PO header + first line from an approved requisition, a chosen
 * supplier and a chosen material. Returns { header, line, errors }.
 * Nothing is invented: a blank unit price stays null (no cost known), it is
 * never written as 0.
 */
export function requisitionPoDraft(req, { supplier, material, unitPrice, country, today, t } = {}) {
  const tx = textFn(t)
  const errors = []
  if (!req) errors.push(tx('wmsmsgprocure.chain.draft.noRequisition'))
  if (!supplier?.supplier_name) errors.push(tx('wmsmsgprocure.chain.draft.chooseSupplier'))
  if (!material?.id) errors.push(tx('wmsmsgprocure.chain.draft.chooseItem'))
  const qty = Number(req?.quantity)
  if (!Number.isFinite(qty) || qty <= 0) errors.push(tx('wmsmsgprocure.chain.draft.needQty'))
  const price = unitPrice === '' || unitPrice === null || unitPrice === undefined ? null : Number(unitPrice)
  if (price !== null && (!Number.isFinite(price) || price < 0)) errors.push(tx('wmsmsgprocure.chain.draft.unitPrice'))
  const ctry = country || req?.country || null
  const currency = currencyForCountry(ctry)
  const lineTotal = price === null || !Number.isFinite(qty) ? null : Math.round(qty * price * 100) / 100
  const header = {
    vendor_name: supplier?.supplier_name || '',
    supplier_name: supplier?.supplier_name || null,
    supplier_id: supplier?.id || null,
    order_date: today || new Date().toISOString().slice(0, 10),
    status: 'Draft',
    priority: 'Normal',
    site: req?.site || null,
    country: ctry,
    currency,
    requested_by: req?.requester || null,
    notes: req?.requisition_no ? `From requisition ${req.requisition_no}` : 'From requisition',
    items: [{
      item_id: material?.id || null, item_code: material?.item_code || null,
      description: material?.item_name || req?.item || null,
      brand: material?.item_code || '', size: material?.item_name || req?.item || '',
      quantity: Number.isFinite(qty) ? qty : null, unit_price: price, received_qty: 0,
    }],
    subtotal: lineTotal ?? 0,
    tax_amount: 0,
    total_amount: lineTotal ?? 0,
  }
  const line = {
    item_id: material?.id || null,
    description: material?.item_name || req?.item || null,
    qty_ordered: Number.isFinite(qty) ? qty : null,
    unit_price: price,
    currency,
  }
  return { header, line, errors }
}

// ── Purchase orders ──────────────────────────────────────────────────────────

/** PO statuses goods may be received against. */
export const RECEIVABLE_PO_STATUSES = Object.freeze(['Approved', 'Ordered', 'Partial Delivery'])

/** PO statuses that still accept new lines (server rule in _inv_po_add_line). */
export const LINE_EDITABLE_PO_STATUSES = Object.freeze(['Draft', 'Submitted'])

/**
 * Status moves a person may make by hand from each PO status. Partial Delivery
 * and Delivered on a PO with lines come from goods receipts, never by hand.
 */
export const PO_NEXT_STATUSES = Object.freeze({
  Draft: ['Submitted', 'Cancelled'],
  Submitted: ['Approved', 'Cancelled'],
  Approved: ['Ordered', 'Cancelled'],
  Ordered: ['Partial Delivery', 'Delivered', 'Cancelled'],
  'Partial Delivery': ['Delivered', 'Cancelled'],
})

/**
 * Statuses to offer in a PO status picker: the current status plus the moves
 * allowed from it. A new PO starts as Draft or Submitted. An emergency PO may
 * be Ordered before approval. The creator never approves their own PO.
 */
export function poStatusOptions(current, { isNew = false, isEmergency = false, hasLines = false, ownPo = false } = {}) {
  if (isNew) return ['Draft', 'Submitted']
  const cur = current || 'Draft'
  let next = [...(PO_NEXT_STATUSES[cur] || [])]
  if (isEmergency && (cur === 'Draft' || cur === 'Submitted') && !next.includes('Ordered')) next.push('Ordered')
  if (hasLines) next = next.filter((s) => s !== 'Partial Delivery' && s !== 'Delivered')
  if (ownPo) next = next.filter((s) => s !== 'Approved')
  return [cur, ...next.filter((s) => s !== cur)]
}

/**
 * Turn PO form items into inv_po_add_line payloads. An item without a Material
 * Master id is reported, not silently dropped, because the GRN can only post
 * stock for a catalogued item.
 */
export function poLinePayloads(items = [], { currency } = {}) {
  const lines = []
  const uncatalogued = []
  ;(items || []).forEach((it, i) => {
    const qty = Number(it?.quantity)
    if (!Number.isFinite(qty) || qty <= 0) return
    if (!it?.item_id) { uncatalogued.push(i); return }
    const price = it.unit_price === '' || it.unit_price === null || it.unit_price === undefined ? null : Number(it.unit_price)
    lines.push({
      item_id: it.item_id,
      // The key minted when the line was added to the form (kept with the item),
      // so a retry replays this line instead of adding a second one.
      ...(it.line_key ? { idempotency_key: String(it.line_key) } : {}),
      description: it.description || [it.brand, it.size].filter(Boolean).join(' ') || null,
      qty_ordered: qty,
      unit_price: Number.isFinite(price) ? price : null,
      currency: currency || null,
    })
  })
  return { lines, uncatalogued }
}

/** Outstanding quantity on a PO line (ordered minus accepted), never below 0. */
export function outstandingQty(line) {
  // Number(null) is 0: a missing ordered quantity must read as unknown, not 0.
  if (line?.qty_ordered === null || line?.qty_ordered === undefined || line?.qty_ordered === '') return null
  const o = Number(line.qty_ordered)
  const a = Number(line?.qty_accepted ?? 0)
  if (!Number.isFinite(o)) return null
  return Math.max(0, Math.round((o - (Number.isFinite(a) ? a : 0)) * 1000) / 1000)
}

/**
 * Validate a receipt against a PO's lines before it is sent. Mirrors
 * _inv_receive_goods: accepted (received - rejected) must not exceed what is
 * outstanding, rejected cannot exceed received, each line needs a location.
 * Returns { lines (payloads for receiveGoods), errors }.
 */
export function receiptPlan(poLines = [], entries = {}, t) {
  const tx = textFn(t)
  const lines = []
  const errors = []
  for (const pl of poLines || []) {
    const e = entries[pl.id] || {}
    const rec = e.qty_received === '' || e.qty_received == null ? 0 : Number(e.qty_received)
    if (!rec) continue
    const rej = e.qty_rejected === '' || e.qty_rejected == null ? 0 : Number(e.qty_rejected)
    const label = pl.item_code || pl.description
      || (pl.line_no == null || pl.line_no === '' ? tx('wmsmsgprocure.chain.receipt.lineBare') : tx('wmsmsgprocure.chain.receipt.line', { no: pl.line_no }))
    if (!Number.isFinite(rec) || rec < 0) { errors.push(tx('wmsmsgprocure.chain.receipt.receivedQty', { label })); continue }
    if (!Number.isFinite(rej) || rej < 0) { errors.push(tx('wmsmsgprocure.chain.receipt.rejectedQty', { label })); continue }
    if (rej > rec) { errors.push(tx('wmsmsgprocure.chain.receipt.rejectedOverReceived', { label })); continue }
    // The database refuses a rejected quantity with no reason (20261124130000); say so before posting.
    if (rej > 0 && !String(e.rejection_reason || '').trim()) { errors.push(tx('wmsmsgprocure.chain.receipt.rejectedReason', { label })); continue }
    const out = outstandingQty(pl)
    if (out !== null && rec - rej > out) { errors.push(tx('wmsmsgprocure.chain.receipt.overOutstanding', { label, qty: rec - rej, outstanding: out })); continue }
    if (!pl.item_id) { errors.push(tx('wmsmsgprocure.chain.receipt.noMaterial', { label })); continue }
    if (!e.location_id) { errors.push(tx('wmsmsgprocure.chain.receipt.chooseLocation', { label })); continue }
    lines.push({
      item_id: pl.item_id, po_line_id: pl.id, location_id: e.location_id,
      qty_received: rec, qty_rejected: rej, rejection_reason: rej > 0 ? (e.rejection_reason || null) : null,
      unit_cost: pl.unit_price ?? null, currency: pl.currency || null, condition: e.condition || 'new',
    })
  }
  if (!lines.length && !errors.length) errors.push(tx('wmsmsgprocure.chain.receipt.nothingEntered'))
  return { lines, errors }
}

/**
 * Fold goods_receipt_lines into per-GRN totals so a GRN posted through the
 * ledger (header item / qty left blank by inv_receive_goods) still reads on
 * the register. Returns Map(grn_id -> { lines, received, accepted, rejected, items }).
 */
export function summarizeGrnLines(lines = []) {
  const map = new Map()
  for (const l of lines || []) {
    if (!l?.grn_id) continue
    const s = map.get(l.grn_id) || { lines: 0, received: 0, accepted: 0, rejected: 0, items: [] }
    s.lines += 1
    s.received += Number(l.qty_received) || 0
    s.accepted += Number(l.qty_accepted) || 0
    s.rejected += Number(l.qty_rejected) || 0
    const code = l.item_code || l.item_name
    if (code && !s.items.includes(code)) s.items.push(code)
    map.set(l.grn_id, s)
  }
  return map
}

/** Apply line totals to GRN headers that carry none (ledger-posted receipts). */
export function withLineTotals(receipts = [], summary = new Map()) {
  return (receipts || []).map((r) => {
    const s = summary.get(r.id)
    if (!s) return r
    const items = s.items.length > 2 ? `${s.items.slice(0, 2).join(', ')} +${s.items.length - 2} more` : s.items.join(', ')
    return {
      ...r,
      item: r.item || items || null,
      qty_received: r.qty_received ?? s.received,
      qty_rejected: r.qty_rejected ?? s.rejected,
      line_count: s.lines,
      posted_to_stock: true,
    }
  })
}
