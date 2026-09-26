import { describe, it, expect } from 'vitest'
import {
  isActiveAsset, coverageByAsset, groupCoverage, coverageTotals, filterCoverage, sortCoverage,
  inspectorWorkload, NO_REGION,
} from '../lib/inspectionPlannerAnalytics'

const today = '2026-09-26'
const fleet = [
  { asset_no: 'TM1', country: 'KSA', site: 'NHC', vehicle_type: 'TR-MIXER', status: 'Active' },
  { asset_no: 'TM2', country: 'KSA', site: 'NHC', vehicle_type: 'TR-MIXER', status: 'Active' },
  { asset_no: 'TM3', country: 'KSA', site: 'JED', vehicle_type: '', status: null },
  { asset_no: 'OLD', country: 'KSA', site: 'NHC', vehicle_type: 'TR-MIXER', status: 'Inactive' },
  { asset_no: 'TM1', country: 'UAE', site: 'DXB', vehicle_type: 'PUMPS', status: 'Active' },
]
const inspections = [
  { asset_no: 'TM1', country: 'KSA', inspection_date: '2026-09-20', inspector_name: 'Ali' },
  { asset_no: 'tm2', country: 'ksa', inspection_date: '2026-07-01', inspector_name: 'Omar' },
  { asset_no: 'TM3', country: 'KSA', inspection_date: '2026-10-30', inspector_name: 'Future' },
]
const regionOf = (site) => ({ NHC: 'CENTRAL', DXB: 'DUBAI' })[site] || ''

describe('inspectionPlannerAnalytics', () => {
  it('treats blank or Active as in service only', () => {
    expect(isActiveAsset({ status: null })).toBe(true)
    expect(isActiveAsset({ status: 'Inactive' })).toBe(false)
  })

  it('measures coverage against active register assets, country-keyed, ignoring future dates', () => {
    const rows = coverageByAsset({ fleet, inspections, today, interval: 30, regionOf })
    expect(rows).toHaveLength(4)
    const by = Object.fromEntries(rows.map((r) => [`${r.country}|${r.asset_no}`, r]))
    expect(by['KSA|TM1']).toMatchObject({ state: 'covered', days_since: 6, region: 'CENTRAL' })
    expect(by['KSA|TM2'].state).toBe('overdue')
    expect(by['KSA|TM3']).toMatchObject({ state: 'never', region: '' })
    expect(by['UAE|TM1'].state).toBe('never')
  })

  it('groups by dimension with unplaced sites kept apart', () => {
    const rows = coverageByAsset({ fleet, inspections, today, interval: 30, regionOf })
    const g = groupCoverage(rows, 'region')
    expect(g.find((x) => x.key === NO_REGION)).toMatchObject({ assets: 1, never: 1, ratePct: 0 })
    expect(g.find((x) => x.key === 'CENTRAL')).toMatchObject({ assets: 2, covered: 1, ratePct: 50 })
    expect(groupCoverage([], 'site')).toEqual([])
    expect(coverageTotals([]).ratePct).toBeNull()
    expect(coverageTotals(rows)).toMatchObject({ assets: 4, covered: 1, overdue: 1, never: 2, ratePct: 25 })
  })

  it('filters and sorts with never inspected treated as the longest gap', () => {
    const rows = coverageByAsset({ fleet, inspections, today, interval: 30, regionOf })
    expect(filterCoverage(rows, { state: 'never' })).toHaveLength(2)
    expect(filterCoverage(rows, { region: NO_REGION })).toHaveLength(1)
    expect(filterCoverage(rows, { search: 'pumps' })).toHaveLength(1)
    const s = sortCoverage(rows)
    expect(s[0].state).toBe('never')
    expect(s[s.length - 1].asset_no).toBe('TM1')
  })

  it('counts inspector workload over a window plus schedule load', () => {
    const w = inspectorWorkload(inspections, [
      { inspector_name: 'Ali', inspection_date: '2026-10-01', status: 'Scheduled' },
      { inspector_name: 'Ali', inspection_date: '2026-09-01', status: 'Scheduled' },
      { inspector_name: 'Ali', inspection_date: '2026-09-01', status: 'Completed' },
    ], { today, days: 30 })
    expect(w[0]).toEqual({ name: 'Ali', readings: 1, assets: 1, upcoming: 1, missed: 1 })
    expect(w.find((x) => x.name === 'Omar')).toBeUndefined()
    expect(w.find((x) => x.name === 'Future')).toBeUndefined()
  })
})
