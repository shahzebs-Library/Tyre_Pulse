import { describe, it, expect } from 'vitest'
import {
  matchesMeterType, matchesAsset, filterVehicles, filterHistory, meterKpis,
  presetRange, vehicleExportRows, latestReadingDate,
} from '../lib/odometerLogsAnalytics'

const kmLog = { odometer_km: 1000, reading_date: '2026-09-01', source: 'Web Manual' }
const vehicles = [
  { id: 'a', asset_no: 'TM1', site: 'NHC', region: 'Central', vehicle_type: 'TR-MIXER', supportsKm: true, supportsHours: true, km: 1000, engineHours: null, kmLog },
  { id: 'b', asset_no: 'GEN1', site: 'JED', region: 'Western', vehicle_type: 'GENERATOR', supportsKm: false, supportsHours: true, km: null, engineHours: 50, hoursLog: { engine_hours: 50, reading_date: '2026-07-01' } },
  { id: 'c', asset_no: 'TR1', site: 'JED', region: 'Western', vehicle_type: '', supportsKm: false, supportsHours: false, km: null, engineHours: null, duplicate: true },
]
const history = [
  { id: 'r1', asset_no: 'TM1', kind: 'km', reading_date: '2026-09-01', flagged: true, reviewed: false },
  { id: 'r2', asset_no: 'GEN1', kind: 'hours', reading_date: '2026-07-01' },
]

describe('odometerLogsAnalytics', () => {
  it('matches meter types', () => {
    expect(matchesMeterType(vehicles[0], 'both')).toBe(true)
    expect(matchesMeterType(vehicles[1], 'hours_only')).toBe(true)
    expect(matchesMeterType(vehicles[2], 'unknown')).toBe(true)
    expect(matchesMeterType(vehicles[0], '')).toBe(true)
  })

  it('filters vehicles by asset fields and reading filters', () => {
    expect(matchesAsset(vehicles[0], { search: 'tm1 nhc' })).toBe(true)
    expect(filterVehicles(vehicles, { vehicleType: '__unknown' }).map((v) => v.id)).toEqual(['c'])
    expect(filterVehicles(vehicles, { readingKind: 'hours' }).map((v) => v.id)).toEqual(['b'])
    expect(filterVehicles(vehicles, { from: '2026-08-01' }).map((v) => v.id)).toEqual(['a'])
    expect(filterHistory(history, { flagged: true }).map((r) => r.id)).toEqual(['r1'])
  })

  it('rolls up coverage and staleness honestly', () => {
    const k = meterKpis(vehicles, history, '2026-09-10')
    expect(k).toMatchObject({ vehicles: 3, withKm: 1, withHours: 1, fresh: 1, stale: 1, undated: 1, duplicates: 1, readings: 2, flagged: 1 })
    expect(k.kmCoveragePct).toBe(100)
    expect(k.hoursCoveragePct).toBe(50)
    expect(meterKpis([], [], '2026-09-10').kmCoveragePct).toBeNull()
    expect(latestReadingDate(vehicles[2])).toBeNull()
  })

  it('builds presets and export rows without inventing readings', () => {
    expect(presetRange('2026-09-10', 7)).toEqual({ from: '2026-09-04', to: '2026-09-10' })
    expect(presetRange('2026-09-10', 'month')).toEqual({ from: '2026-09-01', to: '2026-09-10' })
    const out = vehicleExportRows(vehicles)
    expect(out[0]).toMatchObject({ asset: 'TM1', km: 1000, hours: 'No reading', km_date: '2026-09-01' })
    expect(out[2].km).toBe('No reading')
  })
})
