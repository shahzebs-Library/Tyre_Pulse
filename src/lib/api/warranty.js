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
import { supabase, unwrap, fetchAllPages, toServiceError } from './_client'
import { escapeLike } from '../searchFilter'

// Least-privilege column set covering the WarrantyTracker page (list + detail
// + add/edit form + exports). Omits organisation_id (RLS-managed).
const COLS =
  'id,claim_no,serial_number,brand,size,asset_no,site,country,fitment_date,removal_date,km_at_fitment,km_at_removal,km_run,expected_life_km,failure_type,supplier,notes,claim_status,credit_amount,credit_date,created_by,created_at,updated_at'

// Tyre-record columns the page reads for warranty context. Matches the table's
// warranty-facing shape (serial_number, fitment_date, km_*) - intentionally
// distinct from tyres.js COLS, which serves a different read surface.
//
// tyre_records.serial_number is a DEAD legacy column (empty on every row; the
// live serial is serial_no), so the serial is aliased: callers keep reading
// `serial_number` while PostgREST serves the real column. Reading the dead
// column is why serial autofill never found a tyre.
const TYRE_CONTEXT_COLS =
  'id,serial_number:serial_no,brand,size,asset_no,site,country,fitment_date,km_at_fitment,km_at_removal,supplier'

// Columns for warranty-candidate review (tyres removed with a stated reason).
const CANDIDATE_COLS =
  'id,serial_no,brand,size,asset_no,tyre_position,site,country,issue_date,fitment_date,removal_date,km_at_fitment,km_at_removal,total_km,removal_reason'

/** Upper bound on the candidate read; reported back as `truncated`. */
export const CANDIDATE_MAX_ROWS = 20000

/**
 * List warranty claims, newest first. No country scoping - the page reads the
 * full claim set (RLS enforces tenant isolation).
 */
export async function listWarrantyClaims() {
  return unwrap(
    await supabase
      .from('warranty_claims')
      .select(COLS)
      .order('created_at', { ascending: false })
      .order('id', { ascending: true }),
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
 * Tyres removed with a stated reason, for the warranty-candidate review. Paged
 * past the 1000-row server cap with an id tiebreak; country-scoped with the
 * null-safe convention ('All' = no predicate). Throws on a failed read so the
 * page can say so instead of showing an empty list.
 * Resolves { rows, truncated }.
 */
export async function listRemovedTyresForWarranty({ country = 'All' } = {}) {
  const { data, error, truncated } = await fetchAllPages((from, to) => {
    let q = supabase
      .from('tyre_records')
      .select(CANDIDATE_COLS)
      .not('removal_reason', 'is', null)
    if (country && country !== 'All') q = q.or(`country.eq.${country},country.is.null`)
    return q.order('id', { ascending: true }).range(from, to)
  }, { max: CANDIDATE_MAX_ROWS })
  if (error) throw toServiceError(error, 'Could not load removed tyres.')
  return { rows: data ?? [], truncated: !!truncated }
}

/**
 * Look up a single tyre record by serial number for warranty autofill.
 * Case-insensitive partial match on the live serial_no column. Read-only.
 */
export async function findTyreForClaim(serial) {
  return unwrap(
    await supabase
      .from('tyre_records')
      .select(TYRE_CONTEXT_COLS)
      .ilike('serial_no', `%${escapeLike(String(serial ?? '').trim())}%`)
      .order('id', { ascending: false })
      .limit(1)
      .maybeSingle(),
  )
}
