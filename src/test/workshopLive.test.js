import { describe, it, expect } from 'vitest'
import {
  buildSegments, rollupTechnician, statusFromEvents, buildBoard, computeKpis,
  deriveAlerts, delayBreakdown, STATUS, STATUS_META, statusColor, EVENT_TYPES,
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

  it('empty events yield no segments', () => {
    expect(buildSegments([], { now: NOW })).toEqual([])
  })

  it('exposes complete vocabulary + colour helpers', () => {
    expect(EVENT_TYPES).toContain('start_job')
    expect(STATUS_META[STATUS.WORKING].tone).toBe('green')
    expect(statusColor(STATUS.WORKING)).toMatch(/^#/)
  })
})
