import { describe, it, expect } from 'vitest'
import {
  scoreOf, scoreBand, honestLeaderboard, needsCoaching, enrichCoaching, filterCoaching,
  coachingKpis, bandDistribution, periodOptions, coachingExport,
} from '../lib/driverCoachingAnalytics'

const rows = [
  { id: 1, driver_name: 'Ali', period: '2026-08', safety_score: 50, fuel_score: 50, harsh_events: 4, distance_km: 1000, coaching_status: 'completed', improvement_pct: 10 },
  { id: 2, driver_name: 'Ali', period: '2026-09', safety_score: 90, fuel_score: 80, harsh_events: 1, distance_km: 1000 },
  { id: 3, driver_name: 'Sara', period: '2026-09', safety_score: 70, harsh_events: 2, distance_km: null, coaching_status: 'scheduled' },
  { id: 4, driver_name: 'Omar', period: '2026-09', coaching_status: 'recommended' },
]

describe('driverCoachingAnalytics', () => {
  it('treats a scorecard without scores as unscored, not 0', () => {
    expect(scoreOf(rows[3])).toBeNull()
    expect(scoreOf(rows[1])).toBe(86)
    expect(scoreBand(null)).toBe('unscored')
    expect(scoreBand(55)).toBe('poor')
  })

  it('ranks the latest scored scorecard per driver', () => {
    const b = honestLeaderboard(rows)
    expect(b.map((x) => [x.driver_name, x.rank, x.overallScore])).toEqual([['Ali', 1, 86], ['Sara', 2, 70]])
    expect(bandDistribution(b)).toEqual({ good: 1, watch: 1, poor: 0 })
  })

  it('flags coaching needs without inventing scores', () => {
    const n = needsCoaching(rows)
    expect(n.map((r) => r.id)).toEqual([1, 3, 4])
  })

  it('filters, searches and sorts by score with unscored last', () => {
    const e = enrichCoaching(rows)
    expect(filterCoaching(e).map((r) => r.id)).toEqual([2, 3, 1, 4])
    expect(filterCoaching(e, { band: 'unscored' }).map((r) => r.id)).toEqual([4])
    expect(filterCoaching(e, { status: 'completed' }).map((r) => r.id)).toEqual([1])
    expect(e.find((r) => r.id === 1)._rank).toBe(1)
    expect(periodOptions(rows)).toEqual(['2026-09', '2026-08'])
  })

  it('computes KPIs with nulls for unmeasurable figures', () => {
    const k = coachingKpis(rows)
    expect(k).toMatchObject({ records: 4, driversScored: 2, unscored: 1, avgScore: 78, needsCoaching: 3, completionPct: 33.3, avgImprovementPct: 10, harshPer1000Km: 2.5, exposureRecords: 2 })
    const e = coachingKpis([])
    expect(e.avgScore).toBeNull()
    expect(e.completionPct).toBeNull()
    expect(e.harshPer1000Km).toBeNull()
  })

  it('exports N/A for missing values', () => {
    const x = coachingExport(enrichCoaching(rows))
    expect(x.rows[3].overall).toBe('N/A')
    expect(x.rows[3].rank).toBe('N/A')
  })
})
