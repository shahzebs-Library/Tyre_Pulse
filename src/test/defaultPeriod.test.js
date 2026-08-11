import { describe, it, expect } from 'vitest'
import {
  toIsoDay, parseDay, monthBounds, yearBounds, defaultWindow, monthLabel,
  periodName, previousPeriodName, resolveDefaultPeriod, ALL_TIME, MIN_MONTHS,
} from '../lib/defaultPeriod'

const AUG = new Date(2026, 7, 11)  // 11 Aug 2026, local
const JAN = new Date(2026, 0, 4)   // 4 Jan 2026 - the month the floor exists for

describe('toIsoDay', () => {
  it('uses local time, so a GCC evening does not report yesterday', () => {
    expect(toIsoDay(new Date(2026, 7, 1, 1, 30))).toBe('2026-08-01')
    expect(toIsoDay(new Date(2026, 7, 31, 23, 30))).toBe('2026-08-31')
  })

  it('returns null for a non-date', () => {
    expect(toIsoDay('nonsense')).toBeNull()
    expect(toIsoDay(null)).toBeNull()
  })
})

describe('bounds', () => {
  it('monthBounds covers the whole month including the last day', () => {
    expect(monthBounds(AUG)).toEqual({ from: '2026-08-01', to: '2026-08-31' })
    expect(monthBounds(new Date(2024, 1, 10)).to).toBe('2024-02-29')
  })

  it('yearBounds covers the calendar year', () => {
    expect(yearBounds(AUG)).toEqual({ from: '2026-01-01', to: '2026-12-31' })
  })
})

describe('defaultWindow', () => {
  it('is year to date', () => {
    expect(defaultWindow(AUG)).toEqual({ from: '2026-01-01', to: '2026-08-11' })
  })

  it('reaches back past new year rather than showing four days in January', () => {
    // Without the floor a year-to-date screen goes blank every 1 January.
    const w = defaultWindow(JAN)
    expect(w.from).toBe('2025-11-01')
    expect(w.to).toBe('2026-01-04')
  })

  it('the floor is three months', () => {
    expect(MIN_MONTHS).toBe(3)
  })
})

describe('periodName - screens must never say "this period"', () => {
  it('names a whole calendar year', () => {
    expect(periodName('2025-01-01', '2025-12-31')).toBe('2025')
  })

  it('names a year to date', () => {
    expect(periodName('2026-01-01', '2026-08-11')).toBe('2026 to date')
  })

  it('names a single month', () => {
    expect(periodName('2026-08-01', '2026-08-31')).toContain('August')
    expect(periodName('2026-08-01', '2026-08-31')).toContain('2026')
  })

  it('names both ends of anything else', () => {
    const n = periodName('2025-11-01', '2026-01-04')
    expect(n).toMatch(/2025/)
    expect(n).toMatch(/2026/)
    expect(n).toContain(' to ')
  })

  it('says All time when unbounded', () => {
    expect(periodName(null, null)).toBe('All time')
  })
})

describe('previousPeriodName', () => {
  it('names the year before a full year', () => {
    expect(previousPeriodName('2026-01-01', '2026-12-31')).toBe('2025')
  })

  it('names the month before a month', () => {
    expect(previousPeriodName('2026-08-01', '2026-08-31')).toContain('July')
  })

  it('degrades to a word rather than throwing on an open range', () => {
    expect(previousPeriodName(null, null)).toBe('Earlier')
  })
})

describe('resolveDefaultPeriod', () => {
  it('opens on the year to date when the feed has data in it', () => {
    // tyre_records: 0 rows this month but 3,653 this year - the whole reason
    // the default is the year and not the month.
    const p = resolveDefaultPeriod({ latest: '2026-07-30', now: AUG })
    expect(p.from).toBe('2026-01-01')
    expect(p.fellBack).toBe(false)
    expect(p.note).toBeNull()
  })

  it('falls back to the last year with data, and says so', () => {
    const p = resolveDefaultPeriod({ latest: '2024-06-30', now: AUG })
    expect(p.from).toBe('2024-01-01')
    expect(p.to).toBe('2024-12-31')
    expect(p.fellBack).toBe(true)
    expect(p.note).toContain('2024')
  })

  it('does not follow a future-dated row into a year that has not happened', () => {
    const p = resolveDefaultPeriod({ latest: '2026-12-05', now: AUG })
    expect(p.from).toBe('2026-01-01')
    expect(p.fellBack).toBe(false)
  })

  it('opens on the default when we could not read the feed', () => {
    const p = resolveDefaultPeriod({ latest: null, now: AUG })
    expect(p.isDefault).toBe(true)
    expect(p.note).toBeNull()
  })

  it('ignores an unparseable date rather than throwing', () => {
    expect(resolveDefaultPeriod({ latest: 'not a date', now: AUG }).isDefault).toBe(true)
  })
})

describe('misc', () => {
  it('monthLabel names a month', () => {
    expect(monthLabel(AUG)).toContain('2026')
    expect(monthLabel(null)).toBeNull()
  })

  it('all-time carries no bounds', () => {
    expect(ALL_TIME).toEqual({ from: null, to: null, label: 'All time' })
  })

  it('parseDay round-trips a date', () => {
    expect(toIsoDay(parseDay('2026-08-11T10:00:00Z'))).toMatch(/^2026-08-/)
  })
})
