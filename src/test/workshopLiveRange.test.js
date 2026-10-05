import { describe, it, expect } from 'vitest'
import {
  rangePreset, matchPreset, normalizeRange, rangeLabel, rangeDays, isTodayRange,
  localDayKey, buildRangeDays, computeRangeMeasures, MAX_RANGE_DAYS,
} from '../lib/workshopAnalytics.js'
import { buildBoard, computeKpis, delayBreakdown } from '../lib/workshopLive.js'

// All times are LOCAL wall clock: the live board's day edge is local midnight.
const local = (d, h, m = 0) => new Date(2026, 9, d, h, m).getTime() // October 2026
const iso = (d, h, m = 0) => new Date(local(d, h, m)).toISOString()
const NOW = local(5, 14, 0) // 5 Oct 2026, 14:00

const TECHS = [
  { id: 'u1', name: 'Omar Haddad', full_name: 'Omar Haddad', site: 'NHC' },
  { id: 'u2', name: 'Layla Kareem', full_name: 'Layla Kareem', site: 'JED' },
]

// Today's live inputs (what loadLiveBoard hands the page).
const TODAY_EVENTS = {
  u1: [
    { id: 't1', user_id: 'u1', event_type: 'check_in', at: iso(5, 8) },
    { id: 't2', user_id: 'u1', event_type: 'start_job', job_id: 'J1', at: iso(5, 8) },
    { id: 't3', user_id: 'u1', event_type: 'request_parts', reason_code: 'parts', at: iso(5, 10) },
    { id: 't4', user_id: 'u1', event_type: 'resume_job', job_id: 'J1', at: iso(5, 11) },
  ],
  u2: [
    { id: 't5', user_id: 'u2', event_type: 'check_in', at: iso(5, 9) },
    { id: 't6', user_id: 'u2', event_type: 'start_job', job_id: 'J2', at: iso(5, 9) },
  ],
}
const TODAY_SHIFTS = {
  u1: { start: `2026-10-05T07:00:00`, end: `2026-10-05T12:00:00`, label: '07:00 to 12:00' },
}
const PRESENT = { u1: true, u2: true }
const LIVE_JOBS = [
  { id: 'J1', status: 'In Progress', site: 'NHC', labour_rate: 150 },
  { id: 'J9', status: 'Completed', site: 'NHC', completed_at: iso(5, 9, 30) },
  { id: 'J8', status: 'Completed', site: 'JED', completed_at: iso(5, 12) },
]

describe('workshop live date range: quick picks and labels', () => {
  it('resolves the four quick picks in local days', () => {
    expect(rangePreset('today', NOW)).toEqual({ from: '2026-10-05', to: '2026-10-05' })
    expect(rangePreset('yesterday', NOW)).toEqual({ from: '2026-10-04', to: '2026-10-04' })
    expect(rangePreset('last7', NOW)).toEqual({ from: '2026-09-29', to: '2026-10-05' })
    expect(rangePreset('month', NOW)).toEqual({ from: '2026-10-01', to: '2026-10-05' })
    expect(rangePreset('nonsense', NOW)).toEqual({ from: '2026-10-05', to: '2026-10-05' })
    expect(matchPreset({ from: '2026-09-29', to: '2026-10-05' }, NOW)).toBe('last7')
    expect(matchPreset({ from: '2026-09-02', to: '2026-09-03' }, NOW)).toBeNull()
    expect(isTodayRange({ from: '2026-10-05', to: '2026-10-05' }, NOW)).toBe(true)
  })

  it('names the window plainly, never "this period"', () => {
    expect(rangeLabel('2026-10-01', '2026-10-05')).toBe('1 to 5 Oct 2026')
    expect(rangeLabel('2026-10-05', '2026-10-05')).toBe('5 Oct 2026')
    expect(rangeLabel('2026-09-28', '2026-10-05')).toBe('28 Sep to 5 Oct 2026')
    expect(rangeLabel('2025-12-28', '2026-01-03')).toBe('28 Dec 2025 to 3 Jan 2026')
    expect(rangeLabel('', 'x')).toBe('No dates chosen')
  })

  it('normalises user input: swaps, stops at today, caps the span', () => {
    expect(normalizeRange({ from: '2026-10-04', to: '2026-10-02' }, NOW)).toEqual({ from: '2026-10-02', to: '2026-10-04' })
    expect(normalizeRange({ from: '2026-10-03', to: '2026-12-31' }, NOW)).toEqual({ from: '2026-10-03', to: '2026-10-05' })
    expect(normalizeRange({ from: 'junk', to: '' }, NOW)).toEqual({ from: '2026-10-05', to: '2026-10-05' })
    const wide = normalizeRange({ from: '2020-01-01', to: '2026-10-05' }, NOW)
    expect(rangeDays(wide.from, wide.to)).toHaveLength(MAX_RANGE_DAYS)
    expect(rangeDays('2026-09-30', '2026-10-02')).toEqual(['2026-09-30', '2026-10-01', '2026-10-02'])
  })
})

