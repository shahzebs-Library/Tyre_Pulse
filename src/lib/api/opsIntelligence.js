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
  'id,serial_no,serial_number,tyre_serial,brand,size,asset_no,site,country,' +
  'tread_depth,cost_per_tyre,total_km,fitment_date,issue_date,removal_date,' +
  'reason_for_removal,removal_reason,status'

const WO_COLS =
  'id,work_order_no,asset_no,site,status,priority,created_at,country'

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
 * Convenience loader: fetch both datasets concurrently for the page. Returns the
 * raw rows; the page feeds them to `buildExceptions` with a live clock.
 * @returns {Promise<{ tyres: object[], workOrders: object[] }>}
 */
export async function loadOpsData({ country } = {}) {
  const [tyres, workOrders] = await Promise.all([
    listTyresForOps({ country }),
    listWorkOrdersForOps({ country }),
  ])
  return { tyres, workOrders }
}
