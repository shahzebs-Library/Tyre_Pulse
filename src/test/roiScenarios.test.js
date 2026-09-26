import { describe, it, expect } from 'vitest'
import { seedFromFleetCpk, windowDays, parseScenarios, upsertScenario, removeScenario, compareScenarios, mixedCurrency, loadScenarios, persistScenarios } from '../lib/roiScenarios'

const cpk = {
  fleet: [{ country: 'KSA', currency: 'SAR', km: { total_km: 900000, cpk_tyre: 0.0123456, coverage_pct: 80 } }],
  perVehicle: [{ unit: 'km', distance_or_hours: 1000 }, { unit: 'km', distance_or_hours: 0 }, { unit: 'engine_hours', distance_or_hours: 50 }, { unit: 'km', distance_or_hours: 5 }],
}
describe('roiScenarios', () => {
  it('refuses the all-country view', () => {
    expect(seedFromFleetCpk(cpk, { country: 'All' }).ok).toBe(false)
  })
  it('seeds only measured inputs', () => {
    const s = seedFromFleetCpk(cpk, { country: 'KSA', from: '2026-01-01', to: '2026-01-10' })
    expect(s.ok).toBe(true)
    expect(s.inputs).toEqual({ current_cpkm: 0.0123, fleet_size: 2, daily_km_per_vehicle: 45000 })
    expect(s.currency).toBe('SAR')
    expect(s.inputs.avg_tyre_cost).toBeUndefined()
    expect(seedFromFleetCpk({ fleet: [] }, { country: 'UAE' }).ok).toBe(false)
    expect(windowDays('2026-01-10', '2026-01-01')).toBeNull()
  })
  it('stores, replaces and compares scenarios safely', () => {
    let list = upsertScenario([], { name: 'Base', inputs: { fleet_size: 10 }, currency: 'SAR' }, new Date(1))
    list = upsertScenario(list, { name: 'base', inputs: { fleet_size: 20 }, currency: 'AED' }, new Date(2))
    expect(list).toHaveLength(1)
    list = upsertScenario(list, { name: 'Other', inputs: {}, currency: 'SAR' }, new Date(3))
    expect(() => upsertScenario(list, { name: ' ' })).toThrow()
    const parsed = parseScenarios(JSON.stringify(list))
    expect(parsed[1].inputs.fleet_size).toBe(20)
    expect(parseScenarios('{bad')).toEqual([])
    const cmp = compareScenarios(parsed)
    expect(mixedCurrency(cmp)).toBe(true)
    expect(removeScenario(parsed, parsed[0].id)).toHaveLength(1)
    const store = { v: null, getItem() { return this.v }, setItem(k, v) { this.v = v } }
    expect(persistScenarios(parsed, store)).toBe(true)
    expect(loadScenarios(store)).toHaveLength(2)
    expect(persistScenarios(parsed, { setItem() { throw new Error('blocked') } })).toBe(false)
    expect(loadScenarios({ getItem() { throw new Error('blocked') } })).toEqual([])
  })
})
