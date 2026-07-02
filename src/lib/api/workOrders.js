/**
 * Work orders service — workshop jobs (work_orders). Explicit column lists
 * (no SELECT *); null-safe country scoping. Additive only — mirrors
 * assets.js / tyres.js.
 */
import { supabase, unwrap, applyCountry, ServiceError } from './_client'

const COLS =
  'id,work_order_no,asset_no,tyre_serial,tyre_position,status,priority,work_type,description,technician_name,workshop_name,site,country,opened_at,started_at,completed_at,target_completion,labour_hours,labour_rate,labour_cost,parts_cost,total_cost,created_at'

// Superset used by the Work Orders page detail drawer / job-card export, which
// also surfaces parts, notes, granular cost buckets, hour/meter fields and any
// preserved import payload. Kept separate from COLS so the least-privilege base
// select stays narrow for other consumers.
const PAGE_COLS =
  `${COLS},parts_used,notes,lubricant_cost,tyre_cost,outside_repair_cost,standard_hours,breakdown_hours,odometer,custom_data`

/**
 * List work orders, newest first. Country-scoped (null-safe) and optionally
 * filtered by status / priority / site.
 * @param {{country?:string, status?:string, priority?:string, site?:string, limit?:number}} [opts]
 */
export async function listWorkOrders({ country, status, priority, site, limit = 100 } = {}) {
  let q = supabase
    .from('work_orders')
    .select(COLS)
    .order('created_at', { ascending: false })
    .limit(limit)
  q = applyCountry(q, country)
  if (status) q = q.eq('status', status)
  if (priority) q = q.eq('priority', priority)
  if (site) q = q.eq('site', site)
  return unwrap(await q)
}

/** Get one work order by id (or null if not found). */
export async function getWorkOrder(id) {
  return unwrap(await supabase.from('work_orders').select(COLS).eq('id', id).maybeSingle())
}

/** Create a work order; returns the inserted row. */
export async function createWorkOrder(values) {
  return unwrap(await supabase.from('work_orders').insert(values).select(COLS).single())
}

/** Update a work order by id; returns the updated row. */
export async function updateWorkOrder(id, patch) {
  return unwrap(
    await supabase.from('work_orders').update(patch).eq('id', id).select(COLS).single(),
  )
}

/**
 * List work orders for the Work Orders page. Returns the full detail-drawer
 * column set (PAGE_COLS), ordered by opened_at (newest first), country-scoped
 * with a strict match ("All" = no filter). No row cap — the page filters,
 * sorts and paginates client-side.
 * @param {{country?:string}} [opts]
 */
export async function listWorkOrdersForPage({ country } = {}) {
  let q = supabase
    .from('work_orders')
    .select(PAGE_COLS)
    .order('opened_at', { ascending: false })
  if (country && country !== 'All') q = q.eq('country', country)
  return unwrap(await q)
}

/** Insert a work order (page mutation — no row returned). */
export async function insertWorkOrder(values) {
  return unwrap(await supabase.from('work_orders').insert(values))
}

/** Update a work order by id (page mutation — no row returned). */
export async function updateWorkOrderById(id, patch) {
  return unwrap(await supabase.from('work_orders').update(patch).eq('id', id))
}

/** Generate the next sequential work-order number via the DB RPC. */
export async function generateWorkOrderNo() {
  return unwrap(await supabase.rpc('generate_work_order_no'))
}

/**
 * Delete a work order. RLS restricts this to the Admin role
 * (work_orders_delete_admin); the count-verify surfaces a silent policy block
 * as a real error instead of a button that appears to do nothing.
 */
export async function deleteWorkOrder(id) {
  const { data, error } = await supabase.from('work_orders').delete().eq('id', id).select('id')
  if (error) throw new ServiceError(error.message, error.code, error)
  if ((data?.length ?? 0) === 0) {
    throw new ServiceError('The work order was not deleted — only an Admin can delete work orders.', '42501')
  }
}
