/**
 * Reads for the Size Optimizer page. The tyre records themselves are read by
 * the page (the same paged, country and date scoped read it always had); this
 * module adds the fleet register (for vehicle type, make, model, site) and the
 * tyre specification catalogue (for load index, speed rating, dimensions).
 * Both throw a sanitised error on failure; the catalogue degrades to [] only
 * when its table is not provisioned.
 */
import { supabase, fetchAllPages, applyCountry, toServiceError } from './_client'
import { listCatalog } from './tyreSpecCatalog'

const FLEET_COLS = 'id, asset_no, country, site, vehicle_type, make, model, registration_no, status'

export async function listOptimizerFleet({ country } = {}) {
  const { data, error } = await fetchAllPages((from, to) => {
    let q = supabase.from('vehicle_fleet').select(FLEET_COLS).order('asset_no').order('id')
    q = applyCountry(q, country)
    return q.range(from, to)
  }, { max: 20000 })
  if (error) throw toServiceError(error, 'Could not load the fleet register.')
  return data || []
}

export async function listOptimizerCatalogue({ country } = {}) {
  return listCatalog({ country: country && country !== 'All' ? country : undefined })
}
