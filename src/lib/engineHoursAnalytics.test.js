import { describe, it, expect } from 'vitest'
import {
  toNum, filterEngineHours, latestPerAsset, hoursAddedPerPeriod, assetUtilization,
  detectAnomalies, anomalyRowIds, utilizationByAsset, utilizationBySite,
  monthlyHoursTrend, summarizeEngineHours,
  LOW_UTILISATION_HOURS_PER_DAY, STALE_READING_DAYS,
} from './engineHoursAnalytics'

const NOW = new Date('2026-07-18T00:00:00Z')

// GEN-1: clean monotonic chain, 10h/day over 10 days (100h -> 200h).
// GEN-2: has a meter rollback anomaly (500 -> 480) then recovers.
// PUMP-3: single reading only (span not computable).
const rows = [
  { id: 1, asset_no: 'GEN-1', engine_hours: 100, reading_date: '2026-07-01', site: 'NHC' },
  { id: 2, asset_no: 'GEN-1', engine_hours: 150, reading_date: '2026-07-06', site: 'NHC' },
  { id: 3, asset_no: 'GEN-1', engine_hours: 200, reading_date: '2026-07-11', site: 'NHC' },
  { id: 4, asset_no: 'GEN-2', engine_hours: 500, reading_date: '2026-07-02', site: 'METRO' },
  { id: 5, asset_no: 'GEN-2', engine_hours: 480, reading_date: '2026-07-05', site: 'METRO' }, // rollback
  { id: 6, asset_no: 'GEN-2', engine_hours: 520, reading_date: '2026-07-09', site: 'METRO' },
  { id: 7, asset_no: 'PUMP-3', engine_hours: 30, reading_date: '2026-07-10', site: '' },
]

describe('toNum', () => {
  it('coerces numeric-ish values and rejects the rest', () => {
    expect(toNum('12.5')).toBe(12.5)
    expect(toNum(7)).toBe(7)
    expect(toNum('')).toBeNull()
    expect(toNum(null)).toBeNull()
    expect(toNum('abc')).toBeNull()
  })
})

describe('filterEngineHours', () => {
  it('filters by inclusive date range', () => {
    const out = filterEngineHours(rows, { from: '2026-07-05', to: '2026-07-09' })
    expect(out.map((r) => r.id).sort()).toEqual([2, 5, 6])
  })
  it('filters by asset, site and free-text search independently', () => {
    expect(filterEngineHours(rows, { asset: 'GEN-1' })).toHaveLength(3)
    expect(filterEngineHours(rows, { site: 'METRO' })).toHaveLength(3)
    expect(filterEngineHours(rows, { search: 'pump' })).toHaveLength(1)
  })
  it('ignores blank / All filters and returns [] for non-array', () => {
    expect(filterEngineHours(rows, { site: 'All', asset: '', from: '' })).toHaveLength(7)
    expect(filterEngineHours(null)).toEqual([])
  })
})

describe('latestPerAsset', () => {
  it('keeps the newest reading per asset, ordered by asset', () => {
    const out = latestPerAsset(rows)
    expect(out.map((r) => r.asset_no)).toEqual(['GEN-1', 'GEN-2', 'PUMP-3'])
    expect(out.find((r) => r.asset_no === 'GEN-1').engine_hours).toBe(200)
    expect(out.find((r) => r.asset_no === 'GEN-2').engine_hours).toBe(520)
  })
  it('ignores rows without an asset', () => {
    expect(latestPerAsset([{ engine_hours: 5, reading_date: '2026-07-01' }])).toEqual([])
  })
})

describe('hoursAddedPerPeriod', () => {
  it('sums positive deltas and flags a rollback as an anomaly with zero added', () => {
    const p = hoursAddedPerPeriod(rows, 'GEN-2')
    expect(p).toHaveLength(2)
    expect(p[0]).toMatchObject({ delta: -20, added: 0, anomaly: true, days: 3 })
    expect(p[1]).toMatchObject({ delta: 40, added: 40, anomaly: false, days: 4 })
  })
  it('is empty for a single-reading asset', () => {
    expect(hoursAddedPerPeriod(rows, 'PUMP-3')).toEqual([])
  })
})

describe('assetUtilization', () => {
  it('computes span, accumulated hours and avg daily hours for a clean chain', () => {
    const a = assetUtilization(rows, NOW).find((x) => x.asset_no === 'GEN-1')
    expect(a).toMatchObject({
      readings: 3, latestHours: 200, firstDate: '2026-07-01', latestDate: '2026-07-11',
      spanDays: 10, hoursAdded: 100, avgDailyHours: 10, anomalies: 0,
    })
  })
  it('excludes the rollback from accumulated hours (monotonic guard)', () => {
    const a = assetUtilization(rows, NOW).find((x) => x.asset_no === 'GEN-2')
    // 500->480 excluded; 480->520 = +40 only.
    expect(a.hoursAdded).toBe(40)
    expect(a.anomalies).toBe(1)
    expect(a.latestHours).toBe(520)
  })
  it('returns null avgDailyHours for a single reading (not computable)', () => {
    const a = assetUtilization(rows, NOW).find((x) => x.asset_no === 'PUMP-3')
    expect(a.spanDays).toBe(0)
    expect(a.avgDailyHours).toBeNull()
    expect(a.hoursAdded).toBe(0)
  })
  it('flags idle (low utilisation) and stale assets against now', () => {
    const idleRows = [
      { asset_no: 'IDLE-1', engine_hours: 10, reading_date: '2026-07-01' },
      { asset_no: 'IDLE-1', engine_hours: 12, reading_date: '2026-07-11' }, // 0.2 h/day
    ]
    const a = assetUtilization(idleRows, NOW)[0]
    expect(a.avgDailyHours).toBeLessThan(LOW_UTILISATION_HOURS_PER_DAY)
    expect(a.idle).toBe(true)

    const staleRows = [
      { asset_no: 'OLD-1', engine_hours: 5, reading_date: '2026-01-01' },
      { asset_no: 'OLD-1', engine_hours: 400, reading_date: '2026-02-01' },
    ]
    const s = assetUtilization(staleRows, NOW)[0]
    expect(s.lastReadingDaysAgo).toBeGreaterThan(STALE_READING_DAYS)
    expect(s.stale).toBe(true)
  })
})

