import { describe, it, expect } from 'vitest'
import {
  riskLevel, harshPer100Km, topBehaviours, driverHistory, buildCoachingQueue, filterQueue,
  scoreTrend, latestSession, driverTotals, coachingHeadline, behaviourTrends,
  phasedTrend, coachOptions, workWeek, weekLabel,
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

  it('splits score points before and after the first completed coaching', () => {
    const pts = phasedTrend([{ status: 'recommended' }, { status: 'completed' }, { status: 'none' }])
    expect(pts.map((p) => p.phase)).toEqual(['before', 'after', 'after'])
    expect(phasedTrend([{ status: 'none' }])[0].phase).toBe('before')
  })

  it('lists coaches and builds a Monday to Friday week', () => {
    expect(coachOptions(buildCoachingQueue(rows))).toEqual(['SR'])
    const wk = workWeek(new Date(2026, 9, 7, 10), 0) // Wed 7 Oct 2026
    expect(wk.map((d) => d.iso)).toEqual(['2026-10-05', '2026-10-06', '2026-10-07', '2026-10-08', '2026-10-09'])
    expect(wk.filter((d) => d.isToday).map((d) => d.iso)).toEqual(['2026-10-07'])
    expect(workWeek(new Date(2026, 9, 7), 1)[0].iso).toBe('2026-10-12')
    expect(weekLabel(wk)).toBe('5 to 9 Oct 2026')
  })
})

describe('driverCoachingView export scopes', () => {
  it('offers shown rows and the selected driver history with counts', async () => {
    const { exportScopes } = await import('../lib/driverCoachingView')
    const sc = exportScopes({ shown: [1, 2, 3], history: [1], driverName: 'Ali Khan' })
    expect(sc.map((s) => s.label)).toEqual(['Shown scorecards (3)', 'Ali Khan history (1)'])
    expect(sc.every((s) => !s.disabled)).toBe(true)
    const none = exportScopes({ shown: [], history: [] })
    expect(none[0].disabled).toBe(true)
    expect(none[1]).toMatchObject({ label: 'Selected driver history', disabled: true })
  })
})
