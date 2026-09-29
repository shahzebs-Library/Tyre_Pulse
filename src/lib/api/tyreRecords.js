/**
 * Tyre Records service - the reads/writes the Tyre Records screen consumes: the
 * paginated/filtered records grid, the distinct site/brand filter options, the
 * full-export read, single-record create/update, and the batched bulk
 * edit/scrap/delete operations.
 *
 * Pass-through style: each returns the raw Supabase query builder (thenable) the
 * page reads via `.data` / `.error` / `.count`, preserving the page's
 * destructuring, batching loops and error handling exactly. Country scoping uses
 * the shared NULL-inclusive `applyCountry` helper - identical to the page's prior
 * `../lib/countryFilter` behaviour. The page keeps ownership of pagination math
 * and the 200-row batch loops; these functions relocate only the queries.
 */
import { supabase, applyCountry, fetchAllPages, ServiceError } from './_client'
import { toUserMessage } from '../safeError'
import { sanitizeSearchTerm } from '../searchFilter'
import { createServiceEvent } from './tyreServiceEvents'

/**
 * Distinct `site` + `brand` filter options for the records grid, in ONE round
 * trip (this replaced two separate reads).
 *
 * These were previously two bare, unordered, unpaged selects of a single column
 * (one for site, one for brand) straight off the records table - deliberately
 * NOT reproduced literally here, because the row-cap guard scans source text and
 * a quoted example of the defect trips it as though it were the defect.
 * PostgREST caps every response at 1000 rows and tyre_records holds 11,193, so
 * the dropdown only ever offered the distinct values that happened to land in an
 * arbitrary unordered first 1000. Measured live: 16 of 23 sites and 51 of 104
 * brands - a real site with 92 records (MONORAIL SITE) could not be selected.
 *
 * The V585 RPC is SECURITY INVOKER, so RLS scopes the caller exactly as the old
 * reads did: a country-scoped user still sees only their own values, and the
 * optional country argument can only narrow WITHIN that, never widen it.
 *
 * Values are returned raw (untrimmed) and pre-sorted. Raw is deliberate - the
 * grid filters with an exact `.eq()`, so returning a trimmed option would fail
 * to match padded rows and silently drop them from the result.
 *
 * @param {string} [country] optional; NULL-inclusive, mirrors `applyCountry`.
 * @returns {Promise<{sites:string[], brands:string[]}>}
 */
export async function listFilterOptions(country) {
  const { data, error } = await supabase.rpc('get_tyre_filter_options', {
    p_country: country && country !== 'All' ? country : null,
  })
  if (error) throw new ServiceError(toUserMessage(error), error.code, error)
  return { sites: data?.sites ?? [], brands: data?.brands ?? [] }
}

/**
 * One page of tyre records (exact count) with search + site/brand/risk filters
 * and NULL-inclusive country scoping, newest issue_date first.
 * @param {{page:number, pageSize:number, search?:string, siteFilter?:string,
 *   brandFilter?:string, riskFilter?:string, country?:string}} opts
 */
export function listRecords({ page, pageSize, search, siteFilter, brandFilter, riskFilter, statusFilter, sizeFilter, positionFilter, country } = {}) {
  let q = supabase
    .from('tyre_records')
    .select('*', { count: 'exact' })
    .order('issue_date', { ascending: false })
    // issue_date is not unique (many tyres fitted on one day), so without a
    // tiebreak the same record can appear on two grid pages and another on none.
    .order('id', { ascending: true })
    .range(page * pageSize, (page + 1) * pageSize - 1)
  q = applyRecordFilters(q, { search, siteFilter, brandFilter, riskFilter, statusFilter, sizeFilter, positionFilter })
  return applyCountry(q, country)
}

/**
 * The grid's filters, in one place so the page, its export and its KPI counts
 * can never filter differently. Every option filter is an exact `.eq()` on the
 * raw stored value (options are served raw, so padded values still match).
 */
