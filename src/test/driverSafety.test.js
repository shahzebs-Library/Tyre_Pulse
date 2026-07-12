import { describe, it, expect } from 'vitest'
import { summariseSafety, driverScorecard, byEventType, toFiniteNumber } from '../lib/driverSafety'

describe('driverSafety — summariseSafety', () => {
  it('returns zeroes for empty / non-array input', () => {
    const zero = {
      totalEvents: 0, highSeverityCount: 0, distinctDrivers: 0,
      totalPenaltyPoints: 0, avgPenaltyPerDriver: 0,
    }
    expect(summariseSafety([])).toEqual(zero)
    expect(summariseSafety()).toEqual(zero)
    expect(summariseSafety(null)).toEqual(zero)
  })

  it('counts events, high severity, distinct drivers and penalty points', () => {
    const rows = [
      { driver_name: 'Ali', severity: 'high', penalty_points: 10 },
      { driver_name: 'Ali', severity: 'low', penalty_points: 5 },
      { driver_name: 'Sara', severity: 'high', penalty_points: 20 },
    ]
    const s = summariseSafety(rows)
    expect(s.totalEvents).toBe(3)
    expect(s.highSeverityCount).toBe(2)
    expect(s.distinctDrivers).toBe(2)
    expect(s.totalPenaltyPoints).toBe(35)
    expect(s.avgPenaltyPerDriver).toBe(17.5)
  })

  it('coerces string penalty values and ignores blank drivers', () => {
    const rows = [
      { driver_name: 'Ali', penalty_points: '1,000' },
      { driver_name: '', penalty_points: 50 },
      { penalty_points: 25 },
    ]
    const s = summariseSafety(rows)
    expect(s.distinctDrivers).toBe(1)
    expect(s.totalPenaltyPoints).toBe(1075)
  })
})

describe('driverSafety — driverScorecard', () => {
  it('aggregates events and penalty points per driver', () => {
    const rows = [
      { driver_name: 'Ali', penalty_points: 10 },
      { driver_name: 'Ali', penalty_points: 5 },
      { driver_name: 'Sara', penalty_points: 3 },
    ]
    const card = driverScorecard(rows)
    const ali = card.find((d) => d.driver_name === 'Ali')
    expect(ali.events).toBe(2)
    expect(ali.penaltyPoints).toBe(15)
    expect(ali.safetyScore).toBe(85)
  })

  it('sorts worst (lowest safety score) first', () => {
    const rows = [
      { driver_name: 'Good', penalty_points: 2 },
      { driver_name: 'Bad', penalty_points: 40 },
      { driver_name: 'Mid', penalty_points: 20 },
    ]
    const card = driverScorecard(rows)
    expect(card.map((d) => d.driver_name)).toEqual(['Bad', 'Mid', 'Good'])
  })

  it('clamps safety score to the [0, 100] range', () => {
    const rows = [
      { driver_name: 'Reckless', penalty_points: 250 },
      { driver_name: 'Spotless', penalty_points: 0 },
    ]
    const card = driverScorecard(rows)
    const reckless = card.find((d) => d.driver_name === 'Reckless')
    const spotless = card.find((d) => d.driver_name === 'Spotless')
    expect(reckless.safetyScore).toBe(0)
    expect(spotless.safetyScore).toBe(100)
  })

  it('ignores rows with a blank/missing driver name', () => {
    const rows = [
      { driver_name: '', penalty_points: 5 },
      { penalty_points: 5 },
      { driver_name: 'Ali', penalty_points: 5 },
    ]
    const card = driverScorecard(rows)
    expect(card).toHaveLength(1)
    expect(card[0].driver_name).toBe('Ali')
  })

  it('returns [] for empty / non-array input', () => {
    expect(driverScorecard([])).toEqual([])
    expect(driverScorecard()).toEqual([])
  })
})

describe('driverSafety — byEventType', () => {
  it('counts by event type sorted by count descending', () => {
    const rows = [
      { event_type: 'speeding' },
      { event_type: 'harsh_brake' },
      { event_type: 'speeding' },
      { event_type: 'speeding' },
      { event_type: 'harsh_brake' },
      { event_type: 'fatigue' },
    ]
    const dist = byEventType(rows)
    expect(dist[0]).toEqual({ type: 'speeding', count: 3 })
    expect(dist[1]).toEqual({ type: 'harsh_brake', count: 2 })
    expect(dist[2]).toEqual({ type: 'fatigue', count: 1 })
  })

  it('ignores rows without an event type and returns [] when empty', () => {
    expect(byEventType([{ event_type: '' }, {}])).toEqual([])
    expect(byEventType([])).toEqual([])
  })
})

describe('driverSafety — toFiniteNumber', () => {
  it('parses numbers, numeric strings, and rejects junk', () => {
    expect(toFiniteNumber(42)).toBe(42)
    expect(toFiniteNumber('1,200')).toBe(1200)
    expect(toFiniteNumber('')).toBeNull()
    expect(toFiniteNumber(null)).toBeNull()
    expect(toFiniteNumber('abc')).toBeNull()
  })
})
