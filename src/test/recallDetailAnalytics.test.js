import { describe, it, expect } from 'vitest'
import {
  tyreSerial, matchRecallTyres, daysFitted, recallAgeDays, affectedRows,
  recallExposure, filterAffected, recallActions, affectedExportRows, sortAffected,
} from '../lib/recallDetailAnalytics'

const NOW = Date.parse('2026-09-26T00:00:00Z')
const RECALL = { brand: 'Longmarch', affected_sizes: ['315/80R22.5'], affected_serial_prefix: 'LM2', status: 'Active', issue_date: '2026-09-01' }
const TYRES = [
  { id: 1, brand: 'LONGMARCH ', size: '315/80r22.5', serial_number: 'LM2001', asset_no: 'TM1', site: 'NHC', position: 'LHF1', issue_date: '2026-09-16' },
  { id: 2, brand: 'Longmarch', size: '315/80R22.5', serial_no: 'lm2002', asset_no: 'TM2', site: 'JED', km_at_removal: 50000, issue_date: '2026-01-01' },
  { id: 3, brand: 'Longmarch', size: '315/80R22.5', serial_number: 'XX1', asset_no: 'TM3' },
  { id: 4, brand: 'Triangle', size: '315/80R22.5', serial_number: 'LM2003' },
  { id: 5, brand: 'Longmarch', size: '385/65R22.5', serial_number: 'LM2004' },
  { id: 6, brand: 'Longmarch', size: '315/80R22.5', asset_no: 'TM4' },
]

describe('recallDetailAnalytics', () => {
  it('reads serial from either column', () => {
    expect(tyreSerial({ serial_no: ' A ' })).toBe('A')
    expect(tyreSerial({})).toBeNull()
  })

  it('matches brand, size and prefix case-insensitively', () => {
    expect(matchRecallTyres(RECALL, TYRES).map((t) => t.id)).toEqual([1, 2])
    expect(matchRecallTyres({ ...RECALL, affected_serial_prefix: null, affected_sizes: [] }, TYRES).map((t) => t.id)).toEqual([1, 2, 3, 5, 6])
    expect(matchRecallTyres(null, TYRES)).toEqual([])
    expect(matchRecallTyres({ brand: '' }, [{ brand: '' }])).toEqual([])
  })

  it('computes days fitted only for fitted tyres', () => {
    expect(daysFitted(TYRES[0], NOW)).toBe(10)
    expect(daysFitted(TYRES[1], NOW)).toBeNull()
    expect(daysFitted({ issue_date: null }, NOW)).toBeNull()
    expect(recallAgeDays(RECALL, NOW)).toBe(25)
    expect(recallAgeDays({ issue_date: '2026-09-01', closed_at: '2026-09-11' }, NOW)).toBe(10)
  })

  it('summarises exposure', () => {
    const rows = affectedRows(matchRecallTyres(RECALL, TYRES), NOW)
    const e = recallExposure(rows)
    expect(e).toMatchObject({ affected: 2, fitted: 1, removed: 1, fittedPct: 50, assets: 1, sites: 2, avgDaysFitted: 10, serialCoverage: 100 })
    expect(e.byAsset[0]).toMatchObject({ value: 'TM1', fitted: 1 })
    const empty = recallExposure([])
    expect(empty.fittedPct).toBeNull()
    expect(empty.avgDaysFitted).toBeNull()
  })

  it('filters by state, site and search', () => {
    const rows = affectedRows(matchRecallTyres(RECALL, TYRES), NOW)
    expect(filterAffected(rows, { state: 'Removed' })).toHaveLength(1)
    expect(filterAffected(rows, { site: 'NHC' })).toHaveLength(1)
    expect(filterAffected(rows, { search: 'tm2' })[0].id).toBe(2)
  })

  it('produces data-driven actions', () => {
    const rows = affectedRows(matchRecallTyres(RECALL, TYRES), NOW)
    expect(recallActions(RECALL, recallExposure(rows))[0]).toMatch(/still fitted/)
    expect(recallActions({ ...RECALL, status: 'Closed' }, recallExposure(rows))[0]).toMatch(/closed/)
    expect(recallActions(RECALL, recallExposure([]))[0]).toMatch(/serial prefix/)
    expect(recallActions(null, recallExposure([]))).toEqual([])
  })

  it('sorts fitted first, longest on vehicle first', () => {
    const rows = [
      { state: 'Removed', days_fitted: null, serial: 'A' },
      { state: 'Fitted', days_fitted: 5, serial: 'B' },
      { state: 'Fitted', days_fitted: 50, serial: 'C' },
    ]
    expect(sortAffected(rows).map((r) => r.serial)).toEqual(['C', 'B', 'A'])
    expect(sortAffected(null)).toEqual([])
  })

  it('exports N/A for gaps', () => {
    const rows = affectedExportRows(affectedRows([TYRES[5]], NOW))
    expect(rows[0].serial).toBe('N/A')
    expect(rows[0].days_fitted).toBe('N/A')
  })
})
