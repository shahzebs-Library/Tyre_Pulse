/**
 * Assets service - fleet master data (vehicle_fleet). Explicit column lists
 * (no SELECT *) so new/sensitive columns are never exposed by accident.
 */
import { supabase, unwrap, applyCountry, ServiceError, fetchAllPages, fetchAllRpcPages } from './_client'

const COLS =
  // ops_status is the OPERATIONAL state from the owner's monthly asset sheet
  // (running / breakdown / idle / planned scrap / being reallocated). It is a
  // different fact from `status`, which says whether the asset is on the
  // current fleet at all - a machine can be Active in the register and broken
  // down today, and collapsing the two would hide exactly that case.
  // chassis_no + serial_no are here for the checklist auto-fill, which reads
  // them through AUTO_FILL_SOURCES['asset.chassis_no']. They are populated on
  // 389 and 513 of 1,617 assets, so the field they feed stays CONDITIONALLY
  // locked - it fills and locks where the register really has a value and
  // stays typeable everywhere else, rather than locking blank.
  'id,asset_no,fleet_number,make,model,vehicle_type,registration_no,chassis_no,serial_no,site,country,status,is_active,'
  + 'current_km,tyre_size,capacity,engine_no,ops_status,ops_status_note,ops_status_at,created_at'

/**
 * List fleet assets, newest first. Country-scoped (null-safe) and optionally
 * filtered by site/status.
 *
 * PAGED, because a `.limit()` above 1,000 is a lie: PostgREST caps EVERY
 * response at its db-max-rows (1,000 here) whatever the limit says, and
 * `vehicle_fleet` now holds 1,617 rows (KSA 1,030 / UAE 452 / Egypt 135). The
 * old default of 100 was worse still - any caller that did not pass a limit saw
 * the newest hundred assets and nothing else. Only `.range()` paging gets past
 * the cap, and a truncated list is invisible in the UI: the user types a real
 * asset number, gets "no results", and concludes the asset is missing.
 *
 * `limit` is still honoured as a genuine ceiling for callers that only want a
 * few rows; `MAX_ASSET_ROWS` bounds the unbounded case so a future 50,000-asset
 * fleet cannot pull the whole table into a picker.
 *
 * @param {{country?:string, site?:string, status?:string, limit?:number}} [opts]
 */
export const MAX_ASSET_ROWS = 20000

export async function listAssets({ country, site, status, limit } = {}) {
  const ceiling = Number.isFinite(limit) && limit > 0 ? limit : MAX_ASSET_ROWS
  const { data, error } = await fetchAllPages((from, to) => {
    let q = supabase
      .from('vehicle_fleet')
      .select(COLS)
      // `created_at` is NOT unique, so ordering on it alone lets a row sit in
      // two pages or in neither at a page boundary. The id tiebreak is what
      // makes the paging safe.
      .order('created_at', { ascending: false })
      .order('id')
      .range(from, to)
    q = applyCountry(q, country)
    if (site) q = q.eq('site', site)
    if (status) q = q.eq('status', status)
    return q
  }, { max: ceiling })
  if (error) throw new ServiceError(error.message, error.code, error)
  return data
}

/**
 * Unique asset numbers derived from LIVE operational data (vehicle_fleet +
 * tyre_records + inspections) via the org-scoped RPC (V129). Used by the
 * checklist Asset picker so it always reflects real fleet data, not just the
 * fleet-master table. Returns a sorted string list; empty on any RPC error.
 */
