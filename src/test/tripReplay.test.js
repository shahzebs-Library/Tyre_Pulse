import { describe, it, expect } from 'vitest'
import {
  toFiniteNumber, haversineKm, orderSegments, pathDistanceKm, countEvents,
  speedProfile, stopCount, summariseTrip, HARSH_EVENTS, EVENT_TYPES,
} from '../lib/tripReplay'

// Small helpers to build segments tersely.
const seg = (sequence, extra = {}) => ({ sequence, ...extra })

describe('tripReplay — toFiniteNumber', () => {
  it('parses numbers, numeric strings, and dirty strings', () => {
    expect(toFiniteNumber(42)).toBe(42)
    expect(toFiniteNumber('42.5')).toBe(42.5)
    expect(toFiniteNumber('-7')).toBe(-7)
    expect(toFiniteNumber('88 km/h')).toBe(88)
  })
  it('returns null for empty / null / non-numeric', () => {
    expect(toFiniteNumber('')).toBeNull()
    expect(toFiniteNumber(null)).toBeNull()
    expect(toFiniteNumber(undefined)).toBeNull()
    expect(toFiniteNumber('abc')).toBeNull()
  })
})

describe('tripReplay — haversineKm', () => {
  it('returns 0 when either point has missing coordinates', () => {
    expect(haversineKm({}, {})).toBe(0)
    expect(haversineKm({ latitude: 10 }, { latitude: 20, longitude: 30 })).toBe(0)
    expect(haversineKm(null, null)).toBe(0)
    expect(haversineKm({ latitude: 24.7, longitude: 46.7 }, { latitude: null, longitude: 46.7 })).toBe(0)
  })
  it('returns 0 for identical points', () => {
    const p = { latitude: 24.7136, longitude: 46.6753 }
    expect(haversineKm(p, p)).toBe(0)
  })
  it('computes a known distance (London → Paris ≈ 343 km)', () => {
    const london = { latitude: 51.5074, longitude: -0.1278 }
    const paris = { latitude: 48.8566, longitude: 2.3522 }
    const d = haversineKm(london, paris)
    expect(d).toBeGreaterThan(340)
    expect(d).toBeLessThan(346)
  })
  it('computes ~111 km per degree of latitude at the equator', () => {
    const d = haversineKm({ latitude: 0, longitude: 0 }, { latitude: 1, longitude: 0 })
    expect(d).toBeGreaterThan(110)
    expect(d).toBeLessThan(112)
  })
  it('is symmetric and coerces numeric strings', () => {
    const a = { latitude: '24.7136', longitude: '46.6753' }
    const b = { latitude: '24.8000', longitude: '46.7000' }
    expect(haversineKm(a, b)).toBeCloseTo(haversineKm(b, a), 10)
    expect(haversineKm(a, b)).toBeGreaterThan(0)
  })
})

describe('tripReplay — orderSegments', () => {
  it('orders by sequence ascending, not mutating the input', () => {
    const input = [seg(3), seg(1), seg(2)]
    const out = orderSegments(input)
    expect(out.map((r) => r.sequence)).toEqual([1, 2, 3])
    expect(input.map((r) => r.sequence)).toEqual([3, 1, 2]) // untouched
  })
  it('falls back to recorded_at when sequence is absent or tied', () => {
    const rows = [
      { recorded_at: '2026-01-01T10:05:00Z' },
      { recorded_at: '2026-01-01T10:00:00Z' },
      { recorded_at: '2026-01-01T10:02:00Z' },
    ]
    const out = orderSegments(rows)
    expect(out.map((r) => r.recorded_at)).toEqual([
      '2026-01-01T10:00:00Z', '2026-01-01T10:02:00Z', '2026-01-01T10:05:00Z',
    ])
  })
  it('places sequenced rows before unsequenced ones', () => {
    const rows = [{ recorded_at: '2026-01-01T10:00:00Z' }, seg(1), seg(0)]
    const out = orderSegments(rows)
    expect(out[0].sequence).toBe(0)
    expect(out[1].sequence).toBe(1)
    expect(out[2].sequence).toBeUndefined()
  })
  it('returns [] for non-array input', () => {
    expect(orderSegments(null)).toEqual([])
    expect(orderSegments(undefined)).toEqual([])
  })
})

