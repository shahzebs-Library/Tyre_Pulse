import { describe, it, expect } from 'vitest'
import {
  toFiniteNumber, overallScore, leaderboard, coachingNeeded, summariseCoaching,
} from '../lib/driverCoaching'

describe('driverCoaching — toFiniteNumber', () => {
  it('returns null for empty / nullish input', () => {
    expect(toFiniteNumber('')).toBeNull()
    expect(toFiniteNumber(null)).toBeNull()
    expect(toFiniteNumber(undefined)).toBeNull()
  })

  it('parses numbers and numeric strings, stripping units', () => {
    expect(toFiniteNumber(82)).toBe(82)
    expect(toFiniteNumber('76.5')).toBe(76.5)
    expect(toFiniteNumber('4,200 km')).toBe(4200)
  })

  it('returns null for non-numeric strings', () => {
    expect(toFiniteNumber('abc')).toBeNull()
  })
})

describe('driverCoaching — overallScore', () => {
  it('weights safety 0.6 and fuel 0.4', () => {
    // 80*0.6 + 60*0.4 = 48 + 24 = 72
    expect(overallScore({ safety_score: 80, fuel_score: 60 })).toBe(72)
  })

  it('uses the single present component at full weight', () => {
    expect(overallScore({ safety_score: 90 })).toBe(90)
    expect(overallScore({ fuel_score: 55 })).toBe(55)
  })

  it('returns 0 when neither score is present', () => {
    expect(overallScore({})).toBe(0)
    expect(overallScore({ safety_score: '', fuel_score: null })).toBe(0)
  })

  it('clamps the blended result to [0, 100]', () => {
    expect(overallScore({ safety_score: 200, fuel_score: 200 })).toBe(100)
    expect(overallScore({ safety_score: -50, fuel_score: -50 })).toBe(0)
  })

  it('rounds to one decimal place', () => {
    // 83*0.6 + 76*0.4 = 49.8 + 30.4 = 80.2
    expect(overallScore({ safety_score: 83, fuel_score: 76 })).toBe(80.2)
  })

  it('coerces numeric strings', () => {
    expect(overallScore({ safety_score: '80', fuel_score: '60' })).toBe(72)
  })
})

describe('driverCoaching — leaderboard', () => {
  it('returns [] for empty / non-array input', () => {
    expect(leaderboard([])).toEqual([])
    expect(leaderboard()).toEqual([])
    expect(leaderboard(null)).toEqual([])
  })

  it('sorts by overallScore desc and assigns 1-based rank', () => {
    const rows = [
      { driver_name: 'Low', safety_score: 40, fuel_score: 40 },
      { driver_name: 'High', safety_score: 95, fuel_score: 90 },
      { driver_name: 'Mid', safety_score: 70, fuel_score: 70 },
    ]
    const board = leaderboard(rows)
    expect(board.map((b) => b.driver_name)).toEqual(['High', 'Mid', 'Low'])
    expect(board.map((b) => b.rank)).toEqual([1, 2, 3])
  })

  it('breaks score ties on higher distance, then name', () => {
    const rows = [
      { driver_name: 'B', safety_score: 70, fuel_score: 70, distance_km: 100 },
      { driver_name: 'A', safety_score: 70, fuel_score: 70, distance_km: 100 },
      { driver_name: 'C', safety_score: 70, fuel_score: 70, distance_km: 500 },
    ]
    const board = leaderboard(rows)
    // C wins on distance; A before B alphabetically at equal distance
    expect(board.map((b) => b.driver_name)).toEqual(['C', 'A', 'B'])
    expect(board[0].rank).toBe(1)
  })

  it('ignores rows with a blank/missing driver name and defaults metrics to 0', () => {
    const rows = [
      { driver_name: '', safety_score: 90 },
      { safety_score: 90 },
      { driver_name: 'Solo', safety_score: 50, fuel_score: 50 },
    ]
    const board = leaderboard(rows)
    expect(board).toHaveLength(1)
    expect(board[0]).toMatchObject({ driver_name: 'Solo', harsh_events: 0, distance_km: 0, rank: 1 })
  })
})

describe('driverCoaching — coachingNeeded', () => {
  it('flags drivers scoring below 60', () => {
    const rows = [
      { id: 1, driver_name: 'Weak', safety_score: 40, fuel_score: 40 }, // 40
      { id: 2, driver_name: 'Strong', safety_score: 90, fuel_score: 90 }, // 90
    ]
    const need = coachingNeeded(rows)
    expect(need.map((r) => r.driver_name)).toEqual(['Weak'])
  })

  it('flags recommended/scheduled status even with a high score', () => {
    const rows = [
      { id: 1, driver_name: 'HighButRecommended', safety_score: 95, fuel_score: 95, coaching_status: 'recommended' },
      { id: 2, driver_name: 'HighScheduled', safety_score: 95, fuel_score: 95, coaching_status: 'scheduled' },
      { id: 3, driver_name: 'HighCompleted', safety_score: 95, fuel_score: 95, coaching_status: 'completed' },
    ]
    const names = coachingNeeded(rows).map((r) => r.driver_name)
    expect(names).toContain('HighButRecommended')
    expect(names).toContain('HighScheduled')
    expect(names).not.toContain('HighCompleted')
  })

  it('returns worst-first with an overallScore attached', () => {
    const rows = [
      { id: 1, driver_name: 'A', safety_score: 55, fuel_score: 55 }, // 55
      { id: 2, driver_name: 'B', safety_score: 30, fuel_score: 30 }, // 30
    ]
    const need = coachingNeeded(rows)
    expect(need.map((r) => r.driver_name)).toEqual(['B', 'A'])
    expect(need[0].overallScore).toBe(30)
  })

  it('returns [] for empty input', () => {
    expect(coachingNeeded([])).toEqual([])
    expect(coachingNeeded()).toEqual([])
  })
})

describe('driverCoaching — summariseCoaching', () => {
  it('returns zeroed summary with null extremes for no drivers', () => {
    expect(summariseCoaching([])).toEqual({
      totalDrivers: 0, avgScore: 0, needsCoachingCount: 0,
      coachedCount: 0, topScore: null, bottomScore: null,
    })
  })

  it('computes totals, average, extremes, and coaching counts', () => {
    const rows = [
      { id: 1, driver_name: 'Top', safety_score: 90, fuel_score: 90 }, // 90
      { id: 2, driver_name: 'Mid', safety_score: 70, fuel_score: 70 }, // 70
      { id: 3, driver_name: 'Low', safety_score: 40, fuel_score: 40, coaching_status: 'completed' }, // 40
    ]
    const s = summariseCoaching(rows)
    expect(s.totalDrivers).toBe(3)
    expect(s.topScore).toBe(90)
    expect(s.bottomScore).toBe(40)
    expect(s.avgScore).toBe(66.7) // (90+70+40)/3 = 66.666..
    expect(s.needsCoachingCount).toBe(1) // only 'Low' below 60
    expect(s.coachedCount).toBe(1) // one completed
  })

  it('counts distinct flagged drivers for needsCoachingCount', () => {
    const rows = [
      { id: 1, driver_name: 'Dup', safety_score: 30, fuel_score: 30 },
      { id: 2, driver_name: 'Dup', safety_score: 30, fuel_score: 30, coaching_status: 'recommended' },
    ]
    const s = summariseCoaching(rows)
    expect(s.needsCoachingCount).toBe(1)
  })
})
