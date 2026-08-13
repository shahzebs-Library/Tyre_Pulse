/**
 * Assets service - fleet master data (vehicle_fleet). Explicit column lists
 * (no SELECT *) so new/sensitive columns are never exposed by accident.
 */
import { supabase, unwrap, applyCountry, ServiceError } from './_client'

const COLS =
  // ops_status is the OPERATIONAL state from the owner's monthly asset sheet
  // (running / breakdown / idle / planned scrap / being reallocated). It is a
  // different fact from `status`, which says whether the asset is on the
  // current fleet at all - a machine can be Active in the register and broken
  // down today, and collapsing the two would hide exactly that case.
  'id,asset_no,fleet_number,make,model,vehicle_type,registration_no,site,country,status,is_active,'
  + 'current_km,tyre_size,capacity,engine_no,ops_status,ops_status_note,ops_status_at,created_at'

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
 * Every fleet row that carries this asset number, plus the one row a caller
 * should show. Identity is (organisation_id, country, asset_no) - the SAME code
 * in two countries is normally a DIFFERENT machine (V376), and 239 codes are in
 * that state today, so this NEVER uses `.single()`/`.maybeSingle()`: demanding
 * one row from a query that legitimately matches several is what breaks the
 * asset page with "multiple (or no) rows returned".
 *
 * `country` (the caller's active country) picks the machine to show. With no
 * country, or on the All-countries view, the first row in a STABLE order wins
 * so the same code always resolves to the same machine.
 *
 * @returns {{row:object|null, rows:object[], countries:string[], ambiguous:boolean,
 *            missingInCountry:boolean}}
 *   `missingInCountry` = the code exists, but not in the requested country.
 */
export async function getAssetMatches(assetNo, country) {
  const key = String(assetNo ?? '').trim()
  if (!key) return { row: null, rows: [], countries: [], ambiguous: false, missingInCountry: false }
  const rows =
    unwrap(
      await supabase
        .from('vehicle_fleet')
        .select(COLS)
        .eq('asset_no', key)
        .order('country', { ascending: true })
        .order('id', { ascending: true })
        .limit(20),
    ) || []
  const scoped = country && country !== 'All' ? rows.filter((r) => r.country === country) : rows
  return {
    row: scoped[0] || null,
    rows,
    countries: [...new Set(rows.map((r) => r.country).filter(Boolean))],
    ambiguous: rows.length > 1,
    missingInCountry: rows.length > 0 && scoped.length === 0,
  }
}

/**
 * Get one asset by asset number (or null), scoped to `country` when given.
 * Returns null when the code exists only in another country - a machine from a
 * country the caller did not ask for must never be substituted silently.
 */
export async function getAssetByNo(assetNo, country) {
  const { row } = await getAssetMatches(assetNo, country)
  return row
}