describe('detectAnomalies / anomalyRowIds', () => {
  it('surfaces the rollback reading with prev context and drop magnitude', () => {
    const out = detectAnomalies(rows)
    expect(out).toHaveLength(1)
    expect(out[0]).toMatchObject({
      id: 5, asset_no: 'GEN-2', engine_hours: 480, prevHours: 500, drop: 20,
    })
  })
  it('anomalyRowIds returns the offending row ids', () => {
    expect(anomalyRowIds(rows).has(5)).toBe(true)
    expect(anomalyRowIds(rows).has(2)).toBe(false)
  })
  it('is empty on clean data', () => {
    expect(detectAnomalies([
      { id: 1, asset_no: 'A', engine_hours: 1, reading_date: '2026-07-01' },
      { id: 2, asset_no: 'A', engine_hours: 2, reading_date: '2026-07-02' },
    ])).toEqual([])
  })
})

describe('utilizationByAsset / utilizationBySite', () => {
  it('ranks assets by accumulated hours desc and caps at limit', () => {
    const out = utilizationByAsset(rows, NOW, 2)
    expect(out).toHaveLength(2)
    expect(out[0].asset).toBe('GEN-1') // 100 added
    expect(out[0].hoursAdded).toBe(100)
  })
  it('groups accumulated hours by site, bucketing blank site as Unspecified', () => {
    const out = utilizationBySite(rows, NOW)
    expect(out.find((s) => s.key === 'NHC').hoursAdded).toBe(100)
    expect(out.find((s) => s.key === 'METRO').hoursAdded).toBe(40)
    // PUMP-3 has one reading -> no positive delta -> no site contribution.
    expect(out.find((s) => s.key === 'Unspecified')).toBeUndefined()
  })
})

describe('monthlyHoursTrend', () => {
  it('returns 12 ordered buckets ending at the anchor month', () => {
    const out = monthlyHoursTrend(rows, NOW)
    expect(out).toHaveLength(12)
    expect(out[11].month).toBe('2026-07')
    expect(out[0].month).toBe('2025-08')
  })
  it('accumulates hours added and reading counts into the right month', () => {
    const out = monthlyHoursTrend(rows, NOW)
    const jul = out.find((b) => b.month === '2026-07')
    expect(jul.hoursAdded).toBe(140) // GEN-1 100 + GEN-2 40
    expect(jul.readings).toBe(7)
  })
})

describe('summarizeEngineHours', () => {
  it('computes honest fleet KPIs', () => {
    const k = summarizeEngineHours(rows, {}, NOW)
    expect(k.totalReadings).toBe(7)
    expect(k.assetsTracked).toBe(3)
    expect(k.totalHoursAdded).toBe(140)
    expect(k.maxHours).toBe(520)
    expect(k.anomalies).toBe(1)
    expect(k.mostUtilized.asset_no).toBe('GEN-1') // 10 h/day
    expect(k.leastUtilized.asset_no).toBe('GEN-2') // ~5.7 h/day
  })
  it('applies filters before summarising', () => {
    const k = summarizeEngineHours(rows, { asset: 'GEN-1' }, NOW)
    expect(k.totalReadings).toBe(3)
    expect(k.assetsTracked).toBe(1)
    expect(k.totalHoursAdded).toBe(100)
  })
  it('returns honest zeros / nulls on empty input', () => {
    const k = summarizeEngineHours([], {}, NOW)
    expect(k).toMatchObject({
      totalReadings: 0, assetsTracked: 0, totalHoursAdded: 0, anomalies: 0,
      idleAssets: 0, staleAssets: 0,
    })
    expect(k.avgDailyHours).toBeNull()
    expect(k.maxHours).toBeNull()
    expect(k.mostUtilized).toBeNull()
    expect(k.leastUtilized).toBeNull()
    expect(k.assets).toEqual([])
  })
  it('never yields NaN for non-numeric readings', () => {
    const k = summarizeEngineHours([{ asset_no: 'X', engine_hours: 'n/a', reading_date: '2026-07-01' }], {}, NOW)
    expect(Number.isNaN(k.totalHoursAdded)).toBe(false)
    expect(k.assetsTracked).toBe(1)
  })
})
