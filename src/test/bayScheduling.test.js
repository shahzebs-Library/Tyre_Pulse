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
  workingMsInWindow,
  forecastCapacity,
  perTechnicianLoad,
  technicianConflicts,
  bayOverlapConflicts,
  intervalsOverlap,
  activeBayCount,
  avgJobHours,
  WORKING_HOURS_PER_DAY,
  DEFAULT_CAPACITY_CONFIG,
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

// ── Capacity planning ─────────────────────────────────────────────────────────

// A UTC midnight so working-day (08:00–18:00 UTC) maths is exact.
const DAY0 = Date.parse('2026-07-13T00:00:00Z') // Monday

describe('bayScheduling — workingMsInWindow (working-day calibration)', () => {
  it('a full 24h day contributes only the 10h working window', () => {
    expect(workingMsInWindow(DAY0, DAY0 + 24 * H)).toBe(WORKING_HOURS_PER_DAY * H)
    expect(WORKING_HOURS_PER_DAY).toBe(10)
  })

  it('clips to the shift and sums across multiple days', () => {
    // 06:00 → next-day 12:00 = day-0 working [08:00,18:00]=10h + day-1 [08:00,12:00]=4h
    const start = DAY0 + 6 * H
    const end = DAY0 + 24 * H + 12 * H
    expect(workingMsInWindow(start, end)).toBe((10 + 4) * H)
  })

  it('honours a custom shift via cfg', () => {
    // 08:00 start, 8h/day → a full day = 8h
    expect(workingMsInWindow(DAY0, DAY0 + 24 * H, { workingHoursPerDay: 8 })).toBe(8 * H)
  })

  it('returns 0 for an invalid window', () => {
    expect(workingMsInWindow(DAY0 + H, DAY0)).toBe(0)
  })
})

describe('bayScheduling — bayUtilization calibration', () => {
  it('a bay busy the whole 10h working day over a 24h window reads ~100%, not ~33%', () => {
    const rows = [
      { bay_name: 'Bay 1', status: 'scheduled', scheduled_start: iso(DAY0 + 8 * H), scheduled_end: iso(DAY0 + 18 * H) },
    ]
    // 10h busy / 10h working capacity = 100% (against a full-day 24h window)
    expect(bayUtilization(rows, 'Bay 1', DAY0, DAY0 + 24 * H)).toBe(100)
  })

  it('half the working day reads 50% over a 24h window', () => {
    const rows = [
      { bay_name: 'Bay 1', scheduled_start: iso(DAY0 + 8 * H), scheduled_end: iso(DAY0 + 13 * H) }, // 5h
    ]
    expect(bayUtilization(rows, 'Bay 1', DAY0, DAY0 + 24 * H)).toBe(50)
  })

  it('falls back to raw span when the window has no working hours (no divide-by-zero)', () => {
    // Window 19:00→23:00 (outside the 08:00–18:00 shift): 2h busy of 4h span = 50%
    const rows = [
      { bay_name: 'Bay 1', scheduled_start: iso(DAY0 + 19 * H), scheduled_end: iso(DAY0 + 21 * H) },
    ]
    expect(bayUtilization(rows, 'Bay 1', DAY0 + 19 * H, DAY0 + 23 * H)).toBe(50)
  })
})

describe('bayScheduling — activeBayCount / avgJobHours', () => {
  it('counts distinct non-cancelled bays', () => {
    const rows = [
      { bay_name: 'Bay 1', status: 'scheduled' },
      { bay_name: 'Bay 1', status: 'completed' },
      { bay_name: 'Bay 2', status: 'scheduled' },
      { bay_name: 'Bay 3', status: 'cancelled' },
    ]
    expect(activeBayCount(rows)).toBe(2)
  })

  it('derives mean job hours from scheduled windows, else falls back to cfg default', () => {
    const rows = [
      { bay_name: 'Bay 1', scheduled_start: iso(DAY0 + 8 * H), scheduled_end: iso(DAY0 + 10 * H) }, // 2h
      { bay_name: 'Bay 1', scheduled_start: iso(DAY0 + 10 * H), scheduled_end: iso(DAY0 + 14 * H) }, // 4h
    ]
    expect(avgJobHours(rows)).toBe(3) // (2+4)/2
    expect(avgJobHours([])).toBe(DEFAULT_CAPACITY_CONFIG.avgJobHours)
  })
})