export async function listDataAssetOptions(country) {
  // PAGED. This RPC is set-returning, so PostgREST applies the SAME 1,000-row
  // cap to it as to a table read. Measured live as a real KSA-only Manager it
  // returns 1,033 asset numbers, so the un-paged call was already dropping 33
  // of that one country's assets - silently, with no error and no visible
  // marker. On an all-countries view the tail is far longer.
  // fetchAllRpcPages, not fetchAllPages: an RPC that ignored the range would
  // otherwise return the same first 1,000 rows on every page and be asked
  // thousands of times. Paging by identity stops on the first page that adds
  // nothing new, and guarantees no duplicate reaches the picker.
  const { data, error } = await fetchAllRpcPages(
    (from, to) => supabase
      .rpc('reference_asset_options', {
        p_country: country && country !== 'All' ? country : null,
      })
      .range(from, to),
    (r) => (typeof r?.asset_no === 'string' && r.asset_no ? r.asset_no : null),
    { max: MAX_ASSET_ROWS },
  )
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

export async function listFleetRecords({ page, pageSize, search, site, status, country } = {}) {
  let q = supabase
    .from('vehicle_fleet')
    .select('*', { count: 'exact' })
    .order('asset_no', { ascending: true })

  if (page != null && pageSize != null) {
    q = q.range(page * pageSize, (page + 1) * pageSize - 1)
  }

  if (search) {
    const s = String(search).trim().replace(/[%_]/g, '\\$&')
    q = q.or(`asset_no.ilike.%${s}%,fleet_number.ilike.%${s}%,make.ilike.%${s}%,model.ilike.%${s}%`)
  }
  if (site) q = q.eq('site', site)
  if (status) q = q.eq('status', status)
  q = applyCountry(q, country)

  const { data, count, error } = await q
  if (error) throw new ServiceError(error.message, error.code, error)
  return { data: data ?? [], count: count ?? 0 }
}

export async function listSites({ country } = {}) {
  const { data, error } = await fetchAllPages((from, to) => {
    let q = supabase
      .from('vehicle_fleet')
      .select('site')
      .not('site', 'is', null)
      .order('id')
      .range(from, to)
    q = applyCountry(q, country)
    return q
  }, { max: MAX_ASSET_ROWS })
  if (error) throw new ServiceError(error.message, error.code, error)
  return [...new Set((data ?? []).map(r => r.site))].sort()
}

export async function getFleetSummary({ country, search, site } = {}) {
  const { data, truncated, error } = await fetchAllPages((from, to) => {
    let q = supabase
      .from('vehicle_fleet')
      .select('status,make,model,expected_km_per_tyre,min_days_between_changes')
      .order('asset_no')
      .order('id')
      .range(from, to)
    if (search) {
      const s = String(search).trim().replace(/[%_]/g, '\\$&')
      q = q.or(`asset_no.ilike.%${s}%,fleet_number.ilike.%${s}%,make.ilike.%${s}%,model.ilike.%${s}%`)
    }
    if (site) q = q.eq('site', site)
    q = applyCountry(q, country)
    return q
  }, { max: MAX_ASSET_ROWS })

  if (error) throw new ServiceError(error.message, error.code, error)
  const rows = data ?? []
  return {
    total:        rows.length,
    active:       rows.filter(r => r.status === 'Active').length,
    missingSpecs: rows.filter(r => !r.make || !r.model).length,
    noPolicy:     rows.filter(r => !r.expected_km_per_tyre && !r.min_days_between_changes).length,
    truncated:    Boolean(truncated),
  }
}

export async function saveFleetRecord(payload, id) {
  const q = id
    ? supabase.from('vehicle_fleet').update(payload).eq('id', id)
    : supabase.from('vehicle_fleet').insert(payload)
  const { error } = await q
  if (error) throw new ServiceError(error.message, error.code, error)
}

export async function deleteFleetRecord(id) {
  const { data, error } = await supabase
    .from('vehicle_fleet')
    .delete()
    .eq('id', id)
    .select('id')
  if (error) throw new ServiceError(error.message, error.code, error)
  if (!data || data.length === 0) {
    throw new Error('No permission or record not found.')
  }
  return data
}

export async function deleteFleetRecords(ids) {
  let deleted = 0
  for (let i = 0; i < ids.length; i += 100) {
    const chunk = ids.slice(i, i + 100)
    const { data, error } = await supabase
      .from('vehicle_fleet')
      .delete()
      .in('id', chunk)
      .select('id')
    if (error) throw new ServiceError(error.message, error.code, error)
    deleted += data?.length ?? 0
  }
  if (deleted === 0) {
    throw new Error('No permission or records not found.')
  }
  return deleted
}

export async function fetchAllFleetRecords({ search, site, status, country } = {}) {
  const { data, error } = await fetchAllPages((from, to) => {
    let q = supabase
      .from('vehicle_fleet')
      .select('*')
      .order('asset_no')
      .order('id')
      .range(from, to)
    if (search) {
      const s = String(search).trim().replace(/[%_]/g, '\\$&')
      q = q.or(`asset_no.ilike.%${s}%,fleet_number.ilike.%${s}%,make.ilike.%${s}%,model.ilike.%${s}%`)
    }
    if (site) q = q.eq('site', site)
    if (status) q = q.eq('status', status)
    q = applyCountry(q, country)
    return q
  }, { max: MAX_ASSET_ROWS })
  if (error) throw new ServiceError(error.message, error.code, error)
  return data ?? []
}
