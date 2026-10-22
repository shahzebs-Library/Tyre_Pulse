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
  'cost_usd','input_tokens','output_tokens','total_tokens','provider',
  'model_version','created_at','updated_at','attempts','error_message',
  'review_status','reviewer_note','reviewed_at',
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

/** Database RPC derives organisation and recorded_by from the authenticated session. */
export async function recordDepthMeasurement(values) {
  const {data,error}=await supabase.rpc('record_ai_tyre_depth',{
    p_inspection_id:values.inspectionId,
    p_position:values.position,
    p_source:values.source,
    p_original:Number(values.originalMm),
    p_minimum:Number(values.minimumMm),
    p_inner:values.innerMm===''?null:Number(values.innerMm),
    p_center:values.centerMm===''?null:Number(values.centerMm),
    p_outer:values.outerMm===''?null:Number(values.outerMm),
    p_odometer:values.odometerKm===''?null:Number(values.odometerKm),
    p_serial:values.tyreSerial || null,
  })
  if(error)throw error
  return data
}

/** Request server-side photo analysis; no model credentials are held in the browser. */
export async function enqueueInspectionPhotos(inspectionId) {
  const {data,error}=await supabase.functions.invoke('ai-tyre-inspection',{
    body:{action:'enqueue',inspection_id:inspectionId},
  })
  if(error)throw error
  return data
}
/** Role verification and audit transition happen in the Edge Function. */
export async function reviewAiFinding(jobId,decision,note='') {
  const {data,error}=await supabase.functions.invoke('ai-tyre-inspection',{
    body:{action:'review',job_id:jobId,decision,note},
  })
  if(error)throw error
  return data
}

/** Actual provider-token accounting from completed, tenant-scoped AI jobs. */
export function summarizeInspectionAiCosts(jobs) {
  const byInspection=new Map()
  for(const job of jobs||[]) {
    const id=job.inspection_id
    const current=byInspection.get(id)||{inspectionId:id,images:0,priced:0,unpriced:0,costUsd:0,inputTokens:0,outputTokens:0}
    current.images++
    const cost=job.cost_usd==null?null:Number(job.cost_usd)
    if(cost!==null&&Number.isFinite(cost)){current.costUsd+=cost;current.priced++}
    else current.unpriced++
    current.inputTokens+=Number(job.input_tokens||0)
    current.outputTokens+=Number(job.output_tokens||0)
    byInspection.set(id,current)
  }
  return [...byInspection.values()].map(x=>({...x,costUsd:Number(x.costUsd.toFixed(6))}))
}

/** Backfill one bounded page of historical inspections through server authorization.
 * Date range is interpreted as absolute ISO timestamps.
 */
export async function backfillAiInspectionRange({from,to,page=0}) {
  const {data,error}=await supabase.functions.invoke('ai-tyre-inspection',{
    body:{action:'backfill',from,to,page},
  })
  if(error){
    // FunctionsFetchError = request never reached the function (CORS / not deployed).
    if(error.name==='FunctionsFetchError')throw new Error('The AI service could not be reached. Reload the page; if it persists the function needs redeploying.')
    throw error
  }
  return data
}

/** On-demand gauge-free visual screening of all photographed tyre positions.
 * All depth/remaining-life figures remain unmeasured unless gauge data exists.
 */
export async function screenInspectionPhotos(inspectionId) {
  const {data,error}=await supabase.functions.invoke('ai-tyre-inspection',{
    body:{action:'screen',inspection_id:inspectionId},
  })
  if(error)throw error
  return data
}

/** Per-finding labelled review rows (supervisor roles; INVOKER rpc, tenant scoped by RLS). Evaluation only. */
export async function getAiLabelledFindings({ from = null, to = null, limit = 5000 } = {}) {
  const ymd = /^\d{4}-\d{2}-\d{2}$/
  const { data, error } = await supabase.rpc('get_ai_tyre_labelled_findings', {
    p_from: from && ymd.test(from) ? from : null,
    p_to: to && ymd.test(to) ? to : null,
    p_limit: Math.min(Math.max(Number(limit) || 5000, 1), 20000),
  })
  if (error) throw error
  return data || []
}

/** Evaluation-only aggregate of reviewer decisions per model / prompt version.
 * SECURITY INVOKER RPC: scoped to the caller's organisation and supervisor roles by the database.
 * Dates are YYYY-MM-DD or empty. Never used to train or tune a model.
 */
export async function getAiReviewFeedback({ from = null, to = null } = {}) {
  const ymd = /^\d{4}-\d{2}-\d{2}$/
  const { data, error } = await supabase.rpc('get_ai_tyre_review_feedback', {
    p_from: from && ymd.test(from) ? from : null,
    p_to: to && ymd.test(to) ? to : null,
  })
  if (error) throw error
  return data || []
}
