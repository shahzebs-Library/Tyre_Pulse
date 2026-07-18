import { describe, it, expect } from 'vitest'
import {
  toNum, assetSeries, computeAssetMileage, detectAnomalies,
  summarizeMileage, mileageTrend, kmByAsset, kmBySite,
  MAX_KM_PER_DAY, JUMP_MIN_KM, STALE_DAYS, ANOMALY,
} from './odometerAnalytics'

const row = (asset, km, date, extra = {}) => ({
  id: `${asset}-${date}-${km}`, asset_no: asset, odometer_km: km,
  reading_date: date, ...extra,
})

// A clean monotonic asset: 3 readings 30 days apart, +3000 km each.
const CLEAN = [
  row('TRK-1', 10000, '2026-01-01', { site: 'RIYADH' }),
  row('TRK-1', 13000, '2026-01-31', { site: 'RIYADH' }),
  row('TRK-1', 16000, '2026-03-02', { site: 'RIYADH' }),
]

describe('toNum', () => {
  it('parses numbers, strings, and strips units', () => {
    expect(toNum(42)).toBe(42)
    expect(toNum('45,000 km')).toBe(45000)
    expect(toNum('-5')).toBe(-5)
  })
  it('returns null for empty / non-numeric', () => {
    expect(toNum('')).toBeNull()
    expect(toNum(null)).toBeNull()
    expect(toNum(undefined)).toBeNull()
    expect(toNum('abc')).toBeNull()
  })
})

describe('constants', () => {
  it('exposes tunable thresholds', () => {
    expect(MAX_KM_PER_DAY).toBeGreaterThan(0)
    expect(JUMP_MIN_KM).toBeGreaterThan(0)
    expect(STALE_DAYS).toBeGreaterThan(0)
    expect(ANOMALY.BACKWARD).toBe('backward')
  })
})

describe('assetSeries', () => {
  it('groups by asset, time-ascending, ignoring blank asset numbers', () => {
    const rows = [
      row('B', 200, '2026-02-01'),
      row('A', 100, '2026-01-02'),
      row('A', 90, '2026-01-01'),
      row('', 5, '2026-01-01'),
      { asset_no: null, odometer_km: 1, reading_date: '2026-01-01' },
    ]
    const m = assetSeries(rows)
    expect([...m.keys()].sort()).toEqual(['A', 'B'])
    expect(m.get('A').map((r) => r.odometer_km)).toEqual([90, 100])
  })
  it('handles non-array input', () => {
    expect(assetSeries(null).size).toBe(0)
    expect(assetSeries(undefined).size).toBe(0)
  })
  it('breaks a same-date tie by km ascending', () => {
    const rows = [row('A', 150, '2026-01-01'), row('A', 120, '2026-01-01')]
    expect(assetSeries(rows).get('A').map((r) => r.odometer_km)).toEqual([120, 150])
  })
})

describe('computeAssetMileage', () => {
  it('sums positive deltas into distance and computes avg daily km', () => {
    const [a] = computeAssetMileage(CLEAN, { now: new Date('2026-03-10').getTime() })
    expect(a.asset).toBe('TRK-1')
    expect(a.firstKm).toBe(10000)
    expect(a.latestKm).toBe(16000)
    expect(a.kmAdded).toBe(6000)
    expect(a.readingCount).toBe(3)
    expect(a.daysCovered).toBe(60) // Jan 1 -> Mar 2
    expect(a.avgDailyKm).toBe(100) // 6000 / 60
    expect(a.site).toBe('RIYADH')
    expect(a.anomalyCount).toBe(0)
    expect(a.isStale).toBe(false)
  })

  it('flags a backward reading and never counts it as distance', () => {
    const rows = [
      row('A', 10000, '2026-01-01'),
      row('A', 12000, '2026-02-01'),
      row('A', 11500, '2026-03-01'), // rolled back
      row('A', 13000, '2026-04-01'),
    ]
    const [a] = computeAssetMileage(rows, { now: new Date('2026-04-02').getTime() })
    const backward = a.anomalies.filter((x) => x.type === ANOMALY.BACKWARD)
    expect(backward).toHaveLength(1)
    expect(backward[0].delta).toBe(-500)
    // deltas counted: +2000 (Feb), skip Mar backward, +1500 (Apr vs Mar 11500) = 3500
    expect(a.kmAdded).toBe(3500)
  })

  it('flags an unrealistic jump but still counts the distance', () => {
    const rows = [
      row('A', 10000, '2026-01-01'),
      row('A', 60000, '2026-01-02'), // +50000 in 1 day
    ]
    const [a] = computeAssetMileage(rows, { now: new Date('2026-01-03').getTime() })
    const jumps = a.anomalies.filter((x) => x.type === ANOMALY.JUMP)
    expect(jumps).toHaveLength(1)
    expect(a.kmAdded).toBe(50000)
  })

  it('does not flag a large but plausible multi-year delta', () => {
    const rows = [
      row('A', 10000, '2024-01-01'),
      row('A', 40000, '2026-01-01'), // +30000 over ~730 days => ~41 km/day
    ]
    const [a] = computeAssetMileage(rows, { now: new Date('2026-01-02').getTime() })
    expect(a.anomalyCount).toBe(0)
    expect(a.kmAdded).toBe(30000)
  })

  it('flags a duplicate same-day reading', () => {
    const rows = [row('A', 10000, '2026-01-01'), row('A', 10000, '2026-01-01')]
    const [a] = computeAssetMileage(rows)
    expect(a.anomalies.some((x) => x.type === ANOMALY.DUPLICATE)).toBe(true)
    expect(a.kmAdded).toBe(0)
  })

  it('marks an asset stale when its latest reading is old', () => {
    const rows = [row('A', 10000, '2026-01-01')]
    const [a] = computeAssetMileage(rows, { now: new Date('2026-06-01').getTime() })
    expect(a.isStale).toBe(true)
    expect(a.staleFor).toBeGreaterThan(STALE_DAYS)
  })

  it('returns null avgDailyKm when only one reading exists (no window)', () => {
    const [a] = computeAssetMileage([row('A', 10000, '2026-01-01')])
    expect(a.kmAdded).toBeNull()
    expect(a.avgDailyKm).toBeNull()
  })

  it('respects a custom jump threshold', () => {
    const rows = [row('A', 0, '2026-01-01'), row('A', 5000, '2026-01-02')]
    const strict = computeAssetMileage(rows, { maxKmPerDay: 100, jumpMinKm: 1000 })
    expect(strict[0].anomalyCount).toBe(1)
    const loose = computeAssetMileage(rows, { maxKmPerDay: 100000, jumpMinKm: 1000 })
    expect(loose[0].anomalyCount).toBe(0)
  })
})

