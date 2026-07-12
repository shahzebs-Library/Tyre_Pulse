import { describe, it, expect } from 'vitest'
import {
  toFiniteNumber,
  scheduledMinutes,
  actualMinutes,
  overrunMinutes,
  bayUtilization,
  summariseBays,
  perBayLoad,
  conflictsForBay,
} from '../lib/bayScheduling'

// Fixed reference epoch so every test is deterministic and time-agnostic.
const T0 = Date.parse('2026-07-12T08:00:00Z') // window start
const H = 3_600_000 // one hour in ms
const iso = (ms) => new Date(ms).toISOString()

describe('bayScheduling — toFiniteNumber', () => {
  it('parses numbers, numeric strings, and rejects junk', () => {
    expect(toFiniteNumber(42)).toBe(42)
    expect(toFiniteNumber('1,200')).toBe(1200)
    expect(toFiniteNumber('')).toBeNull()
    expect(toFiniteNumber(null)).toBeNull()
    expect(toFiniteNumber('abc')).toBeNull()
  })
})

describe('bayScheduling — scheduledMinutes', () => {
  it('computes minutes between scheduled_start and scheduled_end', () => {
    expect(scheduledMinutes({ scheduled_start: iso(T0), scheduled_end: iso(T0 + H) })).toBe(60)
    expect(scheduledMinutes({ scheduled_start: iso(T0), scheduled_end: iso(T0 + H / 2) })).toBe(30)
  })
  it('returns null when a bound is missing or end<=start', () => {
    expect(scheduledMinutes({ scheduled_start: iso(T0) })).toBeNull()
    expect(scheduledMinutes({ scheduled_start: iso(T0), scheduled_end: iso(T0) })).toBeNull()
    expect(scheduledMinutes({})).toBeNull()
  })
})

describe('bayScheduling — actualMinutes', () => {
  it('computes minutes between actual_start and actual_end', () => {
    expect(actualMinutes({ actual_start: iso(T0), actual_end: iso(T0 + 2 * H) })).toBe(120)
  })
  it('returns null when actuals are absent or invalid', () => {
    expect(actualMinutes({ actual_start: iso(T0) })).toBeNull()
    expect(actualMinutes({ actual_start: iso(T0 + H), actual_end: iso(T0) })).toBeNull()
  })
})

describe('bayScheduling — overrunMinutes', () => {
  it('measures actual vs estimated_min (positive = ran over)', () => {
    const job = { actual_start: iso(T0), actual_end: iso(T0 + 90 * 60000), estimated_min: 60 }
    expect(overrunMinutes(job)).toBe(30)
  })
  it('measures negative overrun when finishing early', () => {
    const job = { actual_start: iso(T0), actual_end: iso(T0 + 45 * 60000), estimated_min: 60 }
    expect(overrunMinutes(job)).toBe(-15)
  })
  it('falls back to the scheduled window when estimated_min is absent', () => {
    const job = {
      scheduled_start: iso(T0), scheduled_end: iso(T0 + H),
      actual_start: iso(T0), actual_end: iso(T0 + 2 * H),
    }
    expect(overrunMinutes(job)).toBe(60)
  })
  it('returns null when actuals or estimate basis are unavailable', () => {
    expect(overrunMinutes({ estimated_min: 60 })).toBeNull()
    expect(overrunMinutes({ actual_start: iso(T0), actual_end: iso(T0 + H) })).toBeNull()
  })
})

describe('bayScheduling — bayUtilization', () => {
  const winStart = T0
  const winEnd = T0 + 8 * H // 8-hour window = 480 min

  it('returns the busy share of the window as 0..100', () => {
    const rows = [
      { bay_name: 'Bay 1', status: 'scheduled', scheduled_start: iso(T0), scheduled_end: iso(T0 + 2 * H) },
    ]
    // 120 busy of 480 window = 25%
    expect(bayUtilization(rows, 'Bay 1', winStart, winEnd)).toBe(25)
  })

  it('merges overlapping bookings so double-booked time counts once', () => {
    const rows = [
      { bay_name: 'Bay 1', scheduled_start: iso(T0), scheduled_end: iso(T0 + 2 * H) },
      { bay_name: 'Bay 1', scheduled_start: iso(T0 + H), scheduled_end: iso(T0 + 3 * H) },
    ]
    // Union is T0..T0+3h = 180 min of 480 = 37.5%
    expect(bayUtilization(rows, 'Bay 1', winStart, winEnd)).toBe(37.5)
  })

  it('clips jobs to the window and ignores other bays + cancelled jobs', () => {
    const rows = [
      { bay_name: 'Bay 1', scheduled_start: iso(T0 - H), scheduled_end: iso(T0 + H) }, // clipped to 60 min
      { bay_name: 'Bay 2', scheduled_start: iso(T0), scheduled_end: iso(T0 + 4 * H) }, // other bay
      { bay_name: 'Bay 1', status: 'cancelled', scheduled_start: iso(T0), scheduled_end: iso(T0 + 4 * H) },
    ]
    // Only the clipped 60 min counts: 60/480 = 12.5%
    expect(bayUtilization(rows, 'Bay 1', winStart, winEnd)).toBe(12.5)
  })

  it('returns 0 for empty rows or an invalid window', () => {
    expect(bayUtilization([], 'Bay 1', winStart, winEnd)).toBe(0)
    expect(bayUtilization([{ bay_name: 'Bay 1', scheduled_start: iso(T0), scheduled_end: iso(T0 + H) }], 'Bay 1', winEnd, winStart)).toBe(0)
  })
})

