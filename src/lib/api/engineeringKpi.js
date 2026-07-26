/**
 * Engineering KPI page reads - the exact selects the Engineering KPI screen
 * consumes to compute the full CPK / life / failure / compliance KPI set.
 *
 * Read-only pass-throughs return the raw Supabase query builder (thenable) the
 * page reads via `.data` / `.error` (records/inspections through `fetchAllPages`,
 * actions/fleet directly through `Promise.all`). Country scoping here is a
 * STRICT `.eq('country', X)` (NOT null-safe) to preserve the page's prior
 * behaviour exactly. Explicit column lists (no SELECT *). Additive only.
 */
import { supabase } from './_client'

/** Strict (non null-safe) country scope, matching the page's prior inline helper. */
function scopeCountry(query, country) {
  return country ? query.eq('country', country) : query
}

/**
 * Tyre records for KPI computation, strict country scope + optional issue_date
 * window, paged range (drives `fetchAllPages`).
 */
export function listKpiTyreRecords({ country, dateFrom, dateTo, from, to } = {}) {
  let q = supabase
    .from('tyre_records')
    .select('id,issue_date,asset_no,brand,site,country,cost_per_tyre,qty,risk_level,km_at_fitment,km_at_removal,position,category,remarks')
  if (dateFrom) q = q.gte('issue_date', dateFrom)
  if (dateTo) q = q.lte('issue_date', dateTo)
  q = scopeCountry(q, country)
  return q.range(from, to)
}

/** Inspections for KPI computation, strict country scope, paged range. */
export function listKpiInspections({ country, from, to } = {}) {
  return scopeCountry(
    supabase
      .from('inspections')
      .select('id,asset_no,site,country,status,scheduled_date,completed_date,findings,inspection_type'),
    country,
  ).range(from, to)
}

/**
 * Corrective actions for KPI computation, strict country scope.
 * `from`/`to` are optional: when supplied the query is ranged so callers can
 * drive it through `fetchAllPages` past the PostgREST 1000-row cap. Omitting
 * them preserves the original single-shot pass-through exactly.
 */
export function listKpiCorrectiveActions({ country, from, to } = {}) {
  const q = scopeCountry(
    supabase.from('corrective_actions').select('id,status,site,country,due_date,created_at'),
    country,
  )
  return Number.isFinite(from) && Number.isFinite(to) ? q.range(from, to) : q
}

/**
 * Fleet roster (id/asset_no) for fleet-size denominators.
 *
 * Takes `country` because this feeds a DENOMINATOR: on a country-scoped screen
 * every numerator (tyres, inspections, accidents) is filtered to that country,
 * so an unscoped fleet count mixes in other countries' vehicles and understates
 * every per-vehicle ratio and the Fleet Availability KPI.
 * `from`/`to` are optional and drive `fetchAllPages` - the fleet register is
 * over 1000 rows, so an un-ranged read silently truncated the count.
 */
export function listKpiFleet({ country, from, to } = {}) {
  const q = scopeCountry(supabase.from('vehicle_fleet').select('id,asset_no'), country)
  return Number.isFinite(from) && Number.isFinite(to) ? q.range(from, to) : q
}
