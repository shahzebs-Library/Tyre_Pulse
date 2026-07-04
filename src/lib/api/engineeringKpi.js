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

/** Corrective actions for KPI computation, strict country scope. */
export function listKpiCorrectiveActions({ country } = {}) {
  return scopeCountry(
    supabase.from('corrective_actions').select('id,status,site,country,due_date,created_at'),
    country,
  )
}

/** Fleet roster (id/asset_no) for fleet-size denominators. */
export function listKpiFleet() {
  return supabase.from('vehicle_fleet').select('id,asset_no')
}
