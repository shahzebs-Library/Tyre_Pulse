/**
 * Tyre Age Compliance service — reads the tyre records needed to scan fleet tyre
 * age against GCC/RTA limits. Ported (backend-logic side) from tyre_saas, wired
 * to Tyre Pulse's `tyre_records`. Country-scoped (null-safe) and fully paginated
 * so large fleets are never silently truncated. Banding lives in
 * `src/lib/tyreAge.js`.
 */
import { supabase, applyCountry, fetchAllPages } from './_client'

const COLS =
  'id,serial_no,serial_number,tyre_serial,brand,size,asset_no,site,region,country,' +
  'position,tyre_position,status,cost_per_tyre,total_km,fitment_date,issue_date,removal_date'

/**
 * Every tyre record in scope for the age scan, paginated. `fittedOnly` restricts
 * to tyres that are still in service (not removed/scrapped) — the compliance
 * question is about tyres currently on vehicles.
 * @param {{ country?:string, fittedOnly?:boolean }} [opts]
 */
export async function listTyresForAgeScan({ country, fittedOnly = false } = {}) {
  return fetchAllPages((from, to) => {
    let q = supabase.from('tyre_records').select(COLS)
      .order('fitment_date', { ascending: true, nullsFirst: false })
      .order('id', { ascending: true })
      .range(from, to)
    if (fittedOnly) {
      // "removed" tyres carry a removal_date; treat rows without one as in-service.
      q = q.is('removal_date', null)
    }
    return applyCountry(q, country)
  })
}