describe('detectAnomalies', () => {
  it('flattens fleet anomalies newest-first', () => {
    const rows = [
      row('A', 10000, '2026-01-01'),
      row('A', 9000, '2026-02-01'), // backward (Feb)
      row('B', 100, '2026-03-01'),
      row('B', 40000, '2026-03-02'), // jump (Mar)
    ]
    const anoms = detectAnomalies(rows)
    expect(anoms.length).toBe(2)
    expect(new Date(anoms[0].reading_date).getTime())
      .toBeGreaterThanOrEqual(new Date(anoms[1].reading_date).getTime())
  })
  it('is empty for clean data', () => {
    expect(detectAnomalies(CLEAN)).toEqual([])
  })
})

describe('summarizeMileage', () => {
  it('rolls up fleet KPIs from real deltas', () => {
    const rows = [
      ...CLEAN, // TRK-1: +6000 over 60d
      row('TRK-2', 5000, '2026-01-01'),
      row('TRK-2', 5600, '2026-01-31'), // +600 over 30d
    ]
    const s = summarizeMileage(rows, { now: new Date('2026-03-10').getTime() })
    expect(s.assetsTracked).toBe(2)
    expect(s.totalReadings).toBe(5)
    expect(s.totalKmLogged).toBe(6600)
    expect(s.mostDriven).toEqual({ asset: 'TRK-1', km: 6000 })
    expect(s.leastDriven).toEqual({ asset: 'TRK-2', km: 600 })
    // distance-weighted fleet daily: 6600 / (60 + 30) = 73.3
    expect(s.avgDailyKm).toBe(73.3)
    expect(s.anomalyCount).toBe(0)
  })

  it('counts anomalies and stale assets', () => {
    const rows = [
      row('A', 10000, '2026-01-01'),
      row('A', 9000, '2026-02-01'), // backward
    ]
    const s = summarizeMileage(rows, { now: new Date('2026-06-01').getTime() })
    expect(s.anomalyCount).toBe(1)
    expect(s.staleAssets).toBe(1)
  })

  it('degrades honestly on empty input', () => {
    const s = summarizeMileage([])
    expect(s.assetsTracked).toBe(0)
    expect(s.totalKmLogged).toBe(0)
    expect(s.avgDailyKm).toBeNull()
    expect(s.mostDriven).toBeNull()
    expect(s.leastDriven).toBeNull()
  })
})

describe('mileageTrend', () => {
  it('buckets positive deltas by the later reading month', () => {
    const t = mileageTrend(CLEAN)
    // deltas land in Jan (13000, dated 01-31) and Mar (16000, dated 03-02)
    expect(t).toEqual([
      { period: '2026-01', km: 3000 },
      { period: '2026-03', km: 3000 },
    ])
  })
  it('ignores backward deltas', () => {
    const rows = [row('A', 10000, '2026-01-01'), row('A', 9000, '2026-02-01')]
    expect(mileageTrend(rows)).toEqual([])
  })
})

describe('kmByAsset / kmBySite', () => {
  it('ranks assets by distance, excludes zero-distance assets', () => {
    const rows = [
      ...CLEAN,
      row('TRK-2', 5000, '2026-01-01'),
      row('TRK-2', 5600, '2026-02-01'),
      row('TRK-3', 8000, '2026-01-01'), // single reading -> no distance
    ]
    const ranked = kmByAsset(rows)
    expect(ranked).toEqual([
      { label: 'TRK-1', value: 6000 },
      { label: 'TRK-2', value: 600 },
    ])
    expect(kmByAsset(rows, { limit: 1 })).toEqual([{ label: 'TRK-1', value: 6000 }])
  })

  it('aggregates distance by the asset site', () => {
    const rows = [
      ...CLEAN, // RIYADH +6000
      row('TRK-2', 5000, '2026-01-01', { site: 'JEDDAH' }),
      row('TRK-2', 5600, '2026-02-01', { site: 'JEDDAH' }),
      row('TRK-3', 100, '2026-01-01'), // no site, but single reading -> excluded
    ]
    expect(kmBySite(rows)).toEqual([
      { label: 'RIYADH', value: 6000 },
      { label: 'JEDDAH', value: 600 },
    ])
  })

  it('buckets site-less distance under Unassigned', () => {
    const rows = [row('A', 10000, '2026-01-01'), row('A', 11000, '2026-02-01')]
    expect(kmBySite(rows)).toEqual([{ label: 'Unassigned', value: 1000 }])
  })
})
