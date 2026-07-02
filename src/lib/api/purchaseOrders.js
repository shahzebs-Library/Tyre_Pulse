/**
 * Purchase Orders service - purchase_orders records, plus the two read helpers
 * the Stock Replenishment page needs (replenishment stock levels + recent tyre
 * issues used for consumption/cost analytics). Explicit column lists (no
 * SELECT * except where the page relied on it), additive, mirrors the sibling
 * services (assets.js / correctiveActions.js).
 *
 * Scoping is replicated exactly from the page:
 *   - stock + tyre_records use NULL-inclusive country scoping (`.or(...)`).
 *   - createPurchaseOrder receives a whitelisted payload built by the caller.
 */
import { supabase, unwrap, fetchAllPages } from './_client'

// Least-privilege insert column set for the Stock Replenishment PO flow. Only
// the columns the page actually writes; omits organisation_id (RLS-managed),
// approvals, delivery tracking and audit columns filled server-side.
const PO_INSERT_COLS =
  'po_number,vendor_name,supplier_name,order_date,status,priority,items,subtotal,tax_amount,total_amount,site,country,requested_by,created_by,notes'

// Exact column set the page reads from tyre_records for consumption + cost.
const TYRE_COLS = 'site,brand,size,issue_date,cost_per_tyre,country'

/**
 * Create a purchase order; returns the inserted row.
 * Throws ServiceError on failure (caller wraps to surface the message).
 * @param {object} values  whitelisted purchase_orders payload
 */
export async function createPurchaseOrder(values) {
  return unwrap(
    await supabase.from('purchase_orders').insert(values).select(PO_INSERT_COLS).single()
  )
}

/**
 * Generate the next PO number via the `generate_po_number` RPC.
 * Throws ServiceError on failure (caller falls back to a client-side sequence).
 * @returns {Promise<string>} the generated PO number
 */
export async function generatePoNumber() {
  return unwrap(await supabase.rpc('generate_po_number'))
}

/**
 * List replenishment stock levels. Replicates the page's read exactly:
 * SELECT * from `stock`, NULL-inclusive country scoping, no ordering.
 * Throws ServiceError on failure.
 * @param {{country?:string}} [opts]
 */
export async function listReplenishmentStock({ country } = {}) {
  let q = supabase.from('stock').select('*')
  if (country && country !== 'All') q = q.or(`country.eq.${country},country.is.null`)
  return unwrap(await q)
}

/**
 * List recent tyre issues (last 90 days) for consumption + cost analytics.
 * Replicates the page's read exactly: the 6 whitelisted columns,
 * `issue_date >= sinceDate`, NULL-inclusive country scoping, fully paged via
 * fetchAllPages with the same 200k ceiling.
 * Throws ServiceError if any page errors.
 * @param {{country?:string, sinceDate:string}} opts
 * @returns {Promise<any[]>} all matching rows
 */
export async function listReplenishmentTyreRecords({ country, sinceDate } = {}) {
  const res = await fetchAllPages((from, to) => {
    let q = supabase.from('tyre_records').select(TYRE_COLS).gte('issue_date', sinceDate)
    if (country && country !== 'All') q = q.or(`country.eq.${country},country.is.null`)
    return q.range(from, to)
  }, { max: 200000 })
  return unwrap(res)
}
