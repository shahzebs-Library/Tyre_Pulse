/**
 * Work orders service — workshop jobs (work_orders). Explicit column lists
 * (no SELECT *); null-safe country scoping. Additive only — mirrors
 * assets.js / tyres.js.
 */
import { supabase, unwrap, applyCountry } from './_client'

const COLS =
  'id,work_order_no,asset_no,tyre_serial,tyre_position,status,priority,work_type,description,technician_name,workshop_name,site,country,opened_at,started_at,completed_at,target_completion,labour_hours,labour_rate,labour_cost,parts_cost,total_cost,created_at'

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
