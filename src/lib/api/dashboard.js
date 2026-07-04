/**
 * Dashboard reads - the exact selects/RPCs the executive Dashboard consumes.
 *
 * Read-only pass-throughs: each returns the raw Supabase query builder
 * (thenable) or RPC result the page reads via `.data` / `.error`, preserving
 * the page's `Promise.all` + first-error handling exactly. Country scoping is
 * null-safe (`applyCountry`), matching the page's prior `../lib/countryFilter`
 * behaviour (same `country.eq.X,country.is.null` OR filter). Explicit column
 * lists (no SELECT *). Additive only - mirrors analyticsReads.js / dailyOps.js.
 */
import { supabase, applyCountry } from './_client'

/**
 * KPI/analytics tyre rows for the dashboard, country-scoped (null-safe) with an
 * optional issue_date window.
 * @param {{country?:string, from?:string, to?:string}} [opts]
 */
export function listDashboardTyres({ country, from, to } = {}) {
  let q = applyCountry(
    supabase
      .from('tyre_records')
      .select('id,cost_per_tyre,brand,issue_date,risk_level,site,category,asset_no'),
    country,
  )
  if (from) q = q.gte('issue_date', from)
  if (to) q = q.lte('issue_date', to)
  return q
}

/** Stock records (id only, exact count) for the Stock KPI, country-scoped. */
export function listDashboardStock({ country } = {}) {
  return applyCountry(
    supabase.from('stock_records').select('id', { count: 'exact' }),
    country,
  )
}

/** Corrective actions (id/status, exact count) for the Open-Actions KPI, country-scoped. */
export function listDashboardActions({ country } = {}) {
  return applyCountry(
    supabase.from('corrective_actions').select('id,status', { count: 'exact' }),
    country,
  )
}

/** Most recent tyre records (newest first) for the activity feed, country-scoped. */
export function listDashboardRecentTyres({ country, limit = 8 } = {}) {
  return applyCountry(
    supabase
      .from('tyre_records')
      .select('id,issue_date,brand,asset_no,site,risk_level')
      .order('created_at', { ascending: false })
      .limit(limit),
    country,
  )
}

/** Open corrective actions (newest first) for the dashboard panel, country-scoped. */
export function listDashboardOpenActions({ country, limit = 8 } = {}) {
  return applyCountry(
    supabase
      .from('corrective_actions')
      .select('id,title,priority,site,status')
      .eq('status', 'Open')
      .order('created_at', { ascending: false })
      .limit(limit),
    country,
  )
}

/**
 * report_tyre_summary RPC - full-fleet, server-side aggregates accurate beyond
 * the 1000-row page cap. Passes the active country straight through (may be
 * "All") to match the page exactly; empty date bounds coerce to null.
 * @param {{country?:string, from?:string, to?:string}} [opts]
 */
export function reportTyreSummary({ country, from, to } = {}) {
  return supabase.rpc('report_tyre_summary', {
    p_country: country,
    p_from: from || null,
    p_to: to || null,
  })
}

/** Open corrective actions for the PPTX export (brief columns, newest first). */
export function listOpenActionsForPptx({ limit = 20 } = {}) {
  return supabase
    .from('corrective_actions')
    .select('title,priority,site,status')
    .eq('status', 'Open')
    .order('created_at', { ascending: false })
    .limit(limit)
}

/** Open corrective actions for the daily executive PDF (incl. id/assignee). */
export function listOpenActionsForDaily({ limit = 20 } = {}) {
  return supabase
    .from('corrective_actions')
    .select('id,title,priority,site,status,assigned_to')
    .eq('status', 'Open')
    .order('created_at', { ascending: false })
    .limit(limit)
}

/** Recent inspections (newest scheduled first) for the daily executive PDF. */
export function listRecentInspectionsForDaily({ limit = 50 } = {}) {
  return supabase
    .from('inspections')
    .select('id,status,severity,scheduled_date,site,findings,inspector')
    .order('scheduled_date', { ascending: false })
    .limit(limit)
}

/** Critical-risk tyres (newest first) for the daily executive PDF, country-scoped. */
export function listCriticalTyresForDaily({ country, limit = 10 } = {}) {
  return applyCountry(supabase.from('tyre_records').select('asset_no,site'), country)
    .eq('risk_level', 'Critical')
    .order('created_at', { ascending: false })
    .limit(limit)
}
