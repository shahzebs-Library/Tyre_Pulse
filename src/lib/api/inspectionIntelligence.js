/**
 * Inspection Intelligence page reads/writes - the exact selects/insert the
 * Inspection Intelligence screen consumes (inspection corpus + fleet roster for
 * compliance/coverage analytics, plus raising an overdue-inspection action).
 *
 * Read pass-throughs resolve to `{ data, error }` (plus `truncated`) the page
 * reads via `Promise.all`. Both source tables (inspections, vehicle_fleet) are
 * large and growing and feed compliance/coverage aggregates over the WHOLE
 * corpus, so a bare `.select()` (capped at 1000 rows) would silently undercount
 * at scale. Each is now paged with `fetchAllPages` and a stable `id` tiebreak.
 * Country scoping stays a STRICT `.eq('country', X)` (NOT null-safe) to preserve
 * the page's prior behaviour exactly. Additive only.
 */
import { supabase, fetchAllPages } from './_client'

/** Strict (non null-safe) country scope, matching the page's prior inline helper. */
function scopeCountry(query, country) {
  return country !== 'All' ? query.eq('country', country) : query
}

/**
 * Full inspection corpus for the page's analytics, strict country scope. Paged
 * past the PostgREST 1000-row cap so the compliance/coverage counts see every
 * inspection; resolves to { data, error, truncated }.
 */
export function listInspectionIntelInspections({ country } = {}) {
  return fetchAllPages(
    (from, to) =>
      scopeCountry(supabase.from('inspections').select('*'), country)
        .order('id')
        .range(from, to),
    { max: 50000 },
  )
}

/**
 * Fleet roster (asset/site/country) for coverage analytics, strict country
 * scope. Paged (the fleet exceeds 1000 rows) so coverage is computed over the
 * whole register; resolves to { data, error, truncated }.
 */
export function listInspectionIntelFleet({ country } = {}) {
  return fetchAllPages(
    (from, to) =>
      scopeCountry(supabase.from('vehicle_fleet').select('asset_no, site, country'), country)
        .order('id')
        .range(from, to),
    { max: 50000 },
  )
}

/**
 * Raise a corrective action for an overdue-inspection vehicle. Throws on a failed
 * insert so the caller's try/catch actually catches it (supabase-js resolves with
 * {error} rather than rejecting).
 */
export async function insertCorrectiveAction(payload) {
  const { error } = await supabase.from('corrective_actions').insert(payload)
  if (error) throw error
}
