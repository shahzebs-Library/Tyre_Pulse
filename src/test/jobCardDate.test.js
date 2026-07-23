import { describe, it, expect } from 'vitest'
import {
  parseJobCardPeriod,
  dateParts,
  periodMatchesDate,
  checkJobCardPeriod,
  describePeriod,
  formatPeriodMMYY,
  describeCheck,
  summarizeJobCardChecks,
} from '../lib/jobCardDate'

describe('parseJobCardPeriod', () => {
  it('reads MMYY from the real ERP examples', () => {
    expect(parseJobCardPeriod('GCKR/JC/0131/0726')).toEqual({ month: 7, year: 2026 })
    expect(parseJobCardPeriod('RM/RMJC/0001/0226')).toEqual({ month: 2, year: 2026 })
    expect(parseJobCardPeriod('EG/JC/0001/0120')).toEqual({ month: 1, year: 2020 })
  })

  it('handles trailing spaces', () => {
    expect(parseJobCardPeriod('GCKR/JC/0131/0726   ')).toEqual({ month: 7, year: 2026 })
  })

  it('handles different separators', () => {
    expect(parseJobCardPeriod('GCKR-JC-0131-0726')).toEqual({ month: 7, year: 2026 })
    expect(parseJobCardPeriod('GCKR JC 0131 0726')).toEqual({ month: 7, year: 2026 })
    expect(parseJobCardPeriod('0726')).toEqual({ month: 7, year: 2026 })
  })

  it('accepts December (12) at the boundary', () => {
    expect(parseJobCardPeriod('EG/JC/0009/1224')).toEqual({ month: 12, year: 2024 })
  })

  it('accepts a numeric argument', () => {
    expect(parseJobCardPeriod(1226)).toEqual({ month: 12, year: 2026 })
  })

  it('rejects an invalid month MM = 13', () => {
    expect(parseJobCardPeriod('GCKR/JC/0131/1326')).toBeNull()
  })

  it('rejects month 00', () => {
    expect(parseJobCardPeriod('GCKR/JC/0131/0026')).toBeNull()
  })

  it('returns null when there is no trailing 4 digit group', () => {
    expect(parseJobCardPeriod('GCKR/JC/ABCD')).toBeNull()
    expect(parseJobCardPeriod('GCKR/JC/072')).toBeNull()
  })

  it('is null-safe on empty / null / undefined', () => {
    expect(parseJobCardPeriod('')).toBeNull()
    expect(parseJobCardPeriod('   ')).toBeNull()
    expect(parseJobCardPeriod(null)).toBeNull()
    expect(parseJobCardPeriod(undefined)).toBeNull()
  })

  it('reads the final 4 digit group when several exist', () => {
    expect(parseJobCardPeriod('EG/0525/0001/0120')).toEqual({ month: 1, year: 2020 })
  })
})

describe('dateParts', () => {
  it('reads month/year from a timestamp string without timezone shift', () => {
    expect(dateParts('2026-07-02 17:15:00+00')).toEqual({ month: 7, year: 2026 })
    expect(dateParts('2020-01-31T23:00:00Z')).toEqual({ month: 1, year: 2020 })
  })

  it('reads a date-only string', () => {
    expect(dateParts('2026-02-14')).toEqual({ month: 2, year: 2026 })
  })

  it('reads a Date object', () => {
    expect(dateParts(new Date('2026-03-05T20:53:00Z'))).toEqual({ month: 3, year: 2026 })
  })

  it('is null-safe on missing / invalid', () => {
    expect(dateParts(null)).toBeNull()
    expect(dateParts(undefined)).toBeNull()
    expect(dateParts('')).toBeNull()
    expect(dateParts('not a date')).toBeNull()
    expect(dateParts(new Date('bad'))).toBeNull()
  })
})

describe('periodMatchesDate', () => {
  it('true when month and year agree', () => {
    expect(periodMatchesDate({ month: 7, year: 2026 }, '2026-07-02 17:15:00+00')).toBe(true)
  })

  it('false when the year disagrees (the 0336 typo class)', () => {
    expect(periodMatchesDate({ month: 3, year: 2036 }, '2026-03-01 08:40:00+00')).toBe(false)
  })

  it('false when the month disagrees', () => {
    expect(periodMatchesDate({ month: 7, year: 2026 }, '2026-08-02')).toBe(false)
  })

  it('false (not throwing) when either side is unknown', () => {
    expect(periodMatchesDate(null, '2026-07-02')).toBe(false)
    expect(periodMatchesDate({ month: 7, year: 2026 }, null)).toBe(false)
    expect(periodMatchesDate({ month: 7, year: 2026 }, 'bad')).toBe(false)
  })
})

