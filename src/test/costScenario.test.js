import { describe, it, expect } from 'vitest'
import {
  computeScenarios,
  DEFAULT_SCENARIOS,
  SHARED_DEFAULTS,
  blankScenario,
} from '../lib/costScenario'

describe('computeScenarios', () => {
  it('produces a coherent row per scenario', () => {
    const r = computeScenarios(SHARED_DEFAULTS, DEFAULT_SCENARIOS)
    expect(r.rows).toHaveLength(DEFAULT_SCENARIOS.length)
    for (const row of r.rows) {
      expect(row.annualCost).toBeGreaterThan(0)
      // annualCost = tyre cost + maintenance
      expect(Math.abs(row.annualCost - (row.annualTyreCost + row.annualMaintenance)))
        .toBeLessThanOrEqual(1)
      // CPK positive and consistent with annual cost / fleet km
      const fleetKm = SHARED_DEFAULTS.fleet_size * SHARED_DEFAULTS.annual_km_per_vehicle
      expect(row.cpk).toBeGreaterThan(0)
      expect(Math.abs(row.cpk - row.annualCost / fleetKm)).toBeLessThan(0.01)
      expect(row.tyresPerYear).toBeGreaterThan(0)
    }
  })

  it('projects one cumulative point per horizon year, strictly increasing', () => {
    const r = computeScenarios({ ...SHARED_DEFAULTS, horizon_years: 5 }, DEFAULT_SCENARIOS)
    const cum = r.rows[0].cumulative
    expect(cum).toHaveLength(5)
    expect(cum[0].year).toBe('Year 1')
    expect(cum[4].value).toBeGreaterThan(cum[0].value)
    // final cumulative ≈ annualCost × horizon
    expect(Math.abs(cum[4].value - r.rows[0].annualCost * 5)).toBeLessThanOrEqual(5)
    expect(r.horizonYears).toBe(5)
  })

  it('names a baseline (first scenario) and the lowest-cost best scenario', () => {
    const r = computeScenarios(SHARED_DEFAULTS, DEFAULT_SCENARIOS)
    expect(r.baselineName).toBe(DEFAULT_SCENARIOS[0].name)
    const minCost = Math.min(...r.rows.map((x) => x.annualCost))
    const best = r.rows.find((x) => x.name === r.bestName)
    expect(best.annualCost).toBe(minCost)
    expect(best.isBest).toBe(true)
    expect(r.rows[0].isBaseline).toBe(true)
  })

  it('retread lowers effective tyre cost and annual spend', () => {
    const shared = SHARED_DEFAULTS
    const base = {
      name: 'New only',
      tyre_cost: 1600,
      tyre_life_km: 105000,
      retread_pct: 0,
      retread_cost_factor: 0.45,
      maintenance_per_tyre_year: 50,
    }
    const withRetread = { ...base, name: 'Retread', retread_pct: 60 }
    const r = computeScenarios(shared, [base, withRetread])
    const [noRetread, retread] = r.rows
    expect(retread.effectiveCostPerTyre).toBeLessThan(noRetread.effectiveCostPerTyre)
    expect(retread.annualTyreCost).toBeLessThan(noRetread.annualTyreCost)
    expect(retread.annualCost).toBeLessThan(noRetread.annualCost)
  })

  it('computes savingsVsBaseline as best-vs-baseline over the horizon', () => {
    const baseline = {
      name: 'Baseline',
      tyre_cost: 2000,
      tyre_life_km: 80000,
      retread_pct: 0,
      retread_cost_factor: 0.45,
      maintenance_per_tyre_year: 50,
    }
    const cheaper = { ...baseline, name: 'Cheaper', tyre_cost: 1200 }
    const shared = { ...SHARED_DEFAULTS, horizon_years: 4 }
    const r = computeScenarios(shared, [baseline, cheaper])
    expect(r.baselineName).toBe('Baseline')
    expect(r.bestName).toBe('Cheaper')
    const best = r.rows.find((x) => x.name === 'Cheaper')
    const base = r.rows.find((x) => x.name === 'Baseline')
    // top-level savings = baseline horizon cost − best horizon cost
    expect(r.savingsVsBaseline).toBe(base.horizonCost - best.horizonCost)
    expect(r.savingsVsBaseline).toBeGreaterThan(0)
    expect(r.savingsVsBaselinePct).toBeGreaterThan(0)
    // baseline compared to itself yields zero savings
    expect(base.savingsVsBaselineAnnual).toBe(0)
    expect(best.savingsVsBaselineAnnual).toBeGreaterThan(0)
  })

  it('is null-safe on empty / garbage input', () => {
    const r = computeScenarios(
      { fleet_size: '', annual_km_per_vehicle: 'x', horizon_years: null },
      [{ name: '', tyre_cost: 'abc', tyre_life_km: 0, retread_pct: 999, retread_cost_factor: null }],
    )
    const row = r.rows[0]
    expect(Number.isFinite(row.annualCost)).toBe(true)
    expect(Number.isFinite(row.cpk)).toBe(true)
    expect(Array.isArray(row.cumulative)).toBe(true)
    // retread_pct clamped to 0..100
    expect(row.retreadPct).toBeLessThanOrEqual(100)
    expect(row.name).toBe('Scenario')
  })

  it('handles an empty scenario list', () => {
    const r = computeScenarios(SHARED_DEFAULTS, [])
    expect(r.rows).toEqual([])
    expect(r.baselineName).toBeNull()
    expect(r.bestName).toBeNull()
    expect(r.savingsVsBaseline).toBe(0)
  })

  it('falls back to defaults when called with no arguments', () => {
    const r = computeScenarios()
    expect(r.rows).toEqual([])
    expect(r.horizonYears).toBe(SHARED_DEFAULTS.horizon_years)
  })

  it('blankScenario yields a computable scenario', () => {
    const r = computeScenarios(SHARED_DEFAULTS, [blankScenario('Test')])
    expect(r.rows[0].name).toBe('Test')
    expect(r.rows[0].annualCost).toBeGreaterThan(0)
  })
})
