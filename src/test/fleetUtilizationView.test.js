import { describe, it, expect } from 'vitest'
import {
  activityOf, filterByPeriod, filterByActivity, utilizationKpis, activityByCapture,
  activitySplit, siteBars, totalHours,
} from '../lib/fleetUtilizationView'

const ROWS = [
  { id: 1, asset_no: 'TM1', working_seconds: 36000, idle_seconds: 7200, distance_km: 120, utilization_pct: 80, captured_at: '2026-09-20' },
  { id: 2, asset_no: 'TM2', working_seconds: 0, idle_seconds: 3600, utilization_pct: 10, captured_at: '2026-09-20' },
  { id: 3, asset_no: 'TM3', working_seconds: 0, idle_seconds: 0, captured_at: '2026-06-01' },
  { id: 4, asset_no: 'TM4' },
]

describe('fleetUtilizationView', () => {
  it('classifies activity honestly', () => {
    expect(ROWS.map(activityOf)).toEqual(['working', 'idle', 'inactive', 'unknown'])
    expect(activityOf({ driving_seconds: 60 })).toBe('working')
  })

  it('filters by period against the given day and drops undated rows', () => {
    const now = new Date(2026, 8, 29)
    expect(filterByPeriod(ROWS, 'all', now)).toHaveLength(4)
    expect(filterByPeriod(ROWS, '30', now).map((r) => r.id)).toEqual([1, 2])
    expect(filterByPeriod(ROWS, '365', now).map((r) => r.id)).toEqual([1, 2, 3])
    expect(filterByActivity(ROWS, 'idle').map((r) => r.id)).toEqual([2])
  })

  it('KPIs are null when nothing is measured, never zero', () => {
    expect(utilizationKpis([{ asset_no: 'X' }], null)).toMatchObject({
      totalFleet: null, tracked: 1, avgUtilization: null, workingHours: null, idleHours: null, distanceKm: null,
    })
    const k = utilizationKpis(ROWS, [{}, {}, {}, {}, {}])
    expect(k).toMatchObject({ totalFleet: 5, tracked: 4, avgUtilization: 45, workingHours: 10, idleHours: 3, distanceKm: 120 })
  })

  it('never invents days: one capture is not a trend and undated rows stay out', () => {
    const one = activityByCapture(ROWS.slice(0, 2))
    expect(one.trendable).toBe(false)
    expect(one.points).toEqual([{ date: '2026-09-20', working: 1, idle: 1, inactive: 0, unknown: 0, total: 2 }])
    const all = activityByCapture(ROWS)
    expect(all.trendable).toBe(true)
    expect(all.points.map((p) => p.date)).toEqual(['2026-06-01', '2026-09-20'])
    expect(all.undated).toBe(1)
    expect(activitySplit(ROWS).map((s) => s.count)).toEqual([1, 1, 1, 1])
  })

  it('site bars skip unmeasured sites and total hours stay null when unrecorded', () => {
    const bars = siteBars([{ site: 'A', avgUtilization: 40, assets: 2 }, { site: 'B', avgUtilization: null, assets: 1 }, { site: 'C', avgUtilization: 72.36, assets: 3 }])
    expect(bars).toEqual([{ site: 'C', pct: 72.4, assets: 3 }, { site: 'A', pct: 40, assets: 2 }])
    expect(totalHours(ROWS[0])).toBe(12)
    expect(totalHours(ROWS[3])).toBeNull()
  })
})
