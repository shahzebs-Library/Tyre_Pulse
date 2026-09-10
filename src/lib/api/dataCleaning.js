/**
 * Data Cleaning Engine reads/writes - the exact queries the DataCleaning page
 * consumes (pending classification, cleaned records, Quality Intelligence
 * checks, bulk fixes).
 *
 * Country scoping here is STRICT (`.eq('country', X)` only when a specific
 * country is active) to replicate the page's prior behaviour exactly - NOT the
 * null-safe OR filter used elsewhere. Reads return the raw Supabase query
 * builder (the page reads `.data` / `.count` / `.error` directly); writes also
 * return the raw result (the page checks `.error`). Explicit column lists.
 * Additive only - mirrors dailyOps.js / analyticsReads.js pass-through style.
 */
import { supabase, fetchAllPages, unwrap } from './_client'

/** Apply strict country equality (only for a specific, non-"All" country). */
/**
 * Run a scan query across ALL its rows.
 *
 * These checks each read a bare select, which PostgREST caps at 1000. There are
 * 7,508 tyre records, so every quality check was inspecting the first 13% and
 * reporting how many problems it found there - a data-quality tool that makes the
 * data look cleaner than it is, which is the worst possible direction for it to
 * be wrong in.
 *
 * Returns the same `{ data, error }` shape the callers already destructure, so
 * this is a drop-in. `id` is the paging tiebreak: without a unique key a page
 * boundary inside equal sort values drops or repeats rows.
 */
function pageAll(build) {
  return fetchAllPages((from, to) => build().order('id').range(from, to))
}

function scope(q, country) {
  return country && country !== 'All' ? q.eq('country', country) : q
}

// ── Header stats + filters ────────────────────────────────────────────────────

/**
 * Head count of tyre_records, strict country-scoped. Pass `cleaned` to filter by
 * classification state; omit it for the whole-fleet total. Reads `.count`.
 * @param {{country?:string, cleaned?:boolean}} [opts]
 */
export function countTyreRecords({ country, cleaned } = {}) {
  let q = supabase.from('tyre_records').select('id', { count: 'exact', head: true })
  if (cleaned !== undefined) q = q.eq('cleaned', cleaned)
  return scope(q, country)
}

/**
 * Distinct non-null sites among pending (uncleaned) records, strict
 * country-scoped. PAGED through the same `pageAll` helper every other scan on
 * this page uses: an unbounded read returns at most 1000 of the 11,132 tyre
 * records, so the site filter simply omitted sites whose pending rows fell
 * outside that slice. Returns the same `{ data, error }` shape the caller
 * already destructures.
 */
export function listUncleanedSites({ country } = {}) {
  return pageAll(() => scope(
    supabase
      .from('tyre_records')
      .select('site')
      .not('site', 'is', null)
      .eq('cleaned', false),
    country,
  ))
}

// ── Pending / cleaned tabs ────────────────────────────────────────────────────

/**
 * One page of pending (uncleaned) records, newest first, strict country-scoped
 * and optionally site-filtered. Mirrors the page's range window exactly.
 * Requests an exact total `count` alongside the page so the pager can size
 * itself (the page reads `.count` into `totalPending`).
 * @param {{country?:string, site?:string, from:number, to:number}} opts
 */
export function listPendingRecords({ country, site, from, to } = {}) {
  let q = supabase
    .from('tyre_records')
    .select('id, description, remarks, site, asset_no, brand, issue_date, category, risk_level, remarks_cleaned, cleaned', { count: 'exact' })
    .eq('cleaned', false)
    .order('created_at', { ascending: false })
    .order('id')
    .range(from, to)
  q = scope(q, country)
  if (site) q = q.eq('site', site)
  return q
}

/** Already-cleaned records in the selected country and site (newest first, capped). */
export function listCleanedRecords({ country, site, limit = 500 } = {}) {
  let q = scope(supabase
    .from('tyre_records')
    .select('id, asset_no, brand, site, category, risk_level, remarks_cleaned, cleaned, issue_date, description, remarks')
    .eq('cleaned', true)
    .order('created_at', { ascending: false })
    .order('id')
    .limit(limit), country)
  if (site) q = q.eq('site', site)
  return q
}

/**
 * One page of uncleaned records for the "Approve All" sweep (minimal columns),
 * scoped to the selected country and site, with stable pagination.
 * @param {{country?:string, site?:string, from:number, to:number}} opts
 */
