import {describe,it,expect} from 'vitest'
import {estimateWork,summarizeWorkday,dailySubmissionStatus} from '../lib/workforceIntelligence'
import {workforceBoardKpis,verifiedDeliveryMetrics} from '../lib/workforceAnalytics'
const t=(hh)=>'2026-10-22T'+hh+':00+03:00'
describe('workforce cross-module acceptance invariants',()=>{
 it('keeps unrecorded time unknown when real staff work was partly captured',()=>{
  const day=summarizeWorkday({shift_start:t('08:00'),shift_end:t('16:00'),activities:[
   {category:'productive',started_at:t('08:00'),ended_at:t('10:00')},
   {category:'blocked',reason:'parts shortage',started_at:t('10:00'),ended_at:t('11:00')},
   {category:'reporting',started_at:t('15:00'),ended_at:t('16:00')}
  ]})
  expect(day.valid).toBe(true)
  expect(day.unattributed_minutes).toBe(240)
  expect(day.minutes.blocked).toBe(60)
  expect(day.minutes.unassigned).toBe(0)
 })
 it('does not penalize external block time within estimated elapsed duration',()=>{
  const x=estimateWork({quantity:4,standard_minutes:30,complexity_factor:1.2,verified_external_delay_minutes:45,actual_elapsed_minutes:189,standard_approved:true})
  expect(x.effort_minutes).toBe(144)
  expect(x.unexplained_variance_minutes).toBe(0)
  expect(x.automated_personnel_decision).toBe(false)
 })
 it('does not turn missing daily submission and unverified tasks into zero performance',()=>{
  expect(dailySubmissionStatus({shift_ended:true})).toBe('missing_submission')
  expect(verifiedDeliveryMetrics([{status:'assigned'},{status:'blocked'},{status:'submitted'}]).performance_score).toBeNull()
  expect(workforceBoardKpis([{status:'blocked'}],[{status:'submitted'}]).reports_pending).toBe(1)
 })
})
