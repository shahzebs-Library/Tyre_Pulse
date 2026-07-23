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
import { supabase, applyCountry, fetchAllPages } from './_client'
import { sanitizeSearchTerm } from '../searchFilter'
import { createServiceEvent } from './tyreServiceEvents'

/** Distinct non-null `site` values (raw rows) for the site filter dropdown. */
export function listSiteOptions() {
  return supabase.from('tyre_records').select('site').not('site', 'is', null)
}

/** Distinct non-null `brand` values (raw rows) for the brand filter dropdown. */
export function listBrandOptions() {
  return supabase.from('tyre_records').select('brand').not('brand', 'is', null)
}

/**
 * One page of tyre records (exact count) with search + site/brand/risk filters
 * and NULL-inclusive country scoping, newest issue_date first.
 * @param {{page:number, pageSize:number, search?:string, siteFilter?:string,
 *   brandFilter?:string, riskFilter?:string, country?:string}} opts
 */
export function listRecords({ page, pageSize, search, siteFilter, brandFilter, riskFilter, country } = {}) {
  let q = supabase
    .from('tyre_records')
    .select('*', { count: 'exact' })
    .order('issue_date', { ascending: false })
    .range(page * pageSize, (page + 1) * pageSize - 1)
  if (search) { const s = sanitizeSearchTerm(search); q = q.or(`asset_no.ilike.%${s}%,serial_no.ilike.%${s}%,mis_number.ilike.%${s}%,job_card.ilike.%${s}%`) }
  if (siteFilter) q = q.eq('site', siteFilter)
  if (brandFilter) q = q.eq('brand', brandFilter)
  if (riskFilter) q = q.eq('risk_level', riskFilter)
  return applyCountry(q, country)
}

/**
 * All matching tyre records (no pagination) for the Excel/PDF export, same
 * filters + country scoping as the grid, newest issue_date first.
 * @param {{search?:string, siteFilter?:string, brandFilter?:string,
 *   riskFilter?:string, country?:string}} opts
 */
export function listAllRecords({ search, siteFilter, brandFilter, riskFilter, country } = {}) {
  // Page through every match: a single PostgREST select caps at 1000 rows, which
  // silently truncated exports on fleets with >1000 records. Order by a stable
  // unique tiebreaker (id) so pages don't overlap/skip when issue_date is equal/null.
  return fetchAllPages((from, to) => {
    let q = supabase.from('tyre_records').select('*')
      .order('issue_date', { ascending: false }).order('id', { ascending: true })
    if (search) { const s = sanitizeSearchTerm(search); q = q.or(`asset_no.ilike.%${s}%,serial_no.ilike.%${s}%,mis_number.ilike.%${s}%,job_card.ilike.%${s}%`) }
    if (siteFilter) q = q.eq('site', siteFilter)
    if (brandFilter) q = q.eq('brand', brandFilter)
    if (riskFilter) q = q.eq('risk_level', riskFilter)
    return applyCountry(q, country).range(from, to)
  })
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

/** Fleet roster (asset_no → vehicle_type + active state) for the TCO join / active-vehicle count. */
export function listTcoFleet() {
  return supabase.from('vehicle_fleet').select('asset_no,vehicle_type,make,model,status,is_active')
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
