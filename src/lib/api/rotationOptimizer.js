/**
 * Rotation Optimizer service — reads the in-service tyre records needed to build
 * per-vehicle rotation plans. Wired to Tyre Pulse's `tyre_records`. Country-scoped
 * (null-safe) and fully paginated so large fleets are never silently truncated.
 *
 * Only tyres currently fitted (removal_date IS NULL) are relevant: a rotation
 * plan is about the tyres physically on the vehicle right now. The optimisation
 * logic itself lives in the pure `src/lib/rotationOptimizer.js`.
 */
import { supabase, applyCountry, fetchAllPages } from './_client'

const COLS =
  'id,serial_no,serial_number,tyre_serial,brand,size,asset_no,site,region,country,' +
  'position,tyre_position,tread_depth,total_km,removal_date'

/**
 * Every in-service tyre record in scope for rotation analysis, paginated and
 * country-scoped. Ordered by asset then position for stable, group-friendly reads.
 * @param {{ country?:string }} [opts]
 */
export async function listInServiceTyres({ country } = {}) {
  return fetchAllPages((from, to) => {
    const q = supabase
      .from('tyre_records')
      .select(COLS)
      .is('removal_date', null)
      .order('asset_no', { ascending: true, nullsFirst: false })
      .order('id', { ascending: true })
      .range(from, to)
    return applyCountry(q, country)
  })
}
