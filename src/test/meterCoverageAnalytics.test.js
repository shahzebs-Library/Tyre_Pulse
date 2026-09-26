import { describe, it, expect } from 'vitest'
import {
  vehicleMeterStatus, groupMeterCoverage, meterTotals, flagSummary, anomalyCounts,
  filterMeterStatus, sortMeterStatus, NO_REGION,
} from '../lib/meterCoverageAnalytics'

const today = '2026-09-26'
const vehicles = [
  { id: 1, asset_no: 'TM1', region: 'CENTRAL', site: 'NHC', vehicle_type: 'TR-MIXER', supportsKm: true, supportsHours: true, kmLog: { reading_date: '2026-09-20' }, hoursLog: null },
  { id: 2, asset_no: 'TM2', region: 'CENTRAL', site: 'NHC', vehicle_type: 'TR-MIXER', supportsKm: true, supportsHours: false, kmLog: { reading_date: '2026-05-01' } },
  { id: 3, asset_no: 'GN1', region: '', site: 'JED', vehicle_type: 'GENERATOR', supportsKm: false, supportsHours: true },
  { id: 4, asset_no: 'XX1', region: '', site: '', vehicle_type: '', supportsKm: false, supportsHours: false },
  { id: 5, asset_no: 'DUP', supportsKm: true, duplicate: true },
]

describe('meterCoverageAnalytics', () => {
  it('classifies each vehicle honestly and skips duplicates', () => {
    const r = vehicleMeterStatus(vehicles, { today, staleDays: 60 })
    expect(r).toHaveLength(4)
    const by = Object.fromEntries(r.map((x) => [x.asset_no, x]))
    expect(by.TM1).toMatchObject({ state: 'fresh', days_since: 6, missing_km: false, missing_hours: true })
    expect(by.TM2.state).toBe('stale')
    expect(by.GN1).toMatchObject({ state: 'never', missing_hours: true })
    expect(by.XX1).toMatchObject({ state: 'not_applicable', missing_km: false })
  })

  it('groups and totals without counting not-applicable vehicles', () => {
    const r = vehicleMeterStatus(vehicles, { today, staleDays: 60 })
    const t = meterTotals(r)
    expect(t).toMatchObject({ vehicles: 3, fresh: 1, stale: 1, never: 1, not_applicable: 1, missingKm: 0, missingHours: 2, ratePct: 33.3 })
    const g = groupMeterCoverage(r, 'region')
    expect(g.find((x) => x.key === NO_REGION)).toMatchObject({ vehicles: 1, ratePct: 0 })
    expect(g.find((x) => x.key === 'CENTRAL')).toMatchObject({ vehicles: 2, ratePct: 50 })
    expect(meterTotals([]).ratePct).toBeNull()
  })

  it('summarizes flags by source and counts anomaly types', () => {
    const f = flagSummary([
      { source: 'mobile', flagged: true, reviewed: false },
      { source: 'mobile', flagged: true, reviewed: true },
      { source: 'telematics' },
    ])
    expect(f).toMatchObject({ readings: 3, flagged: 2, awaiting: 1, reviewed: 1 })
    expect(f.bySource[0]).toMatchObject({ source: 'Mobile', readings: 2, flagged: 2, flagRatePct: 100 })
    expect(anomalyCounts([{ type: 'backward' }, { type: 'jump' }, { type: 'backward' }, { type: 'other' }])).toEqual({ backward: 2, jump: 1, duplicate: 0 })
  })

  it('filters and sorts with no-reading first', () => {
    const r = vehicleMeterStatus(vehicles, { today, staleDays: 60 })
    expect(filterMeterStatus(r, { missing: 'hours' })).toHaveLength(2)
    expect(filterMeterStatus(r, { search: 'gen' })).toHaveLength(1)
    const s = sortMeterStatus(r.filter((x) => x.state !== 'not_applicable'))
    expect(s.map((x) => x.asset_no)).toEqual(['GN1', 'TM2', 'TM1'])
  })
})
