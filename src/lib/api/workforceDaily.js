import {supabase,unwrap,ServiceError,isMissingColumn,toServiceError} from './_client'
import {summarizeWorkday} from '../workforceIntelligence'
import {ENTRY_CATEGORIES,REASON_CATEGORIES} from '../workforceTimeAccounting'
/** Every category the database accepts after 20261109170000 (legacy values included). */
export const DAILY_ENTRY_CATEGORIES=ENTRY_CATEGORIES
export const DAILY_REASON_CATEGORIES=REASON_CATEGORIES
export const REPORT_COLS='id,organisation_id,employee_id,work_date,site,summary,next_actions,status,submitted_at,reviewed_at,reviewed_by,review_note,created_at,updated_at'
export const ENTRY_COLS='id,report_id,employee_id,title,details,deliverable,source_type,source_id,category,started_at,ended_at,blocked_reason,created_at'
// Columns added by 20261109170000; reads fall back to ENTRY_COLS until that migration is applied.
export const ENTRY_COLS_V2=ENTRY_COLS+',assignment_id,correction_count,last_corrected_at,last_corrected_by'
export const CORRECTION_COLS='id,entry_id,report_id,employee_id,original,patch,corrected,reason,corrected_by,corrected_at'
async function selectEntries(reportId){
 const res=await supabase.from('workforce_daily_entries').select(ENTRY_COLS_V2).eq('report_id',reportId).order('started_at')
 if(res.error&&isMissingColumn(res.error)) return unwrap(await supabase.from('workforce_daily_entries').select(ENTRY_COLS).eq('report_id',reportId).order('started_at'))
 return unwrap(res)
}
export async function getMyDailyReport(date) {
 const {data:{user},error}=await supabase.auth.getUser()
 if(error||!user) throw new ServiceError('Sign in to view daily work')
 const {data,error:dbError}=await supabase.from('workforce_daily_reports').select(REPORT_COLS).eq('employee_id',user.id).eq('work_date',date).maybeSingle()
 if(dbError) throw new ServiceError('Cannot load daily report',dbError.code,dbError)
 if(!data) return {report:null,entries:[]}
 return {report:data,entries:await selectEntries(data.id)}
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
 const reason=values.blocked_reason?.trim()||null
 const entry={report_id:report.id,employee_id:report.employee_id,title:values.title?.trim(),details:values.details?.trim()||'',deliverable:values.deliverable?.trim()||null,category:values.category,started_at:values.started_at,ended_at:values.ended_at,blocked_reason:REASON_CATEGORIES.includes(values.category)?reason:null}
 if(!entry.title) throw new ServiceError('Activity title required')
 if(!values.assignment_id) return unwrap(await supabase.from('workforce_daily_entries').insert(entry).select(ENTRY_COLS).single())
 const res=await supabase.from('workforce_daily_entries').insert({...entry,assignment_id:values.assignment_id}).select(ENTRY_COLS_V2).single()
 // Before 20261109170000 is applied the column does not exist: record the activity without the link
 // rather than losing it.
 if(res.error&&isMissingColumn(res.error)) return unwrap(await supabase.from('workforce_daily_entries').insert(entry).select(ENTRY_COLS).single())
 return unwrap(res)
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
 const entries=await selectEntries(id)
 return {report,entries}
}

/**
 * Authorised correction of a recorded activity (manager only, never their own, report submitted or
 * returned). The server keeps the original in an append-only ledger and re-runs every interval rule.
 * Pass the same idempotencyKey on retry; a replay returns the first result with replayed:true.
 */
export async function correctDailyEntry(entryId,patch,reason,idempotencyKey){
 if(!entryId) throw new ServiceError('Activity id required')
 if(!patch||typeof patch!=='object'||!Object.keys(patch).length) throw new ServiceError('Nothing to correct')
 if(!reason?.trim()||reason.trim().length<5) throw new ServiceError('A correction reason is required')
 if(typeof idempotencyKey!=='string'||idempotencyKey.trim().length<8) throw new ServiceError('A valid idempotency key is required')
 const {data,error}=await supabase.rpc('workforce_correct_daily_entry',{p_entry_id:entryId,p_patch:patch,p_reason:reason.trim(),p_idempotency_key:idempotencyKey.trim()})
 if(error) throw toServiceError(error,'Could not save the correction')
 return data
}

/** Correction history for one activity, oldest first (the first row's `original` is the as-submitted entry). */
export async function listEntryCorrections(entryId){
 if(!entryId) throw new ServiceError('Activity id required')
 return unwrap(await supabase.from('workforce_daily_entry_corrections').select(CORRECTION_COLS).eq('entry_id',entryId).order('corrected_at',{ascending:true}).order('id',{ascending:true}))
}