describe('workshop live date range: measured figures', () => {
  it('a Today range fed the live inputs equals the live board figures exactly', () => {
    const todayStart = local(5, 0)
    const board = buildBoard(TECHS, TODAY_EVENTS, { now: NOW, shiftByUser: TODAY_SHIFTS, presentByUser: PRESENT })
    const live = computeKpis(board, LIVE_JOBS, { now: NOW, todayStart })
    const liveDelays = delayBreakdown(board, { jobs: LIVE_JOBS, labourRate: 100 })

    const m = computeRangeMeasures({
      technicians: TECHS,
      days: [{ day: '2026-10-05', now: NOW, eventsByUser: TODAY_EVENTS, shiftByUser: TODAY_SHIFTS, presentByUser: PRESENT }],
      completedJobs: LIVE_JOBS,
      from: '2026-10-05', to: '2026-10-05', now: NOW, labourRate: 100, rateJobs: LIVE_JOBS,
    })
    expect(m.label).toBe('5 Oct 2026')
    expect(m.hasActivity).toBe(true)
    expect(m.completed).toBe(live.jobsCompletedToday)
    expect(m.completed).toBe(2)
    expect(m.productiveHours).toBe(live.productiveHours)
    expect(m.lostHours).toBe(live.lostHours)
    expect(m.overtimeHours).toBe(live.overtimeHours)
    expect(m.utilization).toBe(live.utilization)
    expect(m.delays).toEqual(liveDelays)
    // Sanity on the fixture: real productive and parts time, not an all-zero match.
    expect(live.productiveHours).toBeGreaterThan(0)
    expect(liveDelays.map((d) => d.reason)).toEqual(['parts'])
  })

  it('rolls a multi-day range up per local day and closes past days at their own end', () => {
    const events = [
      // 3 Oct: Omar works 08:00 to 10:00 then checks out.
      { id: 'a1', user_id: 'u1', event_type: 'check_in', at: iso(3, 8) },
      { id: 'a2', user_id: 'u1', event_type: 'start_job', job_id: 'J1', at: iso(3, 8) },
      { id: 'a3', user_id: 'u1', event_type: 'check_out', at: iso(3, 10) },
      // 4 Oct: Layla starts a job at 22:00 and never logs again. The day closes
      // at local midnight, so it is 2 hours, never 16 hours into today.
      { id: 'b1', user_id: 'u2', event_type: 'check_in', at: iso(4, 22) },
      { id: 'b2', user_id: 'u2', event_type: 'start_job', job_id: 'J2', at: iso(4, 22) },
      // Outside the range: ignored.
      { id: 'c1', user_id: 'u1', event_type: 'start_job', job_id: 'J1', at: iso(1, 8) },
    ]
    const days = buildRangeDays({ technicians: TECHS, events, shifts: [], from: '2026-10-03', to: '2026-10-04', now: NOW })
    expect(days.map((d) => d.day)).toEqual(['2026-10-03', '2026-10-04'])
    expect(days[0].eventCount).toBe(3)
    expect(days[1].now).toBe(local(5, 0))
    expect(days[1].presentByUser).toEqual({})

    const completed = [
      { id: 'X1', status: 'Completed', site: 'NHC', completed_at: iso(3, 10) },
      { id: 'X2', status: 'Completed', site: 'NHC', completed_at: iso(5, 9) }, // outside the range
      { id: 'X3', status: 'In Progress', site: 'NHC', completed_at: iso(4, 9) }, // not completed
    ]
    const m = computeRangeMeasures({ technicians: TECHS, days, completedJobs: completed, from: '2026-10-03', to: '2026-10-04', now: NOW })
    expect(m.label).toBe('3 to 4 Oct 2026')
    expect(m.completed).toBe(1)
    expect(m.productiveHours).toBe(4) // 2h on 3 Oct + 2h on 4 Oct
    expect(m.eventCount).toBe(5)
  })

  it('reads a past day roster as local wall-clock time', () => {
    const events = [
      { id: 'a1', user_id: 'u1', event_type: 'check_in', at: iso(3, 8) },
      { id: 'a2', user_id: 'u1', event_type: 'start_job', job_id: 'J1', at: iso(3, 8) },
      { id: 'a3', user_id: 'u1', event_type: 'check_out', at: iso(3, 12) },
    ]
    const shifts = [{ person_name: 'Omar Haddad', shift_date: '2026-10-03', start_time: '08:00', end_time: '16:00' }]
    const days = buildRangeDays({ technicians: TECHS, events, shifts, from: '2026-10-03', to: '2026-10-03', now: NOW })
    const m = computeRangeMeasures({ technicians: TECHS, days, from: '2026-10-03', to: '2026-10-03', now: NOW, site: 'NHC' })
    // 4 productive hours of an 8 hour shift.
    expect(m.utilization).toBe(50)
  })

  it('reports an empty range as not measurable, never as 0', () => {
    const days = buildRangeDays({ technicians: TECHS, events: [], shifts: [], from: '2026-10-01', to: '2026-10-02', now: NOW })
    const m = computeRangeMeasures({
      technicians: TECHS, days, from: '2026-10-01', to: '2026-10-02', now: NOW,
      completedJobs: [{ id: 'X', status: 'Completed', completed_at: iso(2, 9) }],
    })
    expect(m.hasActivity).toBe(false)
    expect(m.utilization).toBeNull()
    expect(m.productiveHours).toBeNull()
    expect(m.lostHours).toBeNull()
    expect(m.overtimeHours).toBeNull()
    expect(m.delays).toEqual([])
    expect(m.completed).toBe(1) // completed job cards are still a real count
  })

  it('applies the site filter to technicians and completed jobs', () => {
    const m = computeRangeMeasures({
      technicians: TECHS,
      days: [{ day: '2026-10-05', now: NOW, eventsByUser: TODAY_EVENTS, shiftByUser: {}, presentByUser: PRESENT }],
      completedJobs: LIVE_JOBS,
      from: '2026-10-05', to: '2026-10-05', now: NOW, site: 'JED',
    })
    expect(m.techDays).toBe(1)
    expect(m.completed).toBe(1)
    expect(m.eventCount).toBe(2)
  })

  it('stops a range at today: no future days are rolled up', () => {
    const days = buildRangeDays({ technicians: TECHS, events: [], from: '2026-10-04', to: '2026-10-09', now: NOW })
    expect(days.map((d) => d.day)).toEqual(['2026-10-04', '2026-10-05'])
    expect(localDayKey(NOW)).toBe('2026-10-05')
  })
})
