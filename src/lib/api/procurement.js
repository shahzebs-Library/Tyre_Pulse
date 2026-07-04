/**
 * Procurement service - the reads/writes the Procurement (purchase orders)
 * screen consumes: the PO list, single-PO create/update/status changes, the
 * server-side PO number generator, and the shared procurement-budget setting.
 *
 * Pass-through style: each returns the raw Supabase query builder (thenable) or
 * RPC result the page reads via `.data` / `.error`, preserving the page's
 * destructuring, `.then(...)` and try/catch exactly. Country scoping on the PO
 * list is STRICT `.eq('country', ...)` matching the page (no NULL-inclusion) and
 * kept as-is to avoid behaviour change. The budget lives in the shared `settings`
 * table under a page-owned key that the page passes in.
 */
import { supabase } from './_client'

/** Read a single `settings` row's value by key (maybeSingle - may be absent). */
export function getSetting(key) {
  return supabase.from('settings').select('value').eq('key', key).maybeSingle()
}

/**
 * List purchase orders, newest order_date first, strictly country-scoped when a
 * real country is active.
 * @param {{country?:string}} [opts]
 */
export function listPurchaseOrders({ country } = {}) {
  let q = supabase.from('purchase_orders').select('*').order('order_date', { ascending: false })
  if (country && country !== 'All') q = q.eq('country', country)
  return q
}

/** Update a purchase order by id with the given patch. */
export function updatePurchaseOrder(id, patch) {
  return supabase.from('purchase_orders').update(patch).eq('id', id)
}

/** Generate the next PO number via the `generate_po_number` RPC. */
export function generatePoNumber() {
  return supabase.rpc('generate_po_number')
}

/** Insert a purchase order (whitelisted payload built by the page). */
export function insertPurchaseOrder(payload) {
  return supabase.from('purchase_orders').insert(payload)
}

/** Upsert a shared `settings` row (onConflict: key). Page passes key + value. */
export function upsertSetting(key, value) {
  return supabase.from('settings').upsert({ key, value }, { onConflict: 'key' })
}
