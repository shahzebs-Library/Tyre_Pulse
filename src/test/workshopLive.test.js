import { describe, it, expect } from 'vitest'
import {
  buildSegments, rollupTechnician, statusFromEvents, buildBoard, computeKpis,
  deriveAlerts, delayBreakdown, alertSummary, STATUS, STATUS_META, statusColor,
  EVENT_TYPES, DEFAULT_THRESHOLDS,
} from '../lib/workshopLive.js'

const T0 = new Date('2026-07-20T06:00:00Z').getTime()
const at = (min) => new Date(T0 + min * 60000).toISOString()
const shift = { start: T0, end: T0 + 480 * 60000, label: 'Day' }

const SAMPLE = [
  { event_type: 'check_in', at: at(0) },
  { event_type: 'start_job', at: at(10), job_id: 'J1' },
  { event_type: 'request_parts', at: at(70), reason_code: 'parts' },
  { event_type: 'resume_job', at: at(130), job_id: 'J1' },
  { event_type: 'complete_task', at: at(190), job_id: 'J1' },
  { event_type: 'start_break', at: at(200) },
  { event_type: 'end_break', at: at(230) },
]
const NOW = T0 + 260 * 60000

describe('workshopLive engine', () => {
  it('classifies time into productive / blocked / break / unassigned', () => {
    const r = rollupTechnician(SAMPLE, { now: NOW, shiftStart: shift.start, shiftEnd: shift.end })
    expect(r.productiveMin).toBe(120) // 10-70 + 130-190
    expect(r.blockedMin).toBe(60)     // parts 70-130
    expect(r.breakMin).toBe(30)       // 200-230
    expect(r.unassignedMin).toBe(50)  // 0-10 + 190-200 + 230-260
    expect(r.blockedByReason.parts).toBe(60)
    expect(r.jobsCompleted).toBe(1)
  })

  it('utilization = productive / (available duty - break - training)', () => {
    const r = rollupTechnician(SAMPLE, { now: NOW, shiftStart: shift.start, shiftEnd: shift.end })
    // available duty 260, minus 30 break = 230; 120/230 = 0.52
    expect(r.utilization).toBeCloseTo(0.52, 2)
  })

  it('never returns a negative unassigned figure', () => {
    const r = rollupTechnician(SAMPLE, { now: NOW, shiftStart: shift.start, shiftEnd: shift.end })
    expect(r.unassignedMin).toBeGreaterThanOrEqual(0)
  })

  it('blocked time (parts) is NOT counted as idle/unassigned', () => {
    const r = rollupTechnician(SAMPLE, { now: NOW, shiftStart: shift.start, shiftEnd: shift.end })
    expect(r.blockedMin).toBe(60)
    // The 60 blocked minutes are separate from the 50 unassigned minutes.
    expect(r.unassignedMin).toBe(50)
  })

  it('derives live status from the latest meaningful event', () => {
    expect(statusFromEvents(SAMPLE, { now: NOW })).toBe(STATUS.AVAILABLE)
    expect(statusFromEvents([{ event_type: 'start_job', at: at(1), job_id: 'J' }], { now: NOW })).toBe(STATUS.WORKING)
    expect(statusFromEvents([{ event_type: 'request_parts', at: at(1) }], { now: NOW })).toBe(STATUS.WAITING_PARTS)
    expect(statusFromEvents([{ event_type: 'start_break', at: at(1) }], { now: NOW })).toBe(STATUS.ON_BREAK)
    expect(statusFromEvents([{ event_type: 'complete_task', at: at(1) }], { now: NOW })).toBe(STATUS.AWAITING_INSPECTION)
    expect(statusFromEvents([{ event_type: 'check_out', at: at(1) }], { now: NOW })).toBe(STATUS.OFF_DUTY)
  })

  it('no events -> absent when not present, available when present', () => {
    expect(statusFromEvents([], { now: NOW, present: false })).toBe(STATUS.ABSENT)
    expect(statusFromEvents([], { now: NOW, present: true })).toBe(STATUS.AVAILABLE)
  })

  it('request_assistance / report_problem are annotations (do not change status)', () => {
    const evs = [{ event_type: 'start_job', at: at(1), job_id: 'J' }, { event_type: 'request_assistance', at: at(5) }, { event_type: 'report_problem', at: at(6) }]
    expect(statusFromEvents(evs, { now: NOW })).toBe(STATUS.WORKING)
  })

  it('pause with a blocked reason maps to the matching waiting status', () => {
    expect(statusFromEvents([{ event_type: 'pause_job', at: at(1), reason_code: 'approval' }], { now: NOW })).toBe(STATUS.WAITING_APPROVAL)
    expect(statusFromEvents([{ event_type: 'pause_job', at: at(1), reason_code: 'vehicle' }], { now: NOW })).toBe(STATUS.WAITING_VEHICLE)
  })

  it('buildBoard + computeKpis produce a consistent KPI strip', () => {
    const board = buildBoard(
      [{ id: 'u1', full_name: 'Ali', employee_id: 'E1', trade: 'Mechanic' }],
      { u1: SAMPLE },
      { now: NOW, shiftByUser: { u1: shift } },
    )
    expect(board).toHaveLength(1)
    const k = computeKpis(board, [{ id: 'J1', status: 'in_progress', work_order_no: 'WO1' }], { now: NOW, todayStart: T0 })
    expect(k.openJobs).toBe(1)
    expect(k.productiveHours).toBe(2)
    expect(k.utilization).toBe(52)
  })

  it('deriveAlerts flags a long-unassigned technician', () => {
    const board = buildBoard([{ id: 'u1', full_name: 'Ali' }], { u1: SAMPLE }, { now: NOW, shiftByUser: { u1: shift } })
    const alerts = deriveAlerts(board, [], { now: NOW })
    expect(alerts.some((a) => a.type === 'unassigned')).toBe(true)
  })

  it('delayBreakdown aggregates blocked hours by reason', () => {
    const board = buildBoard([{ id: 'u1', full_name: 'Ali' }], { u1: SAMPLE }, { now: NOW, shiftByUser: { u1: shift } })
    const d = delayBreakdown(board)
    const parts = d.find((x) => x.reason === 'parts')
    expect(parts).toBeTruthy()
    expect(parts.hoursLost).toBe(1)
  })

  it('delayBreakdown enriches rows with cost / dept / action / priority', () => {
    const board = buildBoard([{ id: 'u1', full_name: 'Ali' }], { u1: SAMPLE }, { now: NOW, shiftByUser: { u1: shift } })
    const d = delayBreakdown(board) // default labour rate 120
    const parts = d.find((x) => x.reason === 'parts')
    expect(parts.hoursLost).toBe(1)
    expect(parts.costImpact).toBe(120) // 1h * 120
    expect(parts.responsibleDept).toBe('Stores / Procurement')
    expect(parts.suggestedAction).toMatch(/parts/i)
    expect(parts.priority).toBe('low') // 1h, 120 -> low
  })

  it('delayBreakdown derives labour rate from jobs and applies priority bands', () => {
    // Long blocked stint: parts from 20 min to now (600 min later) = ~9.7h.
    const evs = [
      { event_type: 'check_in', at: at(0) },
      { event_type: 'start_job', at: at(10), job_id: 'J1' },
      { event_type: 'request_parts', at: at(20), reason_code: 'parts' },
    ]
    const now = T0 + 600 * 60000
    const longShift = { start: T0, end: T0 + 900 * 60000, label: 'Day' }
    const board = buildBoard([{ id: 'u1', full_name: 'Ali' }], { u1: evs }, { now, shiftByUser: { u1: longShift } })
    const d = delayBreakdown(board, { jobs: [{ labour_rate: 200 }, { labour_rate: 100 }] })
    const parts = d.find((x) => x.reason === 'parts')
    expect(parts.hoursLost).toBeGreaterThanOrEqual(8)
    expect(parts.costImpact).toBe(Math.round(parts.hoursLost * 150)) // avg(200,100)=150
    expect(parts.priority).toBe('high') // >= 8h
  })

  it('delayBreakdown explicit labourRate overrides job-derived rate', () => {
    const board = buildBoard([{ id: 'u1', full_name: 'Ali' }], { u1: SAMPLE }, { now: NOW, shiftByUser: { u1: shift } })
    const d = delayBreakdown(board, { labourRate: 300, jobs: [{ labour_rate: 50 }] })
    const parts = d.find((x) => x.reason === 'parts')
    expect(parts.costImpact).toBe(300) // 1h * 300, not 50
  })

  it('deriveAlerts flags overlapping_jobs (one tech active on >1 job)', () => {
    const board = buildBoard([{ id: 'u1', full_name: 'Ali' }], { u1: SAMPLE }, { now: NOW, shiftByUser: { u1: shift } })
    const assignments = [
      { user_id: 'u1', job_id: 'J1', active: true },
      { user_id: 'u1', job_id: 'J2', active: true },
    ]
    const alerts = deriveAlerts(board, [], { now: NOW, assignments, presentByUser: { u1: true } })
    const a = alerts.find((x) => x.type === 'overlapping_jobs')
    expect(a).toBeTruthy()
    expect(a.level).toBe('critical')
    expect(a.message).toMatch(/2/)
  })

  it('deriveAlerts flags not_checked_in (assigned work, no check-in)', () => {
    const board = buildBoard([{ id: 'u2', full_name: 'Sam' }], { u2: [] }, { now: NOW })
    const assignments = [{ user_id: 'u2', job_id: 'J9', active: true }]
    const alerts = deriveAlerts(board, [], { now: NOW, assignments, presentByUser: {} })
    expect(alerts.some((x) => x.type === 'not_checked_in' && x.ref === 'u2')).toBe(true)
  })

  it('deriveAlerts flags job_no_owner (open job, no owner, no assignment)', () => {
    const jobs = [{ id: 'J5', status: 'in_progress', work_order_no: 'WO5' }]
    const alerts = deriveAlerts([], jobs, { now: NOW })
    expect(alerts.some((x) => x.type === 'job_no_owner' && x.ref === 'J5')).toBe(true)
  })

  it('deriveAlerts flags parts_pending past the blockedPendingMin threshold', () => {
    // request_parts long ago -> WAITING_PARTS with stale lastActivityAt.
    const evs = [
      { event_type: 'check_in', at: at(0) },
      { event_type: 'request_parts', at: at(10), reason_code: 'parts' },
    ]
    const now = T0 + 120 * 60000 // 110 min after the request
    const board = buildBoard([{ id: 'u1', full_name: 'Ali' }], { u1: evs }, { now, shiftByUser: { u1: shift } })
    expect(board[0].status).toBe(STATUS.WAITING_PARTS)
    const alerts = deriveAlerts(board, [], { now })
    expect(alerts.some((x) => x.type === 'parts_pending')).toBe(true)
    expect(DEFAULT_THRESHOLDS.blockedPendingMin).toBe(60)
  })

  it('deriveAlerts with NO extra ctx returns only the original alert types', () => {
    const board = buildBoard([{ id: 'u1', full_name: 'Ali' }], { u1: SAMPLE }, { now: NOW, shiftByUser: { u1: shift } })
    // Jobs carry owners so job_no_owner cannot fire; no assignments/presentByUser given.
    const jobs = [{ id: 'J1', status: 'in_progress', work_order_no: 'WO1', assigned_owner_id: 'u1' }]
    const alerts = deriveAlerts(board, jobs, { now: NOW })
    const ORIGINAL = new Set(['unassigned', 'no_activity', 'overtime', 'overdue', 'vor_sla', 'qc_pending'])
    expect(alerts.length).toBeGreaterThan(0)
    for (const a of alerts) expect(ORIGINAL.has(a.type)).toBe(true)
  })

  it('alertSummary counts alerts by level', () => {
    const alerts = [
      { level: 'critical', type: 'overlapping_jobs' },
      { level: 'warning', type: 'unassigned' },
      { level: 'warning', type: 'job_no_owner' },
      { level: 'info', type: 'qc_pending' },
    ]
    expect(alertSummary(alerts)).toEqual({ critical: 1, warning: 2, info: 1, total: 4 })
    expect(alertSummary([])).toEqual({ critical: 0, warning: 0, info: 0, total: 0 })
  })

  it('empty events yield no segments', () => {
    expect(buildSegments([], { now: NOW })).toEqual([])
  })

  it('exposes complete vocabulary + colour helpers', () => {
    expect(EVENT_TYPES).toContain('start_job')
    expect(STATUS_META[STATUS.WORKING].tone).toBe('green')
    expect(statusColor(STATUS.WORKING)).toMatch(/^#/)
  })
})
