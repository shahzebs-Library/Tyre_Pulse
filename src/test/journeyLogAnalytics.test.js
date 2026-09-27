import { describe, it, expect } from 'vitest'
import {
  filterJourneys, journeyRow, distanceHeadline, recentActivity, journeyExportRows,
  perfRows, perfExportRows, toLocalInput, distinctJourneyValues,
} from '../lib/journeyLogAnalytics'

const rows = [
  { id: 1, asset_no: 'TM1', driver_name: 'Ali', origin: 'A', destination: 'B', start_time: '2026-09-20T08:00:00', end_time: '2026-09-20T10:00:00', distance_km: 100, status: 'completed', site: 'NHC' },
  { id: 2, asset_no: 'TM2', driver_name: 'Omar', start_time: '2026-09-26T09:00:00', status: 'planned', site: 'JED' },
  { id: 3, asset_no: 'TM1', status: 'completed', distance_km: 0 },
]

describe('filterJourneys', () => {
  it('filters by status, asset, site, date range and search', () => {
    expect(filterJourneys(rows, { status: 'completed' })).toHaveLength(2)
    expect(filterJourneys(rows, { asset: 'TM2' })[0].id).toBe(2)
    expect(filterJourneys(rows, { site: 'NHC' })[0].id).toBe(1)
    expect(filterJourneys(rows, { from: '2026-09-21' }).map((r) => r.id)).toEqual([2])
    expect(filterJourneys(rows, { to: '2026-09-20' }).map((r) => r.id)).toEqual([1])
    expect(filterJourneys(rows, { search: 'omar' })[0].id).toBe(2)
  })
  it('distinct values', () => {
    expect(distinctJourneyValues(rows, 'asset_no')).toEqual(['TM1', 'TM2'])
  })
})

describe('row derivation', () => {
  it('derives duration, speed and data-quality flags', () => {
    const r = journeyRow(rows[0])
    expect(r.duration).toBe(2)
    expect(r.speed).toBe(50)
    expect(r.flags).toEqual([])
    const bad = journeyRow(rows[2])
    expect(bad.flags.map((f) => f.code)).toContain('nonpositive_distance')
    expect(journeyRow(rows[1]).distance).toBeNull()
  })
  it('datetime-local conversion', () => {
    expect(toLocalInput('2026-09-20T08:05:00')).toBe('2026-09-20T08:05')
    expect(toLocalInput('')).toBe('')
  })
})

describe('headline + activity', () => {
  it('distance is null when no journey carries a distance', () => {
    expect(distanceHeadline([{ id: 1 }]).total).toBeNull()
    expect(distanceHeadline(rows).total).toBe(100)
    expect(distanceHeadline(rows).recorded).toBe(2)
  })
  it('recent activity respects an injected now', () => {
    const a = recentActivity(rows, new Date(2026, 8, 26, 12))
    expect(a.today).toBe(1)
    expect(a.last7Days).toBe(2)
  })
})

describe('exports', () => {
  it('journey export uses N/A and a data-quality column', () => {
    const ex = journeyExportRows(rows)
    expect(ex[1].distance_km).toBe('N/A')
    expect(ex[0].data_quality).toBe('OK')
    expect(ex[2].data_quality).toMatch(/distance/i)
  })
  it('perf rows carry a common name and N/A for unmeasured', () => {
    const p = perfRows({ drivers: [{ driver: 'Ali', trips: 1, distance: 5, completionRate: 100, onTimeRate: null, avgDurationHours: null }] }, 'driver')
    expect(p[0].name).toBe('Ali')
    expect(perfExportRows(p)[0].onTimeRate).toBe('N/A')
  })
})
