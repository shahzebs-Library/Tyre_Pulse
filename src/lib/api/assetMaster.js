/**
 * Asset Master service - one row per physical vehicle (asset_no) across ALL
 * countries. The same vehicle transfers between countries, so this collapses an
 * asset number to a single master and rolls up its activity; expense is kept
 * PER COUNTRY (each in its own currency) since a transferred vehicle earns
 * expenses in more than one currency. Read-only; org-scoped via the RPC (V356).
 *
 * @module api/assetMaster
 */
import { supabase, fetchAllRpcPages } from './_client'

/** Per-country currency for the by_country expense breakdown. */
export const COUNTRY_CURRENCY = { KSA: 'SAR', UAE: 'AED', Egypt: 'EGP' }

/**
 * One master row per asset_no with cross-country rollup. Never throws - returns
 * [] on a null payload or any RPC error so the panel degrades to an empty state.
 *
 * PAGED. `get_asset_master` is SET-RETURNING, and PostgREST caps an RPC response
 * at 1000 rows exactly as it caps a table read - so the browse list showed 1000
 * of the ~1,377 distinct asset codes and the count printed beside it read as a
 * total. The function's own `LIMIT p_limit` is the real ceiling, so p_limit is
 * set to the page ceiling and `.range()` walks it. Its ORDER BY ends on the
 * unique `asset_no`, so page boundaries are stable. The typed-search path is
 * unchanged: `p_search` is still applied SERVER-side and reaches any asset.
 *
 * @param {{ search?:string, limit?:number }} [opts] `limit` is the row ceiling.
 * @returns {Promise<Array<{ asset_no:string, countries:string, country_count:number,
 *   make:string, model:string, vehicle_type:string, tyres:number, work_orders:number,
 *   by_country:Array<{country:string,tyres:number,work_orders:number,tyre_expense:number}> }>>}
 */
export async function getAssetMaster({ search, limit = 20000 } = {}) {
  const p_search = search && search.trim() ? search.trim() : null
  try {
    const { data, error } = await fetchAllRpcPages(
      (from, to) => supabase
        .rpc('get_asset_master', { p_search, p_limit: limit })
        .range(from, to),
      (row) => (row && row.asset_no != null ? String(row.asset_no) : null),
      { max: limit },
    )
    if (error) return []
    return Array.isArray(data) ? data : []
  } catch {
    return []
  }
}
