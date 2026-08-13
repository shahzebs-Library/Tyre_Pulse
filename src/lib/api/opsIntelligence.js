/**
 * Ops Intelligence service — reads the two datasets the Exception Command Center
 * scans (tyre_records + work_orders), country-scoped (null-safe) and fully
 * paginated so large fleets are never silently truncated. The exception logic
 * itself lives in the pure, unit-tested `src/lib/opsIntelligence.js`; this module
 * only fetches least-privilege column sets.
 *
 * `work_orders` is optional infrastructure (some tenants have not applied the
 * migration): its read is guarded so a missing table degrades to an empty list
 * rather than failing the whole page.
 */
import { supabase, applyCountry, fetchAllPages, ServiceError } from './_client'

const TYRE_COLS =
  'id,serial_no,serial_number,tyre_serial,brand,size,asset_no,site,position,country,' +
  'tread_depth,pressure_reading,cost_per_tyre,total_km,km_at_fitment,km_at_removal,' +
  'fitment_date,issue_date,removal_date,reason_for_removal,removal_reason,status'

/**
 * Exactly what `buildExceptions` reads off a work order: it keeps the open,
 * high/critical ones and prints the number, asset, site and opened date.
 *
 * `scheduled_date`, `due_date` and `completed_date` were listed here and NONE OF
 * THEM IS A COLUMN ON work_orders (the real date columns are opened_at,
 * started_at, completed_at, target_completion - see the same warning on
 * AGGREGATE_COLS in api/workOrders.js). PostgREST fails the whole request on an
 * unknown column with "column ... does not exist", which `isMissingTable` then
 * reads as an unprovisioned table and swallows into [] - so this read has been
 * returning nothing at all, silently, rather than erroring.
 */
const WO_COLS = 'id,work_order_no,asset_no,site,status,priority,created_at,country'

// Ceiling and default window for the work_orders read. work_orders is the
// largest operational table (~88,773 rows) and this read was unbounded, so it
// paged the whole table - about 89 requests, each re-sorting the matched set -
// to surface a handful of open high-priority jobs. Twelve months is deliberately
// generous: an exception feed is about work that is open NOW, and an open job
// older than a year is a data-quality problem rather than an operational one.
export const OPS_WO_MAX = 20000
export const OPS_WO_WINDOW_DAYS = 365

// Least-privilege reads for the Pulse layer (added additively).
const INSPECTION_COLS = 'id,asset_no,tyre_serial,inspection_date,scheduled_date,completed_date,country'
const BUDGET_COLS = 'id,site,monthly_budget,year,month,country'

const isMissingTable = (error) => {
  const msg = (error?.message || '').toLowerCase()
  return error?.code === '42P01' || msg.includes('does not exist')
}

/** Every tyre record in scope (paginated, country-scoped). */
export async function listTyresForOps({ country } = {}) {
  const { data, error } = await fetchAllPages((from, to) => {
    const q = supabase
      .from('tyre_records')
      .select(TYRE_COLS)
      .order('id', { ascending: true })
      .range(from, to)
    return applyCountry(q, country)
  })
  if (error) throw new ServiceError(error.message, error.code, error)
  return data || []
}

/**
 * Work orders in scope, bounded BOTH ways: a server-side `created_at` window
 * (answered directly by the (organisation_id, country, created_at desc) index,
 * the same shape `listWorkOrdersPage` uses for opened_at) and a `max` row
 * ceiling. Guarded: if the `work_orders` table is absent (42P01 / "does not
 * exist"), resolves to [] so the page still renders tyre-derived exceptions.
 *
 * Returns the scope alongside the rows so a caller can SAY the view is bounded.
 * A cap the reader cannot see is the same silent-truncation bug one level up.
 *
 * @param {{country?:string, sinceDate?:string, max?:number}} [opts]
 * @returns {Promise<{rows:any[], truncated:boolean, sinceDate:string|null, max:number}>}
 */
