import { describe, it, expect } from 'vitest'
import {
  computeWorkshopAnalytics, firstTimeFixRate, buildShiftIndex, daysInRange,
} from '../lib/workshopAnalytics.js'

// Two-day deterministic sample. Day 1 = 2026-07-18, Day 2 = 2026-07-19.
const day = (d, min) => new Date(`2026-07-${d}T06:00:00Z`).getTime() + min * 60000
const at = (d, min) => new Date(day(d, min)).toISOString()

const TECHS = [
  { id: 'u1', full_name: 'Ali Hassan' },
  { id: 'u2', full_name: 'Sara Noor' },
]

// Ali: day 18 productive 60, blocked (parts) 30, then resume 60. day 19 productive 120.
// Sara: day 18 productive 30 only.
const EVENTS = [
  // Ali - day 18
  { user_id: 'u1', event_type: 'check_in', at: at(18, 0) },
  { user_id: 'u1', event_type: 'start_job', at: at(18, 0), job_id: 'J1' },
  { user_id: 'u1', event_type: 'request_parts', at: at(18, 60), reason_code: 'parts' },
  { user_id: 'u1', event_type: 'resume_job', at: at(18, 90), job_id: 'J1' },
  { user_id: 'u1', event_type: 'complete_task', at: at(18, 150), job_id: 'J1' },
  { user_id: 'u1', event_type: 'check_out', at: at(18, 160) },
  // Ali - day 19
  { user_id: 'u1', event_type: 'check_in', at: at(19, 0) },
  { user_id: 'u1', event_type: 'start_job', at: at(19, 0), job_id: 'J2' },
  { user_id: 'u1', event_type: 'complete_task', at: at(19, 120), job_id: 'J2' },
  { user_id: 'u1', event_type: 'check_out', at: at(19, 130) },
  // Sara - day 18
  { user_id: 'u2', event_type: 'check_in', at: at(18, 0) },
  { user_id: 'u2', event_type: 'start_job', at: at(18, 0), job_id: 'J3' },
  { user_id: 'u2', event_type: 'complete_task', at: at(18, 30), job_id: 'J3' },
  { user_id: 'u2', event_type: 'check_out', at: at(18, 35) },
]

// 8h shift windows so utilization has a stable denominator.
const SHIFTS = [
  { person_name: 'Ali Hassan', shift_date: '2026-07-18', start_time: '06:00', end_time: '14:00' },
  { person_name: 'Ali Hassan', shift_date: '2026-07-19', start_time: '06:00', end_time: '14:00' },
  { person_name: 'Sara Noor', shift_date: '2026-07-18', start_time: '06:00', end_time: '14:00' },
]

const JOBS = [
  { id: 'J1', work_order_no: 'WO-1', status: 'completed', completed_at: at(18, 150), started_at: at(18, 0), standard_hours: 2 },
  { id: 'J2', work_order_no: 'WO-2', status: 'completed', completed_at: at(19, 120), started_at: at(19, 0), est_minutes: 90 },
  { id: 'J3', work_order_no: 'WO-3', status: 'completed', completed_at: at(18, 30), started_at: at(18, 0) },
]

const NOW = new Date('2026-07-20T00:00:00Z').getTime()
const RANGE = { from: '2026-07-18', to: '2026-07-19', now: NOW }

