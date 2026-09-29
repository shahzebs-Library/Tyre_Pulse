import { describe, it, expect } from 'vitest'
import {
  riskLevel, dominantFactor, buildAssetRisk, riskDistribution, overviewKpis,
  serviceTypeFor, maintenanceForecast, dueSoon, removalTrend, failureTypes,
  buildRecommendations, filterRecommendations,
} from '../lib/predictiveOverview'
import { LIMITING_FACTORS } from '../lib/predictiveMaintenance'

const NOW = new Date(2026, 8, 15, 10)
const due = (d) => new Date(NOW.getTime() + d * 86_400_000)

const RISK = [
  { id: 1, asset_no: 'TM1', site: 'NHC', position: 'LHF1', risk_score: 82, factors: { tread: 25, mileage: 30, age: 0, pressure: 0 } },
  { id: 2, asset_no: 'TM1', site: 'NHC', position: 'RHF1', risk_score: 40, factors: { tread: 10, mileage: 20, age: 0, pressure: 0 } },
  { id: 3, asset_no: 'PU2', site: 'JED', position: 'LHRO', risk_score: 55, factors: { tread: 0, mileage: 10, age: 0, pressure: 12 } },
  { id: 4, asset_no: 'WL3', site: 'JED', position: 'RHRO', risk_score: 10, factors: { tread: 0, mileage: 0, age: 0, pressure: 0 } },
]
const PRED = [
  { id: 1, asset_no: 'TM1', site: 'NHC', position: 'LHF1', days_away: 5, due_date: due(5), estimated_cost: 1000, confidence: 0.5, limiting_factor: LIMITING_FACTORS.tread, tread_depth: 3.5 },
  { id: 2, asset_no: 'TM1', site: 'NHC', position: 'RHF1', days_away: 40, due_date: due(40), estimated_cost: 900, confidence: 0.5, limiting_factor: LIMITING_FACTORS.km, tread_depth: 8 },
  { id: 3, asset_no: 'PU2', site: 'JED', position: 'LHRO', days_away: 200, due_date: due(200), estimated_cost: 700, confidence: 1, limiting_factor: LIMITING_FACTORS.age, tread_depth: 9 },
  { id: 4, asset_no: 'WL3', site: 'JED', position: 'RHRO', days_away: 400, due_date: due(400), estimated_cost: 600, confidence: 0, limiting_factor: null, tread_depth: null },
]
const FLEET = [{ asset_no: 'TM1', make: 'Volvo', model: 'FH16', site: 'NHC' }]