export async function listWorkOrdersForOpsScoped({
  country,
  sinceDate = new Date(Date.now() - OPS_WO_WINDOW_DAYS * 86400000).toISOString(),
  max = OPS_WO_MAX,
} = {}) {
  const { data, error, truncated } = await fetchAllPages((from, to) => {
    let q = supabase
      .from('work_orders')
      .select(WO_COLS)
      .order('created_at', { ascending: false, nullsFirst: false })
      .order('id', { ascending: true })
      .range(from, to)
    if (sinceDate) q = q.gte('created_at', sinceDate)
    return applyCountry(q, country)
  }, { max })
  if (error) {
    if (isMissingTable(error)) return { rows: [], truncated: false, sinceDate, max }
    throw new ServiceError(error.message, error.code, error)
  }
  return { rows: data || [], truncated: !!truncated, sinceDate, max }
}

/** Rows-only wrapper, for callers that do not surface the scope. */
export async function listWorkOrdersForOps(opts = {}) {
  return (await listWorkOrdersForOpsScoped(opts)).rows
}

/**
 * Inspections in scope for the Pulse layer (asset-level recency). Guarded so a
 * missing `inspections` table degrades to [] rather than failing the page.
 */
export async function listInspectionsForOps({ country } = {}) {
  const { data, error } = await fetchAllPages((from, to) => {
    const q = supabase
      .from('inspections')
      .select(INSPECTION_COLS)
      .order('inspection_date', { ascending: false, nullsFirst: false })
      .order('id', { ascending: true })
      .range(from, to)
    return applyCountry(q, country)
  })
  if (error) {
    if (isMissingTable(error)) return []
    throw new ServiceError(error.message, error.code, error)
  }
  return data || []
}

/**
 * Budget rows for a given year (defaults to current). Guarded: absent `budgets`
 * table → [] so the Financial panel degrades to an honest empty state.
 */
export async function listBudgetsForOps({ country, year = new Date().getFullYear() } = {}) {
  const { data, error } = await fetchAllPages((from, to) => {
    const q = supabase
      .from('budgets')
      .select(BUDGET_COLS)
      .eq('year', year)
      .order('id', { ascending: true })
      .range(from, to)
    return applyCountry(q, country)
  })
  if (error) {
    if (isMissingTable(error)) return []
    throw new ServiceError(error.message, error.code, error)
  }
  return data || []
}

/**
 * Active-vehicle count (head-only, no rows transferred). Country-scoped where a
 * real country is active. Degrades to null on a missing table / error so the
 * Pulse renders "—" rather than a fabricated zero.
 */
export async function countActiveVehicles({ country } = {}) {
  let q = supabase
    .from('vehicle_fleet')
    .select('id', { count: 'exact', head: true })
    .eq('is_active', true)
  if (country && country !== 'All') q = q.or(`country.eq.${country},country.is.null`)
  const { count, error } = await q
  if (error) return null
  return count ?? null
}

/**
 * Convenience loader: fetch every dataset the page needs concurrently. Returns
 * the raw rows; the page feeds them to `buildExceptions` / `buildFleetPulse` /
 * `buildAnomalyFeed` / `buildFinancials` with a live clock. Absent optional
 * sources degrade to empty ([]/null), never to an error.
 * `scope` reports the bounds the work-order read actually applied, so the page
 * can state the window rather than presenting a bounded view as the whole fleet.
 * @returns {Promise<{ tyres, workOrders, inspections, budgets, activeVehicles, scope }>}
 */
export async function loadOpsData({ country } = {}) {
  const [tyres, wo, inspections, budgets, activeVehicles] = await Promise.all([
    listTyresForOps({ country }),
    listWorkOrdersForOpsScoped({ country }),
    listInspectionsForOps({ country }),
    listBudgetsForOps({ country }),
    countActiveVehicles({ country }),
  ])
  return {
    tyres,
    workOrders: wo.rows,
    inspections,
    budgets,
    activeVehicles,
    scope: {
      workOrdersSince: wo.sinceDate,
      workOrdersTruncated: wo.truncated,
      workOrdersMax: wo.max,
    },
  }
}
