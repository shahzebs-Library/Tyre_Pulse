import { describe, it, expect } from 'vitest'
import { fleetMeanNetCpk, costOutlierAnomalies, buildFinancials, buildExceptions } from '../lib/opsIntelligence'
import { threeVehicles, sameVehicleRefit, REFIT_CPK } from './lifetimeFixture.groupD'

const NOW = new Date('2025-12-01T00:00:00Z')

describe('opsIntelligence on physical tyres', () => {
  it('a tyre fitted on 3 vehicles is one tyre, price once, km summed', () => {
    expect(fleetMeanNetCpk(threeVehicles())).toBeCloseTo(3000 / 100000, 10)
  })
  it('a refit on the same vehicle is not a second purchase', () => {
    expect(fleetMeanNetCpk(sameVehicleRefit())).toBeCloseTo(REFIT_CPK, 10)
    const f = buildFinancials({ budgets: [], tyres: sameVehicleRefit() }, { now: NOW })
    expect(f.ytdTyreSpend).toBe(1000)
    expect(f.avgCpk).toBeCloseTo(REFIT_CPK, 4)
  })
  it('a multi-row tyre is checked once for cost outliers', () => {
    const rows = [...threeVehicles(), ...Array.from({ length: 3 }, (_, i) => ({ id: `c${i}`, serial_no: `CHEAP00${i}0`, country: 'KSA', cost_per_tyre: 100, km_at_fitment: 0, km_at_removal: 100000 }))]
    const out = costOutlierAnomalies(rows)
    expect(new Set(out.map((o) => o.serial)).size).toBe(out.length)
  })
  it('recent failures stay per removed fitment row (events)', () => {
    const rows = sameVehicleRefit().map((r) => ({ ...r, removal_reason: 'Puncture' }))
    const ex = buildExceptions({ tyres: rows, workOrders: [] }, { now: NOW })
    expect(ex.filter((e) => e.category === 'recent_failure')).toHaveLength(2)
  })
})
