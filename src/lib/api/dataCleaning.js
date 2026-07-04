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
import { supabase } from './_client'

/** Apply strict country equality (only for a specific, non-"All" country). */
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

/** Distinct non-null sites among pending (uncleaned) records, strict country-scoped. */
export function listUncleanedSites({ country } = {}) {
  const q = supabase
    .from('tyre_records')
    .select('site')
    .not('site', 'is', null)
    .eq('cleaned', false)
  return scope(q, country)
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
    .select('id, description, remarks, site, asset_no, brand, issue_date', { count: 'exact' })
    .eq('cleaned', false)
    .order('created_at', { ascending: false })
    .range(from, to)
  q = scope(q, country)
  if (site) q = q.eq('site', site)
  return q
}

/** Already-cleaned records (newest first, capped). Not country-scoped (matches page). */
export function listCleanedRecords({ limit = 500 } = {}) {
  return supabase
    .from('tyre_records')
    .select('id, asset_no, brand, site, category, risk_level, remarks_cleaned, issue_date, description, remarks')
    .eq('cleaned', true)
    .order('created_at', { ascending: false })
    .limit(limit)
}

/**
 * One page of uncleaned records for the "Approve All" sweep (minimal columns),
 * optionally site-filtered. Not country-scoped (replicates the page exactly).
 * @param {{site?:string, from:number, to:number}} opts
 */
export function listPendingForApproveAll({ site, from, to } = {}) {
  let q = supabase
    .from('tyre_records')
    .select('id, description, remarks')
    .eq('cleaned', false)
    .range(from, to)
  if (site) q = q.eq('site', site)
  return q
}

// ── Quality Intelligence checks ───────────────────────────────────────────────

/** Serial-integrity source rows, strict country-scoped. */
export function listSerialRecords({ country } = {}) {
  return scope(
    supabase.from('tyre_records').select('id, tyre_serial, asset_no, site, issue_date'),
    country,
  )
}

/** Active (km_at_removal IS NULL) records for duplicate-serial detection, country-scoped. */
export function listActiveSerialRecords({ country } = {}) {
  return scope(
    supabase
      .from('tyre_records')
      .select('id, tyre_serial, asset_no, site, issue_date, km_at_removal')
      .is('km_at_removal', null),
    country,
  )
}

/** Records carrying a pressure_reading, for invalid-pressure detection, country-scoped. */
export function listPressureRecords({ country } = {}) {
  return scope(
    supabase
      .from('tyre_records')
      .select('id, tyre_serial, asset_no, site, pressure_reading, issue_date')
      .not('pressure_reading', 'is', null),
    country,
  )
}

/** Records with tread_depth column, for missing-tread detection, country-scoped. */
export function listTreadRecords({ country } = {}) {
  return scope(
    supabase.from('tyre_records').select('id, tyre_serial, asset_no, site, tread_depth, issue_date'),
    country,
  )
}

/** Distinct non-null asset numbers, for missing-inspection detection, country-scoped. */
export function listAssetNumbers({ country } = {}) {
  return scope(
    supabase.from('tyre_records').select('asset_no').not('asset_no', 'is', null),
    country,
  )
}

/** Inspections on/after a cutoff date (asset + date only). Not country-scoped. */
export function listRecentInspections({ cutoff } = {}) {
  return supabase
    .from('inspections')
    .select('asset_no, inspection_date')
    .gte('inspection_date', cutoff)
}

/** Fitment/removal odometer rows (both present) for odometer-consistency checks, country-scoped. */
export function listOdometerRecords({ country } = {}) {
  return scope(
    supabase
      .from('tyre_records')
      .select('id, tyre_serial, asset_no, site, km_at_fitment, km_at_removal, issue_date')
      .not('km_at_removal', 'is', null)
      .not('km_at_fitment', 'is', null),
    country,
  )
}

/** Fitment/removal + cost rows for unrealistic-tyre-life checks, country-scoped. */
export function listLifeRecords({ country } = {}) {
  return scope(
    supabase
      .from('tyre_records')
      .select('id, tyre_serial, asset_no, site, km_at_fitment, km_at_removal, cost_per_tyre, issue_date')
      .not('km_at_removal', 'is', null)
      .not('km_at_fitment', 'is', null),
    country,
  )
}

// ── Bulk fixes / mutations ────────────────────────────────────────────────────

/** Set a record's tyre_serial (duplicate-serial fix). Returns raw `{ error }`. */
export function updateTyreSerial(id, tyreSerial) {
  return supabase.from('tyre_records').update({ tyre_serial: tyreSerial }).eq('id', id)
}

/** Patch a record's odometer values. Returns raw `{ error }`. */
export function updateTyreOdometer(id, updates) {
  return supabase.from('tyre_records').update(updates).eq('id', id)
}

/** Overwrite a record's remarks (e.g. prefixing "[NEEDS REVIEW]"). Returns raw `{ error }`. */
export function updateTyreRemarks(id, remarks) {
  return supabase.from('tyre_records').update({ remarks }).eq('id', id)
}

/** Upsert classified tyre records by id (approve / re-classify). */
export function upsertTyreRecords(rows) {
  return supabase.from('tyre_records').upsert(rows, { onConflict: 'id' })
}

/** Insert cleaning_log audit entries. */
export function insertCleaningLog(entries) {
  return supabase.from('cleaning_log').insert(entries)
}

/** Revert a record back to pending (clears classification). Returns raw `{ error }`. */
export function resetTyreClassification(id) {
  return supabase
    .from('tyre_records')
    .update({ category: null, risk_level: null, remarks_cleaned: null, cleaned: false })
    .eq('id', id)
}

/** Delete cleaning_log rows for one tyre record (undo). Returns raw `{ error }`. */
export function deleteCleaningLog(tyreRecordId) {
  return supabase.from('cleaning_log').delete().eq('tyre_record_id', tyreRecordId)
}
