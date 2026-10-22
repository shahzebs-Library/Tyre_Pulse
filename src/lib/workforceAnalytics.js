/**
 * Workforce reporting uses observed, verified work only.
 * A missing report is NEVER a zero-productivity day.
 * A requested or blocked item is NOT counted as failed delivery.
 */
export function workforceBoardKpis(assignments=[],reports=[]){
 const count=(status)=>assignments.filter(x=>x.status===status).length
 const now=new Date()
 const overdue=assignments.filter(x=>x.due_at&&Date.parse(x.due_at)<now.getTime()&&!['verified','cancelled'].includes(x.status)).length
 return {
  assigned:count('assigned'),active:count('in_progress'),blocked:count('blocked'),
  pending_verification:count('submitted'),verified:count('verified'),overdue,
  reports_pending:reports.filter(x=>x.status==='submitted').length,
  reports_verified:reports.filter(x=>x.status==='verified').length
 }
}
export function verifiedDeliveryMetrics(assignments=[]){
 const assessed=assignments.filter(x=>['verified','cancelled'].includes(x.status))
 const verified=assessed.filter(x=>x.status==='verified').length
 return {assessed_count:assessed.length,verified_count:verified,
  verified_completion_pct:assessed.length?Math.round(verified/assessed.length*1000)/10:null,
  // Without actual time, quality reviews and blocked reasons, do not create a productivity score.
  performance_score:null}
}
export function assignmentStatusSeries(assignments=[]){
 const states=['assigned','acknowledged','in_progress','blocked','submitted','verified','cancelled']
 return states.map(status=>({status,count:assignments.filter(x=>x.status===status).length}))
}