describe('bayScheduling — summariseBays', () => {
  it('counts by status, distinct active bays, and average overrun with injected now', () => {
    const nowMs = T0 + 4 * H
    const rows = [
      { bay_name: 'Bay 1', status: 'scheduled', scheduled_start: iso(T0), scheduled_end: iso(T0 + H) },
      { bay_name: 'Bay 1', status: 'in_progress', scheduled_start: iso(T0), scheduled_end: iso(T0 + H) },
      { bay_name: 'Bay 2', status: 'completed', actual_start: iso(T0), actual_end: iso(T0 + 90 * 60000), estimated_min: 60 }, // +30
      { bay_name: 'Bay 2', status: 'delayed', actual_start: iso(T0), actual_end: iso(T0 + 70 * 60000), estimated_min: 60 }, // +10
      { bay_name: 'Bay 3', status: 'cancelled', scheduled_start: iso(T0), scheduled_end: iso(T0 + H) }, // excluded from activeBays
    ]
    const s = summariseBays(rows, nowMs)
    expect(s.totalJobs).toBe(5)
    expect(s.scheduledCount).toBe(1)
    expect(s.inProgressCount).toBe(1)
    expect(s.completedCount).toBe(1)
    expect(s.delayedCount).toBe(1)
    expect(s.avgOverrunMin).toBe(20) // (30 + 10) / 2
    expect(s.activeBays).toBe(2) // Bay 1, Bay 2 (Bay 3 cancelled)
  })

  it('returns zeroes and null avg overrun for empty/non-array input', () => {
    const s = summariseBays([], 0)
    expect(s).toEqual({
      totalJobs: 0, scheduledCount: 0, inProgressCount: 0, completedCount: 0,
      delayedCount: 0, avgOverrunMin: null, activeBays: 0,
    })
    expect(summariseBays().totalJobs).toBe(0)
  })
})

describe('bayScheduling — perBayLoad', () => {
  it('aggregates jobs/busyMin/completed per bay, sorted by busyMin desc', () => {
    const rows = [
      { bay_name: 'Bay 1', status: 'completed', scheduled_start: iso(T0), scheduled_end: iso(T0 + H) },
      { bay_name: 'Bay 1', status: 'scheduled', scheduled_start: iso(T0 + 2 * H), scheduled_end: iso(T0 + 3 * H) },
      { bay_name: 'Bay 2', status: 'scheduled', scheduled_start: iso(T0), scheduled_end: iso(T0 + 4 * H) },
      { bay_name: 'Bay 1', status: 'cancelled', scheduled_start: iso(T0), scheduled_end: iso(T0 + 10 * H) }, // excluded
    ]
    const load = perBayLoad(rows)
    expect(load.map((l) => l.bay_name)).toEqual(['Bay 2', 'Bay 1']) // Bay2 240min > Bay1 120min
    const bay1 = load.find((l) => l.bay_name === 'Bay 1')
    expect(bay1.jobs).toBe(2)
    expect(bay1.busyMin).toBe(120)
    expect(bay1.completed).toBe(1)
    const bay2 = load.find((l) => l.bay_name === 'Bay 2')
    expect(bay2.busyMin).toBe(240)
  })

  it('returns [] for empty input', () => {
    expect(perBayLoad([])).toEqual([])
    expect(perBayLoad()).toEqual([])
  })
})

describe('bayScheduling — conflictsForBay', () => {
  it('detects overlapping scheduled jobs on the same bay', () => {
    const rows = [
      { id: 'a', bay_name: 'Bay 1', scheduled_start: iso(T0), scheduled_end: iso(T0 + 2 * H) },
      { id: 'b', bay_name: 'Bay 1', scheduled_start: iso(T0 + H), scheduled_end: iso(T0 + 3 * H) },
    ]
    const conflicts = conflictsForBay(rows)
    expect(conflicts).toHaveLength(1)
    expect(conflicts[0].a.id).toBe('a') // earlier start first
    expect(conflicts[0].b.id).toBe('b')
  })

  it('does not flag back-to-back jobs, different bays, or cancelled jobs', () => {
    const rows = [
      { id: 'a', bay_name: 'Bay 1', scheduled_start: iso(T0), scheduled_end: iso(T0 + H) },
      { id: 'b', bay_name: 'Bay 1', scheduled_start: iso(T0 + H), scheduled_end: iso(T0 + 2 * H) }, // touches, no overlap
      { id: 'c', bay_name: 'Bay 2', scheduled_start: iso(T0), scheduled_end: iso(T0 + 3 * H) }, // other bay
      { id: 'd', bay_name: 'Bay 1', status: 'cancelled', scheduled_start: iso(T0), scheduled_end: iso(T0 + 3 * H) },
    ]
    expect(conflictsForBay(rows)).toEqual([])
  })

  it('returns [] for empty input', () => {
    expect(conflictsForBay([])).toEqual([])
    expect(conflictsForBay()).toEqual([])
  })
})