function applyRecordFilters(q, { search, siteFilter, brandFilter, riskFilter, statusFilter, sizeFilter, positionFilter } = {}) {
  if (search) { const s = sanitizeSearchTerm(search); q = q.or(`asset_no.ilike.%${s}%,serial_no.ilike.%${s}%,mis_number.ilike.%${s}%,job_card.ilike.%${s}%`) }
  if (siteFilter) q = q.eq('site', siteFilter)
  if (brandFilter) q = q.eq('brand', brandFilter)
  if (riskFilter) q = q.eq('risk_level', riskFilter)
  if (statusFilter) q = q.eq('status', statusFilter)
  if (sizeFilter) q = q.eq('size', sizeFilter)
  if (positionFilter) q = q.eq('position', positionFilter)
  return q
}

/**
 * All matching tyre records (no pagination) for the Excel/PDF export, same
 * filters + country scoping as the grid, newest issue_date first.
 * @param {{search?:string, siteFilter?:string, brandFilter?:string,
 *   riskFilter?:string, statusFilter?:string, sizeFilter?:string,
 *   positionFilter?:string, country?:string}} opts
 */
export function listAllRecords({ search, siteFilter, brandFilter, riskFilter, statusFilter, sizeFilter, positionFilter, country } = {}) {
  // Page through every match: a single PostgREST select caps at 1000 rows, which
  // silently truncated exports on fleets with >1000 records. Order by a stable
  // unique tiebreaker (id) so pages don't overlap/skip when issue_date is equal/null.
  return fetchAllPages((from, to) => {
    let q = supabase.from('tyre_records').select('*')
      .order('issue_date', { ascending: false }).order('id', { ascending: true })
    q = applyRecordFilters(q, { search, siteFilter, brandFilter, riskFilter, statusFilter, sizeFilter, positionFilter })
    return applyCountry(q, country).range(from, to)
  })
}

/**
 * Exact server count of tyre records under the grid's filters (head-only, no
 * rows). The KPI tiles read these, never the length of the page on screen.
 */
async function countRecords(filters = {}, country) {
  let q = supabase.from('tyre_records').select('id', { count: 'exact', head: true })
  q = applyRecordFilters(q, filters)
  const { count, error } = await applyCountry(q, country)
  if (error) throw new ServiceError(toUserMessage(error), error.code, error)
  return count ?? 0
}

/**
 * KPI counts for the Tyre Records tiles. The status dimension is held out
 * (the tiles ARE the status breakdown, and clicking one sets that filter), every
 * other filter applies. Four head-only counts in parallel.
 * @returns {Promise<{total:number, active:number, removed:number, scrapped:number}>}
 */
export async function getRecordStatusCounts(filters = {}, country) {
  const base = { ...filters, statusFilter: '' }
  const [total, active, removed, scrapped] = await Promise.all([
    countRecords(base, country),
    countRecords({ ...base, statusFilter: 'Active' }, country),
    countRecords({ ...base, statusFilter: 'Removed' }, country),
    countRecords({ ...base, statusFilter: 'Scrapped' }, country),
  ])
  return { total, active, removed, scrapped }
}

/**
 * Recorded tyre life (total_km > 0) under the grid's filters, one narrow column
 * paged past the 1000-row cap, for the Average life tile. Ceiling 20,000 rows;
 * `truncated` says when the average rests on a partial read.
 */
export async function listRecordedLifeKm(filters = {}, country) {
  const res = await fetchAllPages((from, to) => {
    let q = supabase.from('tyre_records').select('id,total_km').gt('total_km', 0)
      .order('id', { ascending: true })
    q = applyRecordFilters(q, filters)
    return applyCountry(q, country).range(from, to)
  }, { max: 20000 })
  if (res.error) throw new ServiceError(toUserMessage(res.error), res.error.code, res.error)
  return { values: (res.data || []).map((r) => r.total_km), truncated: !!res.truncated }
}

/**
 * Size and position values for the two filters the options RPC does not serve.
 * Read on demand (when "More filters" opens), paged, raw so the exact `.eq()`
 * filter still matches padded values.
 */
