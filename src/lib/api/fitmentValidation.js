/**
 * Fitment Validation service — reads the two datasets the Fitment Validation
 * screen joins in the browser: fleet assets (the specified tyre size) and the
 * currently-fitted tyres (in-service `tyre_records`, i.e. `removal_date IS
 * NULL`). Country-scoped (null-safe) and fully paginated so large fleets are
 * never silently truncated. Classification lives in `src/lib/fitmentValidation.js`.
 */
import { supabase, applyCountry, fetchAllPages } from './_client'

const VEHICLE_COLS =
  'id,asset_no,make,model,vehicle_type,site,country,status,is_active,tyre_size'

const TYRE_COLS =
  'id,asset_no,serial_no,serial_number,tyre_serial,size,position,tyre_position,' +
  'site,region,country,status,removal_date'

/**
 * Every fleet asset (paginated), newest first, country-scoped. These carry the
 * SPEC (`tyre_size`) that fitted tyres are validated against.
 * @param {{ country?:string }} [opts]
 */
export async function listFleetForFitment({ country } = {}) {
  return fetchAllPages((from, to) => {
    const q = supabase
      .from('vehicle_fleet')
      .select(VEHICLE_COLS)
      .order('asset_no', { ascending: true })
      .order('id', { ascending: true })
      .range(from, to)
    return applyCountry(q, country)
  })
}

/**
 * Every in-service tyre record (paginated), country-scoped. Only tyres still on
 * a vehicle (`removal_date IS NULL`) are relevant to the fitment question.
 * @param {{ country?:string }} [opts]
 */
export async function listFittedTyres({ country } = {}) {
  return fetchAllPages((from, to) => {
    const q = supabase
      .from('tyre_records')
      .select(TYRE_COLS)
      .is('removal_date', null)
      .order('asset_no', { ascending: true })
      .order('id', { ascending: true })
      .range(from, to)
    return applyCountry(q, country)
  })
}

/**
 * Convenience loader: fetch both datasets in parallel for the page.
 * @param {{ country?:string }} [opts]
 * @returns {Promise<{ vehicles:object[], tyres:object[] }>}
 */
export async function loadFitmentData({ country } = {}) {
  const [vehicles, tyres] = await Promise.all([
    listFleetForFitment({ country }),
    listFittedTyres({ country }),
  ])
  return {
    vehicles: Array.isArray(vehicles) ? vehicles : [],
    tyres: Array.isArray(tyres) ? tyres : [],
  }
}