describe('checkJobCardPeriod', () => {
  it('flags a matching record as known + match, not mismatch', () => {
    const r = checkJobCardPeriod('GCKR/JC/0195/0726', '2026-07-02 17:15:00+00')
    expect(r.known).toBe(true)
    expect(r.match).toBe(true)
    expect(r.mismatch).toBe(false)
    expect(r.period).toEqual({ month: 7, year: 2026 })
  })

  it('flags the real 0336/2036 typo as a mismatch', () => {
    const r = checkJobCardPeriod('GCKR/JC/0041/0336', '2026-03-01 08:40:00+00')
    expect(r.known).toBe(true)
    expect(r.match).toBe(false)
    expect(r.mismatch).toBe(true)
    expect(r.period).toEqual({ month: 3, year: 2036 })
    expect(r.date).toEqual({ month: 3, year: 2026 })
  })

  it('does not flag when the period is not derivable (unknown)', () => {
    const r = checkJobCardPeriod('GCKR/JC/1326', '2026-03-01')
    expect(r.known).toBe(false)
    expect(r.match).toBe(false)
    expect(r.mismatch).toBe(false)
  })

  it('does not flag when the date is missing (unknown)', () => {
    const r = checkJobCardPeriod('GCKR/JC/0195/0726', null)
    expect(r.known).toBe(false)
    expect(r.mismatch).toBe(false)
  })
})

describe('describePeriod / formatPeriodMMYY', () => {
  it('describes a period', () => {
    expect(describePeriod({ month: 7, year: 2026 })).toBe('Jul 2026')
    expect(describePeriod({ month: 1, year: 2020 })).toBe('Jan 2020')
    expect(describePeriod(null)).toBe('Unknown')
  })

  it('formats MMYY zero padded', () => {
    expect(formatPeriodMMYY({ month: 7, year: 2026 })).toBe('0726')
    expect(formatPeriodMMYY({ month: 1, year: 2020 })).toBe('0120')
    expect(formatPeriodMMYY(null)).toBe('')
  })
})

describe('describeCheck', () => {
  it('describes a match', () => {
    const r = checkJobCardPeriod('GCKR/JC/0195/0726', '2026-07-02')
    expect(describeCheck(r)).toBe('Job card period Jul 2026 matches the record date')
  })

  it('describes a mismatch with both periods', () => {
    const r = checkJobCardPeriod('GCKR/JC/0041/0336', '2026-03-01')
    expect(describeCheck(r)).toBe('Job card period Mar 2036 does not match record date Mar 2026')
  })

  it('describes an unverifiable check', () => {
    const r = checkJobCardPeriod('bad', null)
    expect(describeCheck(r)).toBe('Period not verifiable')
    expect(describeCheck(null)).toBe('Period not verifiable')
  })

  it('has no dash punctuation in output', () => {
    const r = checkJobCardPeriod('GCKR/JC/0041/0336', '2026-03-01')
    expect(describeCheck(r)).not.toMatch(/[–—-]/)
  })
})

describe('summarizeJobCardChecks', () => {
  it('counts matched, mismatched and unknown', () => {
    const rows = [
      { jobCardNo: 'GCKR/JC/0195/0726', dateISO: '2026-07-02' }, // match
      { jobCardNo: 'GCKR/JC/0041/0336', dateISO: '2026-03-01' }, // mismatch (2036 typo)
      { jobCardNo: 'GCKR/JC/1326', dateISO: '2026-03-01' },      // unknown (bad month)
      { jobCardNo: 'GCKR/JC/0001/0120', dateISO: null },          // unknown (no date)
    ]
    expect(summarizeJobCardChecks(rows)).toEqual({
      total: 4, checked: 2, matched: 1, mismatched: 1, unknown: 2,
    })
  })

  it('is safe on a non array', () => {
    expect(summarizeJobCardChecks(null)).toEqual({
      total: 0, checked: 0, matched: 0, mismatched: 0, unknown: 0,
    })
  })
})