describe('predictiveOverview', () => {
  it('maps composite scores to the engine thresholds', () => {
    expect(riskLevel(70)).toBe('high')
    expect(riskLevel(69.9)).toBe('medium')
    expect(riskLevel(30)).toBe('low')
    expect(riskLevel(0)).toBe('healthy')
    expect(riskLevel(null)).toBeNull()
  })

  it('names the largest risk factor, null when nothing contributes', () => {
    expect(dominantFactor({ tread: 25, mileage: 30 })).toBe('mileage')
    expect(dominantFactor({ tread: 0, mileage: 0 })).toBeNull()
  })

  it('rolls tyres up to one row per asset led by the worst tyre', () => {
    const a = buildAssetRisk(RISK, PRED, FLEET)
    expect(a.map((x) => x.asset_no)).toEqual(['TM1', 'PU2', 'WL3'])
    expect(a[0]).toMatchObject({ score: 82, level: 'high', make: 'Volvo', tyres: 2, minDays: 5, issue: 'Mileage wear-out' })
    expect(a[2].issue).toBeNull()
    expect(riskDistribution(a).map((d) => d.count)).toEqual([1, 1, 0, 1])
  })

  it('computes headline figures and refuses a blended currency total', () => {
    const assets = buildAssetRisk(RISK, PRED, FLEET)
    const pm = [
      { id: 'a', status: 'active', next_due: due(10).toISOString() },
      { id: 'b', status: 'active', next_due: due(-3).toISOString() },
      { id: 'c', status: 'paused', next_due: due(2).toISOString() },
      { id: 'd', status: 'active', next_due: due(60).toISOString() },
    ]
    const k = overviewKpis({ assets, predictions: PRED, pmPrograms: pm, now: NOW })
    expect(k).toMatchObject({ assetsMonitored: 3, highRisk: 1, predictedFailures: 1, dueForService: 2, cost30: 1000 })
    expect(overviewKpis({ assets, predictions: PRED, now: NOW, currencySafe: false }).cost30).toBeNull()
  })

  it('classifies plans by their own name', () => {
    expect(serviceTypeFor({ name: 'Monthly tyre rotation' })).toBe('rotation')
    expect(serviceTypeFor({ name: 'Quarterly brake check' })).toBe('inspection')
    expect(serviceTypeFor({ name: '500-hour service' })).toBe('general')
  })

  it('buckets demand by month and drops empty series', () => {
    const f = maintenanceForecast({
      predictions: PRED,
      pmPrograms: [{ id: 'x', status: 'active', name: 'Annual inspection', next_due: due(-20).toISOString() }],
      now: NOW, months: 6,
    })
    expect(f.labels).toHaveLength(6)
    expect(f.series.map((s) => s.key)).toEqual(['tyre', 'inspection'])
    expect(f.series[0].values[0]).toBe(1)
    expect(f.series[1].values[0]).toBe(1) // overdue plan lands in the current month
    expect(f.series[0].values.reduce((a, b) => a + b, 0)).toBe(2) // 200 and 400 days are outside
  })

  it('lists due-soon plans and the earliest tyre per asset', () => {
    const rows = dueSoon({
      predictions: PRED,
      pmPrograms: [{ id: 'p', status: 'active', name: 'Tyre inspection', asset_no: 'PU2', next_due: due(3).toISOString(), priority: 'critical' }],
      now: NOW,
    })
    expect(rows.map((r) => r.key)).toEqual(['pm-p', 'tyre-TM1'])
    expect(rows[0].priority).toBe('high')
    expect(rows[1]).toMatchObject({ days: 5, priority: 'high', service: 'Tyre replacement' })
  })

  it('counts removals per month and early removals only when life is known', () => {
    const recs = [
      { removal_date: '2026-09-02', km_at_fitment: 0, km_at_removal: 40000 },
      { removal_date: '2026-08-02', km_at_fitment: 0, km_at_removal: 90000 },
      { removal_date: '2025-01-02', km_at_fitment: 0, km_at_removal: 10 },
    ]
    const t = removalTrend(recs, NOW, 6, 80000)
    expect(t.all).toEqual([0, 0, 0, 0, 1, 1])
    expect(t.early).toEqual([0, 0, 0, 0, 0, 1])
    expect(removalTrend([{ removal_date: '2026-09-02' }], NOW, 6, 80000).early).toBeNull()
  })

  it('groups predicted replacements by limiting factor inside the horizon', () => {
    expect(failureTypes(PRED, 180)).toEqual([
      { label: 'Tread wear', count: 1 },
      { label: 'End of km life', count: 1 },
    ])
  })

  it('builds replace and inspect recommendations with real cost only', () => {
    const assets = buildAssetRisk(RISK, PRED, FLEET)
    const recs = buildRecommendations({ assets, predictions: PRED, openJobs: new Set(['TM1']) })
    expect(recs.map((r) => [r.asset_no, r.type])).toEqual([['TM1', 'replace'], ['PU2', 'inspect']])
    expect(recs[0]).toMatchObject({ cost: 1900, targetDays: 5, status: 'job_open' })
    expect(recs[1]).toMatchObject({ cost: null, status: 'no_job' })
    expect(buildRecommendations({ assets, predictions: PRED, currencySafe: false })[0].cost).toBeNull()
    expect(filterRecommendations(recs, { type: 'inspect' })).toHaveLength(1)
    expect(filterRecommendations(recs, { site: 'NHC', level: 'high' })).toHaveLength(1)
  })
})
