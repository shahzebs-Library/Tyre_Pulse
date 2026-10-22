import {supabase,unwrap,ServiceError} from './_client'
export const COLUMNS='id,organisation_id,assigned_to,assigned_by,title,instructions,site,priority,status,due_at,estimated_minutes,source_module,source_record_id,created_at,updated_at'
export async function listWorkforceAssignments({mine=false,status=null,limit=300}={}) {
 if(limit<1||limit>500) throw new ServiceError('Invalid page size')
 let q=supabase.from('workforce_assignments').select(COLUMNS).order('created_at',{ascending:false}).limit(limit)
 if(status) q=q.eq('status',status)
 if(mine){const {data:{user}}=await supabase.auth.getUser();if(!user)throw new ServiceError('Sign in required');q=q.eq('assigned_to',user.id)}
 return unwrap(await q)
}
export async function assignWork(values) {
 if(!values.title?.trim()||!values.assigned_to) throw new ServiceError('Employee and task title required')
 const payload={title:values.title.trim(),assigned_to:values.assigned_to,instructions:values.instructions||null,site:values.site||null,priority:values.priority||'normal',due_at:values.due_at||null,estimated_minutes:values.estimated_minutes||null,source_module:values.source_module||null,source_record_id:values.source_record_id||null}
 return unwrap(await supabase.from('workforce_assignments').insert(payload).select(COLUMNS).single())
}
export async function listAssignableEmployees(){
 const {data,error}=await supabase.from('profiles').select('id,full_name,role,site').order('id').limit(500)
 if(error) throw new ServiceError('Unable to load employees',error.code,error)
 return data
}
export async function setWorkStatus(id,status){
 if(!['assigned','acknowledged','in_progress','blocked','submitted','verified','cancelled'].includes(status))throw new ServiceError('Invalid work status')
 return unwrap(await supabase.from('workforce_assignments').update({status}).eq('id',id).select(COLUMNS).single())
}
