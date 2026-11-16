/**
 * Digital Twin service — reads the tyre_records needed to render a vehicle's
 * digital twin, plus an asset search for the lookup box. Country-scoped
 * (null-safe) and fully paginated so heavily-fitted assets are never truncated.
 * All health/score assembly lives in `src/lib/digitalTwin.js`.
 */
import { supabase, applyCountry, fetchAllPages, ServiceError } from './_client'
import { toUserMessage } from '../safeError'
import { sanitizeSearchTerm } from '../searchFilter'
import { isOrgId, currentOrgId } from './companyScope'

const COLS =
  'id,serial_no,serial_number,tyre_serial,brand,size,supplier,asset_no,asset_number,site,' +
  'country,position,tyre_position,status,cost_per_tyre,total_km,total_hrs,tread_depth,' +
  'pressure_reading,fitment_date,issue_date,removal_date'

/**
 * Every in-service tyre currently fitted to one asset (removal_date IS NULL),
 * paginated. These are the positions that make up the vehicle's live twin.
 * @param {string} assetNo
 * @param {{ country?:string }} [opts]
 */
export async function getAssetTwinRecords(assetNo, { country, orgId } = {}) {
  const raw = String(assetNo || '').trim()
  if (!raw) return []
  const s = sanitizeSearchTerm(raw)
  return fetchAllPages((from, to) => {
    const q = supabase.from('tyre_records').select(COLS)
      .or(`asset_no.eq.${s},asset_number.eq.${s}`)
      .is('removal_date', null)
      .order('position', { ascending: true, nullsFirst: false })
      .order('id', { ascending: true })
      .range(from, to)
    // The machine's own company: a super admin's read spans companies, and the
    // same asset code in two companies is two machines.
    return applyCountry(isOrgId(orgId) ? q.eq('organisation_id', orgId) : q, country)
  })
}

/**
 * Asset search for the lookup box: distinct asset numbers matching a query, with
 * a little context (site/brand) for disambiguation. Capped for responsiveness.
 * Limited to the caller's company (the same rule as reference_asset_options):
 * a super admin's read spans companies, and folding two companies' tyres on
 * one code into one suggestion would count them as one machine.
 * @param {string} query
 * @param {{ country?:string, limit?:number }} [opts]
 */
export async function searchAssets(query, { country, limit = 25 } = {}) {
  const s = sanitizeSearchTerm(String(query || '').trim())
  if (!s || s.length < 2) return []
  let q = supabase.from('tyre_records')
    .select('asset_no,asset_number,site,brand')
    .or(`asset_no.ilike.%${s}%,asset_number.ilike.%${s}%`)
    .is('removal_date', null)
    .limit(300)
  q = applyCountry(q, country)
  const org = await currentOrgId()
  if (org) q = q.eq('organisation_id', org)
  const { data, error } = await q
  if (error) throw new ServiceError(toUserMessage(error), error.code, error)
  const seen = new Map()
  for (const r of data || []) {
    const asset = (r.asset_no || r.asset_number || '').trim()
    if (!asset) continue
    const key = asset.toLowerCase()
    const entry = seen.get(key)
    if (entry) { entry.tyreCount += 1; continue }
    seen.set(key, { asset_no: asset, site: r.site || null, brand: r.brand || null, tyreCount: 1 })
  }
  return [...seen.values()].slice(0, limit)
}
