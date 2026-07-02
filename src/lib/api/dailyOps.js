/**
 * DailyOps reads — the exact date-windowed selects the Daily Ops board consumes.
 * Read-only; each returns the raw Supabase / fetchAllPages result the page reads
 * via `.data` inside a Promise.allSettled (so a single failing source never
 * blanks the whole board).
 */
import { supabase, fetchAllPages } from './_client'

/** Tyre records fitted within [thirtyDaysAgo, wEnd] (paged). */
export function listDailyTyreRecords({ thirtyDaysAgo, wEnd } = {}) {
  return fetchAllPages((from, to) => supabase.from('tyre_records')
    .select('id,asset_no,serial_number,position,risk_level,tread_depth,issue_date,cost_per_tyre,site,country,brand,km_at_fitment,km_at_removal,created_at')
    .gte('issue_date', thirtyDaysAgo).lte('issue_date', wEnd).range(from, to), { max: 200000 })
}

/** Inspections within [thirtyDaysAgo, wEnd] (paged). */
export function listDailyInspections({ thirtyDaysAgo, wEnd } = {}) {
  return fetchAllPages((from, to) => supabase.from('inspections')
    .select('id,asset_no,inspection_date,site,inspector,tyre_conditions,created_at')
    .gte('inspection_date', thirtyDaysAgo).lte('inspection_date', wEnd).range(from, to), { max: 200000 })
}

/** Work orders opened within the window. */
export function listDailyWorkOrders({ thirtyDaysAgo, wEnd } = {}) {
  return supabase.from('work_orders')
    .select('id,asset_no,work_order_no,status,priority,created_at,scheduled_date:target_completion,site')
    .gte('created_at', thirtyDaysAgo + 'T00:00:00').lte('created_at', wEnd + 'T23:59:59')
}

/** Alerts raised within the window. */
export function listDailyAlerts({ thirtyDaysAgo, wEnd } = {}) {
  return supabase.from('alerts')
    .select('id,asset_no,alert_type,severity,message,created_at,resolved')
    .gte('created_at', thirtyDaysAgo + 'T00:00:00').lte('created_at', wEnd + 'T23:59:59')
}

/** Tyre fitments in [thirtyDaysAgo, date] for the day's fitment count (paged). */
export function listDailyTyreFitments({ thirtyDaysAgo, date } = {}) {
  return fetchAllPages((from, to) => supabase.from('tyre_records')
    .select('asset_no,issue_date').gte('issue_date', thirtyDaysAgo).lte('issue_date', date).range(from, to), { max: 200000 })
}
