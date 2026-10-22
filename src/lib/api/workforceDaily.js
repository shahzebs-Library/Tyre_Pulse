import {supabase,unwrap,ServiceError} from './_client'
import {summarizeWorkday} from '../workforceIntelligence'
export const REPORT_COLS='id,organisation_id,employee_id,work_date,site,summary,next_actions,status,submitted_at,reviewed_at,reviewed_by,review_note,created_at,updated_at'
export const ENTRY_COLS='id,report_id,employee_id,title,details,deliverable,source_type,source_id,category,started_at,ended_at,blocked_reason,created_at'
export async function getMyDailyReport(date) {
 const {data:{user},error}=await supabase.auth.getUser()
 if(error||!user) throw new ServiceError('Sign in to view daily work')
 const {data,error:dbError}=await supabase.from('workforce_daily_reports').select(REPORT_COLS).eq('employee_id',user.id).eq('work_date',date).maybeSingle()
 if(dbError) throw new ServiceError('Cannot load daily report',dbError.code,dbError)
 if(!data) return {report:null,entries:[]}
 return {report:data,entries:unwrap(await supabase.from('workforce_daily_entries').select(ENTRY_COLS).eq('report_id',data.id).order('started_at'))}
}
export async function ensureDailyReport(date,site) {
 const existing=await getMyDailyReport(date)
 if(existing.report) return existing.report
 const {data:{user}}=await supabase.auth.getUser()
 if(!user) throw new ServiceError('Sign in required')
 return unwrap(await supabase.from('workforce_daily_reports').insert({work_date:date,site:site||null,employee_id:user.id}).select(REPORT_COLS).single())
}
export async function addDailyEntry(date,values) {
 const report=await ensureDailyReport(date,values.site)
 if(!['draft','returned'].includes(report.status)) throw new ServiceError('Report is locked for review')
 const entry={report_id:report.id,employee_id:report.employee_id,title:values.title?.trim(),details:values.details?.trim()||'',deliverable:values.deliverable?.trim()||null,category:values.category,started_at:values.started_at,ended_at:values.ended_at,blocked_reason:values.category==='blocked'?values.blocked_reason:null}
 if(!entry.title) throw new ServiceError('Activity title required')
 return unwrap(await supabase.from('workforce_daily_entries').insert(entry).select(ENTRY_COLS).single())
}
export async function submitDailyReport(report,entries,summary,next_actions) {
 if(!report||!['draft','returned'].includes(report.status)) throw new ServiceError('Report is not editable')
 if(!summary?.trim()||!entries?.length) throw new ServiceError('Activity and a summary are required')
 // The client evaluates activity spans; database trigger enforces saved intervals.
 for(const e of entries) if(!e.started_at||!e.ended_at) throw new ServiceError('Incomplete activity interval')
 return unwrap(await supabase.from('workforce_daily_reports').update({summary:summary.trim(),next_actions:next_actions?.trim()||null,status:'submitted',submitted_at:new Date().toISOString()}).eq('id',report.id).select(REPORT_COLS).single())
}
export async function listReviewQueue() {
 return unwrap(await supabase.from('workforce_daily_reports').select(REPORT_COLS).eq('status','submitted').order('submitted_at',{ascending:true}).limit(200))
}
export async function reviewDailyReport(id,decision,note) {
 if(!['verified','returned'].includes(decision)) throw new ServiceError('Invalid review decision')
 const {data:{user}}=await supabase.auth.getUser()
 if(!user) throw new ServiceError('Sign in required')
 return unwrap(await supabase.from('workforce_daily_reports').update({status:decision,review_note:note?.trim()||null,reviewed_by:user.id,reviewed_at:new Date().toISOString()}).eq('id',id).eq('status','submitted').select(REPORT_COLS).single())
}
export function dailyReportMetrics(entries,shiftStart,shiftEnd) {
 return summarizeWorkday({shift_start:shiftStart,shift_end:shiftEnd,activities:entries})
}

export async function getDailyReportForReview(id){
 if(!id)throw new ServiceError('Report id required')
 const report=unwrap(await supabase.from('workforce_daily_reports').select(REPORT_COLS).eq('id',id).single())
 const entries=unwrap(await supabase.from('workforce_daily_entries').select(ENTRY_COLS).eq('report_id',id).order('started_at'))
 return {report,entries}
}
