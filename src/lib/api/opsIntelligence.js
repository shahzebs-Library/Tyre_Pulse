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

const WO_COLS =
  'id,work_order_no,asset_no,site,status,priority,created_at,scheduled_date,due_date,completed_date,country'

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
 * Open/in-progress work orders in scope. Guarded: if the `work_orders` table is
 * absent (42P01 / "does not exist"), resolves to [] so the page still renders
 * tyre-derived exceptions.
 */
export async function listWorkOrdersForOps({ country } = {}) {
  const { data, error } = await fetchAllPages((from, to) => {
    const q = supabase
      .from('work_orders')
      .select(WO_COLS)
      .order('created_at', { ascending: false, nullsFirst: false })
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
 * @returns {Promise<{ tyres, workOrders, inspections, budgets, activeVehicles }>}
 */
export async function loadOpsData({ country } = {}) {
  const [tyres, workOrders, inspections, budgets, activeVehicles] = await Promise.all([
    listTyresForOps({ country }),
    listWorkOrdersForOps({ country }),
    listInspectionsForOps({ country }),
    listBudgetsForOps({ country }),
    countActiveVehicles({ country }),
  ])
  return { tyres, workOrders, inspections, budgets, activeVehicles }
}
