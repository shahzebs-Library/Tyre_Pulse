import { describe, it, expect } from 'vitest'
import { scoreHeader, smartMapping, parseDate, TYRE_FIELDS } from '../pages/UploadData'

// Headers from a typical ERP tyre-consumption export.
const ERP_HEADERS = ['Date', 'Serial No', 'Description', 'Brand', 'Vehicle No', 'Tyre Position', 'Fixed KM', 'Job Card', 'Remarks']

describe('smartMapping - greedy assignment regressions', () => {
  const map = smartMapping(ERP_HEADERS, TYRE_FIELDS)

  it('maps every required field to its exact column', () => {
    expect(map.issue_date.header).toBe('Date')
    expect(map.serial_no.header).toBe('Serial No')
    expect(map.description.header).toBe('Description')
    expect(map.asset_no.header).toBe('Vehicle No')
  })

  it('does not let the optional sr field steal a critical column', () => {
    // Regression: "#" normalised to "" and substring-matched every header,
    // then greedy field-order assignment let sr take "Date" (and later,
    // "Serial No" via the generic "no" guess) before required fields ran.
    expect(map.sr.header ?? null).toBeNull()
    expect(map.job_card.header).toBe('Job Card')
    expect(map.position.header).toBe('Tyre Position')
    expect(map.km_at_fitment.header).toBe('Fixed KM')
  })

  it('assigns the strongest global match first, not field-definition order', () => {
    // serial_no (exact, 100) must beat sr's fuzzy interest in "Serial No".
    expect(map.serial_no.score).toBe(100)
  })
})

describe('scoreHeader - empty-guess guard', () => {
  it('ignores guesses that normalise to an empty string', () => {
    expect(scoreHeader('Date', ['#']).score).toBe(0)
    expect(scoreHeader('Anything', ['#', '.', '-']).score).toBe(0)
  })

  it('still matches real guesses', () => {
    expect(scoreHeader('Serial No.', ['serial no']).score).toBe(100)
  })
})

describe('parseDate - junk rejection', () => {
  it('rejects job-card codes that JS Date mis-parses as ancient years', () => {
    expect(parseDate('JC-770')).toBeNull()
    expect(parseDate('770')).toBeNull()
  })

  it('accepts real dates in several formats', () => {
    expect(parseDate('2026-06-15')).toBe('2026-06-15')
    expect(parseDate('15/06/2026')).toBe('2026-06-15')
    expect(parseDate(new Date('2026-06-15T00:00:00Z'))).toBe('2026-06-15')
  })

  it('rejects implausible years', () => {
    expect(parseDate('01/01/1024')).toBeNull()
    expect(parseDate('3050-01-01')).toBeNull()
  })
})
