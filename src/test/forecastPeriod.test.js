/**
 * A forecast must say which months it covers.
 *
 * Every forecast here is anchored to the latest month that HAS DATA, not to
 * today. "Next 3 Months" therefore means three months after the last upload,
 * which on a fleet whose files are a month behind is not the next three months
 * at all - and the screen used to look identical either way.
 */
import { describe, it, expect } from 'vitest'
import {
  monthName, monthsBetween, forecastWindow, staleNote, windowFromMonths,
} from '../lib/forecastPeriod'

describe('monthName', () => {
  it('names a month from a date, a month key or an ISO day', () => {
    expect(monthName(new Date(2026, 7, 13))).toBe('Aug 2026')
    expect(monthName('2026-08')).toBe('Aug 2026')
    expect(monthName('2026-08-13')).toBe('Aug 2026')
  })

  it('reads a month key in LOCAL time, so the fleet at +03:00 does not lose a month', () => {
    // Date('2026-08-01') parses as UTC midnight, which is 31 Jul locally in
    // any negative offset and rolls the label back a month
    expect(monthName('2026-01-01')).toBe('Jan 2026')
    expect(monthName('2026-12-01')).toBe('Dec 2026')
  })

  it('returns nothing rather than a guess for junk', () => {
    expect(monthName(null)).toBe('')
    expect(monthName('not a date')).toBe('')
  })
})

describe('monthsBetween', () => {
  it('counts whole months in either direction and across a year end', () => {
    expect(monthsBetween('2026-07', '2026-08')).toBe(1)
    expect(monthsBetween('2026-08', '2026-07')).toBe(-1)
    expect(monthsBetween('2025-11', '2026-02')).toBe(3)
    expect(monthsBetween('2026-08', '2026-08')).toBe(0)
  })

  it('is null when either end is unusable - never zero', () => {
    // zero would read as "up to date", which is a claim we cannot make
    expect(monthsBetween(null, '2026-08')).toBeNull()
    expect(monthsBetween('2026-08', 'junk')).toBeNull()
  })
})

describe('forecastWindow', () => {
  it('names both ends of the history and both ends of the projection', () => {
    const w = forecastWindow({ anchor: '2026-08', historyMonths: 12, ahead: 3 })
    expect(w.ok).toBe(true)
    expect(w.historyFrom).toBe('Sep 2025')
    expect(w.historyTo).toBe('Aug 2026')
    expect(w.forecastFrom).toBe('Sep 2026')
    expect(w.forecastTo).toBe('Nov 2026')
    expect(w.label).toBe('Built from Sep 2025 to Aug 2026 (12 months), projecting Sep 2026 to Nov 2026')
  })

  it('does not say "to" when the projection is a single month', () => {
    const w = forecastWindow({ anchor: '2026-08', historyMonths: 6, ahead: 1 })
    expect(w.forecastFrom).toBe('Sep 2026')
    expect(w.label).toContain('projecting Sep 2026')
    expect(w.label).not.toContain('Sep 2026 to Sep 2026')
  })

  it('describes history alone when nothing is projected', () => {
    const w = forecastWindow({ anchor: '2026-08', historyMonths: 12, ahead: 0 })
    expect(w.label).toBe('Built from Sep 2025 to Aug 2026 (12 months)')
    expect(w.forecastFrom).toBe('')
  })

  it('says how far behind the data is, and why the projection starts there', () => {
    const w = forecastWindow({ anchor: '2026-07', historyMonths: 12, ahead: 3, now: '2026-08-13' })
    expect(w.stale).toBe(true)
    expect(w.staleMonths).toBe(1)
    expect(w.note).toContain('Jul 2026')
    expect(w.note).toContain('1 month behind today')
    expect(w.note).toMatch(/rather than from this month/i)
    // and the projection genuinely does start from the anchor, not from today
    expect(w.forecastFrom).toBe('Aug 2026')
  })

  it('stays silent about staleness when the data is current', () => {
    const w = forecastWindow({ anchor: '2026-08', historyMonths: 12, ahead: 3, now: '2026-08-13' })
    expect(w.stale).toBe(false)
    expect(w.note).toBe('')
  })

  it('never invents a staleness warning when no clock was supplied', () => {
    // a caller that does not pass `now` has not told us what day it is; that
    // must read as up to date, not as a fabricated month-behind warning
    const w = forecastWindow({ anchor: '2026-01', historyMonths: 12, ahead: 3 })
    expect(w.stale).toBe(false)
    expect(w.note).toBe('')
  })

  it('returns an unusable-but-safe shape when there is no anchor at all', () => {
    const w = forecastWindow({ anchor: null })
    expect(w.ok).toBe(false)
    expect(w.label).toBe('')
    expect(w.note).toBe('')
  })

  it('clamps nonsense inputs instead of rendering NaN months', () => {
    const w = forecastWindow({ anchor: '2026-08', historyMonths: 0, ahead: -4 })
    expect(w.historyMonths).toBe(1)
    expect(w.ahead).toBe(0)
    expect(w.label).toBe('Built from Aug 2026 to Aug 2026 (1 months)')
  })
})

describe('staleNote', () => {
  it('is silent for a current or unmeasurable anchor', () => {
    expect(staleNote('Aug 2026', 0)).toBe('')
    expect(staleNote('Aug 2026', null)).toBe('')
    expect(staleNote('', 3)).toBe('')
  })

  it('pluralises honestly', () => {
    expect(staleNote('Jul 2026', 1)).toContain('1 month behind')
    expect(staleNote('May 2026', 3)).toContain('3 months behind')
  })
})

describe('windowFromMonths', () => {
  it('reads the window off a demand forecast rather than being told it twice', () => {
    // the caption and the chart must describe the same months; deriving the
    // caption from the result is what guarantees it
    const fc = {
      months: ['2026-03', '2026-04', '2026-05', '2026-06', '2026-07', '2026-08'],
      forecastMonths: ['2026-09', '2026-10'],
    }
    const w = windowFromMonths(fc)
    expect(w.historyFrom).toBe('Mar 2026')
    expect(w.historyTo).toBe('Aug 2026')
    expect(w.historyMonths).toBe(6)
    expect(w.forecastFrom).toBe('Sep 2026')
    expect(w.forecastTo).toBe('Oct 2026')
  })

  it('is safe on an empty or missing forecast', () => {
    expect(windowFromMonths(null).ok).toBe(false)
    expect(windowFromMonths({ months: [] }).ok).toBe(false)
  })
})
