/**
 * vehicleHistoryExtra - the per-asset sources the shared asset history loader
 * (./assetHistory.js, also used by Asset Detail) does not read: tyre service
 * events, gate passes, handover reports and vehicle check-ins and check-outs.
 *
 * Same three rules as that loader: identity is (country, asset_no) with a
 * STRICT country match, each source fails on its own into an envelope
 * { ok, rows, error, missing, truncated }, and every read is paged with a
 * unique id tiebreak and a ceiling.
 */
import { supabase, fetchAllPages, isMissingRelation } from './_client'
import { canonAssetNo } from '../assetHistory'

const MAX = 3000

export const EXTRA_SOURCES = Object.freeze([
  {
    key: 'tyre_service', label: 'Tyre service events', table: 'tyre_service_events', date: 'event_date',
    cols: 'id,country,tyre_serial,asset_no,position,event_type,event_date,tread_depth,pressure,cost,technician,site,notes',
  },
  {
    key: 'gate_pass', label: 'Gate passes', table: 'gate_passes', date: 'pass_date',
    cols: 'id,country,asset_no,site,pass_date,status,cleared_at,denial_reason,notes,created_at',
  },
  {
    key: 'handover', label: 'Handover reports', table: 'handover_reports', date: 'handover_at',
    cols: 'id,country,report_no,asset_no,handover_type,from_driver,to_driver,handover_at,odometer_km,fuel_level_pct,condition_rating,damage_count,cleanliness,notes',
  },
  {
    key: 'checkinout', label: 'Check-ins and check-outs', table: 'vehicle_checkinout', date: 'checked_at',
    cols: 'id,country,asset_no,driver_name,direction,odometer_km,fuel_level,condition_notes,site,checked_at,status',
  },
])

const ok = (rows, truncated) => ({ ok: true, rows: rows || [], truncated: Boolean(truncated), error: null, missing: false })
const empty = () => ({ ok: true, rows: [], truncated: false, error: null, missing: true })
const failed = (error) => ({ ok: false, rows: [], truncated: false, error, missing: false })

async function readSource(src, asset, country) {
  try {
    const { data, error, truncated } = await fetchAllPages((from, to) => {
      let q = supabase.from(src.table).select(src.cols).eq('asset_no', asset)
      if (country && country !== 'All') q = q.eq('country', country)
      return q.order(src.date, { ascending: false, nullsFirst: false }).order('id', { ascending: true }).range(from, to)
    }, { max: MAX })
    if (error) return isMissingRelation(error) ? empty() : failed(error)
    return ok(data, truncated)
  } catch (err) {
    return isMissingRelation(err) ? empty() : failed(err)
  }
}

/**
 * Read every extra source for one asset. Never rejects: a failed source is
 * reported in its envelope so the page can say "could not be read" for it.
 * @returns {Promise<Record<string, {ok:boolean, rows:Array, error:any, missing:boolean, truncated:boolean}>>}
 */
export async function loadAssetExtraSources(assetNo, { country } = {}) {
  const asset = canonAssetNo(assetNo)
  if (!asset) return {}
  const settled = await Promise.allSettled(EXTRA_SOURCES.map((s) => readSource(s, asset, country)))
  const out = {}
  EXTRA_SOURCES.forEach((s, i) => {
    out[s.key] = settled[i].status === 'fulfilled' ? settled[i].value : failed(settled[i].reason)
  })
  return out
}
