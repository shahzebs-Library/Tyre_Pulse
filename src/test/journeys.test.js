import { describe, it, expect } from 'vitest'
import {
  journeyDurationHours, summarizeJourneys,
  journeyOnTime, journeyScheduledArrival, journeyAvgSpeedKmh,
  journeyDataQualityFlags, months12, bucketMonthly, monthlyDistance,
  statusFunnel, onTimeBreakdown, driverRollups, assetRollups,
  buildJourneyAnalytics, ON_TIME_TOLERANCE_MIN, JOURNEY_STATUSES,
} from '../lib/journeys'

describe('journeyDurationHours', () => {
  it('computes duration in hours from start/end times', () => {
    expect(journeyDurationHours({ start_time: '2026-07-12T08:00:00Z', end_time: '2026-07-12T12:30:00Z' })).toBe(4.5)
    expect(journeyDurationHours({ start_time: '2026-07-12T00:00:00Z', end_time: '2026-07-13T00:00:00Z' })).toBe(24)
  })

  it('returns null when a bound is missing or unparseable', () => {
    expect(journeyDurationHours({ start_time: '2026-07-12T08:00:00Z' })).toBeNull()
    expect(journeyDurationHours({ end_time: '2026-07-12T08:00:00Z' })).toBeNull()
    expect(journeyDurationHours({})).toBeNull()
    expect(journeyDurationHours(null)).toBeNull()
    expect(journeyDurationHours({ start_time: 'not-a-date', end_time: '2026-07-12T08:00:00Z' })).toBeNull()
  })

  it('returns null for a negative span (end before start)', () => {
    expect(journeyDurationHours({ start_time: '2026-07-12T12:00:00Z', end_time: '2026-07-12T08:00:00Z' })).toBeNull()
  })
})

describe('summarizeJourneys', () => {
  it('counts by status and aggregates distance', () => {
    const rows = [
      { status: 'planned', distance_km: 100 },
      { status: 'in_progress', distance_km: 50 },
      { status: 'completed', distance_km: 200 },
      { status: 'completed', distance_km: 150 },
      { status: 'cancelled', distance_km: 0 },
    ]
    const s = summarizeJourneys(rows)
    expect(s.byStatus).toEqual({ planned: 1, in_progress: 1, completed: 2, cancelled: 1 })
    expect(s.totalTrips).toBe(5)
    expect(s.totalDistance).toBe(500)
    expect(s.avgDistance).toBe(100)
  })

  it('ignores non-numeric distances in totals but still counts the trip', () => {
    const rows = [
      { status: 'completed', distance_km: 300 },
      { status: 'completed', distance_km: null },
      { status: 'completed', distance_km: 'abc' },
    ]
    const s = summarizeJourneys(rows)
    expect(s.totalTrips).toBe(3)
    expect(s.totalDistance).toBe(300)
    expect(s.avgDistance).toBe(300) // averaged over the 1 numeric distance
  })

  it('handles empty / non-array input safely', () => {
    const s = summarizeJourneys([])
    expect(s).toEqual({ byStatus: { planned: 0, in_progress: 0, completed: 0, cancelled: 0 }, totalTrips: 0, totalDistance: 0, avgDistance: 0 })
    expect(summarizeJourneys(null).totalTrips).toBe(0)
    expect(summarizeJourneys(undefined).totalTrips).toBe(0)
  })
})

describe('journeyScheduledArrival', () => {
  it('reads scheduled arrival from any of the supported keys', () => {
    expect(journeyScheduledArrival({ scheduled_end: '2026-07-12T10:00:00Z' })?.toISOString()).toBe('2026-07-12T10:00:00.000Z')
    expect(journeyScheduledArrival({ eta: '2026-07-12T11:00:00Z' })?.toISOString()).toBe('2026-07-12T11:00:00.000Z')
    expect(journeyScheduledArrival({ planned_arrival: '2026-07-12T12:00:00Z' })?.toISOString()).toBe('2026-07-12T12:00:00.000Z')
  })
  it('returns null when no scheduled arrival is present or parseable', () => {
    expect(journeyScheduledArrival({})).toBeNull()
    expect(journeyScheduledArrival({ scheduled_end: 'nope' })).toBeNull()
    expect(journeyScheduledArrival(null)).toBeNull()
  })
})

