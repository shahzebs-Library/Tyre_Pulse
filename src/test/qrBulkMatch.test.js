import { describe, it, expect } from 'vitest'
import {
  canonCode, parseCodes, codesFromRows, matchCodes, matchSummary, rowWhere,
} from '../lib/qrBulkMatch'

const fleet = [
  { id: 'a', asset_no: 'TM360', country: 'KSA',   site: 'NHC',    vehicle_type: 'TR-MIXER' },
  { id: 'b', asset_no: 'TM360', country: 'UAE',   site: 'JEBEL',  vehicle_type: 'PUMPS' },
  { id: 'c', asset_no: 'MP093', country: 'KSA',   site: 'DIRIYAH', vehicle_type: 'PUMPS' },
  { id: 'd', asset_no: 'BH021', country: 'KSA',   site: null,     vehicle_type: null },
]

describe('canonCode', () => {
  it('upper-cases and strips whitespace and quotes', () => {
    expect(canonCode(' tm360 ')).toBe('TM360')
    expect(canonCode('"MP093"')).toBe('MP093')
    expect(canonCode('TM\t360')).toBe('TM360')
  })
  it('returns empty for nothing usable', () => {
    expect(canonCode(null)).toBe('')
    expect(canonCode('   ')).toBe('')
    expect(canonCode(undefined)).toBe('')
  })
})

describe('parseCodes', () => {
  it('reads one per line, comma, tab and semicolon separated alike', () => {
    const { codes } = parseCodes('TM360\nMP093, BH021;GN103\tSL019')
    expect(codes).toEqual(['TM360', 'MP093', 'BH021', 'GN103', 'SL019'])
  })
  it('de-duplicates in first-seen order and names the repeats', () => {
    const { codes, repeated, total } = parseCodes('TM360\nMP093\ntm360')
    expect(codes).toEqual(['TM360', 'MP093'])
    expect(repeated).toEqual(['TM360'])
    expect(total).toBe(3)
  })
  it('ignores blank lines and stray punctuation', () => {
    expect(parseCodes('\n\n  ;;  ,, \n').codes).toEqual([])
    expect(parseCodes('').codes).toEqual([])
    expect(parseCodes(null).codes).toEqual([])
  })
})

describe('codesFromRows', () => {
  it('reads every cell of a sheet, header row included', () => {
    const { codes } = codesFromRows([['Asset'], ['TM360'], ['MP093', 'spare']])
    // The header word comes through as a code and is reported unmatched later,
    // rather than a guess at which row was a header dropping a real code.
    expect(codes).toEqual(['ASSET', 'TM360', 'MP093', 'SPARE'])
  })
  it('survives blanks and a non-array argument', () => {
    expect(codesFromRows([[''], [null], []]).codes).toEqual([])
    expect(codesFromRows(null).codes).toEqual([])
  })
})

describe('matchCodes', () => {
  it('matches a code that resolves to exactly one row', () => {
    const r = matchCodes(['MP093'], fleet)
    expect(r.counts).toEqual({ asked: 1, matched: 1, ambiguous: 0, unmatched: 0 })
    expect(r.ids).toEqual(['c'])
  })

  it('REFUSES to pick when a code exists in two countries', () => {
    // The whole point: TM360 is a different machine in KSA and UAE (V376).
    const r = matchCodes(['TM360'], fleet)
    expect(r.matched).toEqual([])
    expect(r.ids).toEqual([])
    expect(r.ambiguous).toHaveLength(1)
    expect(r.ambiguous[0].rows.map((x) => x.id)).toEqual(['a', 'b'])
  })

  it('reports a code the register does not carry instead of dropping it', () => {
    const r = matchCodes(['ZZ999', 'MP093'], fleet)
    expect(r.unmatched).toEqual(['ZZ999'])
    expect(r.ids).toEqual(['c'])
  })

  it('is case and padding insensitive on both sides', () => {
    const padded = [{ id: 'p', asset_no: '  tm999  ' }]
    expect(matchCodes(['TM999'], padded).ids).toEqual(['p'])
  })

  it('asks for each code once even when the list repeats it', () => {
    const r = matchCodes(['MP093', 'mp093', 'MP093'], fleet)
    expect(r.counts.asked).toBe(1)
    expect(r.ids).toEqual(['c'])
  })

  it('reads the identifier through getCode, so serials work too', () => {
    const tyres = [{ id: 't1', serial_number: 'EP060420711' }]
    const r = matchCodes(['ep060420711'], tyres, { getCode: (x) => x.serial_number })
    expect(r.ids).toEqual(['t1'])
  })

  it('skips rows with no identifier rather than indexing them under ""', () => {
    const r = matchCodes(['MP093'], [...fleet, { id: 'x', asset_no: null }, { id: 'y', asset_no: '  ' }])
    expect(r.counts.matched).toBe(1)
    expect(r.ids).toEqual(['c'])
  })

  it('degrades on junk input without throwing', () => {
    expect(matchCodes(null, null).counts).toEqual({ asked: 0, matched: 0, ambiguous: 0, unmatched: 0 })
    expect(matchCodes([''], fleet).counts.asked).toBe(0)
  })
})

describe('matchSummary', () => {
  it('names what was not found, not just what was', () => {
    const r = matchCodes(['MP093', 'TM360', 'ZZ999'], fleet)
    const s = matchSummary(r, 'asset code')
    expect(s).toContain('1 asset code matched of 3')
    expect(s).toContain('1 asset code found in more than one place')
    expect(s).toContain('1 asset code not in the register')
  })
  it('says so plainly when everything matched', () => {
    expect(matchSummary(matchCodes(['MP093'], fleet), 'asset code'))
      .toBe('1 asset code matched of 1.')
  })
  it('handles an empty lookup', () => {
    expect(matchSummary(matchCodes([], fleet), 'asset code')).toBe('No asset codes to look up.')
    expect(matchSummary(null)).toBe('No codes to look up.')
  })
})

describe('rowWhere', () => {
  it('leads with country, which is what actually differs', () => {
    expect(rowWhere(fleet[0])).toBe('KSA - NHC - TR-MIXER')
  })
  it('never renders an empty string', () => {
    expect(rowWhere({})).toBe('no location recorded')
    expect(rowWhere(null)).toBe('no location recorded')
  })
})

describe('reading an uploaded file end to end', () => {
  // Exercises the REAL parser rather than a stand-in: parseWorkbookRaw returns
  // { sheets: [...] }, not a bare array, and reading it as an array made every
  // upload fail with "could not read that file" while the code looked correct.
  const toBuffer = (text) => {
    const bytes = new TextEncoder().encode(text)
    return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)
  }

  it('reads a plain column of codes out of a CSV', async () => {
    const { parseWorkbookRaw } = await import('../lib/import/parseWorkbook')
    const { sheets } = await parseWorkbookRaw(toBuffer('Asset Code\nTM360\nMP093\n'), { fileName: 'codes.csv' })
    const aoa = (sheets || []).flatMap((s) => s.aoa || [])
    expect(codesFromRows(aoa).codes).toEqual(['ASSET', 'CODE', 'TM360', 'MP093'])
  })

  it('keeps the first data row when the file has no header at all', async () => {
    const { parseWorkbookRaw } = await import('../lib/import/parseWorkbook')
    const { sheets } = await parseWorkbookRaw(toBuffer('TM360\nMP093\n'), { fileName: 'codes.txt' })
    const aoa = (sheets || []).flatMap((s) => s.aoa || [])
    // A header-detecting read would have eaten TM360 as a column label.
    expect(codesFromRows(aoa).codes).toEqual(['TM360', 'MP093'])
  })
})
