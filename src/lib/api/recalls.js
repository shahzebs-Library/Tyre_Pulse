/**
 * Recalls service - tyre recall / batch-quality records (recalls table). Single
 * boundary for that table as pages migrate off inline supabase.from() calls.
 * Explicit least-privilege column list (no SELECT *); consistent ServiceError
 * handling via unwrap. Mirrors correctiveActions.js / assets.js style.
 *
 * Scoping note: the RecallTracker page loads recalls with no country filter
 * (RLS handles tenant/country isolation server-side), so list/get here apply no
 * country predicate - behaviour-preserving. `country` is still written on
 * create/update via the caller-supplied row.
 */
import { supabase, unwrap, fetchAllPages } from './_client'

// Least-privilege columns: every recall field the RecallTracker page reads
// (KPIs, filters, timeline, brand history, analytics, PDF/Excel export) or
// writes (create/update form). Omits organisation_id (RLS-managed).
const COLS =
  'id,recall_number,brand,affected_sizes,affected_serial_prefix,issue_date,severity,description,action_required,source,status,country,created_by,created_at,closed_at'

// Columns the page needs from tyre_records for recall matching, the batch
// detector, drawer and exports. Distinct from tyres.js (which selects serial_no
// and omits km_at_fitment/km_at_removal/serial_number), so kept local here.
const TYRE_COLS =
  'id, asset_no, serial_number, brand, size, position, site, country, tread_depth, risk_level, issue_date, km_at_fitment, km_at_removal'

/**
 * List recalls, newest first. No country filter (matches the page's prior
 * `.select('*').order('created_at', desc)` behaviour; RLS scopes rows).
 */
export async function listRecalls() {
  return unwrap(
    await supabase.from('recalls').select(COLS).order('created_at', { ascending: false }),
  )
}

/** Get one recall by id (or null if not found). */
export async function getRecall(id) {
  return unwrap(await supabase.from('recalls').select(COLS).eq('id', id).maybeSingle())
}

/** Create a recall; returns the inserted row. */
export async function createRecall(values) {
  return unwrap(await supabase.from('recalls').insert(values).select(COLS).single())
}

/** Update a recall by id. */
export async function updateRecall(id, patch) {
  return unwrap(await supabase.from('recalls').update(patch).eq('id', id))
}

/** Delete a recall by id. */
export async function deleteRecall(id) {
  return unwrap(await supabase.from('recalls').delete().eq('id', id))
}

/**
 * Load all tyre records (paged) with the columns the recall matcher/detector
 * needs. Read-only helper local to recalls since the shape differs from the
 * shared tyres service. Returns `{ data, error }` from fetchAllPages unchanged
 * so the page keeps its existing non-throwing load semantics.
 */
export function listRecallTyres() {
  return fetchAllPages((from, to) =>
    supabase.from('tyre_records').select(TYRE_COLS).range(from, to),
  )
}
