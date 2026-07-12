import { describe, it, expect } from 'vitest'
import {
  toFiniteNumber,
  normaliseTerm,
  matchesRow,
  rankMatches,
  summariseSearches,
  groupByEntity,
} from '../lib/advancedSearch'

describe('advancedSearch — toFiniteNumber', () => {
  it('returns null for empty / nullish input', () => {
    expect(toFiniteNumber('')).toBeNull()
    expect(toFiniteNumber(null)).toBeNull()
    expect(toFiniteNumber(undefined)).toBeNull()
  })

  it('passes through finite numbers', () => {
    expect(toFiniteNumber(42)).toBe(42)
    expect(toFiniteNumber(-3.5)).toBe(-3.5)
    expect(toFiniteNumber(0)).toBe(0)
  })

  it('parses numeric strings, stripping non-numeric characters', () => {
    expect(toFiniteNumber('1,250 km')).toBe(1250)
    expect(toFiniteNumber('SAR 300.75')).toBe(300.75)
  })

  it('returns null for non-numeric strings', () => {
    expect(toFiniteNumber('abc')).toBeNull()
  })
})

describe('advancedSearch — normaliseTerm', () => {
  it('lowercases and trims', () => {
    expect(normaliseTerm('  TRK-1042  ')).toBe('trk-1042')
    expect(normaliseTerm('MixedCase')).toBe('mixedcase')
  })

  it('coerces nullish to empty string', () => {
    expect(normaliseTerm(null)).toBe('')
    expect(normaliseTerm(undefined)).toBe('')
  })

  it('coerces numbers to their string form', () => {
    expect(normaliseTerm(1042)).toBe('1042')
  })
})

describe('advancedSearch — matchesRow', () => {
  const row = { asset_no: 'TRK-1042', site: 'Riyadh Depot', notes: 'Front left wear' }

  it('matches when a named field includes the normalised term', () => {
    expect(matchesRow(row, 'trk', ['asset_no', 'site'])).toBe(true)
    expect(matchesRow(row, 'RIYADH', ['site'])).toBe(true)
  })

  it('returns false when no named field contains the term', () => {
    expect(matchesRow(row, 'jeddah', ['asset_no', 'site'])).toBe(false)
  })

  it('only searches the named fields', () => {
    expect(matchesRow(row, 'wear', ['asset_no', 'site'])).toBe(false)
    expect(matchesRow(row, 'wear', ['notes'])).toBe(true)
  })

  it('returns false for an empty term or missing row', () => {
    expect(matchesRow(row, '', ['asset_no'])).toBe(false)
    expect(matchesRow(row, '   ', ['asset_no'])).toBe(false)
    expect(matchesRow(null, 'trk', ['asset_no'])).toBe(false)
  })

  it('tolerates missing fields on the row', () => {
    expect(matchesRow(row, 'x', ['nonexistent'])).toBe(false)
    expect(matchesRow({}, 'x', ['asset_no'])).toBe(false)
  })
})

describe('advancedSearch — rankMatches', () => {
  const rows = [
    { id: 1, brand: 'Michelin', model: 'X Multi', note: 'good' },
    { id: 2, brand: 'Bridgestone', model: 'Michelin-alike', note: 'michelin ref' },
    { id: 3, brand: 'Goodyear', model: 'Efficient', note: 'none' },
  ]

  it('drops rows with zero field hits', () => {
    const out = rankMatches(rows, 'michelin', ['brand', 'model', 'note'])
    expect(out.map((r) => r.id)).not.toContain(3)
  })

  it('orders rows by number of field hits descending', () => {
    const out = rankMatches(rows, 'michelin', ['brand', 'model', 'note'])
    // row 2 has 2 hits (model + note), row 1 has 1 hit (brand)
    expect(out.map((r) => r.id)).toEqual([2, 1])
  })

  it('is stable for equal scores (preserves input order)', () => {
    const eq = [
      { id: 'a', field: 'alpha' },
      { id: 'b', field: 'alpha' },
      { id: 'c', field: 'alpha' },
    ]
    const out = rankMatches(eq, 'alpha', ['field'])
    expect(out.map((r) => r.id)).toEqual(['a', 'b', 'c'])
  })

  it('returns [] for empty term or non-array input', () => {
    expect(rankMatches(rows, '', ['brand'])).toEqual([])
    expect(rankMatches(null, 'x', ['brand'])).toEqual([])
  })
})

describe('advancedSearch — summariseSearches', () => {
  const rows = [
    { entity: 'assets', pinned: true, result_count: 12 },
    { entity: 'tyres', pinned: false, result_count: '30' },
    { entity: 'assets', pinned: true, result_count: null },
    { entity: 'all', pinned: false, result_count: 8 },
  ]

  it('counts totals, pins, distinct entities and indexed results', () => {
    const s = summariseSearches(rows)
    expect(s.totalSaved).toBe(4)
    expect(s.pinnedCount).toBe(2)
    expect(s.distinctEntities).toBe(3) // assets, tyres, all
    expect(s.totalResultsIndexed).toBe(50) // 12 + 30 + 8
  })

  it('returns zeroed summary for empty / non-array input', () => {
    expect(summariseSearches([])).toEqual({
      totalSaved: 0, pinnedCount: 0, distinctEntities: 0, totalResultsIndexed: 0,
    })
    expect(summariseSearches(null)).toEqual({
      totalSaved: 0, pinnedCount: 0, distinctEntities: 0, totalResultsIndexed: 0,
    })
  })
})

describe('advancedSearch — groupByEntity', () => {
  it('groups by entity and sorts by count descending', () => {
    const rows = [
      { entity: 'tyres' },
      { entity: 'assets' },
      { entity: 'tyres' },
      { entity: 'tyres' },
      { entity: 'assets' },
    ]
    expect(groupByEntity(rows)).toEqual([
      { entity: 'tyres', count: 3 },
      { entity: 'assets', count: 2 },
    ])
  })

  it('buckets missing entity under "all" and tiebreaks by name', () => {
    const rows = [{ entity: '' }, {}, { entity: 'assets' }]
    expect(groupByEntity(rows)).toEqual([
      { entity: 'all', count: 2 },
      { entity: 'assets', count: 1 },
    ])
  })

  it('returns [] for empty / non-array input', () => {
    expect(groupByEntity([])).toEqual([])
    expect(groupByEntity(null)).toEqual([])
  })
})