export function listPendingForApproveAll({ country, site, from, to } = {}) {
  let q = supabase
    .from('tyre_records')
    .select('id, description, remarks, category, risk_level, remarks_cleaned, cleaned')
    .eq('cleaned', false)
    .order('id')
    .range(from, to)
  q = scope(q, country)
  if (site) q = q.eq('site', site)
  return q
}

// ── Quality Intelligence checks ───────────────────────────────────────────────

/** Serial-integrity source rows, strict country-scoped. */
export function listSerialRecords({ country } = {}) {
  return pageAll(() => scope(
    supabase.from('tyre_records').select('id, tyre_serial, asset_no, site, issue_date'),
    country,
  ))
}

/** Active (km_at_removal IS NULL) records for duplicate-serial detection, country-scoped. */
export function listActiveSerialRecords({ country } = {}) {
  return pageAll(() => scope(
    supabase
      .from('tyre_records')
      .select('id, tyre_serial, asset_no, site, issue_date, km_at_removal')
      .is('km_at_removal', null),
    country,
  ))
}

/** Records carrying a pressure_reading, for invalid-pressure detection, country-scoped. */
export function listPressureRecords({ country } = {}) {
  return pageAll(() => scope(
    supabase
      .from('tyre_records')
      .select('id, tyre_serial, asset_no, site, pressure_reading, issue_date')
      .not('pressure_reading', 'is', null),
    country,
  ))
}

/** Records with tread_depth column, for missing-tread detection, country-scoped. */
export function listTreadRecords({ country } = {}) {
  return pageAll(() => scope(
    supabase.from('tyre_records').select('id, tyre_serial, asset_no, site, tread_depth, issue_date'),
    country,
  ))
}

/** Distinct non-null asset numbers, for missing-inspection detection, country-scoped. */
export function listAssetNumbers({ country } = {}) {
  return pageAll(() => scope(
    supabase.from('tyre_records').select('asset_no').not('asset_no', 'is', null),
    country,
  ))
}

/** Inspections on/after a cutoff date in the same selected country. */
export function listRecentInspections({ cutoff, country } = {}) {
  return pageAll(() => scope(supabase
    .from('inspections')
    .select('asset_no, inspection_date')
    .gte('inspection_date', cutoff), country))
}

/** Fitment/removal odometer rows (both present) for odometer-consistency checks, country-scoped. */
export function listOdometerRecords({ country } = {}) {
  return pageAll(() => scope(
    supabase
      .from('tyre_records')
      .select('id, tyre_serial, asset_no, site, km_at_fitment, km_at_removal, issue_date')
      .not('km_at_removal', 'is', null)
      .not('km_at_fitment', 'is', null),
    country,
  ))
}

/** Fitment/removal + cost rows for unrealistic-tyre-life checks, country-scoped. */
export function listLifeRecords({ country } = {}) {
  return pageAll(() => scope(
    supabase
      .from('tyre_records')
      .select('id, tyre_serial, asset_no, site, km_at_fitment, km_at_removal, cost_per_tyre, issue_date, remarks')
      .not('km_at_removal', 'is', null)
      .not('km_at_fitment', 'is', null),
    country,
  ))
}

// ── Bulk fixes / mutations ────────────────────────────────────────────────────

/** Apply a bounded correction transaction and require every requested ID back.
 * There is deliberately no direct-write fallback when the RPC is unavailable.
 */
export async function correctTyreRecords(changes, { country, site, action = 'classify' } = {}) {
  const requested = changes.map(change => change.id)
  if (!requested.length || requested.length > 200 || new Set(requested).size !== requested.length) {
    throw new Error('Select between 1 and 200 distinct records.')
  }
  const result = unwrap(await supabase.rpc('admin_clean_tyre_records', {
    p_changes: changes,
    p_country: country && country !== 'All' ? country : null,
    p_site: site || null,
    p_action: action,
  }))
  const ids = result?.ids
  if (!Array.isArray(ids) || ids.length !== requested.length || new Set(ids).size !== requested.length || ids.some(id => !requested.includes(id))) {
    throw new Error('Correction confirmation was incomplete. Refresh before retrying.')
  }
  return ids
}

/** Build an optimistic snapshot from exactly the fields the user reviewed. */
export function classificationChange(record, result, undo = false) {
  const patch = undo
    ? { category: null, risk_level: null, remarks_cleaned: null, cleaned: false }
    : { category: result.category, risk_level: result.risk_level, remarks_cleaned: result.remarks_cleaned ?? null, cleaned: true }
  const expected = Object.fromEntries(['category', 'risk_level', 'remarks_cleaned', 'cleaned', 'description', 'remarks'].map(key => [key, record[key] ?? null]))
  return { id: record.id, patch, expected }
}
