import { describe, it, expect } from 'vitest'
import {
  normalizeBrandToken, hasValue, shapeSuggestions, suggestionSummary,
  MATCH_TYPES, TARGET_FIELDS,
} from '../lib/tyreLearning'

describe('normalizeBrandToken', () => {
  it('strips tabs/whitespace and uppercases', () => {
    expect(normalizeBrandToken('TRIANGLE\t')).toBe('TRIANGLE')
    expect(normalizeBrandToken('  road x ')).toBe('ROAD X')
  })
  it('rejects the master files blank placeholders', () => {
    for (const t of ['NULL', 'N/A', 'NA', '-', 'NONE', '', '   ', 'unknown']) {
      expect(normalizeBrandToken(t)).toBeNull()
    }
    expect(hasValue('NULL')).toBe(false)
    expect(hasValue('PIRELLI')).toBe(true)
  })
})

describe('shapeSuggestions', () => {
  it('cleans, drops junk brands, and sorts by rows desc', () => {
    const out = shapeSuggestions([
      { serial_key: 'A', serial_no: 'A1', country: 'KSA', rows: 2, suggested_brand: 'triangle\t', source: 'master' },
      { serial_key: 'B', serial_no: 'B1', country: 'KSA', rows: 5, suggested_brand: 'PIRELLI', source: 'self' },
      { serial_key: 'C', serial_no: 'C1', country: 'KSA', rows: 9, suggested_brand: 'NULL', source: 'master' },
    ])
    expect(out.map((r) => r.serialNo)).toEqual(['B1', 'A1']) // C dropped (junk brand), sorted by rows
    expect(out[0].brand).toBe('PIRELLI')
    expect(out[1].brand).toBe('TRIANGLE')
    expect(out[1].source).toBe('master')
  })
  it('returns [] for empty/invalid input', () => {
    expect(shapeSuggestions(null)).toEqual([])
    expect(shapeSuggestions([{ suggested_brand: 'N/A' }])).toEqual([])
  })
})

describe('suggestionSummary', () => {
  it('counts serials, rows and sources', () => {
    const shaped = shapeSuggestions([
      { serial_no: 'A1', rows: 2, suggested_brand: 'TRIANGLE', source: 'master' },
      { serial_no: 'B1', rows: 5, suggested_brand: 'PIRELLI', source: 'self' },
    ])
    const s = suggestionSummary(shaped)
    expect(s.serials).toBe(2)
    expect(s.rows).toBe(7)
    expect(s.fromSelf).toBe(1)
    expect(s.fromMaster).toBe(1)
  })
})

describe('label maps', () => {
  it('expose match types and fields', () => {
    expect(MATCH_TYPES.serial).toBeTruthy()
    expect(MATCH_TYPES.alias).toBeTruthy()
    expect(TARGET_FIELDS.brand).toBe('Brand')
  })
})
