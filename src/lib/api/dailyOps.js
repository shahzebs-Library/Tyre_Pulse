/**
 * DailyOps reads - the exact date-windowed selects the Daily Ops board consumes.
 * Read-only; each returns the raw Supabase / fetchAllPages result the page reads
 * via `.data` inside a Promise.allSettled (so a single failing source never
 * blanks the whole board).
 */
import { supabase, fetchAllPages, applyCountry } from './_client'

/**
 * Tyre records fitted within [thirtyDaysAgo, wEnd] (paged).
 * `.order('id')` is a stable unique-key tiebreak: a paged read without a unique
 * sort can drop or repeat rows at a page boundary. Country scope is applied by
 * the caller (rows carry a `country` column and are filtered in memory).
 */
export function listDailyTyreRecords({ thirtyDaysAgo, wEnd } = {}) {
  return fetchAllPages((from, to) => supabase.from('tyre_records')
    .select('id,asset_no,serial_number:serial_no,position,risk_level,tread_depth,issue_date,cost_per_tyre,site,country,brand,km_at_fitment,km_at_removal,created_at')
    .gte('issue_date', thirtyDaysAgo).lte('issue_date', wEnd).order('id').range(from, to), { max: 200000 })
}

/** Inspections within [thirtyDaysAgo, wEnd] (paged, stable id tiebreak). */
export function listDailyInspections({ thirtyDaysAgo, wEnd } = {}) {
  return fetchAllPages((from, to) => supabase.from('inspections')
    .select('id,asset_no,inspection_date,site,inspector,tyre_conditions,created_at')
    .gte('inspection_date', thirtyDaysAgo).lte('inspection_date', wEnd).order('id').range(from, to), { max: 200000 })
}

/**
 * Work orders opened within the window (paged, country-scoped, stable id tiebreak).
 *
 * work_orders is the largest table in the schema, so a single unpaged request
 * silently caps at PostgREST's 1000-row limit and UNDERCOUNTS the Daily Ops
 * work-order KPIs and lists in a busy 30-day window. This pages the read past
 * that cap and applies the country scope SERVER-SIDE via the app's null-safe
 * `applyCountry` convention (All = no predicate; a country = its own rows plus
 * any NULL-country rows, never silently dropped). `.order('id')` is the unique
 * tiebreak that keeps a paged read from dropping or repeating rows at a page
 * boundary. Resolves to `{ data, error, truncated }`.
 */
export function listDailyWorkOrders({ thirtyDaysAgo, wEnd, country } = {}) {
  return fetchAllPages((from, to) => applyCountry(
    supabase.from('work_orders')
      .select('id,asset_no,work_order_no,status,priority,created_at,scheduled_date:target_completion,site,country')
      .gte('created_at', thirtyDaysAgo + 'T00:00:00').lte('created_at', wEnd + 'T23:59:59'),
    country,
  ).order('id').range(from, to), { max: 20000 })
}

/**
 * Alerts raised within the window (paged, country-scoped, stable id tiebreak).
 *
 * Alerts are system-generated and can exceed 1000 in a busy 30-day window, so
 * this is paged too for the same reason as work orders. Country scope is applied
 * server-side; resolves to `{ data, error, truncated }`.
 */
export function listDailyAlerts({ thirtyDaysAgo, wEnd, country } = {}) {
  return fetchAllPages((from, to) => applyCountry(
    supabase.from('alerts')
      .select('id,asset_no,alert_type,severity,message,created_at,resolved,country')
      .gte('created_at', thirtyDaysAgo + 'T00:00:00').lte('created_at', wEnd + 'T23:59:59'),
    country,
  ).order('id').range(from, to), { max: 20000 })
}

/** Tyre fitments in [thirtyDaysAgo, date] for the day's fitment count (paged, stable id tiebreak). */
export function listDailyTyreFitments({ thirtyDaysAgo, date } = {}) {
  return fetchAllPages((from, to) => supabase.from('tyre_records')
    .select('asset_no,issue_date').gte('issue_date', thirtyDaysAgo).lte('issue_date', date).order('id').range(from, to), { max: 200000 })
}
