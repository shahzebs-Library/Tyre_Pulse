import { describe, it, expect } from 'vitest'
import {
  filterCombinations, combinationKpis, siteOptions, registryRow, combinationExportRows,
  scrapSharePct, positionRows, memberCoverage, combinationSearchText,
} from '../lib/combinationsAnalytics'

const rows = [
  { id: 1, name: 'Rig A', prime_mover_no: 'PM-1', trailer_nos: 'T1, T2', site: 'Jeddah', status: 'active' },
  { id: 2, name: 'Rig B', prime_mover_no: 'PM-2', trailer_nos: 'T2', site: 'Riyadh', status: 'active' },
  { id: 3, name: 'Solo', prime_mover_no: 'PM-3', trailer_nos: '', site: 'Riyadh', status: 'inactive' },
]

describe('filterCombinations', () => {
  it('filters by status, site, trailer presence and search', () => {
    expect(filterCombinations(rows, { status: 'active' })).toHaveLength(2)
    expect(filterCombinations(rows, { site: 'Riyadh' }).map((r) => r.id)).toEqual([2, 3])
    expect(filterCombinations(rows, { trailers: 'without' }).map((r) => r.id)).toEqual([3])
    expect(filterCombinations(rows, { trailers: 'with' })).toHaveLength(2)
    expect(filterCombinations(rows, { search: 't1' }).map((r) => r.id)).toEqual([1])
  })
  it('tolerates bad input', () => {
    expect(filterCombinations(null)).toEqual([])
    expect(combinationSearchText(null)).toBe('')
  })
})

describe('combinationKpis', () => {
  it('reports trailer-less units, double-booked trailers and averages', () => {
    const k = combinationKpis(rows)
    expect(k.total).toBe(3)
    expect(k.withoutTrailer).toBe(1)
    expect(k.duplicateTrailers).toBe(1)
    expect(k.sites).toBe(2)
    expect(k.avgTrailersPerUnit).toBe(1)
    expect(k.activePct).toBe(66.7)
  })
  it('returns null ratios for an empty registry, never 0', () => {
    const k = combinationKpis([])
    expect(k.avgTrailersPerUnit).toBeNull()
    expect(k.activePct).toBeNull()
  })
})

describe('shapes', () => {
  it('site options are distinct and sorted', () => {
    expect(siteOptions(rows)).toEqual(['Jeddah', 'Riyadh'])
  })
  it('registry row carries a trailer count', () => {
    expect(registryRow(rows[0]).trailerCount).toBe(2)
  })
  it('export rows use N/A for blanks', () => {
    const ex = combinationExportRows(rows)
    expect(ex[2].trailers).toBe('N/A')
    expect(ex[0].trailers).toBe('T1, T2')
  })
})

describe('rollup ratios', () => {
  it('scrap share is null when nothing is recorded', () => {
    expect(scrapSharePct({ fittedTyres: 0, scrapTyres: 0 })).toBeNull()
    expect(scrapSharePct(null)).toBeNull()
    expect(scrapSharePct({ fittedTyres: 3, scrapTyres: 1 })).toBe(25)
  })
  it('position rows add labels and spend share, sorted by spend', () => {
    const p = positionRows({ positionBreakdown: [
      { positionClass: 'steer', count: 2, spend: 100, cpk: 0.1 },
      { positionClass: 'drive', count: 4, spend: 300, cpk: null },
    ] })
    expect(p[0].label).toBe('Drive')
    expect(p[0].spendSharePct).toBe(75)
    const none = positionRows({ positionBreakdown: [{ positionClass: 'other', count: 1, spend: 0 }] })
    expect(none[0].spendSharePct).toBeNull()
  })
  it('member coverage is null with no members', () => {
    expect(memberCoverage({ members: [], resolution: { resolvedCount: 0 } }).pct).toBeNull()
    expect(memberCoverage({ members: [{}, {}], resolution: { resolvedCount: 1 } }).pct).toBe(50)
  })
})
