import { describe, it, expect } from 'vitest'
import {
  riskLevel, harshPer100Km, topBehaviours, driverHistory, buildCoachingQueue, filterQueue,
  scoreTrend, latestSession, driverTotals, coachingHeadline, behaviourTrends,
} from '../lib/driverCoachingView'

const rows = [
  { id: 1, driver_name: 'Ali', period: '2026-07', safety_score: 50, fuel_score: 50, harsh_events: 10, distance_km: 1000, idling_min: 40, coaching_status: 'recommended', improvement_pct: 5 },
  { id: 2, driver_name: 'Ali', period: '2026-08', safety_score: 70, fuel_score: 70, harsh_events: 5, distance_km: 1000, idling_min: 20, coaching_status: 'completed', coach: 'SR' },
  { id: 3, driver_name: 'Sara', period: '2026-08', safety_score: 90, fuel_score: 90, harsh_events: 0, distance_km: 500 },
  { id: 4, driver_name: 'Omar', period: '2026-08' },
  { id: 5, driver_name: '', period: '2026-08', safety_score: 10 },
]

describe('driverCoachingView', () => {
  it('maps score to risk, unscored stays unscored', () => {
    expect(riskLevel(null)).toBe('unscored')
    expect(riskLevel(40)).toBe('high')
    expect(riskLevel(70)).toBe('medium')
    expect(riskLevel(85)).toBe('low')
  })
  it('measures harsh events per 100 km only with distance', () => {
    expect(harshPer100Km(rows[0])).toBe(1)
    expect(harshPer100Km({ harsh_events: 3 })).toBeNull()
    expect(topBehaviours(rows[0])).toEqual(['Harsh events (10)', 'Idling (40 min)'])
    expect(topBehaviours(rows[2])).toEqual([])
  })
  it('builds the queue from the latest scorecard, riskiest first, unscored last', () => {
    const q = buildCoachingQueue(rows)
    expect(q.map((e) => e.driver_name)).toEqual(['Ali', 'Sara', 'Omar'])
    expect(q[0].score).toBe(70)
    expect(q[0].scorecards).toBe(2)
    expect(q[2].risk).toBe('unscored')
    expect(filterQueue(q, { risk: 'low' }).map((e) => e.driver_name)).toEqual(['Sara'])
    expect(filterQueue(q, { search: 'sr' }).map((e) => e.driver_name)).toEqual(['Ali'])
  })
  it('history, trend, latest session and totals', () => {
    const h = driverHistory(rows, 'ali')
    expect(h.map((r) => r.id)).toEqual([1, 2])
    expect(scoreTrend(h).map((p) => p.score)).toEqual([50, 70])
    expect(latestSession(h).id).toBe(2)
    expect(driverTotals(h)).toEqual({ distanceKm: 2000, harshEvents: 15, idlingMin: 60, scorecards: 2 })
    expect(driverTotals(driverHistory(rows, 'Omar')).distanceKm).toBeNull()
  })
  it('headline never invents overdue coaching', () => {
    const k = coachingHeadline(rows)
    expect(k.drivers).toBe(3)
    expect(k.coachedDrivers).toBe(1)
    expect(k.highRisk).toBe(0)
    expect(k.openFollowUps).toBe(1)
    expect(k.overdue).toBeNull()
    expect(k.avgImprovementPct).toBe(5)
    expect(coachingHeadline([]).avgImprovementPct).toBeNull()
  })
  it('behaviour trends per period with honest change', () => {
    const t = behaviourTrends(rows)
    expect(t.periods).toEqual(['2026-07', '2026-08'])
    expect(t.harsh.series.map((s) => s.value)).toEqual([1, 0.3])
    expect(t.harsh.change).toBe(-70)
    expect(t.idling.series.map((s) => s.value)).toEqual([40, 20])
    expect(behaviourTrends([{ period: 'x' }]).harsh.change).toBeNull()
  })
})
