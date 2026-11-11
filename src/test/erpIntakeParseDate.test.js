import { describe, it, expect } from 'vitest'
import { parseDate, parseDateStatus, intakeSheet } from '../lib/erpIntake'

/**
 * F-B-05: the ERP date parser accepts the real export shapes (DD-MM-YY with the
 * Postgres/master_parse_date century pivot, and Excel 5-digit date serials),
 * rejects a value that cannot be a real calendar day, and REPORTS a non-empty
 * junk cell so the intake result screen can say "N dates could not be read"
 * instead of silently dropping it.
 */

// Excel stores a date as whole days since 1899-12-30. Compute the serial for a
// known day independently of the parser, then prove the string path maps it back.
const EXCEL_BASE = Date.UTC(1899, 11, 30)
const serialFor = (y, m, d) => Math.round((Date.UTC(y, m - 1, d) - EXCEL_BASE) / 86400000)

describe('parseDate - accepted shapes (unchanged behaviour preserved)', () => {
  it('keeps the existing ISO / DD-MM-YYYY / DD-Mon-YY handling', () => {
    expect(parseDate('2026-07-01')).toBe('2026-07-01')
    expect(parseDate('02-07-2026')).toBe('2026-07-02')
    expect(parseDate('02/07/2026')).toBe('2026-07-02')
    expect(parseDate('02-Jul-26')).toBe('2026-07-02')
    expect(parseDate('')).toBe('')
    expect(parseDate('not a date')).toBe('')
  })

  it('treats the ERP 1900 blank placeholder as blank, not a date', () => {
    expect(parseDate('1900-01-01')).toBe('')
    expect(parseDate('01-01-1900')).toBe('')
    expect(parseDate('1899-12-30')).toBe('') // the Excel epoch is a blank, not a serial
  })
})

describe('parseDate - DD-MM-YY century pivot (matches Postgres to_date YY)', () => {
  it('reads a bare 2-digit year with 00-69 as 2000s and 70-99 as 1900s', () => {
    expect(parseDate('02-07-26')).toBe('2026-07-02')
    expect(parseDate('02/07/26')).toBe('2026-07-02')
    expect(parseDate('30-06-26')).toBe('2026-06-30')
    expect(parseDate('05-01-69')).toBe('2069-01-05') // 69 -> 2069 (pivot boundary)
    expect(parseDate('05-01-70')).toBe('1970-01-05') // 70 -> 1970
    expect(parseDate('31-12-99')).toBe('1999-12-31')
  })
})

describe('parseDate - Excel date serials (Egypt exports)', () => {
  it('converts a 5-digit serial in the business window', () => {
    expect(parseDate(String(serialFor(2026, 11, 10)))).toBe('2026-11-10')
    expect(parseDate(String(serialFor(2000, 1, 1)))).toBe('2000-01-01')   // lower bound
    expect(parseDate(String(serialFor(2024, 2, 29)))).toBe('2024-02-29')  // leap day
  })

  it('does not read a number outside the date window as a date', () => {
    expect(parseDate('770')).toBe('')      // 3 digits: a reference, not a serial
    expect(parseDate('132283')).toBe('')   // 6 digits: a km reading, not a serial
    expect(parseDate('99999')).toBe('')    // 5 digits but past 2099
  })
})

describe('parseDate - a shape that is not a real calendar day', () => {
  it('rejects an impossible month/day instead of storing garbage', () => {
    expect(parseDate('32-13-2026')).toBe('')
    expect(parseDate('2026-13-02')).toBe('')
    expect(parseDate('31-02-2026')).toBe('') // 31 Feb
  })
})

describe('parseDateStatus - the reason the intake counts an unreadable date', () => {
  it('flags non-empty junk as unparsed, and a blank or real date as not', () => {
    expect(parseDateStatus('not a date')).toEqual({ value: null, unparsed: true })
    expect(parseDateStatus('32-13-2026')).toEqual({ value: null, unparsed: true })
    expect(parseDateStatus('')).toEqual({ value: null, unparsed: false })       // blank cell
    expect(parseDateStatus('   ')).toEqual({ value: null, unparsed: false })    // whitespace only
    expect(parseDateStatus('1900-01-01')).toEqual({ value: null, unparsed: false }) // deliberate ERP blank
    expect(parseDateStatus('2026-07-02')).toEqual({ value: '2026-07-02', unparsed: false })
    expect(parseDateStatus('02-07-26')).toEqual({ value: '2026-07-02', unparsed: false })
  })
})

describe('intakeSheet - surfaces the unreadable-date count', () => {
  const header = ['Job Card No.', 'Job Card Date', 'VEH.NO', 'VEH TYPE/CATEGORY', 'ITEM/TYRE', 'TYRE POSITION', 'TYRE No.', 'TYRE FIX DATE', 'FIXED KM', 'FIXED HRS', 'TYRE REMOVED DATE', 'REMOVED KM', 'REMOVED HRS', 'REASON', 'TOTAL KM', 'TOTAL HRS']

  it('counts a junk date cell and still maps the row', () => {
    const aoa = [
      ['', 'Monthly Tyres', '', '', '', '', '', '', '', '', '', '', '', '', '', ''],
      ['', 'DATE FROM', ': 02 July 2026', '', '', '', '', '', '', '', '', '', '', '', '', ''],
      header,
      ['JC1', '02-07-2026', 'TM556', 'TR-MIXER', '315/80 R 22.5', 'RHF1', 'K507B403553', 'bad-date', '143067', '0', '2026-07-08', '150000', '0', 'MISUSE', '7000', '0'],
    ]
    const res = intakeSheet(aoa, { country: 'KSA' })
    expect(res.target).toBe('tyre_records')
    expect(res.rows).toHaveLength(1)
    // The mapper reads the TYRE FIX DATE ('bad-date', non-empty junk) and the
    // TYRE REMOVED DATE ('2026-07-08', valid); so exactly one date is unreadable.
    expect(res.unparsedDates).toBe(1)
    // The unreadable fit date is left blank; the valid removal date still lands.
    expect(res.rows[0].issue_date).toBe(null)
    expect(res.rows[0].removal_date).toBe('2026-07-08')
  })

  it('counts zero when every date cell is a real date or blank', () => {
    const aoa = [
      ['', 'Monthly Tyres', '', '', '', '', '', '', '', '', '', '', '', '', '', ''],
      ['', 'DATE FROM', ': 02 July 2026', '', '', '', '', '', '', '', '', '', '', '', '', ''],
      header,
      ['JC1', '', 'TM556', 'TR-MIXER', '315/80 R 22.5', 'RHF1', 'K507B403553', '02-07-26', '143067', '0', '', '', '0', 'MISUSE', '7000', '0'],
    ]
    const res = intakeSheet(aoa, { country: 'KSA' })
    expect(res.unparsedDates).toBe(0)
    expect(res.rows[0].issue_date).toBe('2026-07-02') // DD-MM-YY pivot applied
  })
})
