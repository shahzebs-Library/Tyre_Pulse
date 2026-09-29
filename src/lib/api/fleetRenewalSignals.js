/**
 * fleetRenewalSignals - the register reads behind the Fleet Renewal page's
 * candidate list (plans themselves still come from ./fleetRenewal.js).
 *
 * vehicle_fleet and asset_utilization are paged past the 1,000 row response
 * cap with an id tiebreak. Utilisation and breakdowns are optional signals:
 * each comes back null when it could not be read, so the page can say "not
 * measured" instead of treating a failed read as zero.
 */
import { supabase, applyCountry, fetchAllPages, toServiceError } from './_client'
import { listAssetBreakdowns } from './assetBreakdowns'

const MAX_ROWS = 20000

export const RENEWAL_FLEET_COLS =
  'id,asset_no,fleet_number,registration_no,make,model,vehicle_type,site,country,model_year,current_km,status,ops_status'

/** Fleet register for the scope. Throws on failure: without it there is no candidate list. */
export async function loadRenewalFleet({ country } = {}) {
  const { data, error, truncated } = await fetchAllPages((from, to) =>
    applyCountry(supabase.from('vehicle_fleet').select(RENEWAL_FLEET_COLS), country)
      .order('asset_no', { ascending: true }).order('id', { ascending: true }).range(from, to), { max: MAX_ROWS })
  if (error) throw toServiceError(error)
  return { rows: data || [], truncated: !!truncated }
}

/** Latest telematics utilisation snapshots, or null when unreadable. */
export async function loadRenewalUtilization({ country } = {}) {
  try {
    const { data, error } = await fetchAllPages((from, to) =>
      applyCountry(supabase.from('asset_utilization').select('id,asset_no,country,utilization_pct,captured_at'), country)
        .order('id', { ascending: true }).range(from, to), { max: MAX_ROWS })
    if (error) return null
    return data || []
  } catch {
    return null
  }
}

/** Breakdown register rows, or null when unreadable. */
export async function loadRenewalBreakdowns({ country } = {}) {
  try {
    const res = await listAssetBreakdowns({ country })
    return res.ok ? res.rows : null
  } catch {
    return null
  }
}
