/**
 * Pure-logic tests for lib/workshopLive.ts (technician live-status engine).
 * Deterministic: every call passes an explicit numeric `now`.
 */
import {
  statusFromEvents,
  isCheckedIn,
  myProductivityToday,
  statusKind,
  statusLabel,
  WorkshopEventLike,
} from '../lib/workshopLive'

const MIN = 60_000
const ev = (event_type: string, atMin: number, reason_code?: string): WorkshopEventLike => ({
  event_type,
  reason_code: reason_code ?? null,
  at: atMin * MIN,
})

describe('statusFromEvents', () => {
  it('defaults to available when present and absent when not, with no events', () => {
    expect(statusFromEvents([], { present: true })).toBe('available')
    expect(statusFromEvents([], { present: false })).toBe('absent')
    expect(statusFromEvents(null, {})).toBe('absent')
  })

  it('reflects the latest duty/job event', () => {
    expect(statusFromEvents([ev('check_in', 0), ev('start_job', 10)])).toBe('working')
    expect(statusFromEvents([ev('start_job', 0), ev('start_break', 5)])).toBe('on_break')
    expect(statusFromEvents([ev('start_job', 0), ev('complete_task', 5)])).toBe('awaiting_inspection')
    expect(statusFromEvents([ev('check_in', 0), ev('check_out', 30)])).toBe('off_duty')
  })

  it('resolves a pause_job by its blocked reason_code', () => {
    expect(statusFromEvents([ev('start_job', 0), ev('pause_job', 5, 'parts')])).toBe('waiting_parts')
    expect(statusFromEvents([ev('start_job', 0), ev('pause_job', 5, 'tools')])).toBe('waiting_tools')
    expect(statusFromEvents([ev('start_job', 0), ev('pause_job', 5, 'break')])).toBe('on_break')
    // Unknown reason falls back to available.
    expect(statusFromEvents([ev('start_job', 0), ev('pause_job', 5, 'other')])).toBe('available')
  })

  it('treats request_assistance / report_problem as annotations that do not change status', () => {
    expect(
      statusFromEvents([ev('start_job', 0), ev('request_assistance', 5), ev('report_problem', 6)]),
    ).toBe('working')
  })
})

describe('isCheckedIn', () => {
  it('is true after check_in and false after check_out', () => {
    expect(isCheckedIn([ev('check_in', 0)])).toBe(true)
    expect(isCheckedIn([ev('check_in', 0), ev('check_out', 60)])).toBe(false)
    // Job events between check_in/out do not toggle duty.
    expect(isCheckedIn([ev('check_in', 0), ev('start_job', 10)])).toBe(true)
  })

  it('is false with no duty events', () => {
    expect(isCheckedIn([])).toBe(false)
    expect(isCheckedIn(null)).toBe(false)
  })
})

describe('myProductivityToday', () => {
  it('splits duty into productive / blocked / unassigned and counts completed jobs', () => {
    // start_job@0 -> productive until request_parts@60 (60 min productive)
    // request_parts@60 -> blocked:parts until resume_job@90 (30 min blocked)
    // resume_job@90 -> productive until complete_task@150 (60 min productive)
    const events = [
      ev('start_job', 0),
      ev('request_parts', 60),
      ev('resume_job', 90),
      ev('complete_task', 150),
    ]
    const p = myProductivityToday(events, { now: 150 * MIN })
    expect(p.productiveMin).toBe(120)
    expect(p.blockedMin).toBe(30)
    expect(p.breakMin).toBe(0)
    expect(p.unassignedMin).toBe(0)
    expect(p.jobsCompleted).toBe(1)
  })

  it('returns zeroed metrics for no events', () => {
    const p = myProductivityToday([], { now: 100 * MIN })
    expect(p).toEqual({
      productiveMin: 0,
      blockedMin: 0,
      unassignedMin: 0,
      breakMin: 0,
      jobsCompleted: 0,
    })
  })
})

describe('status presentation helpers', () => {
  it('maps status to a theme StatusKind', () => {
    expect(statusKind('working')).toBe('success')
    expect(statusKind('waiting_parts')).toBe('warning')
    expect(statusKind('absent')).toBe('danger')
    expect(statusKind('off_duty')).toBe('neutral')
  })

  it('gives a human label, defaulting safely', () => {
    expect(statusLabel('working')).toBe('Working')
    expect(statusLabel('waiting_approval')).toBe('Waiting for Approval')
  })
})