export async function listSizePositionOptions(country) {
  const res = await fetchAllPages((from, to) => applyCountry(
    supabase.from('tyre_records').select('id,size,position').order('id', { ascending: true }),
    country,
  ).range(from, to), { max: 20000 })
  if (res.error) throw new ServiceError(toUserMessage(res.error), res.error.code, res.error)
  return { rows: res.data || [], truncated: !!res.truncated }
}

/** Vehicle master rows for the assets on one grid page (bounded by the page). */
export async function listFleetForAssets(assetNos = []) {
  const list = [...new Set((assetNos || []).filter(Boolean).map((a) => String(a).trim()))].slice(0, 100)
  if (!list.length) return []
  const { data, error } = await supabase.from('vehicle_fleet')
    .select('id,asset_no,country,site,vehicle_type,make,model,current_km,registration_no,status')
    .in('asset_no', list).order('id', { ascending: true }).range(0, 999)
  if (error) throw new ServiceError(toUserMessage(error), error.code, error)
  return data || []
}

/** Latest inspection rows for the assets on one grid page. */
export async function listInspectionsForAssets(assetNos = [], country) {
  const list = [...new Set((assetNos || []).filter(Boolean).map((a) => String(a).trim()))].slice(0, 100)
  if (!list.length) return []
  const q = supabase.from('inspections')
    .select('id,asset_no,inspection_date,completed_date')
    .in('asset_no', list)
    .order('inspection_date', { ascending: false }).order('id', { ascending: true })
    .range(0, 999)
  const { data, error } = await applyCountry(q, country)
  if (error) throw new ServiceError(toUserMessage(error), error.code, error)
  return data || []
}

/** Odometer readings of one asset since a date, for the tyre's km trend. */
export async function listOdometerSince(assetNo, since, country) {
  const asset = String(assetNo || '').trim()
  if (!asset) return []
  let q = supabase.from('odometer_logs').select('id,odometer_km,reading_date')
    .eq('asset_no', asset)
    .order('reading_date', { ascending: true }).order('id', { ascending: true })
  if (since) q = q.gte('reading_date', since)
  const { data, error } = await applyCountry(q, country).range(0, 999)
  if (error) throw new ServiceError(toUserMessage(error), error.code, error)
  return data || []
}

/**
 * Tyre records for the Fleet-Actuals TCO engine: the cost + odometer + status
 * columns needed to derive per-asset actual TCO / cost-per-km, NULL-inclusive
 * country-scoped, paged (drives `fetchAllPages`). Explicit column list
 * (least-privilege). vehicle_type is joined page-side from `listTcoFleet()`
 * rather than via a PostgREST embed, so no FK relationship is assumed.
 * @param {{country?:string, from:number, to:number}} opts
 */
export function listTcoActualRecords({ country, from, to } = {}) {
  const q = supabase
    .from('tyre_records')
    .select('id,asset_no,brand,size,position,status,category,cost_per_tyre,qty,km_at_fitment,km_at_removal,total_km,fitment_date,removal_date,issue_date,site,country')
    .order('issue_date', { ascending: false })
    .order('id', { ascending: true })
    .range(from, to)
  return applyCountry(q, country)
}

/**
 * Fleet roster (asset_no -> vehicle_type + active state) for the TCO join / active-vehicle
 * count. Paged: a bare .select() caps at 1000 and the fleet is ~1523, which undercounts the
 * active-vehicle-derived TCO totals. Resolves to { data, error, truncated } (caller-compatible).
 */
export function listTcoFleet() {
  return fetchAllPages(
    (from, to) => supabase.from('vehicle_fleet')
      .select('asset_no,vehicle_type,make,model,status,is_active')
      .order('id', { ascending: true }).range(from, to),
    { max: 20000 },
  )
}

/** Update a single tyre record by id. */
export function updateRecord(id, payload) {
  return supabase.from('tyre_records').update(payload).eq('id', id)
}

/** Insert a single tyre record. */
export function insertRecord(payload) {
  return supabase.from('tyre_records').insert(payload)
}

