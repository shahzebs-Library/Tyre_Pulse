/**
 * Assets service - fleet master data (vehicle_fleet). Explicit column lists
 * (no SELECT *) so new/sensitive columns are never exposed by accident.
 */
import { supabase, unwrap, applyCountry, ServiceError } from './_client'

const COLS =
  'id,asset_no,fleet_number,make,model,vehicle_type,registration_no,site,country,status,is_active,current_km,tyre_size,created_at'

/**
 * List fleet assets, newest first. Country-scoped (null-safe) and optionally
 * filtered by site/status.
 * @param {{country?:string, site?:string, status?:string, limit?:number}} [opts]
 */
export async function listAssets({ country, site, status, limit = 100 } = {}) {
  let q = supabase
    .from('vehicle_fleet')
    .select(COLS)
    .order('created_at', { ascending: false })
    .limit(limit)
  q = applyCountry(q, country)
  if (site) q = q.eq('site', site)
  if (status) q = q.eq('status', status)
  return unwrap(await q)
}

/**
 * Unique asset numbers derived from LIVE operational data (vehicle_fleet +
 * tyre_records + inspections) via the org-scoped RPC (V129). Used by the
 * checklist Asset picker so it always reflects real fleet data, not just the
 * fleet-master table. Returns a sorted string list; empty on any RPC error.
 */
export async function listDataAssetOptions(country) {
  const { data, error } = await supabase.rpc('reference_asset_options', {
    p_country: country && country !== 'All' ? country : null,
  })
  if (error) throw new ServiceError(error.message, error.code, error)
  return (Array.isArray(data) ? data : []).map((r) => r?.asset_no).filter(Boolean)
}

/** Get one asset by id (or null if not found). */
export async function getAsset(id) {
  return unwrap(await supabase.from('vehicle_fleet').select(COLS).eq('id', id).maybeSingle())
}

/**
 * Get one asset by asset number (or null). The same asset number can now exist in
 * more than one country (per-country fleet, V348), so an optional `country` scopes
 * the lookup; `limit(1)` keeps it single-row-safe for a super-admin who can see
 * every country. RLS already scopes a country-restricted user to their own row.
 */
export async function getAssetByNo(assetNo, country) {
  let q = supabase.from('vehicle_fleet').select(COLS).eq('asset_no', assetNo)
  if (country && country !== 'All') q = q.eq('country', country)
  const rows = unwrap(await q.order('country', { ascending: true }).limit(1))
  return Array.isArray(rows) ? rows[0] || null : rows || null
}
