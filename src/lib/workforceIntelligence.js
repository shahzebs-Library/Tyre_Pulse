/**
 * Workforce Intelligence foundation: deterministic, explainable time accounting.
 * Pure functions only. Does not make employee performance or disciplinary decisions.
 * All instants must be ISO 8601 with offsets or Z. Unknown intervals remain unknown,
 * not unproductive. External delays are kept separate from verified work time.
 */
export const WORK_CATEGORIES = Object.freeze([
  'productive','coordination','reporting','training','break','blocked','unassigned'
])
export const REPORT_STATES = Object.freeze(['draft','submitted','returned','verified'])
const good = n => typeof n === 'number' && Number.isFinite(n)
const epoch = v => {
  if (typeof v !== 'string' || !/(Z|[+-]\d\d:\d\d)$/i.test(v)) return null
  const n=Date.parse(v)
  return Number.isFinite(n)?n:null
}
const round = x => Math.round(x*100)/100
export function validateActivity(activity) {
  if (!activity || !WORK_CATEGORIES.includes(activity.category)) return 'Unknown activity category'
  const a=epoch(activity.started_at), b=epoch(activity.ended_at)
  if (a===null || b===null || b<=a) return 'Invalid interval or missing timezone'
  if (activity.category==='blocked' && !String(activity.reason||'').trim()) return 'Blocked time requires a reason'
  return null
}
/**
 * Returns classified minutes and coverage. Overlapping input is reported rather
 * than summed, so duplicate timers cannot inflate work minutes.
 */
export function summarizeWorkday({shift_start,shift_end,activities=[],excluded_break_minutes=0}={}) {
  const start=epoch(shift_start), end=epoch(shift_end)
  if(start===null||end===null||end<=start) throw new Error('Valid shift timestamps required')
  if(!good(excluded_break_minutes)||excluded_break_minutes<0) throw new Error('Invalid break allowance')
  const errors=[], intervals=[],minutes=Object.fromEntries(WORK_CATEGORIES.map(x=>[x,0]))
  for(const [i,a] of activities.entries()){
    const problem=validateActivity(a)
    if(problem){errors.push({index:i,message:problem});continue}
    const from=epoch(a.started_at),to=epoch(a.ended_at)
    if(from<start||to>end){errors.push({index:i,message:'Activity outside shift'});continue}
    intervals.push({...a,from,to,index:i})
  }
  intervals.sort((a,b)=>a.from-b.from||a.to-b.to)
  for(let i=1;i<intervals.length;i++) if(intervals[i].from<intervals[i-1].to)
    errors.push({index:intervals[i].index,message:'Overlapping activity'})
  if(errors.length) return {valid:false,errors,minutes:null}
  for(const a of intervals) minutes[a.category]+=(a.to-a.from)/60000
  for(const k of WORK_CATEGORIES) minutes[k]=round(minutes[k])
  const recorded=round(Object.values(minutes).reduce((a,b)=>a+b,0))
  const shift=round((end-start)/60000)
  // A scheduled break allowance and a recorded break may describe the same
  // minutes. Exclude the larger of the two, never both.
  const excludedBreak=round(Math.min(shift,Math.max(excluded_break_minutes,minutes.break)))
  const available=round(Math.max(0,shift-excludedBreak))
  const unattributed=round(Math.max(0,shift-recorded))
  const productive=round(minutes.productive+minutes.coordination+minutes.reporting)
  const utilizationDenominator=available
  return {valid:true,errors:[],minutes,shift_minutes:shift,available_minutes:available,
    recorded_minutes:recorded,unattributed_minutes:unattributed,
    productive_minutes:productive,
    utilization_pct:utilizationDenominator>0?round(100*productive/utilizationDenominator):null,
    coverage_pct:round(100*recorded/shift)}
}
/** Estimate using an APPROVED standard; complexity must be explicitly configured.
 * No fabricated AI confidence value. External wait increases elapsed estimate,
 * but never counts as direct work effort.
 */
export function estimateWork({quantity,standard_minutes,complexity_factor=1,setup_minutes=0,verified_external_delay_minutes=0,actual_elapsed_minutes=null,standard_approved=false}={}) {
  if(![quantity,standard_minutes,complexity_factor,setup_minutes,verified_external_delay_minutes].every(good) ||
    quantity<=0||standard_minutes<=0||complexity_factor<=0||setup_minutes<0||verified_external_delay_minutes<0)
    throw new Error('Invalid estimate inputs')
  const effort_minutes=round(quantity*standard_minutes*complexity_factor+setup_minutes)
  const expected_elapsed_minutes=round(effort_minutes+verified_external_delay_minutes)
  if(actual_elapsed_minutes!==null&&(!good(actual_elapsed_minutes)||actual_elapsed_minutes<0))
    throw new Error('Invalid actual duration')
  const unexplained_variance_minutes=actual_elapsed_minutes===null?null:round(actual_elapsed_minutes-expected_elapsed_minutes)
  return {effort_minutes,expected_elapsed_minutes,unexplained_variance_minutes,
    estimation_basis:standard_approved?'approved_standard':'unapproved_provisional',
    confidence:null,requires_human_review:unexplained_variance_minutes!==null&&unexplained_variance_minutes>0,
    automated_personnel_decision:false}
}
export function dailySubmissionStatus({shift_ended=false,submitted_at=null,review_state='draft'}={}) {
  if(!REPORT_STATES.includes(review_state)) throw new Error('Unknown review status')
  if(review_state==='verified') return 'verified'
  if(review_state==='returned') return 'returned_for_correction'
  if(submitted_at) return 'awaiting_review'
  return shift_ended?'missing_submission':'not_due'
}
