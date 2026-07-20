import { describe, it, expect } from 'vitest'
import { taskRollup, jobTaskSummary, minutesByTask, qcOutcome, QC_STATUSES, TASK_STATUS } from '../lib/workshopTasks.js'

const T0 = new Date('2026-07-20T06:00:00Z').getTime()
const at = (min) => new Date(T0 + min * 60000).toISOString()
const NOW = T0 + 100 * 60000

describe('workshopTasks engine', () => {
  it('attributes event-log time to the task_id that was active', () => {
    const events = [
      { task_id: 'A', at: at(0) },   // A holds 0 -> 30
      { task_id: 'B', at: at(30) },  // B holds 30 -> 60
      { task_id: 'A', at: at(60) },  // A holds 60 -> 100 (now)
    ]
    const mins = minutesByTask(events, NOW)
    expect(mins.A).toBe(30 + 40) // 30 + (100-60)
    expect(mins.B).toBe(30)
  })

  it('ignores events with no task_id for task time', () => {
    const events = [
      { task_id: null, at: at(0) },
      { task_id: 'A', at: at(20) },
    ]
    const mins = minutesByTask(events, NOW)
    expect(mins.A).toBe(80) // 20 -> 100
    expect(mins[null]).toBeUndefined()
  })

  it('taskRollup returns per-task time, status, assignee and overBudget flag', () => {
    const tasks = [
      { id: 'A', title: 'Remove tyre', seq: 1, est_minutes: 60, status: 'in_progress', assignee_user_id: 'u1' },
      { id: 'B', title: 'Balance wheel', seq: 2, est_minutes: 100, status: 'done', assignee_user_id: 'u2' },
    ]
    const events = [
      { task_id: 'A', at: at(0) },
      { task_id: 'B', at: at(70) },
    ]
    const rows = taskRollup(tasks, events, { now: NOW })
    const a = rows.find((r) => r.id === 'A')
    const b = rows.find((r) => r.id === 'B')
    expect(a.minutesSpent).toBe(70)   // 0 -> 70
    expect(a.overBudget).toBe(true)   // 70 > est 60
    expect(a.assignee).toBe('u1')
    expect(b.minutesSpent).toBe(30)   // 70 -> 100
    expect(b.overBudget).toBe(false)  // 30 < est 100
    expect(b.status).toBe('done')
  })

  it('taskRollup orders by seq then title and defaults an unknown status to pending', () => {
    const tasks = [
      { id: 'Z', title: 'Zeta', seq: 2, status: 'weird' },
      { id: 'A', title: 'Alpha', seq: 1, status: 'pending' },
    ]
    const rows = taskRollup(tasks, [], { now: NOW })
    expect(rows.map((r) => r.id)).toEqual(['A', 'Z'])
    expect(rows[1].status).toBe('pending') // unknown -> pending
    expect(rows[0].minutesSpent).toBe(0)   // no events -> honest zero
  })

  it('jobTaskSummary counts by status and computes done percentage', () => {
    const tasks = [
      { status: 'done' }, { status: 'done' }, { status: 'in_progress' }, { status: 'blocked' },
    ]
    const s = jobTaskSummary(tasks)
    expect(s.total).toBe(4)
    expect(s.done).toBe(2)
    expect(s.inProgress).toBe(1)
    expect(s.blocked).toBe(1)
    expect(s.pct).toBe(50)
  })

  it('handles empty input honestly', () => {
    expect(minutesByTask([], NOW)).toEqual({})
    expect(taskRollup([], [], { now: NOW })).toEqual([])
    expect(jobTaskSummary([])).toEqual({ total: 0, done: 0, inProgress: 0, blocked: 0, pending: 0, qc: 0, pct: 0 })
  })

  it('exposes the task status vocabulary', () => {
    expect(TASK_STATUS).toContain('in_progress')
    expect(TASK_STATUS).toContain('done')
  })
})

describe('qcOutcome (QC sign-off transition)', () => {
  it('pass -> canonical Completed, qc_status passed, no rework', () => {
    const t = qcOutcome('pass')
    expect(t).toEqual({ status: 'Completed', qc_status: 'passed', rework: false, note: null })
  })

  it('fail -> canonical In Progress, qc_status failed, rework signal + note', () => {
    const t = qcOutcome('fail')
    expect(t.status).toBe('In Progress')
    expect(t.qc_status).toBe('failed')
    expect(t.rework).toBe(true)
    expect(t.note).toBe('QC failed: rework required')
  })

  it('is case-insensitive and returns null for an unknown action', () => {
    expect(qcOutcome('PASS').qc_status).toBe('passed')
    expect(qcOutcome('Fail').qc_status).toBe('failed')
    expect(qcOutcome('maybe')).toBeNull()
    expect(qcOutcome('')).toBeNull()
    expect(qcOutcome(null)).toBeNull()
  })

  it('emits only valid qc_status values', () => {
    expect(QC_STATUSES).toContain('passed')
    expect(QC_STATUSES).toContain('failed')
    expect(QC_STATUSES).toContain('pending')
    expect(QC_STATUSES).toContain(qcOutcome('pass').qc_status)
    expect(QC_STATUSES).toContain(qcOutcome('fail').qc_status)
  })
})
