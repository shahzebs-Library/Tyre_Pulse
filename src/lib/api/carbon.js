/**
 * Carbon Tracker service — reads the operational fuel-usage signal the fleet
 * already has and normalises it for the pure carbon maths in `src/lib/carbon.js`.
 *
 * There is deliberately NO dedicated emissions table. Fuel burned is derived
 * from the SAME source `FuelEfficiency` uses — the `tyre_records` table — where
 * each record's fitment→removal odometer gives a real distance travelled while
 * that tyre was fitted. The service returns lightweight, country-scoped rows;
 * litres and CO2 are computed downstream (single source of truth).
 *
 * Country-scoped (null-safe) and fully paginated so large fleets are never
 * silently truncated. A missing relation (fresh/partial schema) degrades to an
 * empty list rather than throwing — the page shows an honest empty state.
 */
import { supabase, applyCountry, fetchAllPages, ServiceError } from './_client'

// Least-privilege select: only the columns carbon aggregation needs. Mirrors
// the fuel-relevant subset of FuelEfficiency's tyre_records query.
const COLS = 'id,asset_no,site,country,km_at_fitment,km_at_removal,issue_date'

const MISSING_RELATION = '42P01'

function isMissingRelation(err) {
  const code = err?.code || err?.cause?.code
  if (code === MISSING_RELATION) return true
  return /relation .* does not exist|could not find the table|schema cache/i.test(err?.message || '')
}

/** Map a tyre record to a normalised fuel-usage row. */
function normalize(r) {
  const fit = Number(r?.km_at_fitment)
  const rem = Number(r?.km_at_removal)
  const distance_km =
    Number.isFinite(fit) && Number.isFinite(rem) && rem > fit ? rem - fit : null
  return {
    id: r?.id,
    vehicle: r?.asset_no || null,
    site: r?.site || null,
    date: r?.issue_date || null,
    distance_km,
  }
}

/**
 * Fetch normalised fuel-usage rows for the active country.
 * @param {{ country?: string }} [opts]
 * @returns {Promise<Array<{id:any, vehicle:string|null, site:string|null, date:string|null, distance_km:number|null}>>}
 */
export async function listFuelUsage({ country } = {}) {
  try {
    const { data, error } = await fetchAllPages((from, to) => {
      const q = supabase
        .from('tyre_records')
        .select(COLS)
        .order('issue_date', { ascending: true, nullsFirst: false })
        .order('id', { ascending: true })
        .range(from, to)
      return applyCountry(q, country)
    })
    if (error) {
      if (isMissingRelation(error)) return []
      throw new ServiceError(error.message, error.code, error)
    }
    return (data ?? []).map(normalize)
  } catch (err) {
    if (isMissingRelation(err)) return []
    if (err instanceof ServiceError) throw err
    throw new ServiceError(err?.message || 'Failed to load fuel usage', err?.code, err)
  }
}