const numOrNull = (v) => {
  if (v === '' || v == null) return null
  const n = typeof v === 'number' ? v : parseFloat(v)
  return Number.isFinite(n) ? n : null
}
const serialOf = (r) => (r?.serial_no || r?.serial_number || r?.tyre_serial || '').toString().trim() || null
const todayISO = () => new Date().toISOString().slice(0, 10)

/**
 * Move / swap a fitted tyre to another position (same vehicle) or another asset
 * (cross vehicle). Composes a single `updateRecord` on the tyre's own record:
 * same-vehicle = relocate position; cross-vehicle = re-point asset_no + position
 * and clear the removal fields so it reads as fitted at its new home. A rotation
 * service event is logged best-effort (a missing table never blocks the move).
 * @param {{tyre:object, toAssetNo?:string, toPosition:string, km?:number|string, date?:string}} args
 * @returns {Promise<{error:any}>}
 */
export async function moveTyre({ tyre, toAssetNo, toPosition, km, date } = {}) {
  if (!tyre?.id) return { error: new Error('A tyre record id is required.') }
  const targetAsset = (toAssetNo || '').toString().trim().toUpperCase()
  const crossVehicle = targetAsset && targetAsset !== String(tyre.asset_no || '').toUpperCase()
  const newPos = (toPosition || '').toString().trim()

  // Route through the transactional tyre_move RPC: it locks the source and the
  // destination slot, atomically SWAPS an active tyre already at the destination
  // instead of silently creating a duplicate fitment, is capability-gated, and
  // records an audit event. A bare position update cannot do this safely and is
  // rejected by the V349 active-fitment guard when the target slot is occupied.
  const { error } = await supabase.rpc('tyre_move', {
    p: {
      tyre_id: tyre.id,
      to_asset_no: crossVehicle ? targetAsset : null,
      to_position: newPos || null,
      km: numOrNull(km),
    },
  })
  if (error) return { error }

  try {
    await createServiceEvent({
      tyre_serial: serialOf(tyre),
      asset_no: (crossVehicle ? targetAsset : tyre.asset_no) || null,
      position: newPos || null,
      event_type: 'rotation',
      event_date: date || todayISO(),
      site: tyre.site || null,
      country: tyre.country || null,
      notes: crossVehicle
        ? `Moved from ${tyre.asset_no || 'asset'} ${tyre.position || ''} to ${targetAsset} ${newPos}`.trim()
        : `Swapped to position ${newPos}`.trim(),
    })
  } catch { /* service-event log is best-effort */ }

  return { error: null }
}

/**
 * Remove a fitted tyre: stamp removal date + odometer + reason and mark it
 * Removed, leaving a closed stint that the position history surfaces. Logs a
 * replacement service event best-effort.
 * @param {{tyre:object, reason?:string, km?:number|string, date?:string}} args
 * @returns {Promise<{error:any}>}
 */
export async function removeTyre({ tyre, reason, km, date } = {}) {
  if (!tyre?.id) return { error: new Error('A tyre record id is required.') }
  const payload = {
    status: 'Removed',
    removal_date: date || todayISO(),
    km_at_removal: numOrNull(km),
    removal_reason: (reason || '').toString().trim() || null,
  }
  const { error } = await updateRecord(tyre.id, payload)
  if (error) return { error }

  try {
    await createServiceEvent({
      tyre_serial: serialOf(tyre),
      asset_no: tyre.asset_no || null,
      position: tyre.position || tyre.tyre_position || null,
      event_type: 'replacement',
      event_date: payload.removal_date,
      site: tyre.site || null,
      country: tyre.country || null,
      notes: payload.removal_reason ? `Removed: ${payload.removal_reason}` : 'Removed',
    })
  } catch { /* service-event log is best-effort */ }

  return { error: null }
}

/** Update a batch of tyre records by id (page loops in 200-id chunks). */
export function updateRecordsByIds(ids, patch) {
  return supabase.from('tyre_records').update(patch).in('id', ids)
}

/**
 * Delete a batch of tyre records by id, returning the deleted ids so the page
 * can count-verify each batch (surfaces silent RLS failures).
 */
export function deleteRecordsByIds(ids) {
  return supabase.from('tyre_records').delete().in('id', ids).select('id')
}
