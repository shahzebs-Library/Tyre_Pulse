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
import { supabase, unwrap, fetchAllPages, ServiceError } from './_client'
import { normaliseRecallCountry } from '../recallCountry'

// Least-privilege columns: every recall field the RecallTracker page reads
// (KPIs, filters, timeline, brand history, analytics, PDF/Excel export) or
// writes (create/update form). Omits organisation_id (RLS-managed).
const COLS =
  'id,recall_number,brand,affected_sizes,affected_serial_prefix,issue_date,severity,description,action_required,source,status,country,created_by,created_at,closed_at'

// Columns the page needs from tyre_records for recall matching, the batch
// detector, drawer and exports. Distinct from tyres.js (which selects serial_no
// and omits km_at_fitment/km_at_removal/serial_number), so kept local here.
const TYRE_COLS =
  'id, asset_no, serial_number:serial_no, brand, size, position, site, country, tread_depth, risk_level, issue_date, km_at_fitment, km_at_removal'

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

/**
 * recalls.country is one text value. A caller that passes the profile's country
 * ARRAY would store a JSON string that no country scope matches (the save is
 * then refused). Only a single clean country, or null, is ever sent.
 */
function withSingleCountry(values) {
  if (!values || !('country' in values)) return values
  return { ...values, country: normaliseRecallCountry(values.country) }
}

/** Create a recall; returns the inserted row. */
export async function createRecall(values) {
  values = withSingleCountry(values)
  return unwrap(await supabase.from('recalls').insert(values).select(COLS).single())
}

/**
 * Update a recall by id. Row level security turns a refused UPDATE into
 * "0 rows changed" with no error, which used to look like a successful save.
 * The changed ids are read back and an empty result is reported as refused.
 */
export async function updateRecall(id, patch) {
  patch = withSingleCountry(patch)
  const data = unwrap(await supabase.from('recalls').update(patch).eq('id', id).select('id'))
  if (Array.isArray(data) && data.length === 0) {
    throw new ServiceError('This recall could not be changed. It may have been removed, or it belongs to a country you cannot edit.', '42501')
  }
  return data
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
    supabase.from('tyre_records').select(TYRE_COLS).order('id', { ascending: true }).range(from, to),
  )
}
