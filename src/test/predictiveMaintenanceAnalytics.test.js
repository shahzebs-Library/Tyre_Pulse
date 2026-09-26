import { describe, it, expect } from 'vitest'
import {
  horizonDays, forecastBase, filterPredictions, filterRisk, forecastKpis,
  buildMonthlyBudget, quarterlyForecast, buildSiteBreakdown, urgentVehicles,
  riskKpis, cohortRows, monthlyFleetBudget, mean, matchesSearch, recommendedAction,
} from '../lib/predictiveMaintenanceAnalytics'

const NOW = new Date(2026, 0, 15)
const due = (days) => new Date(NOW.getTime() + days * 86_400_000)

const P = [
  { id: 1, asset_no: 'TM1', site: 'NHC', vehicle_type: 'TR-MIXER', brand: 'Triangle', urgency: 'Urgent', days_away: 10, due_date: due(10), estimated_cost: 1000 },
  { id: 2, asset_no: 'TM1', site: 'NHC', vehicle_type: 'TR-MIXER', brand: 'Triangle', urgency: 'Soon', days_away: 60, due_date: due(60), estimated_cost: 900 },
  { id: 3, asset_no: 'PU2', site: 'JED', vehicle_type: 'PUMPS', brand: 'Pirelli', urgency: 'Monitor', days_away: 200, due_date: due(200), estimated_cost: 1100 },
  { id: 4, asset_no: 'PU3', site: 'JED', vehicle_type: 'PUMPS', brand: 'Pirelli', urgency: 'Monitor', days_away: 500, due_date: due(500), estimated_cost: 800 },
]

describe('predictiveMaintenanceAnalytics', () => {
  it('maps horizon keys and falls back to a year', () => {
    expect(horizonDays('30d')).toBe(30)
    expect(horizonDays('6mo')).toBe(180)
    expect(horizonDays('nope')).toBe(365)
  })

  it('forecast base applies population filters and search, not time filters', () => {
    expect(forecastBase(P, { site: 'JED' })).toHaveLength(2)
    expect(forecastBase(P, { vehicleType: 'TR-MIXER' })).toHaveLength(2)
    expect(forecastBase(P, { search: 'pirelli' }).map((p) => p.id)).toEqual([3, 4])
    expect(forecastBase(P)).toHaveLength(4)
  })

  it('table filter adds urgency and horizon', () => {
    expect(filterPredictions(P, { horizon: '90d' }).map((p) => p.id)).toEqual([1, 2])
    expect(filterPredictions(P, { urgency: 'Monitor', horizon: '12mo' }).map((p) => p.id)).toEqual([3])
  })

  it('forecast KPIs bucket counts and costs, excluding beyond 12 months', () => {
    const k = forecastKpis(P)
    expect(k).toMatchObject({ urgentCount: 1, soonCount: 1, monitorCount: 1, yearCount: 3, urgentCost: 1000, annualCost: 3000 })
  })

  it('monthly budget uses the injected clock and quarterly sums the buckets', () => {
    const m = buildMonthlyBudget(P, NOW)
    expect(m).toHaveLength(12)
    expect(m[0].cost).toBe(1000)
    expect(m.reduce((s, b) => s + b.count, 0)).toBe(3)
    const q = quarterlyForecast(m)
    expect(q.q1).toBe(1900)
    expect(q.total).toBe(3000)
  })

  it('site breakdown shares are null when the total is zero', () => {
    const rows = buildSiteBreakdown(P)
    expect(rows[0]).toMatchObject({ site: 'NHC', due30: 1, due90: 2, due12mo: 2, cost: 1900 })
    expect(rows[0].pctBudget).toBeCloseTo(63.3, 1)
    const zero = buildSiteBreakdown([{ site: 'X', days_away: 5, estimated_cost: 0 }])
    expect(zero[0].pctBudget).toBeNull()
  })

  it('ranks urgent vehicles and recommends an action', () => {
    const v = urgentVehicles(P)
    expect(v[0]).toMatchObject({ asset_no: 'TM1', urgent_count: 1, soon_count: 1, rank: 1 })
    expect(v.map((x) => x.asset_no)).not.toContain('PU3')
    expect(recommendedAction(3)).toMatch(/full set/)
    expect(recommendedAction(0)).toMatch(/90 days/)
  })

  it('risk KPIs are null over no rows, never zero', () => {
    const empty = riskKpis([])
    expect(empty.total).toBe(0)
    expect(empty.avgFailureProbPct).toBeNull()
    expect(empty.avgRiskScore).toBeNull()
    const k = riskKpis([
      { risk_band: 'extreme', failure_prob_pct: 80, risk_score: 75 },
      { risk_band: 'low', failure_prob_pct: 10, risk_score: 20 },
      { risk_band: null, failure_prob_pct: null, risk_score: null },
    ])
    expect(k).toMatchObject({ total: 3, extreme: 1, low: 1, unknown: 1 })
    expect(k.avgFailureProbPct).toBe(45)
  })

  it('filters risk rows by site, band and search', () => {
    const rows = [
      { site: 'NHC', risk_band: 'high', asset_no: 'A1', brand: 'X' },
      { site: 'JED', risk_band: 'low', asset_no: 'B2', brand: 'Y' },
    ]
    expect(filterRisk(rows, { site: 'NHC' })).toHaveLength(1)
    expect(filterRisk(rows, { band: 'low' })).toHaveLength(1)
    expect(filterRisk(rows, { search: 'b2' })).toHaveLength(1)
  })

  it('flattens cohort models and sums fleet budgets honestly', () => {
    const models = new Map([['a', { brand: 'A', size: 'S', n: 5, eta: 90000.4, beta: 2.21234, mean: 80000.2, cv: 0.456, ciSpread: 13.41 }],
      ['b', { brand: 'B', size: 'S', n: 9, eta: 1, beta: 1, mean: 1, cv: 1, ciSpread: 1 }]])
    const rows = cohortRows(models)
    expect(rows[0].brand).toBe('B')
    expect(rows[1]).toMatchObject({ etaKm: 90000, beta: 2.212, cv: 0.46, ciSpread: 13.4 })
    expect(monthlyFleetBudget([])).toBeNull()
    expect(monthlyFleetBudget([{ monthly_tyre_budget: 0 }, { monthly_tyre_budget: 500 }])).toBe(500)
  })

  it('helpers behave', () => {
    expect(mean([])).toBeNull()
    expect(mean([2, 4])).toBe(3)
    expect(matchesSearch({ a: 'Hello' }, 'ell', ['a'])).toBe(true)
    expect(matchesSearch({ a: 'Hello' }, '', ['a'])).toBe(true)
  })
})