describe('workshopAnalytics engine', () => {
  it('builds a per-day trend across the multi-day range (sorted, real hours)', () => {
    const a = computeWorkshopAnalytics({ events: EVENTS, jobs: JOBS, shifts: SHIFTS, technicians: TECHS, ...RANGE })
    expect(a.dailyTrend.map((d) => d.date)).toEqual(['2026-07-18', '2026-07-19'])
    const d18 = a.dailyTrend[0]
    // Ali 120 productive + Sara 30 productive = 150 min = 2.5 h on day 18.
    expect(d18.productiveHours).toBe(2.5)
    // Ali parts block 30 min = 0.5 h.
    expect(d18.blockedHours).toBe(0.5)
    expect(d18.jobsCompleted).toBe(2) // J1 + J3 completed on day 18
    const d19 = a.dailyTrend[1]
    expect(d19.productiveHours).toBe(2) // Ali 120 min
    expect(d19.jobsCompleted).toBe(1)
  })

  it('utilization is a 0..100 percent for days with data and null when a day has none', () => {
    const a = computeWorkshopAnalytics({ events: EVENTS, jobs: JOBS, shifts: SHIFTS, technicians: TECHS, ...RANGE })
    for (const d of a.dailyTrend) {
      expect(d.utilization == null || (d.utilization >= 0 && d.utilization <= 100)).toBe(true)
    }
    // A range with NO events -> daily trend built only from completed jobs, util null.
    const b = computeWorkshopAnalytics({ events: [], jobs: JOBS, shifts: SHIFTS, technicians: TECHS, ...RANGE })
    expect(b.summary.avgUtilization).toBeNull()
    for (const d of b.dailyTrend) expect(d.utilization).toBeNull()
  })

  it('ranks technicians by productive hours (Ali ahead of Sara)', () => {
    const a = computeWorkshopAnalytics({ events: EVENTS, jobs: JOBS, shifts: SHIFTS, technicians: TECHS, ...RANGE })
    expect(a.technicianLeaderboard.map((t) => t.name)).toEqual(['Ali Hassan', 'Sara Noor'])
    expect(a.technicianLeaderboard[0].rank).toBe(1)
    expect(a.technicianLeaderboard[0].productiveHours).toBe(4) // 120 + 120 = 240 min
    expect(a.technicianLeaderboard[0].jobsCompleted).toBe(2)   // two complete_task events
    expect(a.technicianLeaderboard[1].rank).toBe(2)
  })

  it('aggregates delay cost by reason via the reused delayBreakdown engine', () => {
    const a = computeWorkshopAnalytics({ events: EVENTS, jobs: JOBS, shifts: SHIFTS, technicians: TECHS, ...RANGE })
    const parts = a.delayByReason.find((r) => r.reason === 'parts')
    expect(parts).toBeTruthy()
    expect(parts.hoursLost).toBe(0.5)
    expect(parts.costImpact).toBeGreaterThan(0)
    expect(a.delayCostTrend.find((r) => r.reason === 'parts').responsibleDept).toBeTruthy()
  })

  it('first-time-fix heuristic: a reopened job (report_problem after complete) is not first-time', () => {
    // J1 completed and never reopened; J4 completed then report_problem later.
    const ftfEvents = [
      { user_id: 'u1', event_type: 'complete_task', at: at(18, 100), job_id: 'JA' },
      { user_id: 'u1', event_type: 'complete_task', at: at(18, 100), job_id: 'JB' },
      { user_id: 'u1', event_type: 'report_problem', at: at(18, 200), job_id: 'JB' },
    ]
    const f = firstTimeFixRate(ftfEvents)
    expect(f.completed).toBe(2)
    expect(f.firstTime).toBe(1) // JA clean, JB reopened
    expect(f.reworked).toBe(1)
    expect(f.rate).toBe(0.5)
    // No completed jobs -> null (nothing to measure), never a fabricated 0/100.
    expect(firstTimeFixRate([{ user_id: 'u1', event_type: 'start_job', at: at(18, 0), job_id: 'X' }]).rate).toBeNull()
  })

  it('target vs actual compares standard_hours / est_minutes to real duration; null when none timed', () => {
    const a = computeWorkshopAnalytics({ events: EVENTS, jobs: JOBS, shifts: SHIFTS, technicians: TECHS, ...RANGE })
    // J1 (target 120) + J2 (target 90) are timed; J3 has no target.
    expect(a.targetVsActual).toBeTruthy()
    expect(a.targetVsActual.count).toBe(2)
    expect(a.avgTaskDurationMin).toBeGreaterThan(0)
    // No jobs at all -> null.
    const b = computeWorkshopAnalytics({ events: EVENTS, jobs: [], shifts: SHIFTS, technicians: TECHS, ...RANGE })
    expect(b.targetVsActual).toBeNull()
    expect(b.avgTaskDurationMin).toBeNull()
  })

  it('empty input yields honest empty arrays and null KPIs (no fabrication)', () => {
    const a = computeWorkshopAnalytics({ events: [], jobs: [], shifts: [], technicians: [], from: '2026-07-18', to: '2026-07-19', now: NOW })
    expect(a.dailyTrend).toEqual([])
    expect(a.technicianLeaderboard).toEqual([])
    expect(a.delayByReason).toEqual([])
    expect(a.summary.avgUtilization).toBeNull()
    expect(a.summary.jobsCompleted).toBe(0)
    expect(a.summary.firstTimeFixRate).toBeNull()
    expect(a.summary.totalProductiveHours).toBe(0)
  })

  it('helper: buildShiftIndex keys by user+day, daysInRange spans inclusive', () => {
    const idx = buildShiftIndex(TECHS, SHIFTS)
    expect(idx.has('u1|2026-07-18')).toBe(true)
    expect(idx.has('u2|2026-07-19')).toBe(false)
    expect(daysInRange('2026-07-18', '2026-07-20')).toEqual(['2026-07-18', '2026-07-19', '2026-07-20'])
    expect(daysInRange('', '')).toEqual([])
  })
})
