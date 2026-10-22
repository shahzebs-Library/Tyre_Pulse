import { describe,it,expect } from 'vitest'
import {summarizeWorkday,estimateWork,dailySubmissionStatus} from '../lib/workforceIntelligence'
const start='2026-10-22T08:00:00+03:00'
const end='2026-10-22T16:00:00+03:00'
const a=(x,y,category,reason)=>({started_at:`2026-10-22T${x}:00+03:00`,ended_at:`2026-10-22T${y}:00+03:00`,category,reason})
describe('workforce intelligence',()=>{
  it('retains unrecorded shift time as unknown, not idle',()=>{
    const r=summarizeWorkday({shift_start:start,shift_end:end,activities:[a('08:00','10:00','productive')]})
    expect(r.valid).toBe(true);expect(r.unattributed_minutes).toBe(360)
    expect(r.minutes.unassigned).toBe(0)
  })
  it('rejects overlapping work and blocked intervals without a reason',()=>{
    expect(summarizeWorkday({shift_start:start,shift_end:end,activities:[a('08:00','10:00','productive'),a('09:00','11:00','reporting')]}).valid).toBe(false)
    expect(summarizeWorkday({shift_start:start,shift_end:end,activities:[a('09:00','10:00','blocked')]}).valid).toBe(false)
  })
  it('does not treat verified external delays as worker inefficiency',()=>{
    const r=estimateWork({quantity:5,standard_minutes:30,verified_external_delay_minutes:30,actual_elapsed_minutes:180,standard_approved:true})
    expect(r.effort_minutes).toBe(150);expect(r.unexplained_variance_minutes).toBe(0)
    expect(r.automated_personnel_decision).toBe(false)
  })
  it('does not invent confidence for an unapproved standard',()=>{
    const r=estimateWork({quantity:1,standard_minutes:40,actual_elapsed_minutes:60})
    expect(r.estimation_basis).toBe('unapproved_provisional')
    expect(r.confidence).toBe(null);expect(r.requires_human_review).toBe(true)
  })
  it('separates missing submission from returned and approved work',()=>{
    expect(dailySubmissionStatus({shift_ended:true})).toBe('missing_submission')
    expect(dailySubmissionStatus({submitted_at:'2026-10-22T16:02:00+03:00'})).toBe('awaiting_review')
    expect(dailySubmissionStatus({review_state:'verified'})).toBe('verified')
  })
})
