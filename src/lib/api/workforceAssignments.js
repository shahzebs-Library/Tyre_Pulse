import {supabase,unwrap,ServiceError,fetchAllPages,isMissingColumn,isNotProvisioned,toServiceError} from './_client'
import {TRANSITIONS,reasonMessage,BLOCK_REASONS} from '../workforceTransitions'
import {pickEstimate} from '../workforceEstimate'
export const BASE_COLUMNS='id,organisation_id,assigned_to,assigned_by,title,instructions,site,priority,status,due_at,estimated_minutes,source_module,source_record_id,created_at,updated_at'
export const CLASSIFIED_COLUMNS=BASE_COLUMNS+',task_type,vehicle_type,assignee_role'
export const COLUMNS=CLASSIFIED_COLUMNS+',asset_no,tyre_serial,tyre_position,operational_record_table,operational_record_id,supporting_employee_ids,qualification,override_reason,overridden_by'
/**
 * One page of assignments plus the exact server count, so a board never presents the first page as
 * the whole organisation. RLS decides what is visible (own work, or the organisation for managers).
 */
export async function listWorkforceAssignmentsPage({mine=false,status=null,page=0,pageSize=50,search=''}={}) {
 if(pageSize<1||pageSize>200||page<0) throw new ServiceError('Invalid page')
 let userId=null
 if(mine){const {data:{user}}=await supabase.auth.getUser();if(!user)throw new ServiceError('Sign in required');userId=user.id}
 let q=supabase.from('workforce_assignments').select(COLUMNS,{count:'exact'}).order('created_at',{ascending:false}).order('id',{ascending:true}).range(page*pageSize,page*pageSize+pageSize-1)
 if(status)q=q.eq('status',status)
 if(userId)q=q.eq('assigned_to',userId)
 const term=String(search||'').trim().replace(/[%,()\\]/g,' ').trim()
 if(term)q=q.or(`title.ilike.%${term}%,asset_no.ilike.%${term}%,tyre_serial.ilike.%${term}%,site.ilike.%${term}%`)
 const {data,error,count}=await q
 if(error){if(isNotProvisioned(error)||isMissingColumn(error))throw new ServiceError(NOT_INSTALLED,error.code,error);throw toServiceError(error,'Unable to load assignments')}
 return {rows:data||[],total:count??0}
}
/** Legacy list read used by the open board views: bounded, and reports truncation instead of hiding it. */
export async function listWorkforceAssignments({mine=false,status=null,limit=300}={}) {
 if(limit<1||limit>500) throw new ServiceError('Invalid page size')
 const {rows,total}=await listWorkforceAssignmentsPage({mine,status,page:0,pageSize:Math.min(limit,200)})
 rows.truncated=total>rows.length
 rows.total=total
 return rows
}
export const NOT_INSTALLED='Team work tracking needs the latest database update before it can record work. Ask an administrator to apply it.'
/** Whole-dataset counts from the server (never a client tally of one page). */
export async function getBoardSummary({from=null,to=null,site=null}={}){
 try{return unwrap(await supabase.rpc('workforce_board_summary',{p_from:from||null,p_to:to||null,p_site:site||null}))}
 catch(e){if(isNotProvisioned(e))throw new ServiceError(NOT_INSTALLED,e.code,e);throw e}
}
export async function assignWork(values) {
 if(!values.title?.trim()||!values.assigned_to) throw new ServiceError('Employee and task title required')
 const payload={title:values.title.trim(),assigned_to:values.assigned_to,instructions:values.instructions||null,site:values.site||null,priority:values.priority||'normal',due_at:values.due_at||null,estimated_minutes:values.estimated_minutes||null,source_module:values.source_module||null,source_record_id:values.source_record_id||null}
 for(const k of ['task_type','vehicle_type','asset_no','tyre_serial','tyre_position','override_reason'])if(String(values[k]||'').trim())payload[k]=String(values[k]).trim()
 if(Array.isArray(values.supporting_employee_ids)&&values.supporting_employee_ids.length)payload.supporting_employee_ids=values.supporting_employee_ids
 const {data,error}=await supabase.from('workforce_assignments').insert(payload).select(BASE_COLUMNS).single()
 if(error){
  // Qualification refusals are written for people (see workforce_assignment_qualify); show them as-is.
  const m=String(error.message||'')
  if(/^(Not qualified|A manager override reason|The selected employee)/.test(m))throw new ServiceError(qualificationMessage(m),error.code,error)
  throw toServiceError(error,'Could not assign the work')
 }
 return data
}
const REASON_TEXT={skill_missing:'required skill level not recorded',certification_invalid:'no valid certificate',site_not_assigned:'not assigned to this site',temporarily_unavailable:'temporarily unavailable',account_inactive:'account not active',employee_inactive:'employee inactive',no_employee_record:'no employee record yet'}
export const qualificationReasonText=code=>REASON_TEXT[code]||String(code||'').replace(/_/g,' ')
function qualificationMessage(m){return m.replace(/:\s*([a-z_, ]+)$/,(_,list)=>': '+list.split(',').map(x=>qualificationReasonText(x.trim())).join(', '))}
/** Qualified, available people for a task, with the reasons. It only recommends; it never assigns. */
export async function recommendAssignees({task_type=null,site=null,due_at=null,limit=10}={}){
 try{return unwrap(await supabase.rpc('workforce_recommend_assignees',{p_task_type:task_type||null,p_site:site||null,p_due_at:due_at||null,p_limit:limit}))||[]}
 catch(e){if(isNotProvisioned(e))return null;throw e}
}
export async function reassignAssignment(id,newAssignee,{note,overrideReason=null,key=newKey()}={}){
 if(!String(note||'').trim())throw new ServiceError(reasonMessage('note_required'))
 const data=unwrap(await supabase.rpc('workforce_reassign',{p_assignment_id:id,p_new_assignee:newAssignee,p_note:String(note).trim(),p_idempotency_key:key,p_override_reason:overrideReason||null}))
 if(!data?.ok)throw new ServiceError(reasonMessage(data?.reason,data?.current_status),data?.reason)
 return data
}
export const OPERATIONAL_TABLES=Object.freeze({tyre_records:'Tyre fitment / removal',tyre_service_events:'Tyre service event',work_orders:'Job card',inspections:'Inspection'})
export async function linkOperationalRecord(id,table,recordId,{key=newKey()}={}){
 if(!OPERATIONAL_TABLES[table]||!recordId)throw new ServiceError('Choose the operational record to link')
 const data=unwrap(await supabase.rpc('workforce_link_operational_record',{p_assignment_id:id,p_table:table,p_record_id:recordId,p_idempotency_key:key}))
 if(!data?.ok)throw new ServiceError(reasonMessage(data?.reason,data?.current_status),data?.reason)
 return data
}
export async function listAssignableEmployees(){
 const result=await fetchAllPages((from,to)=>supabase.from('profiles')
  .select('id,employee_id,username,full_name,role,site,approved,locked')
  .eq('approved',true).eq('locked',false).order('id',{ascending:true}).range(from,to),{max:20000})
 if(result.error||result.truncated) throw new ServiceError('Unable to load a complete employee directory')
 return result.data||[]
}
const newKey=()=>globalThis.crypto?.randomUUID?globalThis.crypto.randomUUID():`web-${Date.now()}-${Math.random().toString(36).slice(2,12)}`
/**
 * Status changes go through the audited, idempotent database function so every change leaves an
 * event (who, when, note). Domain refusals (the assignment moved on, wrong role) throw a
 * ServiceError with a plain sentence; a replayed key is success.
 */
