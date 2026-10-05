import { describe, it, expect } from 'vitest'
import {
  tripsInPeriod, segmentTone, pathGeometry, playbackAt, fmtClock, eventsSummary, stopsTimeline,
  speedChart, tripSummary,
} from '../lib/tripReplayView'

const segs = [
  { id: 'a', sequence: 1, latitude: 24.70, longitude: 46.60, speed_kmh: 60, event_type: 'move', recorded_at: '2026-09-01T08:00:00Z', address: 'Depot' },
  { id: 'b', sequence: 2, latitude: 24.72, longitude: 46.62, speed_kmh: 0, event_type: 'stop', recorded_at: '2026-09-01T08:10:00Z', address: 'Customer A' },
  { id: 'c', sequence: 3, latitude: 24.74, longitude: 46.65, speed_kmh: 110, event_type: 'harsh_brake', recorded_at: '2026-09-01T08:30:00Z' },
  { id: 'd', sequence: 4, latitude: 24.80, longitude: 46.70, speed_kmh: 15, event_type: 'move', recorded_at: '2026-09-01T09:00:00Z', address: 'Site' },
]

describe('tripsInPeriod', () => {
  const trips = [{ trip_ref: 'A', firstAt: '2026-09-01T08:00:00Z' }, { trip_ref: 'B', firstAt: '2026-10-02T08:00:00Z' }, { trip_ref: 'C' }]
  it('keeps everything with no bounds', () => expect(tripsInPeriod(trips)).toHaveLength(3))
  it('filters by first point day', () => {
    expect(tripsInPeriod(trips, { from: '2026-10-01' }).map((t) => t.trip_ref)).toEqual(['B'])
    expect(tripsInPeriod(trips, { to: '2026-09-30' }).map((t) => t.trip_ref)).toEqual(['A'])
  })
})

describe('segmentTone', () => {
  it('maps events and slow speed', () => {
    expect(segmentTone({ event_type: 'harsh_brake' })).toBe('harsh')
    expect(segmentTone({ event_type: 'speeding' })).toBe('speeding')
    expect(segmentTone({ event_type: 'idle' })).toBe('stop')
    expect(segmentTone({ event_type: 'move', speed_kmh: 10 })).toBe('slow')
    expect(segmentTone({ event_type: 'move', speed_kmh: 70 })).toBe('normal')
  })
})

describe('pathGeometry', () => {
  it('is null with fewer than two positioned points', () => {
    expect(pathGeometry([])).toBeNull()
    expect(pathGeometry([segs[0], { id: 'x', sequence: 2 }])).toBeNull()
  })
  it('projects points inside the box', () => {
    const g = pathGeometry(segs, { w: 400, h: 200, pad: 20 })
    expect(g.points).toHaveLength(4)
    expect(g.lines).toHaveLength(3)
    for (const p of g.points) {
      expect(p.x).toBeGreaterThanOrEqual(0); expect(p.x).toBeLessThanOrEqual(400)
      expect(p.y).toBeGreaterThanOrEqual(0); expect(p.y).toBeLessThanOrEqual(200)
    }
    expect(g.points[2].tone).toBe('harsh')
    expect(g.kmAcross).toBeGreaterThan(0)
  })
})

describe('playback', () => {
  it('clamps the index and reports elapsed time', () => {
    const p = playbackAt(segs, 2)
    expect(p).toMatchObject({ index: 2, last: 3, elapsedMin: 30, totalMin: 60, pct: 67 })
    expect(playbackAt(segs, 99).index).toBe(3)
    expect(playbackAt([], 0).current).toBeNull()
    expect(fmtClock(75)).toBe('01:15')
    expect(fmtClock(null)).toBe('N/A')
  })
})

describe('events, timeline, chart, summary', () => {
  it('summarises events honestly', () => {
    const e = eventsSummary(segs)
    expect(e).toMatchObject({ speeding: 0, harsh: 1, stops: 1, idleMin: 20, maxSpeed: 110, geofence: null, fuel: null, tolls: null })
    expect(eventsSummary([]).idleMin).toBeNull()
  })
  it('builds the stops timeline', () => {
    const tl = stopsTimeline(segs)
    expect(tl.map((x) => x.kind)).toEqual(['start', 'stop', 'harsh', 'end'])
    expect(tl[1].note).toBe('20 min')
    expect(tl[0].label).toBe('Start - Depot')
  })
  it('builds the speed chart over time', () => {
    const c = speedChart(segs)
    expect(c.useTime).toBe(true)
    expect(c.top).toBe(120)
    expect(c.markers.map((m) => m.tone)).toEqual(['stop', 'harsh'])
    expect(speedChart([{ id: 'z', sequence: 1 }])).toBeNull()
  })
  it('never invents fuel or CO2', () => {
    expect(tripSummary({ distanceKm: 12, durationMin: 60, avgKmh: 40 })).toEqual({ distanceKm: 12, durationMin: 60, avgKmh: 40, fuelL: null, efficiency: null, co2Kg: null })
  })
})
