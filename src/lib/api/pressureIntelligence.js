/**
 * Reads behind /pressure-intel. Pure shaping lives in
 * src/lib/pressureIntelligenceAnalytics.js and src/lib/pressureIntelligenceView.js.
 *
 * Sources, measured live on 2026-09-29:
 *   - inspections.tyre_conditions pressure_psi: the only place the fleet
 *     records wheel pressure (about 17,400 wheel readings).
 *   - tpms_readings: the table exists but holds 0 rows, so there is no live
 *     sensor feed. countTpmsReadings lets the page say so honestly.
 *   - tyre_specifications.recommended_pressure: a handful of fitment rules by
 *     vehicle type and axle. Used only where a rule exists for that exact type
 *     and axle; everywhere else the vehicle median is the reference.
 */
import { supabase } from '../supabase'
import { fetchAllPages } from '../fetchAll'
import { toServiceError, isNotProvisioned } from './_client'

export const PRESSURE_ROW_CAP = 50000
const INSPECTION_COLS = 'id,asset_no,vehicle_type,site,country,inspector,inspection_date,scheduled_date,created_at,status,tyre_conditions'

/**
 * Inspections with their wheel readings, newest first. Null-safe country scope
 * (a row with no country is shown in every country, as elsewhere in the app),
 * paged with an id tiebreak so a page boundary never drops or repeats a row.
 * Resolves { rows, truncated }; throws on a failed read.
 */
export async function listPressureInspections({ country } = {}) {
  const scoped = country && country !== 'All' ? country : null
  const { data, error, truncated } = await fetchAllPages((f, t) => {
    let q = supabase.from('inspections').select(INSPECTION_COLS)
    if (scoped) q = q.or(`country.eq.${scoped},country.is.null`)
    return q.order('inspection_date', { ascending: false }).order('id', { ascending: false }).range(f, t)
  }, { max: PRESSURE_ROW_CAP })
  if (error) throw toServiceError(error, 'Could not load pressure data.')
  return { rows: data || [], truncated: Boolean(truncated) }
}

/** Specification pressure rules. [] when none or the table is not installed. */
export async function listPressureSpecs() {
  const { data, error } = await supabase
    .from('tyre_specifications')
    .select('id,vehicle_type,position,recommended_pressure')
    .not('recommended_pressure', 'is', null)
    .limit(500)
  if (error) {
    if (isNotProvisioned(error)) return []
    throw toServiceError(error, 'Could not read tyre specification pressures.')
  }
  return data || []
}

/** How many live sensor (TPMS) readings exist. null when it cannot be read. */
export async function countTpmsReadings() {
  const { count, error } = await supabase.from('tpms_readings').select('id', { count: 'exact', head: true })
  if (error) return isNotProvisioned(error) ? 0 : null
  return count ?? 0
}