export async function transitionAssignment(id,action,{note=null,reasonCode=null,key=newKey(),clientAt=null}={}){
 const rule=TRANSITIONS[action]
 if(!rule)throw new ServiceError('Unknown assignment action')
 if(rule.noteRequired&&!String(note||'').trim())throw new ServiceError(reasonMessage('note_required'))
 if(action==='block'&&!BLOCK_REASONS.includes(reasonCode))throw new ServiceError(reasonMessage('reason_required'))
 let data
 try{data=unwrap(await supabase.rpc('workforce_assignment_transition',{p_assignment_id:id,p_action:action,p_idempotency_key:key,p_note:String(note||'').trim()||null,p_client_at:clientAt,p_reason_code:action==='block'?reasonCode:null}))}
 catch(e){
  // No untraceable fallback: a status change without its audit event is worse than no change.
  if(isNotProvisioned(e))throw new ServiceError(NOT_INSTALLED,e.code,e)
  throw e
 }
 if(!data||data.ok!==true)throw new ServiceError(reasonMessage(data?.reason,data?.current_status),data?.reason)
 return data
}
export async function listAssignmentEvents(assignmentId){
 const cols='id,action,from_status,to_status,note,actor_id,effective_at,occurred_at,reason_code,from_assignee,to_assignee,detail'
 const r=await supabase.from('workforce_assignment_events').select(cols).eq('assignment_id',assignmentId).order('effective_at',{ascending:true}).order('occurred_at',{ascending:true}).limit(500)
 if(r.error&&isMissingColumn(r.error))return unwrap(await supabase.from('workforce_assignment_events').select('id,action,from_status,to_status,note,actor_id,effective_at').eq('assignment_id',assignmentId).order('effective_at',{ascending:true}).limit(500))
 return unwrap(r)
}
/** Historical effort estimate for a new assignment. Never throws for 'no history': returns the engine's honest state. */
export async function getDurationEstimate({task_type,vehicle_type=null,role=null}){
 if(!String(task_type||'').trim())return pickEstimate(null)
 try{
  const data=unwrap(await supabase.rpc('workforce_duration_estimate',{p_task_type:task_type,p_vehicle_type:vehicle_type||null,p_role:role||null}))
  return pickEstimate(data)
 }catch(e){
  if(isNotProvisioned(e))return {status:'unavailable',message:'Estimates are not available until the latest database update is installed.'}
  throw e
 }
}

export async function listWorkDependencies() {
 return unwrap(await supabase.from('workforce_dependencies').select('id,predecessor_id,successor_id,created_at').order('created_at',{ascending:false}).limit(500))
}
export async function addWorkDependency(predecessor_id,successor_id) {
 if(!predecessor_id||!successor_id||predecessor_id===successor_id) throw new ServiceError('Choose two different assignments')
 return unwrap(await supabase.from('workforce_dependencies').insert({predecessor_id,successor_id}).select('id,predecessor_id,successor_id').single())
}
export async function listWorkStandards() {
 return unwrap(await supabase.from('workforce_work_standards').select('id,work_type,role_name,unit_name,minutes_per_unit,sample_count,confidence,approved_at').order('work_type').limit(500))
}
export async function addWorkStandard({work_type,role_name,minutes_per_unit,unit_name='unit'}) {
 if(!work_type?.trim()||!(Number(minutes_per_unit)>0)) throw new ServiceError('Valid standard and time required')
 return unwrap(await supabase.from('workforce_work_standards').insert({work_type:work_type.trim(),role_name:role_name||null,unit_name,minutes_per_unit:Number(minutes_per_unit),confidence:'provisional'}).select().single())
}
