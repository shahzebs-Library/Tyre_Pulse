import { describe, it, expect } from 'vitest'
import {
  fmtLabel, fmtMin, localDayWindow, completedToday, scheduledToday, onTimeRate,
  bayLoadToday, bayKpis, bayOptions, filterJobs, conflictJobIds, jobExportRows, utilBand,
} from '../lib/baySchedulingAnalytics'

const at = (y, mo, d, h = 0, mi = 0) => new Date(y, mo, d, h, mi).toISOString()
const now = new Date(2026, 8, 26, 12, 0).getTime()

const rows = [
  { id: 1, bay_name: 'Bay 1', status: 'completed', job_type: 'repair', asset_no: 'TM1', technician: 'Ali',
    scheduled_start: at(2026, 8, 26, 8), scheduled_end: at(2026, 8, 26, 10),
    actual_start: at(2026, 8, 26, 8), actual_end: at(2026, 8, 26, 9, 30), priority: 'high' },
  { id: 2, bay_name: 'Bay 1', status: 'scheduled', job_type: 'rotation', asset_no: 'TM2',
    scheduled_start: at(2026, 8, 26, 9), scheduled_end: at(2026, 8, 26, 11) },
  { id: 3, bay_name: 'Bay 2', status: 'completed', job_type: 'service',
    scheduled_start: at(2026, 8, 25, 8), scheduled_end: at(2026, 8, 25, 9),
    actual_start: at(2026, 8, 25, 8), actual_end: at(2026, 8, 25, 10) },
  { id: 4, bay_name: 'Bay 3', status: 'cancelled', scheduled_start: at(2026, 8, 26, 13), scheduled_end: at(2026, 8, 26, 14) },
]

describe('formatting', () => {
  it('formats labels and minutes honestly', () => {
    expect(fmtLabel('in_progress')).toBe('In Progress')
    expect(fmtLabel(null)).toBe('N/A')
    expect(fmtMin(null)).toBe('N/A')
    expect(fmtMin(45)).toBe('45 min')
    expect(fmtMin(125)).toBe('2h 5m')
    expect(fmtMin(-60)).toBe('-1h')
  })
  it('bands utilisation with a text label', () => {
    expect(utilBand(95).label).toBe('Overloaded')
    expect(utilBand(75).key).toBe('busy')
    expect(utilBand(10).key).toBe('ok')
    expect(utilBand(NaN).key).toBe('none')
  })
})

describe('local day', () => {
  it('spans the local calendar day', () => {
    const { start, end } = localDayWindow(now)
    expect(new Date(start).getHours()).toBe(0)
    expect(new Date(start).getDate()).toBe(26)
    expect(new Date(end).getDate()).toBe(27)
  })
  it('counts today jobs', () => {
    expect(completedToday(rows, now)).toBe(1)
    expect(scheduledToday(rows, now)).toBe(2) // cancelled excluded
  })
})

describe('kpis', () => {
  it('computes an on-time rate only over measured jobs', () => {
    expect(onTimeRate(rows)).toEqual({ measured: 2, onTime: 1, pct: 50 })
    expect(onTimeRate([{ status: 'completed' }]).pct).toBeNull()
  })
  it('rolls up the page KPIs', () => {
    const k = bayKpis(rows, now, { limit: 500 })
    expect(k.totalJobs).toBe(4)
    expect(k.completedToday).toBe(1)
    expect(k.conflicts).toBe(1)
    expect(k.live).toBe(1)
    expect(k.capped).toBe(false)
    expect(bayKpis(rows, now, { limit: 4 }).capped).toBe(true)
    expect(bayKpis([], now).onTimePct).toBeNull()
  })
  it('flags double-booked jobs', () => {
    expect([...conflictJobIds(rows)].sort()).toEqual([1, 2])
  })
  it('builds today bay load', () => {
    const load = bayLoadToday(rows, now)
    expect(load.map((b) => b.bay_name)).toEqual(expect.arrayContaining(['Bay 1', 'Bay 2']))
    expect(load.every((b) => Number.isFinite(b.utilization))).toBe(true)
  })
})

describe('register', () => {
  it('filters and exports', () => {
    expect(bayOptions(rows)).toEqual(['Bay 1', 'Bay 2', 'Bay 3'])
    expect(filterJobs(rows, { bay: 'Bay 1' })).toHaveLength(2)
    expect(filterJobs(rows, { status: 'completed', priority: 'high' })).toHaveLength(1)
    expect(filterJobs(rows, { jobType: 'service' })).toHaveLength(1)
    expect(filterJobs(rows, { search: 'ali' })).toHaveLength(1)
    const out = jobExportRows(rows)
    expect(out[0]).toMatchObject({ job_type: 'Repair', priority: 'High', status: 'Completed', overrun_min: -30 })
    expect(out[1].overrun_min).toBe('')
  })
})
