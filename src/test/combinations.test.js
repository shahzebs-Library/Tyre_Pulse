import { describe, it, expect } from 'vitest'
import { parseTrailerList, summarizeCombinations } from '../lib/combinations'

describe('parseTrailerList', () => {
  it('returns [] for nullish input', () => {
    expect(parseTrailerList(null)).toEqual([])
    expect(parseTrailerList(undefined)).toEqual([])
    expect(parseTrailerList('')).toEqual([])
  })

  it('splits on commas and whitespace, trimming blanks', () => {
    expect(parseTrailerList('T1, T2 T3')).toEqual(['T1', 'T2', 'T3'])
    expect(parseTrailerList('  T1 ,,  T2 ')).toEqual(['T1', 'T2'])
  })

  it('dedupes case-insensitively, keeping first spelling and order', () => {
    expect(parseTrailerList('T1, t1, T2, T1')).toEqual(['T1', 'T2'])
  })

  it('accepts an array input', () => {
    expect(parseTrailerList(['A', ' B ', 'a', ''])).toEqual(['A', 'B'])
  })
})

describe('summarizeCombinations', () => {
  it('handles empty / non-array input', () => {
    expect(summarizeCombinations([])).toEqual({ total: 0, active: 0, inactive: 0, trailers: 0, units: 0 })
    expect(summarizeCombinations(undefined)).toEqual({ total: 0, active: 0, inactive: 0, trailers: 0, units: 0 })
  })

  it('counts combinations, active/inactive, trailers and total units', () => {
    const rows = [
      { status: 'active', prime_mover_no: 'PM1', trailer_nos: ['T1', 'T2'] },
      { status: 'inactive', prime_mover_no: 'PM2', trailer_nos: ['T3'] },
      { status: 'active', prime_mover_no: 'PM3', trailer_nos: [] },
    ]
    expect(summarizeCombinations(rows)).toEqual({
      total: 3,
      active: 2,
      inactive: 1,
      trailers: 3, // 2 + 1 + 0
      units: 6,    // 3 movers + 3 trailers
    })
  })

  it('parses string trailer_nos and ignores blank prime movers for unit count', () => {
    const rows = [
      { status: 'active', prime_mover_no: 'PM1', trailer_nos: 'T1, T2' },
      { status: 'active', prime_mover_no: '   ', trailer_nos: 'T3' },
    ]
    const s = summarizeCombinations(rows)
    expect(s.trailers).toBe(3)
    expect(s.units).toBe(4) // 1 mover + 3 trailers
  })
})
