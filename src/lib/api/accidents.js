/**
 * Accidents service — incident records (accidents). Explicit column lists
 * (no SELECT *); null-safe country scoping. Additive only — mirrors
 * assets.js / tyres.js.
 */
import { supabase, unwrap, applyCountry } from './_client'

const COLS =
  'id,asset_no,site,country,incident_date,severity,status,accident_type,claim_amount,claim_status,recovered_amount,recovery_status,repair_cost,estimated_damage_cost,driver_name,location,created_at'

/**
 * List accidents, newest first. Country-scoped (null-safe) and optionally
 * filtered by status / severity / site.
 * @param {{country?:string, status?:string, severity?:string, site?:string, limit?:number}} [opts]
 */
export async function listAccidents({ country, status, severity, site, limit = 100 } = {}) {
  let q = supabase
    .from('accidents')
    .select(COLS)
    .order('created_at', { ascending: false })
    .limit(limit)
  q = applyCountry(q, country)
  if (status) q = q.eq('status', status)
  if (severity) q = q.eq('severity', severity)
  if (site) q = q.eq('site', site)
  return unwrap(await q)
}

/** Get one accident by id (or null if not found). */
export async function getAccident(id) {
  return unwrap(await supabase.from('accidents').select(COLS).eq('id', id).maybeSingle())
}

/** Create an accident record; returns the inserted row. */
export async function createAccident(values) {
  return unwrap(await supabase.from('accidents').insert(values).select(COLS).single())
}

/** Update an accident record by id; returns the updated row. */
export async function updateAccident(id, patch) {
  return unwrap(
    await supabase.from('accidents').update(patch).eq('id', id).select(COLS).single(),
  )
}
