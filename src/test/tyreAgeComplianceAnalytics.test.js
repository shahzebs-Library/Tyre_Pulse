import { describe, it, expect } from 'vitest'
import { assessFleet } from '../lib/tyreAgeCompliance'
import {
  filterAssessed, sortByAge, buildAgeView, ageHistogram, dateSourceMix, actionList,
  ageExportRows, EXPORT_COLS,
} from '../lib/tyreAgeComplianceAnalytics'

const NOW = new Date('2026-09-27T00:00:00Z')
const raw = [
  { id: 1, serial_no: 'S1', asset_no: 'A1', brand: 'Bridgestone', site: 'NHC', manufacture_date: '2026-03-01' },
  { id: 2, serial_no: 'S2', asset_no: 'A2', brand: 'Michelin', site: 'NHC', manufacture_date: '2019-01-01' },
  { id: 3, serial_no: 'S3', asset_no: 'A3', brand: 'Michelin', site: 'JED', issue_date: '2022-06-01' },
  { id: 4, serial_no: 'S4', asset_no: 'A4', brand: 'Pirelli', site: 'JED' },
]
const assessed = assessFleet(raw, NOW).rows

describe('tyreAgeComplianceAnalytics', () => {
  it('filters by band, site, brand, source and search', () => {
    expect(filterAssessed(assessed, { band: 'overdue' }).map((r) => r.id)).toEqual([2])
    expect(filterAssessed(assessed, { site: 'JED' }).map((r) => r.id)).toEqual([3, 4])
    expect(filterAssessed(assessed, { source: 'issue' }).map((r) => r.id)).toEqual([3])
    expect(filterAssessed(assessed, { search: 'pirelli' }).map((r) => r.id)).toEqual([4])
    expect(filterAssessed(assessed, { band: 'overdue' }, { skipBand: true })).toHaveLength(4)
  })

  it('sorts oldest first and puts undated tyres last', () => {
    expect(sortByAge(assessed).map((r) => r.id)).toEqual([2, 3, 1, 4])
    expect(sortByAge(assessed, 'asc').map((r) => r.id)).toEqual([1, 3, 2, 4])
  })

  it('holds the band filter out of the KPIs but applies it to the table', () => {
    const view = buildAgeView(assessed, { band: 'overdue', brand: 'Michelin' }, { now: NOW })
    expect(view.scope.map((r) => r.id)).toEqual([2, 3])
    expect(view.summary.kpis.totalAssessed).toBe(2)
    expect(view.table.map((r) => r.id)).toEqual([2])
  })

  it('buckets ages into whole years with an Unknown bucket', () => {
    const h = ageHistogram(assessed)
    expect(h.find((x) => x.label === '0-1').count).toBe(1)
    expect(h.find((x) => x.label === '4-5').count).toBe(1)
    expect(h.find((x) => x.label === '7+').count).toBe(1)
    expect(h.find((x) => x.label === 'Unknown').count).toBe(1)
  })

  it('reports how dates were established and builds the removal worklist', () => {
    const mix = dateSourceMix(assessed)
    expect(mix.find((x) => x.key === 'manufacture').count).toBe(2)
    expect(mix.find((x) => x.key === 'unknown').count).toBe(1)
    expect(actionList(assessed).map((r) => r.id)).toEqual([2])
  })

  it('shapes export rows with N/A for missing values', () => {
    const out = ageExportRows(assessed)
    expect(Object.keys(out[0])).toEqual(EXPORT_COLS)
    const undated = out.find((r) => r.serial === 'S4')
    expect(undated.ageYears).toBe('N/A')
    expect(undated.birthDate).toBe('N/A')
    expect(undated.band).toBe('Date unknown')
  })
})
