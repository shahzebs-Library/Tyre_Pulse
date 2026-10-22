import {supabase,unwrap,ServiceError,fetchAllPages,isMissingColumn,isNotProvisioned} from './_client'
import {TRANSITIONS,reasonMessage} from '../workforceTransitions'
import {pickEstimate} from '../workforceEstimate'
export const BASE_COLUMNS='id,organisation_id,assigned_to,assigned_by,title,instructions,site,priority,status,due_at,estimated_minutes,source_module,source_record_id,created_at,updated_at'
export const CLASSIFIED_COLUMNS=BASE_COLUMNS+',task_type,vehicle_type,assignee_role'
export const COLUMNS=CLASSIFIED_COLUMNS
export async function listWorkforceAssignments({mine=false,status=null,limit=300}={}) {
 if(limit<1||limit>500) throw new ServiceError('Invalid page size')
 let userId=null
 if(mine){const {data:{user}}=await supabase.auth.getUser();if(!user)throw new ServiceError('Sign in required');userId=user.id}
 const build=cols=>{let q=supabase.from('workforce_assignments').select(cols).order('created_at',{ascending:false}).limit(limit);if(status)q=q.eq('status',status);if(userId)q=q.eq('assigned_to',userId);return q}
 // A database that has not yet had the classification migration lacks three columns; PostgREST fails the whole request.
 const first=await build(CLASSIFIED_COLUMNS)
 if(first.error&&isMissingColumn(first.error))return unwrap(await build(BASE_COLUMNS))
 return unwrap(first)
}
export async function assignWork(values) {
 if(!values.title?.trim()||!values.assigned_to) throw new ServiceError('Employee and task title required')
 const payload={title:values.title.trim(),assigned_to:values.assigned_to,instructions:values.instructions||null,site:values.site||null,priority:values.priority||'normal',due_at:values.due_at||null,estimated_minutes:values.estimated_minutes||null,source_module:values.source_module||null,source_record_id:values.source_record_id||null}
 // Classification is sent only when provided, so an unmigrated database still accepts ordinary assignments.
 if(values.task_type?.trim())payload.task_type=values.task_type.trim()
 if(values.vehicle_type?.trim())payload.vehicle_type=values.vehicle_type.trim()
 return unwrap(await supabase.from('workforce_assignments').insert(payload).select(BASE_COLUMNS).single())
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
export async function transitionAssignment(id,action,{note=null,key=newKey(),clientAt=null}={}){
 const rule=TRANSITIONS[action]
 if(!rule)throw new ServiceError('Unknown assignment action')
 if(rule.noteRequired&&!String(note||'').trim())throw new ServiceError(reasonMessage('note_required'))
 let data
 try{data=unwrap(await supabase.rpc('workforce_assignment_transition',{p_assignment_id:id,p_action:action,p_idempotency_key:key,p_note:String(note||'').trim()||null,p_client_at:clientAt}))}
 catch(e){
  if(!isNotProvisioned(e))throw e
  // Function not installed yet: plain guarded status change (no audit event, no note).
  if(rule.noteRequired)throw new ServiceError('This action needs the latest database update before notes can be recorded.')
  const rows=unwrap(await supabase.from('workforce_assignments').update({status:rule.to}).eq('id',id).in('status',rule.from).select('id'))
  if(!rows?.length)throw new ServiceError(reasonMessage('invalid_transition'))
  return {ok:true,result:'applied',status:rule.to,legacy:true}
 }
 if(!data||data.ok!==true)throw new ServiceError(reasonMessage(data?.reason,data?.current_status),data?.reason)
 return data
}
export async function listAssignmentEvents(assignmentId){
 return unwrap(await supabase.from('workforce_assignment_events').select('id,action,from_status,to_status,note,actor_id,effective_at').eq('assignment_id',assignmentId).order('effective_at',{ascending:true}).limit(200))
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
