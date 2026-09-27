import { describe, it, expect } from 'vitest'
import {
  filterSavedSearches, savedSearchKpis, resultSummary, savedTableRows, savedExportRows,
  daysSinceRun, runState, activeLibraryFilterCount, EMPTY_LIBRARY_FILTERS, entityShort,
} from '../lib/advancedSearchAnalytics'

const NOW = Date.parse('2026-09-27T12:00:00Z')

const ROWS = [
  { id: 1, name: 'Critical steer', entity: 'tyres', query_text: 'steer', pinned: false, last_run_at: '2026-09-25T10:00:00Z', result_count: 12 },
  { id: 2, name: 'Old asset hunt', entity: 'assets', query_text: 'TRK', pinned: true, last_run_at: '2026-07-01T10:00:00Z', result_count: null },
  { id: 3, name: 'Never touched', entity: 'all', query_text: 'x', pinned: false, notes: 'weekly review' },
]

describe('advancedSearchAnalytics', () => {
  it('measures run age and classifies run state against the injected clock', () => {
    expect(daysSinceRun(ROWS[0], NOW)).toBe(2)
    expect(daysSinceRun(ROWS[2], NOW)).toBeNull()
    expect(runState(ROWS[0], NOW)).toBe('recent')
    expect(runState(ROWS[1], NOW)).toBe('stale')
    expect(runState(ROWS[2], NOW)).toBe('never')
  })

  it('filters the library and floats pinned searches first', () => {
    expect(filterSavedSearches(ROWS, {}, NOW).map((r) => r.id)).toEqual([2, 1, 3])
    expect(filterSavedSearches(ROWS, { search: 'weekly' }, NOW).map((r) => r.id)).toEqual([3])
    expect(filterSavedSearches(ROWS, { entity: 'tyres' }, NOW).map((r) => r.id)).toEqual([1])
    expect(filterSavedSearches(ROWS, { pinnedOnly: true }, NOW).map((r) => r.id)).toEqual([2])
    expect(filterSavedSearches(ROWS, { runState: 'never' }, NOW).map((r) => r.id)).toEqual([3])
  })

  it('reports last recorded matches as null when no search carries a count', () => {
    expect(savedSearchKpis([{ id: 9, name: 'a' }], NOW).lastRecordedMatches).toBeNull()
    const k = savedSearchKpis(ROWS, NOW)
    expect(k).toMatchObject({ totalSaved: 3, pinnedCount: 1, recordedCount: 1, lastRecordedMatches: 12, neverRun: 1, stale: 1 })
  })

  it('summarises a live result set including failed sources and truncation', () => {
    expect(resultSummary(null, ['assets'])).toBeNull()
    const s = resultSummary({
      assets: [{ id: 1 }], tyres: [], total: 1, totalMatches: null, complete: false,
      coverage: { assets: { truncated: true, count: 40 } }, errors: { tyres: 'Timed out' },
    }, ['assets', 'tyres'])
    expect(s.total).toBe(1)
    expect(s.matches).toBeNull()
    expect(s.complete).toBe(false)
    expect(s.failed).toEqual(['tyres'])
    expect(s.perGroup[0]).toEqual({ key: 'assets', shown: 1, truncated: true, count: 40 })
  })

  it('shapes table and export rows without fabricating a zero count', () => {
    const t = savedTableRows(ROWS, NOW)
    expect(t[1]._results).toBeNull()
    expect(t[0]._results).toBe(12)
    const out = savedExportRows(ROWS, NOW)
    expect(out[1]).toMatchObject({ result_count: '', pinned: 'Yes', entity: 'Assets', run_state: 'Not run in 30+ days' })
    expect(out[2]).toMatchObject({ last_run_at: '', run_state: 'Never run', entity: 'All' })
  })

  it('counts active filters and labels entities', () => {
    expect(activeLibraryFilterCount(EMPTY_LIBRARY_FILTERS)).toBe(0)
    expect(activeLibraryFilterCount({ search: 'x', entity: 'tyres', pinnedOnly: true, runState: 'never' })).toBe(4)
    expect(entityShort('work_orders')).toBe('Work orders')
    expect(entityShort(undefined)).toBe('All')
  })
})
