import { describe, it, expect } from 'vitest'
import { computeScenarios, DEFAULT_SCENARIOS, SHARED_DEFAULTS } from '../lib/costScenario'
import {
  validateInputs, rankScenarios, withPerVehicle, sensitivity, breakEvenRetreadPct, scenarioExportRows,
} from '../lib/costScenarioAnalytics'

describe('costScenarioAnalytics', () => {
  it('validates meaningless inputs', () => {
    expect(validateInputs(SHARED_DEFAULTS, DEFAULT_SCENARIOS)).toEqual([])
    const w = validateInputs({ fleet_size: 0 }, [{ name: 'A', tyre_life_km: 0, tyre_cost: 10 }, { name: 'a', tyre_life_km: 1, tyre_cost: 10, retread_pct: 50, retread_cost_factor: 1.2 }])
    const msgs = w.map((x) => x.message).join('|')
    expect(w.some((x) => x.level === 'error' && x.scope === 'shared')).toBe(true)
    expect(msgs).toMatch(/Tyre life is zero/)
    expect(msgs).toMatch(/share this name/)
    expect(msgs).toMatch(/saves nothing/)
  })

  it('ranks cheapest first using the single cost model', () => {
    const r = computeScenarios(SHARED_DEFAULTS, DEFAULT_SCENARIOS)
    const ranked = rankScenarios(r)
    expect(ranked[0].rank).toBe(1)
    expect(ranked[0].deltaToBest).toBe(0)
    expect(ranked[0].name).toBe(r.bestName)
    expect(ranked.every((x, i, a) => i === 0 || a[i - 1].annualCost <= x.annualCost)).toBe(true)
    expect(ranked[0].tyreSharePct).toBeGreaterThan(0)
    expect(rankScenarios({ rows: [] })).toEqual([])
    const pv = withPerVehicle(ranked, SHARED_DEFAULTS)
    expect(pv[0].costPerVehicleYear).toBe(Math.round(ranked[0].annualCost / 50))
    expect(withPerVehicle(ranked, { fleet_size: 0 })[0].costPerVehicleYear).toBeNull()
  })

  it('computes a tornado sensitivity', () => {
    const s = sensitivity(SHARED_DEFAULTS, DEFAULT_SCENARIOS[0], { pct: 20 })
    expect(s.base).toBe(computeScenarios(SHARED_DEFAULTS, [DEFAULT_SCENARIOS[0]]).rows[0].annualCost)
    const cost = s.drivers.find((d) => d.key === 'tyre_cost')
    expect(cost.high).toBeGreaterThan(0)
    expect(cost.low).toBeLessThan(0)
    const retread = s.drivers.find((d) => d.key === 'retread_pct')
    expect(retread.swing).toBeNull()
    expect(s.drivers[0].swing).toBeGreaterThanOrEqual(s.drivers[1].swing ?? 0)
  })

  it('finds the break-even retread share', () => {
    const base = DEFAULT_SCENARIOS[0]
    const p = breakEvenRetreadPct(SHARED_DEFAULTS, base, { ...DEFAULT_SCENARIOS[1], retread_cost_factor: 0.45 })
    expect(p === null || (p >= 0 && p <= 100)).toBe(true)
    expect(breakEvenRetreadPct(SHARED_DEFAULTS, base, base)).toBe(0)
    expect(breakEvenRetreadPct(SHARED_DEFAULTS, { ...base, tyre_cost: 1 }, { ...base, tyre_cost: 100000, retread_cost_factor: 0.99 })).toBeNull()
  })

  it('exports flat rows', () => {
    const ranked = rankScenarios(computeScenarios(SHARED_DEFAULTS, DEFAULT_SCENARIOS))
    const rows = scenarioExportRows(ranked, 5)
    expect(rows).toHaveLength(3)
    expect(rows.find((r) => r.role.includes('Baseline')).savings_vs_baseline).toBe('')
  })
})
