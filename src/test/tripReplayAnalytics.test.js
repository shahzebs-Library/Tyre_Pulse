import { describe, it, expect } from 'vitest'
import {
  replayKpis, eventBreakdown, filterSegments, speedSeries, tripListRows,
  segmentExportRows, replayNarrative, EXPORT_COLS,
} from '../lib/tripReplayAnalytics'

const segs = [
  { id: 1, sequence: 1, latitude: 24.7, longitude: 46.6, speed_kmh: 0, event_type: 'stop', recorded_at: '2026-09-01T08:00:00Z', address: 'Depot' },
  { id: 2, sequence: 2, latitude: 24.8, longitude: 46.7, speed_kmh: 80, event_type: 'move', recorded_at: '2026-09-01T08:30:00Z' },
  { id: 3, sequence: 3, latitude: 24.9, longitude: 46.8, speed_kmh: 120, event_type: 'speeding', recorded_at: '2026-09-01T09:00:00Z', asset_no: 'A1' },
]

describe('tripReplayAnalytics', () => {
  it('computes distance, span and speeds for a measured trip', () => {
    const k = replayKpis(segs)
    expect(k.segments).toBe(3)
    expect(k.distanceKm).toBeGreaterThan(20)
    expect(k.durationMin).toBe(60)
    expect(k.maxKmh).toBe(120)
    expect(k.movingAvgKmh).toBe(100)
    expect(k.harshEvents).toBe(1)
    expect(k.harshRatePct).toBe(33.3)
    expect(k.harshPer100Km).not.toBeNull()
  })

  it('reports N/A (null) rather than 0 when nothing can be measured', () => {
    const k = replayKpis([{ id: 9, sequence: 1, event_type: 'move' }])
    expect(k.distanceKm).toBeNull()
    expect(k.maxKmh).toBeNull()
    expect(k.avgKmh).toBeNull()
    expect(k.movingAvgKmh).toBeNull()
    expect(k.durationMin).toBeNull()
    expect(k.harshPer100Km).toBeNull()
    expect(replayKpis([]).harshRatePct).toBeNull()
  })

  it('breaks events down with share and harsh flag', () => {
    const e = eventBreakdown(segs)
    expect(e.map((x) => x.type)).toEqual(['move', 'stop', 'speeding'])
    expect(e.find((x) => x.type === 'speeding')).toMatchObject({ count: 1, pct: 33, harsh: true })
  })

  it('filters segments by search, event and harsh only', () => {
    expect(filterSegments(segs, { search: 'depot' }).map((r) => r.id)).toEqual([1])
    expect(filterSegments(segs, { event: 'move' }).map((r) => r.id)).toEqual([2])
    expect(filterSegments(segs, { harshOnly: true }).map((r) => r.id)).toEqual([3])
    expect(filterSegments(segs, { search: 'speeding' }).map((r) => r.id)).toEqual([3])
  })

  it('down-samples a long series but keeps every harsh point', () => {
    const long = Array.from({ length: 1000 }, (_, i) => ({ sequence: i + 1, speed_kmh: i % 90, event_type: i === 777 ? 'harsh_brake' : 'move' }))
    const s = speedSeries(long, 100)
    expect(s.length).toBeLessThanOrEqual(101)
    expect(s.some((p) => p.seq === 778 && p.harsh)).toBe(true)
    expect(speedSeries(segs)).toHaveLength(3)
  })

  it('lists trips with a span and a search filter', () => {
    const trips = [
      { trip_ref: 'T1', asset_no: 'A1', segments: 3, firstAt: '2026-09-01T08:00:00Z', lastAt: '2026-09-01T09:30:00Z' },
      { trip_ref: 'T2', asset_no: 'B7', segments: 1, firstAt: null, lastAt: null },
    ]
    const rows = tripListRows(trips)
    expect(rows[0].durationMin).toBe(90)
    expect(rows[1].durationMin).toBeNull()
    expect(tripListRows(trips, { search: 'b7' }).map((t) => t.trip_ref)).toEqual(['T2'])
  })

  it('shapes exports and narrative', () => {
    const out = segmentExportRows(segs)
    expect(Object.keys(out[0])).toEqual(EXPORT_COLS)
    expect(out[0].heading).toBe('N/A')
    expect(out[2].event_type).toBe('Speeding')
    expect(replayNarrative(replayKpis(segs))).toContain('1 harsh event')
    expect(replayNarrative(replayKpis([]))).toBe('')
  })
})
