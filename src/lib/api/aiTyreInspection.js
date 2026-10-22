/**
 * Read-only boundaries for AI tyre inspection data.
 *
 * All requests are mediated by Supabase RLS. Writes to analysis jobs are
 * deliberately NOT performed from browser code. A secure server worker owns
 * state transitions, model credentials and human review authorization.
 */
import { supabase } from './_client'

const JOB_FIELDS = [
  'id','inspection_id','tyre_position','photo_ref','status','analysis',
  'model_version','created_at','updated_at','attempts','error_message',
].join(',')
const MEASUREMENT_FIELDS = [
  'id','inspection_id','tyre_position','tyre_serial','original_mm',
  'minimum_mm','inner_mm','center_mm','outer_mm','source','odometer_km',
  'measured_at','recorded_by','created_at',
].join(',')

function requireIds(ids) {
  if (!Array.isArray(ids)) throw new Error('Expected inspection IDs.')
  const valid = ids.filter(v => typeof v === 'string' && /^[a-f0-9-]{36}$/i.test(v))
  return Array.from(new Set(valid)).slice(0,100)
}

function validateResponse(response) {
  if (response.error) throw response.error
  return response.data || []
}

export async function readInspectionAnalysis(ids) {
  const keys=requireIds(ids)
  if (!keys.length) return []
  return validateResponse(await supabase.from('ai_tyre_inspection_jobs')
    .select(JOB_FIELDS).in('inspection_id',keys)
    .order('created_at',{ascending:false}).limit(500))
}
export async function readInspectionMeasurements(ids) {
  const keys=requireIds(ids)
  if (!keys.length) return []
  return validateResponse(await supabase.from('ai_tyre_depth_measurements')
    .select(MEASUREMENT_FIELDS).in('inspection_id',keys)
    .order('measured_at',{ascending:false}).limit(1000))
}
export async function readPositionHistory(inspectionIds,position) {
  const keys=requireIds(inspectionIds)
  if (!keys.length) return []
  if (!position || String(position).length>80) throw new Error('Invalid tyre position.')
  return validateResponse(await supabase.from('ai_tyre_depth_measurements')
    .select(MEASUREMENT_FIELDS).in('inspection_id',keys)
    .eq('tyre_position',position)
    .order('measured_at',{ascending:false}).limit(500))
}
export function indexByInspection(rows) {
  return (rows||[]).reduce((map,row)=>{
    const key=row.inspection_id
    if (!map.has(key)) map.set(key,[])
    map.get(key).push(row)
    return map
  },new Map())
}
