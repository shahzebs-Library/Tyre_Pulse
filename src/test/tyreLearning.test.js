import { describe, it, expect } from 'vitest'
import {
  normalizeBrandToken, hasValue, shapeSuggestions, suggestionSummary,
  shapeGapOverview, shapeMasterCompleteness,
  MATCH_TYPES, TARGET_FIELDS, SUGGESTABLE_FIELDS,
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
  it('reads suggested_value (new key) and keeps a brand alias', () => {
    const out = shapeSuggestions([
      { serial_key: 'S', serial_no: 'S1', country: 'KSA', rows: 3, suggested_value: '315/80 r22.5', source: 'self' },
    ])
    expect(out).toHaveLength(1)
    expect(out[0].value).toBe('315/80 R22.5')
    expect(out[0].brand).toBe('315/80 R22.5') // back-compat alias === value
    expect(out[0].serialNo).toBe('S1')
    expect(out[0].rows).toBe(3)
    expect(out[0].sourceLabel).toBeTruthy()
  })
})

describe('shapeGapOverview', () => {
  it('computes filled pct and honest null on zero total', () => {
    const out = shapeGapOverview({
      ok: true,
      total: 400,
      fields: [
        { field: 'brand', label: 'Brand', total: 400, blank: 100, recoverable: 42 },
        { field: 'removal_reason', label: 'Removal reason', total: 0, blank: 0, recoverable: null },
      ],
    })
    expect(out).toHaveLength(2)
    expect(out[0].field).toBe('brand')
    expect(out[0].pct).toBe(75) // (400-100)/400
    expect(out[0].recoverable).toBe(42)
    expect(out[1].pct).toBeNull() // zero total -> honest null
    expect(out[1].recoverable).toBeNull()
  })
  it('returns [] for null/!ok input', () => {
    expect(shapeGapOverview(null)).toEqual([])
    expect(shapeGapOverview({ ok: false })).toEqual([])
  })
})

describe('shapeMasterCompleteness', () => {
  it('sorts by ord and computes blank + pct', () => {
    const out = shapeMasterCompleteness({
      ok: true,
      table: 'ksa_country_upload_template_staging',
      total: 200,
      columns: [
        { column: 'tyre_brand', ord: 2, filled: 150 },
        { column: 'serialno', ord: 1, filled: 200 },
      ],
    })
    expect(out.total).toBe(200)
    expect(out.columns.map((c) => c.column)).toEqual(['serialno', 'tyre_brand']) // sorted by ord
    expect(out.columns[0].blank).toBe(0)
    expect(out.columns[0].pct).toBe(100)
    expect(out.columns[1].blank).toBe(50)
    expect(out.columns[1].pct).toBe(75)
  })
  it('returns empty shape for null/!ok input', () => {
    expect(shapeMasterCompleteness(null)).toEqual({ total: 0, columns: [] })
    expect(shapeMasterCompleteness({ ok: false })).toEqual({ total: 0, columns: [] })
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
    expect(TARGET_FIELDS.size).toBe('Size')
    expect(TARGET_FIELDS.removal_reason).toBe('Removal reason')
    expect(SUGGESTABLE_FIELDS).toEqual(['brand', 'size'])
  })
})
