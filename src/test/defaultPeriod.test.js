import { describe, it, expect } from 'vitest'
import {
  toIsoDay, parseDay, monthBounds, monthLabel, resolveDefaultPeriod, ALL_TIME,
} from '../lib/defaultPeriod'

const AUG = new Date(2026, 7, 11) // 11 Aug 2026, local

describe('toIsoDay', () => {
  it('uses local time, so a GCC evening does not report yesterday', () => {
    // toISOString() on a +03:00 midnight-adjacent date rolls the day back; this
    // is the bug the helper exists to avoid.
    expect(toIsoDay(new Date(2026, 7, 1, 1, 30))).toBe('2026-08-01')
    expect(toIsoDay(new Date(2026, 7, 31, 23, 30))).toBe('2026-08-31')
  })

  it('returns null for a non-date', () => {
    expect(toIsoDay('nonsense')).toBeNull()
    expect(toIsoDay(null)).toBeNull()
  })
})

describe('monthBounds', () => {
  it('covers the whole month including the last day', () => {
    expect(monthBounds(AUG)).toEqual({ from: '2026-08-01', to: '2026-08-31' })
  })

  it('gets February right', () => {
    expect(monthBounds(new Date(2026, 1, 10))).toEqual({ from: '2026-02-01', to: '2026-02-28' })
    expect(monthBounds(new Date(2024, 1, 10)).to).toBe('2024-02-29')
  })
})

describe('resolveDefaultPeriod', () => {
  it('opens on the current month when the feed has data in it', () => {
    const p = resolveDefaultPeriod({ latest: '2026-08-09', now: AUG })
    expect(p).toMatchObject({
      from: '2026-08-01', to: '2026-08-31', isCurrentMonth: true, fellBack: false, note: null,
    })
  })

  it('falls back to the last month with data, and says so', () => {
    // tyre_records genuinely stops at 30 Jul on live data; defaulting it to
    // August would show an empty page and read as lost data.
    const p = resolveDefaultPeriod({ latest: '2026-07-30', now: AUG })
    expect(p.from).toBe('2026-07-01')
    expect(p.to).toBe('2026-07-31')
    expect(p.fellBack).toBe(true)
    expect(p.note).toContain('July 2026')
    expect(p.note).toContain('August 2026')
  })

  it('does not follow a future-dated row into a month that has not happened', () => {
    // work_orders carries opened_at values into Dec 2026.
    const p = resolveDefaultPeriod({ latest: '2026-12-05', now: AUG })
    expect(p.from).toBe('2026-08-01')
    expect(p.isCurrentMonth).toBe(true)
    expect(p.fellBack).toBe(false)
  })

  it('opens on the current month when we could not read the feed', () => {
    // Unknown is not empty: we default to the fast option and say nothing,
    // rather than claiming a month has no data when we never looked.
    const p = resolveDefaultPeriod({ latest: null, now: AUG })
    expect(p.isCurrentMonth).toBe(true)
    expect(p.note).toBeNull()
  })

  it('handles a feed that has been silent for a year', () => {
    const p = resolveDefaultPeriod({ latest: '2025-03-14', now: AUG })
    expect(p.from).toBe('2025-03-01')
    expect(p.to).toBe('2025-03-31')
    expect(p.note).toContain('March 2025')
  })

  it('ignores an unparseable date rather than throwing', () => {
    expect(resolveDefaultPeriod({ latest: 'not a date', now: AUG }).isCurrentMonth).toBe(true)
  })
})

describe('monthLabel and ALL_TIME', () => {
  it('labels a month', () => {
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
