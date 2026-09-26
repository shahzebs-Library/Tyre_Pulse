/**
 * Per-vehicle insurance schedule lines (V526 `insurance_policy_assets`).
 *
 * The portfolio service (`insurancePortfolio.js`) reads the whole schedule for
 * the Insurance Policies page; Vehicle 360 needs only the lines stated against
 * ONE asset, so this is the narrow read. Scoped by asset AND country (the same
 * asset code in two countries is usually a different machine - V376), paged
 * with an `id` tiebreak, bounded by `max`. A missing table degrades to [].
 *
 * NOTE the stated coverage limit: only ~405 of 2,041 schedule lines carry an
 * asset id that joins the fleet register, so an empty result means "no line
 * names this asset", not "this asset is uninsured". The page says so.
 */
import { supabase, fetchAllPages, isMissingRelation } from './_client'

const COLS =
  'id,country,policy_no,cover_type,asset_no,plate_no,chassis_no,description,sum_insured,premium,currency,cover_from,cover_to,status,certificate_no'

export async function listVehicleInsuranceLines(assetNo, { country } = {}) {
  const asset = String(assetNo || '').trim().toUpperCase()
  if (!asset) return []
  try {
    const { data, error } = await fetchAllPages((from, to) => {
      let q = supabase.from('insurance_policy_assets').select(COLS).eq('asset_no', asset)
      if (country && country !== 'All') q = q.eq('country', country)
      return q.order('cover_to', { ascending: false, nullsFirst: false }).order('id').range(from, to)
    }, { max: 500 })
    if (error) throw error
    return Array.isArray(data) ? data : []
  } catch (err) {
    if (isMissingRelation(err)) return []
    throw err
  }
}
