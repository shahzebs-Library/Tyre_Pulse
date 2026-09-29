import { describe, it, expect } from 'vitest'
import {
  classifyUtilization, assetProfiles, filterProfiles, utilizationSegments,
  dailyHoursTrend, detectJumps, allAnomalies, serviceThresholds, buildKpis,
  telematicsSummary, normalizeSettings, localDay,
} from '../lib/engineHoursView'

const NOW = new Date(2026, 8, 29, 12, 0, 0) // 29 Sep 2026 local
const R = (id, asset, hours, date, extra = {}) => ({ id, asset_no: asset, engine_hours: hours, reading_date: date, country: 'KSA', ...extra })

const readings = [
  R(1, 'G1', 100, '2026-09-19'),
  R(2, 'G1', 150, '2026-09-29'), // 50 h over 10 d = 5 h/day
  R(3, 'G2', 500, '2026-09-01'),
  R(4, 'G2', 500, '2026-09-10'), // did not move = idle, last read 19 d ago
  R(5, 'G3', 40, '2026-06-01'), // single reading, overdue
]

describe('engineHoursView', () => {
  it('classifies utilisation honestly', () => {
    expect(classifyUtilization(null)).toBe('no_data')
    expect(classifyUtilization(0)).toBe('idle')
    expect(classifyUtilization(0.5, 1)).toBe('low')
    expect(classifyUtilization(5, 1)).toBe('active')
  })

  it('builds per-asset profiles joined to the register', () => {
    const fleet = [{ asset_no: 'g1', country: 'KSA', make: 'CAT', model: 'C9', fleet_number: 'F-1' }]
    const p = assetProfiles(readings, { fleet, now: NOW })
    const g1 = p.find((x) => x.asset_no === 'G1')
    expect(g1).toMatchObject({ make: 'CAT', currentHours: 150, sincePrevious: 50, avgDailyHours: 5, status: 'active', readingOverdue: false })
    expect(g1.utilizationPct).toBeCloseTo(20.8, 1)
    const g3 = p.find((x) => x.asset_no === 'G3')
    expect(g3).toMatchObject({ make: null, avgDailyHours: null, utilizationPct: null, status: 'no_data', readingOverdue: true, sincePrevious: null })
    expect(p.find((x) => x.asset_no === 'G2').status).toBe('idle')
  })

  it('refuses to guess a make when the code exists in two countries', () => {
    const fleet = [{ asset_no: 'G1', country: 'UAE', make: 'A' }, { asset_no: 'G1', country: 'EGYPT', make: 'B' }]
    expect(assetProfiles(readings, { fleet, now: NOW }).find((x) => x.asset_no === 'G1').make).toBeNull()
  })

  it('filters profiles, including reading overdue', () => {
    const p = assetProfiles(readings, { now: NOW })
    expect(filterProfiles(p, { status: 'overdue' }).map((x) => x.asset_no)).toEqual(['G3'])
    expect(filterProfiles(p, { search: 'g2' }).map((x) => x.asset_no)).toEqual(['G2'])
    const seg = utilizationSegments(p)
    expect(seg.map((s) => s.count)).toEqual([1, 0, 1, 1])
  })

  it('counts daily hours on the day of the later reading', () => {
    const t = dailyHoursTrend(readings, { days: 14, now: NOW })
    expect(t).toHaveLength(14)
    expect(t[t.length - 1]).toMatchObject({ day: localDay(NOW), hours: 50, readings: 1 })
    expect(t.reduce((s, b) => s + b.hours, 0)).toBe(50)
  })

  it('flags meter jumps and drops', () => {
    const rows = [R(1, 'X', 100, '2026-09-01'), R(2, 'X', 200, '2026-09-02'), R(3, 'X', 150, '2026-09-03')]
    expect(detectJumps(rows)).toHaveLength(1)
    const all = allAnomalies(rows)
    expect(all.map((a) => a.type).sort()).toEqual(['drop', 'jump'])
  })

  it('judges engine-hour plans against the latest reading', () => {
    const plans = [
      { id: 'p1', name: 'A', asset_no: 'G1', country: 'KSA', status: 'active', meter_source: 'engine_hours', next_due_meter: 160 },
      { id: 'p2', name: 'B', asset_no: 'G2', country: 'KSA', status: 'active', meter_source: 'engine_hours', next_due_meter: 450 },
      { id: 'p3', name: 'C', asset_no: 'G9', status: 'active', meter_source: 'engine_hours', next_due_meter: 10 },
      { id: 'p4', name: 'D', asset_no: 'G1', status: 'active', meter_source: 'odometer', next_due_meter: 10 },
    ]
    const t = serviceThresholds(plans, readings)
    expect(t.map((x) => [x.id, x.status])).toEqual([['p2', 'exceeded'], ['p1', 'near'], ['p3', 'unknown']])
    const k = buildKpis({ profiles: assetProfiles(readings, { now: NOW }), readings, thresholds: t, now: NOW })
    expect(k).toMatchObject({ assetsWithMeters: 3, readingsToday: 1, overdueReadings: 1, nearService: 1, exceeded: 1 })
    expect(buildKpis({ profiles: [], readings: [], thresholds: [], now: NOW }).nearService).toBeNull()
  })

  it('sums telematics time only when a snapshot has it', () => {
    const util = [
      { asset_no: 'G1', country: 'KSA', captured_at: '2026-09-01', working_seconds: 7200, idle_seconds: 3600 },
      { asset_no: 'G1', country: 'KSA', captured_at: '2026-09-20', working_seconds: 36000, idle_seconds: null },
    ]
    expect(telematicsSummary(util, new Set(['G1']))).toMatchObject({ assets: 1, workingHours: 10, idleHours: null })
    expect(normalizeSettings({ staleDays: -5, basisHoursPerDay: 'x' })).toMatchObject({ staleDays: 1, basisHoursPerDay: 24 })
  })
})

describe('assetHourSeries', () => {
  it('marks drops with a reason and measures hours run from clean readings', async () => {
    const { assetHourSeries } = await import('../lib/engineHoursView')
    const rows = [
      { id: 'a', asset_no: 'gn1', engine_hours: 100, reading_date: '2026-01-01' },
      { id: 'b', asset_no: 'GN1', engine_hours: 140, reading_date: '2026-01-05' },
      { id: 'c', asset_no: 'GN1', engine_hours: 90, reading_date: '2026-01-06' },
      { id: 'd', asset_no: 'X9', engine_hours: 5, reading_date: '2026-01-06' },
    ]
    const s = assetHourSeries(rows, 'GN1')
    expect(s.points.map((p) => p.value)).toEqual([100, 140, 90])
    expect(s.points[2].flagged).toBe(true)
    expect(s.points[2].reason).toMatch(/lower than the previous reading/)
    expect(s.hoursRun).toBe(40)
    expect(s.flaggedCount).toBe(1)
    expect(assetHourSeries(rows, 'X9').hoursRun).toBeNull()
  })
})