describe('tripReplay — pathDistanceKm', () => {
  it('sums haversine over the ordered path regardless of input order', () => {
    const a = { sequence: 1, latitude: 0, longitude: 0 }
    const b = { sequence: 2, latitude: 0, longitude: 1 }
    const c = { sequence: 3, latitude: 0, longitude: 2 }
    const ordered = pathDistanceKm([a, b, c])
    const shuffled = pathDistanceKm([c, a, b])
    expect(ordered).toBeCloseTo(shuffled, 9)
    // Two ~111 km hops at the equator.
    expect(ordered).toBeGreaterThan(221)
    expect(ordered).toBeLessThan(224)
  })
  it('returns 0 for fewer than two points', () => {
    expect(pathDistanceKm([])).toBe(0)
    expect(pathDistanceKm([{ sequence: 1, latitude: 0, longitude: 0 }])).toBe(0)
  })
  it('ignores hops where a coordinate is missing (haversine yields 0)', () => {
    const rows = [
      { sequence: 1, latitude: 0, longitude: 0 },
      { sequence: 2 },
      { sequence: 3, latitude: 0, longitude: 1 },
    ]
    expect(pathDistanceKm(rows)).toBe(0)
  })
})

describe('tripReplay — countEvents', () => {
  it('counts per event_type with every recognised key present', () => {
    const rows = [
      seg(1, { event_type: 'move' }),
      seg(2, { event_type: 'harsh_brake' }),
      seg(3, { event_type: 'harsh_brake' }),
      seg(4, { event_type: 'stop' }),
      seg(5, { event_type: 'speeding' }),
    ]
    const c = countEvents(rows)
    expect(c.move).toBe(1)
    expect(c.harsh_brake).toBe(2)
    expect(c.stop).toBe(1)
    expect(c.speeding).toBe(1)
    expect(c.idle).toBe(0)
    expect(Object.keys(c).sort()).toEqual([...EVENT_TYPES].sort())
  })
  it('ignores missing / unrecognised event types', () => {
    const rows = [seg(1), seg(2, { event_type: 'bogus' }), seg(3, { event_type: null })]
    const c = countEvents(rows)
    expect(Object.values(c).reduce((a, b) => a + b, 0)).toBe(0)
  })
})

describe('tripReplay — speedProfile', () => {
  it('computes max, avg, and moving average excluding zero-speed stops', () => {
    const rows = [
      seg(1, { speed_kmh: 0 }),
      seg(2, { speed_kmh: 60 }),
      seg(3, { speed_kmh: 40 }),
      seg(4, { speed_kmh: 0 }),
    ]
    const p = speedProfile(rows)
    expect(p.maxKmh).toBe(60)
    expect(p.avgKmh).toBe(25) // (0+60+40+0)/4
    expect(p.movingAvgKmh).toBe(50) // (60+40)/2
  })
  it('returns zeros when no numeric speeds are present', () => {
    const p = speedProfile([seg(1), seg(2, { speed_kmh: '' })])
    expect(p).toEqual({ maxKmh: 0, avgKmh: 0, movingAvgKmh: 0 })
  })
  it('coerces numeric strings for speed', () => {
    const p = speedProfile([seg(1, { speed_kmh: '30' }), seg(2, { speed_kmh: '90' })])
    expect(p.maxKmh).toBe(90)
    expect(p.avgKmh).toBe(60)
  })
})

describe('tripReplay — stopCount', () => {
  it('counts stop and idle segments', () => {
    const rows = [
      seg(1, { event_type: 'stop' }),
      seg(2, { event_type: 'idle' }),
      seg(3, { event_type: 'move' }),
      seg(4, { event_type: 'stop' }),
    ]
    expect(stopCount(rows)).toBe(3)
  })
  it('returns 0 when there are no halts', () => {
    expect(stopCount([seg(1, { event_type: 'move' })])).toBe(0)
    expect(stopCount([])).toBe(0)
  })
})

describe('tripReplay — summariseTrip', () => {
  it('rolls up segments, distance, stops, harsh events, and speed', () => {
    const rows = [
      { sequence: 1, latitude: 0, longitude: 0, speed_kmh: 0, event_type: 'stop' },
      { sequence: 2, latitude: 0, longitude: 1, speed_kmh: 80, event_type: 'harsh_accel' },
      { sequence: 3, latitude: 0, longitude: 2, speed_kmh: 120, event_type: 'speeding' },
      { sequence: 4, latitude: 0, longitude: 2, speed_kmh: 0, event_type: 'idle' },
    ]
    const s = summariseTrip(rows)
    expect(s.segments).toBe(4)
    expect(s.stops).toBe(2) // stop + idle
    expect(s.harshEvents).toBe(2) // harsh_accel + speeding
    expect(s.maxKmh).toBe(120)
    expect(s.avgKmh).toBe(50) // (0+80+120+0)/4
    expect(s.distanceKm).toBeGreaterThan(221)
    expect(s.distanceKm).toBeLessThan(224)
  })
  it('handles an empty trip deterministically', () => {
    expect(summariseTrip([])).toEqual({
      segments: 0, distanceKm: 0, stops: 0, harshEvents: 0, maxKmh: 0, avgKmh: 0,
    })
  })
  it('sums all harsh event families', () => {
    const rows = HARSH_EVENTS.map((event_type, i) => seg(i + 1, { event_type }))
    expect(summariseTrip(rows).harshEvents).toBe(HARSH_EVENTS.length)
  })
})
