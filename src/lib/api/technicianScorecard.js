/**
 * Technician Scorecard service — reads the `work_orders` rows needed to build
 * the workshop technician performance leaderboard. Country-scoped (null-safe)
 * and fully paginated so large workshops are never silently truncated.
 *
 * Grouping / KPI / ranking logic lives in `src/lib/technicianScorecard.js`;
 * this module is purely I/O with a least-privilege column list.
 */
import { supabase, applyCountry, fetchAllPages, ServiceError } from './_client'

// Explicit columns only (no SELECT *). `assigned_to` aliases technician_name to
// mirror WorkshopManagement; the pure lib accepts either key.
const COLS =
  'id,work_order_no,asset_no,status,priority,work_type,site,' +
  'technician_name,labour_cost,parts_cost,total_cost,' +
  'created_at,completed_at,country'

/**
 * Fetch every work order in scope for the scorecard, paginated.
 * @param {{ country?: string }} [opts]
 * @returns {Promise<Array<object>>}
 */
export async function listWorkOrdersForScorecard({ country } = {}) {
  const { data, error } = await fetchAllPages((from, to) => {
    const q = supabase
      .from('work_orders')
      .select(COLS)
      .order('created_at', { ascending: false })
      .order('id', { ascending: false })
      .range(from, to)
    return applyCountry(q, country)
  })
  if (error) throw new ServiceError(error.message, error.code, error)
  return data || []
}
