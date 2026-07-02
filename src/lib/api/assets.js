/**
 * Assets service - fleet master data (vehicle_fleet). Explicit column lists
 * (no SELECT *) so new/sensitive columns are never exposed by accident.
 */
import { supabase, unwrap, applyCountry } from './_client'

const COLS =
  'id,asset_no,fleet_number,make,model,vehicle_type,site,country,status,is_active,current_km,tyre_size,created_at'

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

/** Get one asset by id (or null if not found). */
export async function getAsset(id) {
  return unwrap(await supabase.from('vehicle_fleet').select(COLS).eq('id', id).maybeSingle())
}

/** Get one asset by asset number (or null). */
export async function getAssetByNo(assetNo) {
  return unwrap(
    await supabase.from('vehicle_fleet').select(COLS).eq('asset_no', assetNo).maybeSingle(),
  )
}
