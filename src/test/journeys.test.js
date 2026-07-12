import { describe, it, expect } from 'vitest'
import { journeyDurationHours, summarizeJourneys } from '../lib/journeys'

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