describe('journeyOnTime', () => {
  const base = { end_time: '2026-07-12T10:00:00Z' }
  it('classifies on_time within tolerance', () => {
    const r = journeyOnTime({ ...base, scheduled_end: '2026-07-12T09:55:00Z' })
    expect(r.class).toBe('on_time')
    expect(r.deltaMinutes).toBe(5)
  })
  it('classifies late beyond +tolerance and early beyond -tolerance', () => {
    expect(journeyOnTime({ ...base, scheduled_end: '2026-07-12T09:00:00Z' }).class).toBe('late')
    expect(journeyOnTime({ ...base, scheduled_end: '2026-07-12T11:00:00Z' }).class).toBe('early')
  })
  it('honours a custom tolerance', () => {
    expect(journeyOnTime({ ...base, scheduled_end: '2026-07-12T09:50:00Z' }, { toleranceMinutes: 5 }).class).toBe('late')
    expect(journeyOnTime({ ...base, scheduled_end: '2026-07-12T09:50:00Z' }, { toleranceMinutes: 15 }).class).toBe('on_time')
  })
  it('is unknown (delta null) when scheduled or actual arrival is missing', () => {
    expect(journeyOnTime({ end_time: '2026-07-12T10:00:00Z' })).toEqual({ class: 'unknown', deltaMinutes: null })
    expect(journeyOnTime({ scheduled_end: '2026-07-12T10:00:00Z' })).toEqual({ class: 'unknown', deltaMinutes: null })
  })
  it('uses a sane default tolerance', () => {
    expect(ON_TIME_TOLERANCE_MIN).toBe(15)
  })
})

describe('journeyAvgSpeedKmh', () => {
  it('computes distance / duration in km/h', () => {
    expect(journeyAvgSpeedKmh({ distance_km: 240, start_time: '2026-07-12T08:00:00Z', end_time: '2026-07-12T12:00:00Z' })).toBe(60)
  })
  it('guards missing distance, non-positive distance and zero/absent duration', () => {
    expect(journeyAvgSpeedKmh({ start_time: '2026-07-12T08:00:00Z', end_time: '2026-07-12T12:00:00Z' })).toBeNull()
    expect(journeyAvgSpeedKmh({ distance_km: 0, start_time: '2026-07-12T08:00:00Z', end_time: '2026-07-12T12:00:00Z' })).toBeNull()
    expect(journeyAvgSpeedKmh({ distance_km: 100, start_time: '2026-07-12T08:00:00Z', end_time: '2026-07-12T08:00:00Z' })).toBeNull()
    expect(journeyAvgSpeedKmh({ distance_km: 100 })).toBeNull()
  })
})

describe('journeyDataQualityFlags', () => {
  it('flags an end before start', () => {
    const f = journeyDataQualityFlags({ start_time: '2026-07-12T12:00:00Z', end_time: '2026-07-12T08:00:00Z' })
    expect(f.map((x) => x.code)).toContain('end_before_start')
  })
  it('flags a completed trip with zero/negative distance and missing times', () => {
    expect(journeyDataQualityFlags({ status: 'completed', distance_km: 0, start_time: '2026-07-12T08:00:00Z', end_time: '2026-07-12T09:00:00Z' }).map((x) => x.code)).toContain('nonpositive_distance')
    expect(journeyDataQualityFlags({ status: 'completed', distance_km: 10 }).map((x) => x.code)).toContain('missing_times')
  })
  it('returns an empty array for a clean row', () => {
    expect(journeyDataQualityFlags({ status: 'completed', distance_km: 120, start_time: '2026-07-12T08:00:00Z', end_time: '2026-07-12T10:00:00Z' })).toEqual([])
  })
  it('does not flag distance on non-completed trips', () => {
    expect(journeyDataQualityFlags({ status: 'planned', distance_km: 0 })).toEqual([])
  })
})

describe('months12 / bucketMonthly / monthlyDistance', () => {
  const now = new Date('2026-07-15T00:00:00Z')
  it('months12 returns 12 oldest-first buckets ending in the current month', () => {
    const m = months12(now)
    expect(m).toHaveLength(12)
    expect(m[11].key).toBe('2026-07')
    expect(m[0].key).toBe('2025-08')
  })
  it('bucketMonthly sums a value into the correct month via start_time', () => {
    const rows = [
      { start_time: '2026-07-03T08:00:00Z', distance_km: 100 },
      { start_time: '2026-07-20T08:00:00Z', distance_km: 50 },
      { start_time: '2026-06-01T08:00:00Z', distance_km: 25 },
      { start_time: '2020-01-01T00:00:00Z', distance_km: 999 }, // outside window, ignored
    ]
    const b = bucketMonthly(rows, (r) => r.distance_km, now)
    expect(b[11]).toBe(150)
    expect(b[10]).toBe(25)
    expect(b.reduce((s, v) => s + v, 0)).toBe(175)
  })
  it('monthlyDistance returns aligned labels, distance and a 12-month total', () => {
    const rows = [{ start_time: '2026-07-03T08:00:00Z', distance_km: 100 }, { end_time: '2026-07-05T08:00:00Z', distance_km: 40 }]
    const md = monthlyDistance(rows, now)
    expect(md.labels).toHaveLength(12)
    expect(md.distance).toHaveLength(12)
    expect(md.total).toBe(140)
  })
})

describe('statusFunnel', () => {
  it('counts each status with its share of the total', () => {
    const rows = [
      { status: 'planned' }, { status: 'in_progress' },
      { status: 'completed' }, { status: 'completed' },
    ]
    const f = statusFunnel(rows)
    expect(f.map((x) => x.status)).toEqual(JOURNEY_STATUSES)
    const completed = f.find((x) => x.status === 'completed')
    expect(completed.count).toBe(2)
    expect(completed.pct).toBe(50)
  })
})

