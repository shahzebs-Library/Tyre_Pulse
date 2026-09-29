/**
 * Reads behind the Site Management operational cards. Each read is lean,
 * country scoped (null-safe) and paged past the 1000-row cap.
 *
 * - listSiteFleetOps: the fleet feed of listSiteAssets plus operational status
 *   and document expiry dates. When those columns are not provisioned it falls
 *   back to the base feed and reports `opsKnown: false` so the page shows N/A.
 * - listSiteUtilization: latest telematics utilisation rows ([] when the table
 *   is not deployed).
 * - listSiteInspectionDates: asset + inspection date, for "inspection due".
 */
import { supabase, applyCountry, fetchAllPages, isMissingRelation, isMissingColumn, ServiceError } from './_client'
import { listSiteAssets } from './sites'
import { toUserMessage } from '../safeError'

const BASE = 'id,asset_no,fleet_number,vehicle_type,site,country,region,status,current_km,active:is_active'
const EXTRA = ',ops_status,insurance_expiry,mvip_expiry,operating_card_expiry'

async function paged(build) {
  const { data, error } = await fetchAllPages(build)
  if (error) throw new ServiceError(toUserMessage(error), error.code, error)
  return Array.isArray(data) ? data : []
}

export async function listSiteFleetOps({ country } = {}) {
  try {
    const rows = await paged((from, to) =>
      applyCountry(supabase.from('vehicle_fleet').select(BASE + EXTRA), country)
        .order('site', { nullsFirst: false }).order('asset_no').order('id', { ascending: true }).range(from, to))
    return { rows, opsKnown: true }
  } catch (err) {
    if (!isMissingColumn(err)) throw err
    return { rows: await listSiteAssets({ country }), opsKnown: false }
  }
}

export async function listSiteUtilization({ country } = {}) {
  try {
    return await paged((from, to) =>
      applyCountry(supabase.from('asset_utilization').select('id,asset_no,country,utilization_pct,captured_at,created_at'), country)
        .order('asset_no').order('id', { ascending: true }).range(from, to))
  } catch (err) {
    if (isMissingRelation(err)) return []
    throw err
  }
}

export async function listSiteInspectionDates({ country } = {}) {
  return paged((from, to) =>
    applyCountry(supabase.from('inspections').select('id,asset_no,country,inspection_date,completed_date'), country)
      .order('inspection_date', { ascending: false, nullsFirst: false }).order('id', { ascending: true }).range(from, to))
}
