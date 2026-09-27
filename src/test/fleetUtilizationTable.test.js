import { describe, it, expect } from 'vitest'
import { sortRows } from '../lib/consoleTable'
import {
  UTILIZATION_SORT_ACCESSORS, UTILIZATION_EXPORT_COLS, UTILIZATION_EXPORT_HEADERS, utilizationExportRows,
  coverageGapExportRows, readingCoverage, NO_SITE, NO_TYPE, attachRegister,
} from '../lib/fleetUtilizationAnalytics'

const ROWS = [
  { id: 'a', asset_no: 'TM1', country: 'KSA', utilization_pct: 80, distance_km: 1200, working_seconds: 36000, idle_seconds: 7200, captured_at: '2026-09-01T00:00:00Z' },
  { id: 'b', asset_no: 'TM2', country: 'KSA', utilization_pct: 20, distance_km: null, working_seconds: 3600, idle_seconds: 3600 },
  { id: 'c', asset_no: 'TM3', country: 'UAE', utilization_pct: null, distance_km: 300 },
]

describe('fleetUtilizationAnalytics - register sorting', () => {
  it('sorts utilization with unmeasured rows last in both directions', () => {
    const desc = sortRows(ROWS, { key: 'utilization', dir: 'desc' }, UTILIZATION_SORT_ACCESSORS).map((r) => r.id)
    const asc = sortRows(ROWS, { key: 'utilization', dir: 'asc' }, UTILIZATION_SORT_ACCESSORS).map((r) => r.id)
    expect(desc).toEqual(['a', 'b', 'c'])
    expect(asc).toEqual(['b', 'a', 'c'])
  })
  it('derives idle % and hours for sorting', () => {
    expect(UTILIZATION_SORT_ACCESSORS.idle(ROWS[0])).toBe(20)
    expect(UTILIZATION_SORT_ACCESSORS.idle_hours(ROWS[0])).toBe(2)
    expect(UTILIZATION_SORT_ACCESSORS.idle(ROWS[2])).toBeNull()
  })
})

describe('fleetUtilizationAnalytics - exports', () => {
  it('export rows cover every column with honest placeholders', () => {
    const rows = attachRegister(ROWS, [{ asset_no: 'TM1', country: 'KSA', site: 'NHC', vehicle_type: 'TR-MIXER' }])
    const out = utilizationExportRows(rows)
    expect(UTILIZATION_EXPORT_HEADERS).toHaveLength(UTILIZATION_EXPORT_COLS.length)
    expect(Object.keys(out[0]).sort()).toEqual([...UTILIZATION_EXPORT_COLS].sort())
    expect(out[0]).toMatchObject({ site: 'NHC', in_register: 'Yes', captured_at: '2026-09-01' })
    expect(out[1]).toMatchObject({ site: NO_SITE, vehicle_type: NO_TYPE, in_register: 'No', distance_km: null })
  })
  it('coverage gap rows fill unrecorded site and type', () => {
    expect(coverageGapExportRows({ uncovered: [{ asset_no: 'X', country: 'KSA', site: '', vehicle_type: '' }] })[0])
      .toMatchObject({ site: NO_SITE, vehicle_type: NO_TYPE })
    expect(coverageGapExportRows(null)).toEqual([])
  })
  it('readingCoverage is null for no rows, else the measured share', () => {
    expect(readingCoverage([])).toBeNull()
    expect(readingCoverage(ROWS)).toBeCloseTo(66.7)
  })
})
