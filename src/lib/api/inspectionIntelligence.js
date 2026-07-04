/**
 * Inspection Intelligence page reads/writes - the exact selects/insert the
 * Inspection Intelligence screen consumes (inspection corpus + fleet roster for
 * compliance/coverage analytics, plus raising an overdue-inspection action).
 *
 * Read-only pass-throughs return the raw Supabase query builder (thenable) the
 * page reads via `.data` / `.error` through `Promise.all`. Country scoping here
 * is a STRICT `.eq('country', X)` (NOT null-safe) to preserve the page's prior
 * behaviour exactly. Additive only.
 */
import { supabase } from './_client'

/** Strict (non null-safe) country scope, matching the page's prior inline helper. */
function scopeCountry(query, country) {
  return country !== 'All' ? query.eq('country', country) : query
}

/** Full inspection corpus for the page's analytics, strict country scope. */
export function listInspectionIntelInspections({ country } = {}) {
  return scopeCountry(supabase.from('inspections').select('*'), country)
}

/** Fleet roster (asset/site/country) for coverage analytics, strict country scope. */
export function listInspectionIntelFleet({ country } = {}) {
  return scopeCountry(supabase.from('vehicle_fleet').select('asset_no, site, country'), country)
}

/**
 * Raise a corrective action for an overdue-inspection vehicle. Pass-through: the
 * page fires this inside a best-effort try/catch and ignores the result.
 */
export function insertCorrectiveAction(payload) {
  return supabase.from('corrective_actions').insert(payload)
}
