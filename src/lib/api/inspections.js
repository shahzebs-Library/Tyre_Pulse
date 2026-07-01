/**
 * Inspections service — inspection records (inspections). Explicit column lists
 * (no SELECT *); null-safe country scoping. Additive only — mirrors
 * assets.js / tyres.js.
 */
import { supabase, unwrap, applyCountry } from './_client'

const COLS =
  'id,title,inspection_type,site,asset_no,tyre_serial,status,findings,severity,inspection_date,scheduled_date,completed_date,inspector,notes,country,created_by,created_at'

/**
 * List inspections, newest first. Country-scoped (null-safe) and optionally
 * filtered by status / severity / site / inspection type.
 * @param {{country?:string, status?:string, severity?:string, site?:string, type?:string, limit?:number}} [opts]
 */
export async function listInspections({ country, status, severity, site, type, limit = 100 } = {}) {
  let q = supabase
    .from('inspections')
    .select(COLS)
    .order('created_at', { ascending: false })
    .limit(limit)
  q = applyCountry(q, country)
  if (status) q = q.eq('status', status)
  if (severity) q = q.eq('severity', severity)
  if (site) q = q.eq('site', site)
  if (type) q = q.eq('inspection_type', type)
  return unwrap(await q)
}

/** Get one inspection by id (or null if not found). */
export async function getInspection(id) {
  return unwrap(await supabase.from('inspections').select(COLS).eq('id', id).maybeSingle())
}

/** Create an inspection; returns the inserted row. */
export async function createInspection(values) {
  return unwrap(await supabase.from('inspections').insert(values).select(COLS).single())
}

/** Update an inspection by id; returns the updated row. */
export async function updateInspection(id, patch) {
  return unwrap(
    await supabase.from('inspections').update(patch).eq('id', id).select(COLS).single(),
  )
}
