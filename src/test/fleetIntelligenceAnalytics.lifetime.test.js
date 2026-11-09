import { describe, it, expect } from 'vitest'
import { buildVehicleMetrics, fleetAggregates } from '../lib/fleetIntelligenceAnalytics'
import { CPK_KIND } from '../lib/tyreLifetime'
import { threeVehicles, sameVehicleRefit, SER_CPK, REFIT_CPK } from './lifetimeFixture.groupD'

const NOW = new Date('2025-12-01T00:00:00Z')

describe('fleetIntelligenceAnalytics on physical tyres', () => {
  it('a tyre fitted on 3 vehicles is one tyre on its latest vehicle, price once, km summed', () => {
    const m = Object.fromEntries(buildVehicleMetrics(threeVehicles(), {}, { now: NOW }).map((v) => [v.asset_no, v]))
    expect(m.V3.avg_cpk).toBeCloseTo(SER_CPK, 10)
    expect(m.V3.measured_km).toBe(60000)
    expect(m.V3.physical_tyres).toBe(1)
    expect(m.V2.avg_cpk).toBeNull() // the tyre left V2; its life is not charged twice
    expect(m.V3.cpk_kind).toBe(CPK_KIND.TYRE_LIFETIME)
    const a = fleetAggregates(Object.values(m), threeVehicles())
    expect(a.fleetAvgCpk).toBeCloseTo(3000 / 100000, 10)
    expect(a.cpk_kind).toBe(CPK_KIND.FLEET_AGGREGATE)
  })

  it('a refit on the same vehicle is not a second purchase', () => {
    const [v] = buildVehicleMetrics(sameVehicleRefit(), {}, { now: NOW })
    expect(v.total_tyre_cost).toBe(1000)
    expect(v.avg_cpk).toBeCloseTo(REFIT_CPK, 10)
  })

  it('tyre changes stay per fitment row (event)', () => {
    const [v] = buildVehicleMetrics(sameVehicleRefit(), {}, { now: NOW })
    expect(v.total_tyre_changes).toBe(2)
    expect(v.downtime_hours).toBe(4)
  })
})
