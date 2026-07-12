/**
 * Goods Receipts service (V157) — records the receipt of goods against a
 * purchase order / supplier: GRN number, PO reference, supplier, item,
 * quantities ordered vs received, condition, receipt date, and a short status
 * lifecycle (pending → partial → received → rejected). RLS enforces org
 * isolation; any authenticated member may read and maintain records. This layer
 * keeps an explicit column list (least-privilege select) and null-safe country
 * scoping, mirroring batteries.js / support.js.
 *
 * When the table has not been migrated yet, listers degrade to [] so the page
 * can surface an "apply MIGRATIONS_V157_GOODS_RECEIPTS.sql" hint instead of
 * throwing.
 */
import { supabase, unwrap, applyCountry } from './_client'

const COLS =
  'id,organisation_id,country,grn_no,po_ref,supplier,item,qty_ordered,qty_received,' +
  'condition,received_date,site,status,notes,created_by,created_at,updated_at'

export const GOODS_RECEIPT_STATUS_VALUES = ['pending', 'partial', 'received', 'rejected']

/** True when a Supabase error means the table/relation is not deployed yet. */
function isMissingRelation(err) {
  const m = String(err?.message || '').toLowerCase()
  return (
    m.includes('does not exist') ||
    m.includes('relation') ||
    m.includes('schema cache') ||
    m.includes('could not find the table')
  )
}

/** Coerce a value to a finite number, or null. */
function num(value) {
  if (value === '' || value == null) return null
  const n = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(n) ? n : null
}

/**
 * List goods receipts (newest first by receipt date). Optional country / status
 * filters. Returns [] when the table is missing so the UI can prompt for the
 * migration rather than error.
 */
export async function listGoodsReceipts({ country, status, limit = 500 } = {}) {
  try {
    let q = supabase.from('goods_receipts').select(COLS)
    if (status) q = q.eq('status', status)
    q = applyCountry(q, country)
    return unwrap(
      await q
        .order('received_date', { ascending: false, nullsFirst: false })
        .order('created_at', { ascending: false })
        .limit(limit),
    ) || []
  } catch (err) {
    if (isMissingRelation(err)) return []
    throw err
  }
}

export async function getGoodsReceipt(id) {
  return unwrap(await supabase.from('goods_receipts').select(COLS).eq('id', id).maybeSingle())
}

/** Create a goods receipt. Requires at least an item or a supplier. */
export async function createGoodsReceipt(values = {}) {
  const item = String(values.item || '').trim()
  const supplier = String(values.supplier || '').trim()
  if (!item && !supplier) throw new Error('An item or a supplier is required.')
  const status = GOODS_RECEIPT_STATUS_VALUES.includes(values.status) ? values.status : 'received'
  const payload = {
    grn_no: values.grn_no ? String(values.grn_no).slice(0, 120) : null,
    po_ref: values.po_ref ? String(values.po_ref).slice(0, 120) : null,
    supplier: supplier ? supplier.slice(0, 200) : null,
    item: item ? item.slice(0, 200) : null,
    qty_ordered: num(values.qty_ordered),
    qty_received: num(values.qty_received),
    condition: values.condition ? String(values.condition).slice(0, 60) : null,
    received_date: values.received_date || null,
    site: values.site ? String(values.site).slice(0, 120) : null,
    status,
    notes: values.notes ? String(values.notes).slice(0, 4000) : null,
    country: values.country ?? null,
  }
  return unwrap(await supabase.from('goods_receipts').insert(payload).select(COLS).single())
}

/** Patch a goods receipt. Immutable columns are stripped before update. */
export async function updateGoodsReceipt(id, patch = {}) {
  const clean = { ...patch }
  delete clean.id
  delete clean.created_at
  delete clean.created_by
  delete clean.organisation_id
  delete clean.updated_at
  if (clean.status != null && !GOODS_RECEIPT_STATUS_VALUES.includes(clean.status)) delete clean.status
  if (clean.qty_ordered != null) clean.qty_ordered = num(clean.qty_ordered)
  if (clean.qty_received != null) clean.qty_received = num(clean.qty_received)
  if (clean.item != null) clean.item = String(clean.item).trim().slice(0, 200) || null
  if (clean.supplier != null) clean.supplier = String(clean.supplier).trim().slice(0, 200) || null
  if (clean.grn_no != null) clean.grn_no = String(clean.grn_no).trim().slice(0, 120) || null
  if (clean.po_ref != null) clean.po_ref = String(clean.po_ref).trim().slice(0, 120) || null
  return unwrap(await supabase.from('goods_receipts').update(clean).eq('id', id).select(COLS).single())
}

export async function deleteGoodsReceipt(id) {
  return unwrap(await supabase.from('goods_receipts').delete().eq('id', id))
}
