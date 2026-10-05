import { describe, expect, it } from 'vitest'
import {
  jobFlowStage, jobFlowCounts, alertRows, alertLevelCounts, initials, techJobLine,
  BOARD_CHIPS, chipCounts, todayLabel, JOB_FLOW_STAGES,
} from '../lib/workshopLiveView'

describe('jobFlowStage', () => {
  it('maps canonical and legacy statuses to stages', () => {
    expect(jobFlowStage({ status: 'New' })).toBe('unassigned')
    expect(jobFlowStage({ status: 'open', assigned_owner_id: 'u1' })).toBe('assigned')
    expect(jobFlowStage({ status: 'Assigned' })).toBe('assigned')
    expect(jobFlowStage({ status: 'in_progress' })).toBe('in_progress')
    expect(jobFlowStage({ status: 'Waiting for Parts' })).toBe('blocked')
    expect(jobFlowStage({ status: 'waiting_approval' })).toBe('blocked')
    expect(jobFlowStage({ status: 'On Hold' })).toBe('blocked')
    expect(jobFlowStage({ status: 'Quality Inspection' })).toBe('qa')
  })
  it('treats a QC pass that is not closed as ready to close', () => {
    expect(jobFlowStage({ status: 'Quality Inspection', qc_status: 'passed' })).toBe('ready')
    expect(jobFlowStage({ status: 'Completed', qc_status: 'passed' })).toBeNull()
  })
  it('returns null for closed or unknown jobs', () => {
    expect(jobFlowStage({ status: 'Completed' })).toBeNull()
    expect(jobFlowStage({ status: 'cancelled' })).toBeNull()
    expect(jobFlowStage({ status: 'Something odd' })).toBeNull()
    expect(jobFlowStage(null)).toBeNull()
  })
})

describe('jobFlowCounts', () => {
  it('counts open jobs per stage and reports unmatched ones honestly', () => {
    const jobs = [
      { status: 'New' }, { status: 'New' }, { status: 'In Progress' },
      { status: 'Completed' }, { status: 'Mystery' }, { status: 'Quality Inspection', qc_status: 'passed' },
    ]
    const r = jobFlowCounts(jobs)
    const by = Object.fromEntries(r.stages.map((s) => [s.key, s.count]))
    expect(by).toEqual({ unassigned: 2, assigned: 0, in_progress: 1, blocked: 0, qa: 0, ready: 1 })
    expect(r.open).toBe(5)
    expect(r.other).toBe(1)
    expect(r.stages.find((s) => s.key === 'unassigned').bar).toBe(1)
    expect(r.stages.find((s) => s.key === 'unassigned').share).toBeCloseTo(0.4)
  })
  it('is all zeros on no data, never NaN', () => {
    const r = jobFlowCounts([])
    expect(r.open).toBe(0)
    expect(r.stages).toHaveLength(JOB_FLOW_STAGES.length)
    for (const s of r.stages) { expect(s.count).toBe(0); expect(s.share).toBe(0); expect(s.bar).toBe(0) }
    expect(jobFlowCounts(undefined).open).toBe(0)
  })
})

describe('alerts', () => {
  const alerts = [
    { level: 'warning', type: 'unassigned', message: 'A unassigned for 40 min', ref: 'u1' },
    { level: 'info', type: 'qc_pending', message: 'Job 9 awaiting', ref: 'j9' },
    { level: 'critical', type: 'vor_sla', message: 'Vehicle TM1 off road', ref: 'j1' },
    { level: 'warning', type: 'unknown_type', message: 'x', ref: 'u2' },
  ]
  it('sorts most severe first and stays stable within a level', () => {
    const rows = alertRows(alerts)
    expect(rows.map((r) => r.ref)).toEqual(['j1', 'u1', 'u2', 'j9'])
    expect(rows[0]).toMatchObject({ title: 'Vehicle off road beyond SLA', pillTone: 'bad', pillLabel: 'Critical', detail: 'Vehicle TM1 off road' })
    expect(rows[2].title).toBe('Workshop alert')
    expect(new Set(rows.map((r) => r.key)).size).toBe(rows.length)
  })
  it('counts levels', () => {
    expect(alertLevelCounts(alerts)).toEqual({ critical: 1, warning: 2, info: 1 })
    expect(alertLevelCounts(null)).toEqual({ critical: 0, warning: 0, info: 0 })
  })
})

describe('technician helpers', () => {
  it('builds initials and job lines', () => {
    expect(initials('Omar Haddad')).toBe('OH')
    expect(initials('  priya  ')).toBe('PR')
    expect(initials('Ali bin Salem')).toBe('AS')
    expect(initials('')).toBe('?')
    expect(techJobLine({ job: { no: 'WO-1', asset_no: 'TM514' } })).toBe('WO-1 | TM514')
    expect(techJobLine({ job: { asset_no: 'TM514' } })).toBe('Job | TM514')
    expect(techJobLine({ job: null })).toBe('No active job')
  })
  it('counts board chips per status group', () => {
    const board = [
      { status: 'available', currentJobId: null },
      { status: 'available', currentJobId: 'j' },
      { status: 'waiting_parts' }, { status: 'waiting_tools' },
      { status: 'on_break' }, { status: 'absent' }, { status: 'awaiting_inspection' },
    ]
    expect(chipCounts(board)).toEqual({ all: 7, unassigned: 1, waiting: 2, inspection: 1, break: 1, away: 1 })
    expect(BOARD_CHIPS[0].pred).toBeUndefined()
  })
  it('labels today without a range', () => {
    expect(todayLabel(Date.UTC(2026, 9, 5, 9))).toMatch(/^Today, \d{2} Oct 2026$/)
    expect(todayLabel(NaN)).toBe('Today')
  })
})