describe('bayScheduling — forecastCapacity (G1)', () => {
  const NOW = DAY0 + 9 * H // mid-morning on day 0

  it('computes avgDaily from the last 30 days and projects 7 days', () => {
    // 15 non-cancelled jobs in the trailing 30d → avgDaily = 0.5/day
    const history = Array.from({ length: 15 }, (_, i) => ({
      bay_name: 'Bay 1', status: 'completed',
      scheduled_start: iso(NOW - (i + 1) * H * 24), // one per prior day
    }))
    const f = forecastCapacity(history, NOW, { activeBays: 2, avgJobHours: 2 })
    expect(f.avgDaily).toBe(0.5)
    expect(f.activeBays).toBe(2)
    // slots/day = 2 bays * 10h / 2h = 10
    expect(f.slotsPerDay).toBe(10)
    expect(f.days).toHaveLength(7)
    expect(f.days[0].date).toBe('2026-07-13')
  })

  it('flags an overloaded day when scheduled demand exceeds 90% of capacity', () => {
    // 1 bay, 2h jobs → slots/day = 1*10/2 = 5. 6 jobs tomorrow = 120% → overloaded.
    const tomorrow = DAY0 + 24 * H
    const rows = Array.from({ length: 6 }, () => ({
      bay_name: 'Bay 1', status: 'scheduled', scheduled_start: iso(tomorrow + 9 * H),
    }))
    const f = forecastCapacity(rows, NOW, { activeBays: 1, avgJobHours: 2 })
    expect(f.slotsPerDay).toBe(5)
    const day1 = f.days.find((d) => d.date === '2026-07-14')
    expect(day1.scheduled).toBe(6)
    expect(day1.utilPct).toBe(120)
    expect(day1.overloaded).toBe(true)
    // A quiet day (day 0 has no scheduled jobs, tiny avgDaily) is not overloaded.
    expect(f.days[0].overloaded).toBe(false)
  })

  it('expected never drops below the daily average', () => {
    // 30 jobs across the last 30 days → avgDaily = 1; a day with 0 scheduled still expects 1.
    const history = Array.from({ length: 30 }, (_, i) => ({
      bay_name: 'Bay 1', status: 'scheduled', scheduled_start: iso(NOW - (i + 1) * H * 24),
    }))
    const f = forecastCapacity(history, NOW, { activeBays: 5, avgJobHours: 1 })
    expect(f.avgDaily).toBe(1)
    // future days have no scheduled jobs but expected == avgDaily
    const future = f.days[3]
    expect(future.scheduled).toBe(0)
    expect(future.expected).toBe(1)
  })

  it('returns zeroed capacity with no active bays', () => {
    const f = forecastCapacity([], NOW)
    expect(f.activeBays).toBe(0)
    expect(f.slotsPerDay).toBe(0)
    expect(f.days).toHaveLength(7)
  })
})

describe('bayScheduling — perTechnicianLoad (G3)', () => {
  it('rolls up jobs/bookedMin/utilPct per technician vs the working day', () => {
    const rows = [
      { technician: 'A. Rahman', status: 'completed', scheduled_start: iso(DAY0 + 8 * H), scheduled_end: iso(DAY0 + 11 * H) }, // 180m
      { technician: 'A. Rahman', status: 'scheduled', scheduled_start: iso(DAY0 + 11 * H), scheduled_end: iso(DAY0 + 12 * H) }, // 60m
      { technician: 'B. Khan', status: 'scheduled', scheduled_start: iso(DAY0 + 8 * H), scheduled_end: iso(DAY0 + 9 * H) }, // 60m
      { technician: 'A. Rahman', status: 'cancelled', scheduled_start: iso(DAY0), scheduled_end: iso(DAY0 + 5 * H) }, // excluded
      { technician: '', status: 'scheduled', scheduled_start: iso(DAY0 + 8 * H), scheduled_end: iso(DAY0 + 9 * H) }, // Unassigned
    ]
    const load = perTechnicianLoad(rows)
    const rahman = load.find((t) => t.technician === 'A. Rahman')
    expect(rahman.jobs).toBe(2)
    expect(rahman.bookedMin).toBe(240)
    expect(rahman.completed).toBe(1)
    // 240 min / (10h*60) = 40%
    expect(rahman.utilPct).toBe(40)
    // sorted by bookedMin desc → Rahman first
    expect(load[0].technician).toBe('A. Rahman')
    expect(load.some((t) => t.technician === 'Unassigned')).toBe(true)
  })

  it('returns [] for empty input', () => {
    expect(perTechnicianLoad([])).toEqual([])
  })
})

