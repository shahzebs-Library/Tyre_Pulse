import { describe, it, expect } from 'vitest'
import {
  normalizeViewSettings, sourceGroup, sourceDistribution, findJumps, readingStatus, readingKey,
  missingReadings, viewKpis, distanceSeries, distanceBuckets, anomalyRows, approvalQueue,
} from '../lib/odometerLogsView'

const km = (id, value, date, extra = {}) => ({ id, kind: 'km', value, reading_date: date, asset_no: 'TM1', country: 'KSA', created_at: `${date}T08:00:00Z`, ...extra })
const hrs = (id, value, date, extra = {}) => ({ ...km(id, value, date, extra), kind: 'hours' })

describe('odometerLogsView', () => {
  it('clamps settings and falls back to defaults on junk', () => {
    expect(normalizeViewSettings({ missingDays: 'x', maxHoursPerDay: 99, jumpMinKm: -5 })).toEqual({ missingDays: 30, maxKmPerDay: 1500, jumpMinKm: 0, maxHoursPerDay: 24 })
  })

  it('groups sources into telematics, manual, mobile app and other', () => {
    expect(['telematics', 'Web Manual', 'manual', 'mobile', 'erp import', ''].map(sourceGroup))
      .toEqual(['telematics', 'manual', 'manual', 'mobile', 'other', 'other'])
    const segs = sourceDistribution([{ source: 'mobile' }, { source: 'telematics' }])
    expect(segs.map(s => s.key)).toEqual(['telematics', 'manual', 'mobile'])
  })

  it('flags km and hour jumps only when both the size and daily rate are implausible', () => {
    const rows = [
      km('a', 1000, '2026-09-01'), km('b', 6000, '2026-09-02'), km('c', 8000, '2026-09-10'),
      hrs('h1', 100, '2026-09-01'), hrs('h2', 110, '2026-09-02'), hrs('h3', 200, '2026-09-03'),
    ]
    const jumps = findJumps(rows)
    expect(jumps.map(j => j.key).sort()).toEqual(['hours:h3', 'km:b'])
    expect(jumps.find(j => j.key === 'km:b').perDay).toBe(5000)
  })

  it('status: server flag wins, then jump, else accepted', () => {
    const keys = new Set(['km:j'])
    expect(readingStatus({ id: 'x', kind: 'km', flagged: true, reviewed: false }, keys)).toBe('review')
    expect(readingStatus({ id: 'j', kind: 'km', flagged: true, reviewed: true }, keys)).toBe('reviewed')
    expect(readingStatus({ id: 'j', kind: 'km' }, keys)).toBe('jump')
    expect(readingStatus({ id: 'y', kind: 'km' }, keys)).toBe('accepted')
    expect(approvalQueue([{ flagged: true }, { flagged: true, reviewed: true }, {}])).toHaveLength(1)
  })

  it('missing readings: never read and older than the window, skipping vehicles with no meter', () => {
    const v = (id, date, supports = true) => ({ id, asset_no: id, supportsKm: supports, kmLog: date ? { reading_date: date } : null })
    const out = missingReadings([v('A', '2026-09-20'), v('B', '2026-07-01'), v('C', null), v('D', null, false)], '2026-09-29')
    expect(out.map(m => [m.vehicle.id, m.daysSince])).toEqual([['C', null], ['B', 90]])
  })

  it('KPIs: accuracy is N/A without readings and excludes flagged and jumps', () => {
    expect(viewKpis({ rows: [], vehicles: [], jumps: [], missing: [] }).accuracyPct).toBeNull()
    const rows = [km('a', 1, '2026-09-01'), km('b', 2, '2026-09-02', { flagged: true }), km('c', 3, '2026-09-03'), km('d', 4, '2026-09-04')]
    const k = viewKpis({ rows, vehicles: [{}], jumps: [{ key: readingKey(rows[2]) }], missing: [] })
    expect(k).toMatchObject({ total: 4, review: 1, jumps: 1, reporting: 1, accuracyPct: 50 })
  })

  it('distance: positive non-jump increases credited to the later reading bucket', () => {
    const rows = [km('a', 1000, '2026-09-27'), km('b', 1200, '2026-09-28'), km('c', 1100, '2026-09-29'), km('d', 9000, '2026-09-29'), hrs('h', 5, '2026-09-29')]
    const s = distanceSeries(rows, 'daily', '2026-09-29')
    expect(s.points).toHaveLength(30)
    expect(s.points.find(p => p.key === '2026-09-28').km).toBe(200)
    expect(s.total).toBe(200)
    expect(distanceBuckets('weekly', '2026-09-30').at(-1).key).toBe('2026-09-28')
    expect(distanceBuckets('monthly', '2026-09-29').map(b => b.key).slice(-2)).toEqual(['2026-08', '2026-09'])
  })

  it('anomalies list each reading once, flagged ahead of the client jump', () => {
    const r = km('b', 6000, '2026-09-02', { flagged: true, flag_reason: 'Lower' })
    const out = anomalyRows([r], [{ key: 'km:b', reading: r, kind: 'km', delta: 5000, days: 1, perDay: 5000 }, { key: 'km:z', reading: km('z', 9, '2026-09-03'), kind: 'km', delta: 4000, days: 1, perDay: 4000 }])
    expect(out.map(a => a.type)).toEqual(['jump', 'regression'])
  })
})
