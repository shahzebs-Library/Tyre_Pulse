/**
 * Asset Master service - one row per physical vehicle (asset_no) across ALL
 * countries. The same vehicle transfers between countries, so this collapses an
 * asset number to a single master and rolls up its activity; expense is kept
 * PER COUNTRY (each in its own currency) since a transferred vehicle earns
 * expenses in more than one currency. Read-only; org-scoped via the RPC (V356).
 *
 * @module api/assetMaster
 */
import { supabase } from './_client'

/** Per-country currency for the by_country expense breakdown. */
export const COUNTRY_CURRENCY = { KSA: 'SAR', UAE: 'AED', Egypt: 'EGP' }

/**
 * One master row per asset_no with cross-country rollup. Never throws - returns
 * [] on a null payload or any RPC error so the panel degrades to an empty state.
 * @param {{ search?:string, limit?:number }} [opts]
 * @returns {Promise<Array<{ asset_no:string, countries:string, country_count:number,
 *   make:string, model:string, vehicle_type:string, tyres:number, work_orders:number,
 *   by_country:Array<{country:string,tyres:number,work_orders:number,tyre_expense:number}> }>>}
 */
export async function getAssetMaster({ search, limit = 1000 } = {}) {
  try {
    const { data, error } = await supabase.rpc('get_asset_master', {
      p_search: search && search.trim() ? search.trim() : null,
      p_limit: limit,
    })
    if (error) return []
    return Array.isArray(data) ? data : []
  } catch {
    return []
  }
}