describe('bayScheduling — technicianConflicts (G5)', () => {
  it('flags a technician double-booked across DIFFERENT bays at overlapping times', () => {
    const rows = [
      { id: 'a', technician: 'A. Rahman', bay_name: 'Bay 1', scheduled_start: iso(DAY0 + 8 * H), scheduled_end: iso(DAY0 + 10 * H) },
      { id: 'b', technician: 'A. Rahman', bay_name: 'Bay 2', scheduled_start: iso(DAY0 + 9 * H), scheduled_end: iso(DAY0 + 11 * H) },
    ]
    const c = technicianConflicts(rows)
    expect(c).toHaveLength(1)
    expect(c[0].technician).toBe('A. Rahman')
    expect(c[0].a.id).toBe('a') // earlier start first
    expect(c[0].b.id).toBe('b')
  })

  it('ignores same-bay overlaps (handled by conflictsForBay), back-to-back, and cancelled', () => {
    const rows = [
      { id: 'a', technician: 'A. Rahman', bay_name: 'Bay 1', scheduled_start: iso(DAY0 + 8 * H), scheduled_end: iso(DAY0 + 10 * H) },
      { id: 'b', technician: 'A. Rahman', bay_name: 'Bay 1', scheduled_start: iso(DAY0 + 9 * H), scheduled_end: iso(DAY0 + 11 * H) }, // same bay
      { id: 'c', technician: 'B. Khan', bay_name: 'Bay 3', scheduled_start: iso(DAY0 + 8 * H), scheduled_end: iso(DAY0 + 9 * H) },
      { id: 'd', technician: 'B. Khan', bay_name: 'Bay 4', scheduled_start: iso(DAY0 + 9 * H), scheduled_end: iso(DAY0 + 10 * H) }, // back-to-back
      { id: 'e', technician: 'C. Lee', bay_name: 'Bay 5', status: 'cancelled', scheduled_start: iso(DAY0 + 8 * H), scheduled_end: iso(DAY0 + 12 * H) },
    ]
    expect(technicianConflicts(rows)).toEqual([])
  })

  it('ignores rows with no technician', () => {
    const rows = [
      { id: 'a', bay_name: 'Bay 1', scheduled_start: iso(DAY0 + 8 * H), scheduled_end: iso(DAY0 + 10 * H) },
      { id: 'b', bay_name: 'Bay 2', scheduled_start: iso(DAY0 + 9 * H), scheduled_end: iso(DAY0 + 11 * H) },
    ]
    expect(technicianConflicts(rows)).toEqual([])
  })
})

describe('bayScheduling — bayOverlapConflicts (write-time guard, pure)', () => {
  it('intervalsOverlap is half-open (touching ends do not overlap)', () => {
    expect(intervalsOverlap(0, 10, 5, 15)).toBe(true)
    expect(intervalsOverlap(0, 10, 10, 20)).toBe(false)
    expect(intervalsOverlap(0, 10, 20, 30)).toBe(false)
  })

  it('returns same-bay non-cancelled rows overlapping the candidate window', () => {
    const existing = [
      { id: 'x', bay_name: 'Bay 1', scheduled_start: iso(DAY0 + 9 * H), scheduled_end: iso(DAY0 + 11 * H) },
      { id: 'y', bay_name: 'Bay 2', scheduled_start: iso(DAY0 + 9 * H), scheduled_end: iso(DAY0 + 11 * H) }, // other bay
      { id: 'z', bay_name: 'Bay 1', status: 'cancelled', scheduled_start: iso(DAY0 + 9 * H), scheduled_end: iso(DAY0 + 11 * H) }, // cancelled
    ]
    const candidate = { bay_name: 'Bay 1', scheduled_start: iso(DAY0 + 10 * H), scheduled_end: iso(DAY0 + 12 * H) }
    const clash = bayOverlapConflicts(candidate, existing)
    expect(clash.map((r) => r.id)).toEqual(['x'])
  })

  it('excludes the candidate own row by id (edit does not clash with itself)', () => {
    const existing = [
      { id: 'self', bay_name: 'Bay 1', scheduled_start: iso(DAY0 + 8 * H), scheduled_end: iso(DAY0 + 10 * H) },
    ]
    const candidate = { id: 'self', bay_name: 'Bay 1', scheduled_start: iso(DAY0 + 8 * H), scheduled_end: iso(DAY0 + 10 * H) }
    expect(bayOverlapConflicts(candidate, existing)).toEqual([])
  })

  it('does not flag back-to-back jobs on the same bay', () => {
    const existing = [
      { id: 'x', bay_name: 'Bay 1', scheduled_start: iso(DAY0 + 8 * H), scheduled_end: iso(DAY0 + 10 * H) },
    ]
    const candidate = { bay_name: 'Bay 1', scheduled_start: iso(DAY0 + 10 * H), scheduled_end: iso(DAY0 + 12 * H) }
    expect(bayOverlapConflicts(candidate, existing)).toEqual([])
  })

  it('returns [] when the candidate is cancelled, unscheduled, or bay-less (nothing to guard)', () => {
    const existing = [{ id: 'x', bay_name: 'Bay 1', scheduled_start: iso(DAY0 + 8 * H), scheduled_end: iso(DAY0 + 12 * H) }]
    expect(bayOverlapConflicts({ bay_name: 'Bay 1', status: 'cancelled', scheduled_start: iso(DAY0 + 9 * H), scheduled_end: iso(DAY0 + 10 * H) }, existing)).toEqual([])
    expect(bayOverlapConflicts({ bay_name: 'Bay 1', scheduled_start: iso(DAY0 + 9 * H) }, existing)).toEqual([])
    expect(bayOverlapConflicts({ scheduled_start: iso(DAY0 + 9 * H), scheduled_end: iso(DAY0 + 10 * H) }, existing)).toEqual([])
  })
})