describe('onTimeBreakdown', () => {
  it('tallies each class and the evaluated total', () => {
    const rows = [
      { end_time: '2026-07-12T10:00:00Z', scheduled_end: '2026-07-12T09:59:00Z' }, // on_time
      { end_time: '2026-07-12T10:00:00Z', scheduled_end: '2026-07-12T08:00:00Z' }, // late
      { end_time: '2026-07-12T10:00:00Z', scheduled_end: '2026-07-12T12:00:00Z' }, // early
      { end_time: '2026-07-12T10:00:00Z' }, // unknown
    ]
    const b = onTimeBreakdown(rows)
    expect(b).toEqual({ early: 1, on_time: 1, late: 1, unknown: 1, evaluated: 3 })
  })
})

describe('driverRollups / assetRollups', () => {
  const rows = [
    { driver_name: 'Ali', asset_no: 'A1', status: 'completed', distance_km: 100, start_time: '2026-07-12T08:00:00Z', end_time: '2026-07-12T10:00:00Z', scheduled_end: '2026-07-12T10:01:00Z' },
    { driver_name: 'Ali', asset_no: 'A1', status: 'cancelled', distance_km: 50, start_time: '2026-07-12T08:00:00Z', end_time: '2026-07-12T09:00:00Z' },
    { driver_name: 'Sara', asset_no: 'A2', status: 'completed', distance_km: 200, start_time: '2026-07-12T08:00:00Z', end_time: '2026-07-12T12:00:00Z' },
  ]
  it('rolls up per driver: trips, distance, completion + on-time rate, avg duration', () => {
    const d = driverRollups(rows)
    const ali = d.find((x) => x.driver === 'Ali')
    expect(ali.trips).toBe(2)
    expect(ali.distance).toBe(150)
    expect(ali.completed).toBe(1)
    expect(ali.completionRate).toBe(50)
    expect(ali.avgDurationHours).toBe(1.5)
    expect(ali.onTimeEvaluated).toBe(1)
    expect(ali.onTimeRate).toBe(100)
    const sara = d.find((x) => x.driver === 'Sara')
    expect(sara.onTimeEvaluated).toBe(0)
    expect(sara.onTimeRate).toBeNull()
  })
  it('sorts by distance desc and ignores blank keys', () => {
    const d = driverRollups([...rows, { driver_name: '', distance_km: 999 }])
    expect(d[0].driver).toBe('Sara')
    expect(d.every((x) => x.driver)).toBe(true)
  })
  it('assetRollups groups by asset_no', () => {
    const a = assetRollups(rows)
    expect(a.map((x) => x.asset).sort()).toEqual(['A1', 'A2'])
  })
})

describe('buildJourneyAnalytics', () => {
  const now = new Date('2026-07-15T00:00:00Z')
  const rows = [
    { driver_name: 'Ali', asset_no: 'A1', status: 'completed', distance_km: 240, start_time: '2026-07-12T08:00:00Z', end_time: '2026-07-12T12:00:00Z', scheduled_end: '2026-07-12T12:02:00Z' },
    { driver_name: 'Sara', asset_no: 'A2', status: 'in_progress', distance_km: 60, start_time: '2026-07-13T08:00:00Z' },
    { driver_name: 'Omar', asset_no: 'A3', status: 'completed', distance_km: -5, start_time: '2026-07-14T09:00:00Z', end_time: '2026-07-14T08:00:00Z' },
  ]
  it('produces honest KPIs, trend, breakdowns and rollups', () => {
    const a = buildJourneyAnalytics(rows, { now })
    expect(a.kpis.totalTrips).toBe(3)
    expect(a.kpis.completedTrips).toBe(2)
    expect(a.kpis.inProgress).toBe(1)
    expect(a.kpis.activeTrips).toBe(1)
    expect(a.kpis.avgSpeedKmh).toBe(60) // only the one clean completed trip qualifies
    expect(a.kpis.onTimePct).toBe(100)
    expect(a.kpis.onTimeEvaluated).toBe(1)
    expect(a.monthly.distance).toHaveLength(12)
    expect(a.drivers).toHaveLength(3)
    expect(a.assets).toHaveLength(3)
    // Omar's row is dirty: end<start AND completed w/ non-positive distance
    expect(a.dataQuality.rowsFlagged).toBe(1)
    expect(a.dataQuality.byCode.end_before_start).toBe(1)
    expect(a.dataQuality.byCode.nonpositive_distance).toBe(1)
  })
  it('is safe on empty input with null (N/A) metrics where uncomputable', () => {
    const a = buildJourneyAnalytics([], { now })
    expect(a.kpis.totalTrips).toBe(0)
    expect(a.kpis.avgDurationHours).toBeNull()
    expect(a.kpis.avgSpeedKmh).toBeNull()
    expect(a.kpis.onTimePct).toBeNull()
    expect(a.drivers).toEqual([])
    expect(a.dataQuality.rowsFlagged).toBe(0)
  })
})
