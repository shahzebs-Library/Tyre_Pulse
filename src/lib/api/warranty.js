/**
 * Warranty service - warranty_claims records. Explicit column lists (no
 * SELECT *); additive, mirrors correctiveActions.js / inspections.js. The
 * WarrantyTracker page is the single boundary onto this table as pages migrate
 * off inline supabase.from() calls.
 *
 * warranty_claims has no country column filter in the page's read path (it
 * loads the full set ordered newest-first), so - unlike country-scoped
 * services - list takes no country option and applies no country predicate.
 *
 * The page also reads tyre_records for warranty context (bulk fitment lookup +
 * a serial autofill lookup) with a column set that differs from the canonical
 * tyres.js service (serial_number / fitment_date / km_at_fitment vs serial_no).
 * Since no tyres.js function matches that shape and tyres.js is out of scope,
 * the two read helpers live here, colocated with their only consumer.
 */
import { supabase, unwrap, fetchAllPages } from './_client'

// Least-privilege column set covering the WarrantyTracker page (list + detail
// + add/edit form + exports). Omits organisation_id (RLS-managed).
const COLS =
  'id,claim_no,serial_number,brand,size,asset_no,site,country,fitment_date,removal_date,km_at_fitment,km_at_removal,km_run,expected_life_km,failure_type,supplier,notes,claim_status,credit_amount,credit_date,created_by,created_at,updated_at'

// Tyre-record columns the page reads for warranty context. Matches the table's
// warranty-facing shape (serial_number, fitment_date, km_*) - intentionally
// distinct from tyres.js COLS, which serves a different read surface.
const TYRE_CONTEXT_COLS =
  'id,serial_number,brand,size,asset_no,site,country,fitment_date,km_at_fitment,km_at_removal,supplier'

/**
 * List warranty claims, newest first. No country scoping - the page reads the
 * full claim set (RLS enforces tenant isolation).
 */
export async function listWarrantyClaims() {
  return unwrap(
    await supabase
      .from('warranty_claims')
      .select(COLS)
      .order('created_at', { ascending: false }),
  )
}

/** Get one warranty claim by id (or null if not found). */
export async function getWarrantyClaim(id) {
  return unwrap(await supabase.from('warranty_claims').select(COLS).eq('id', id).maybeSingle())
}

/** Create a warranty claim; returns the inserted row. */
export async function createWarrantyClaim(values) {
  return unwrap(await supabase.from('warranty_claims').insert(values).select(COLS).single())
}

/** Update a warranty claim by id. */
export async function updateWarrantyClaim(id, patch) {
  return unwrap(await supabase.from('warranty_claims').update(patch).eq('id', id))
}

/** Delete a warranty claim by id. */
export async function deleteWarrantyClaim(id) {
  return unwrap(await supabase.from('warranty_claims').delete().eq('id', id))
}

/**
 * List tyre records (warranty context columns), newest first, across all
 * pages. Read-only helper for the warranty fitment lookup.
 */
export async function listTyreContext() {
  const { data } = await fetchAllPages((from, to) =>
    supabase
      .from('tyre_records')
      .select(TYRE_CONTEXT_COLS)
      .order('created_at', { ascending: false })
      .range(from, to),
  )
  return data ?? []
}

/**
 * Fuzzy-lookup a single tyre record by serial number for warranty autofill.
 * Returns the first partial match (or null). Read-only.
 */
export async function findTyreForClaim(serial) {
  return unwrap(
    await supabase
      .from('tyre_records')
      .select(TYRE_CONTEXT_COLS)
      .ilike('serial_number', `%${serial}%`)
      .limit(1)
      .maybeSingle(),
  )
}
