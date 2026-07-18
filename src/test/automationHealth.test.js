import { describe, it, expect } from 'vitest'
import {
  summarizeSchedules, scheduleFlags, summarizeCron, cronRunTone,
} from '../lib/api/automationHealth'

const NOW = Date.parse('2026-07-18T12:00:00Z')
const past = new Date(NOW - 3600_000).toISOString()
const future = new Date(NOW + 3600_000).toISOString()

describe('summarizeSchedules', () => {
  it('counts active, paused, overdue and failing correctly', () => {
    const rows = [
      { id: 1, active: true, next_run_at: future, last_status: 'sent' },   // healthy
      { id: 2, active: true, next_run_at: past, last_status: 'sent' },     // overdue
      { id: 3, active: false, next_run_at: past, last_status: 'sent' },    // paused (not overdue)
      { id: 4, active: true, next_run_at: future, last_status: 'error' },  // failing
      { id: 5, active: true, next_run_at: future, last_error: 'boom' },    // failing via error text
    ]
    const s = summarizeSchedules(rows, NOW)
    expect(s.total).toBe(5)
    expect(s.active).toBe(4)
    expect(s.paused).toBe(1)
    expect(s.overdue).toBe(1) // only row 2 (row 3 is paused, not counted)
    expect(s.failing).toBe(2) // rows 4 and 5
  })

  it('is empty-safe for non-array input', () => {
    const s = summarizeSchedules(null, NOW)
    expect(s).toEqual({ total: 0, active: 0, paused: 0, overdue: 0, failing: 0 })
  })

  it('does not mark a paused schedule as overdue even with a past next run', () => {
    const s = summarizeSchedules([{ id: 1, active: false, next_run_at: past }], NOW)
    expect(s.overdue).toBe(0)
    expect(s.paused).toBe(1)
  })

  it('ignores a blank / invalid next_run_at', () => {
    const s = summarizeSchedules([
      { id: 1, active: true, next_run_at: '' },
      { id: 2, active: true, next_run_at: 'not-a-date' },
    ], NOW)
    expect(s.overdue).toBe(0)
  })
})

describe('scheduleFlags', () => {
  it('flags a paused schedule', () => {
    expect(scheduleFlags({ active: false, next_run_at: past }, NOW)).toEqual({
      paused: true, overdue: false, failing: false,
    })
  })
  it('flags an overdue active schedule', () => {
    const f = scheduleFlags({ active: true, next_run_at: past }, NOW)
    expect(f.paused).toBe(false)
    expect(f.overdue).toBe(true)
  })
  it('flags failing on failed status', () => {
    expect(scheduleFlags({ active: true, last_status: 'failed', next_run_at: future }, NOW).failing).toBe(true)
  })
})

describe('cronRunTone', () => {
  it('maps statuses to tones', () => {
    expect(cronRunTone('succeeded')).toBe('green')
    expect(cronRunTone('success')).toBe('green')
    expect(cronRunTone('running')).toBe('amber')
    expect(cronRunTone('failed')).toBe('red')
    expect(cronRunTone('')).toBe('gray')
    expect(cronRunTone(null)).toBe('gray')
    expect(cronRunTone('weird')).toBe('gray')
  })
})

describe('summarizeCron', () => {
  it('counts active/inactive/failing and maps per-job tone', () => {
    const rows = [
      { jobid: 1, jobname: 'a', schedule: '* * * * *', active: true, last_status: 'succeeded', last_end: past },
      { jobid: 2, jobname: 'b', schedule: '0 * * * *', active: true, last_status: 'failed', last_end: past },
      { jobid: 3, jobname: 'c', schedule: '0 0 * * *', active: false, last_status: null, last_end: null },
    ]
    const s = summarizeCron(rows)
    expect(s.total).toBe(3)
    expect(s.active).toBe(2)
    expect(s.inactive).toBe(1)
    expect(s.failing).toBe(1)
    expect(s.jobs[0].tone).toBe('green')
    expect(s.jobs[1].tone).toBe('red')
    expect(s.jobs[2].tone).toBe('gray')
  })

  it('is empty-safe', () => {
    const s = summarizeCron(undefined)
    expect(s).toEqual({ total: 0, active: 0, inactive: 0, failing: 0, jobs: [] })
  })

  it('derives a job name when jobname is missing', () => {
    const s = summarizeCron([{ jobid: 7, active: true }])
    expect(s.jobs[0].jobname).toBe('job 7')
  })
})
