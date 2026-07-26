import { describe, it, expect } from 'vitest'
import { computeCpkFleet, computeRemovalRate, computeFailureRate } from '../lib/kpiEngine'

/**
 * Core guarantees of the canonical KPI engine.
 *
 * kpiEngine is the single source for CPK / life / failure maths, but its
 * fleet-level entry points had no direct coverage. These lock in two properties
 * the rest of the app depends on:
 *   - a metric that is NOT computable reports null, never a fabricated 0
 *   - a rate's numerator and denominator cover the same population
 */

// A record is "valid" for CPK when it has cost and a real km run.
const usable = (over = {}) => ({
  cost_per_tyre: 1200,
  km_at_fitment: 10000,
  km_at_removal: 70000,   // 60,000 km run -> CPK 0.02
  ...over,
})

// Priced, but no usable km run - the shape a large share of real rows have.
const unusable = (over = {}) => ({
  cost_per_tyre: 1200,
  km_at_fitment: null,
  km_at_removal: null,
  ...over,
})

describe('computeCpkFleet - honest nulls', () => {
  it('reports null, not 0, when nothing is computable', () => {
    const r = computeCpkFleet([unusable(), unusable()])
    expect(r.validCount).toBe(0)
    // 0 would read as "this fleet achieves a perfect CPK of zero".
    expect(r.fleetAvgCpk).toBeNull()
    expect(r.medianCpk).toBeNull()
    expect(r.p10Cpk).toBeNull()
    expect(r.p90Cpk).toBeNull()
  })

  it('reports null on empty input', () => {
    expect(computeCpkFleet([]).fleetAvgCpk).toBeNull()
  })

  it('still computes a real value when records are usable', () => {
    const r = computeCpkFleet([usable()])
    expect(r.validCount).toBe(1)
    expect(r.fleetAvgCpk).toBeCloseTo(0.02, 6)
  })

  it('coverage reflects the usable share', () => {
    const r = computeCpkFleet([usable(), unusable(), unusable(), unusable()])
    expect(r.coveragePct).toBe(25)
    expect(r.fleetAvgCpk).toBeCloseTo(0.02, 6)
  })
})

describe('computeRemovalRate - numerator matches denominator', () => {
  it('counts only records whose km fed the derived distance', () => {
    // 1 usable (60,000 km) + 3 with no km. The derived fleet distance can only
    // come from the usable record, so only that removal may be counted.
    const r = computeRemovalRate([usable(), unusable(), unusable(), unusable()])
    expect(r.estimatedFleetKm).toBe(60000)
    expect(r.totalRemovals).toBe(1)
    expect(r.removalPer1000Km).toBeCloseTo((1 / 60000) * 1000, 9)
  })

  it('does not inflate the rate when most records lack km', () => {
    const withKm = [usable()]
    const mixed = [usable(), ...Array.from({ length: 9 }, () => unusable())]
    // Same measured distance in both cases, so the same rate - adding rows that
    // contribute no distance must not multiply the rate by 10.
    expect(computeRemovalRate(mixed).removalPer1000Km)
      .toBeCloseTo(computeRemovalRate(withKm).removalPer1000Km, 9)
  })

  it('counts every removal when the caller supplies a true fleet total', () => {
    const r = computeRemovalRate([usable(), unusable(), unusable()], 100000)
    expect(r.estimatedFleetKm).toBe(100000)
    expect(r.totalRemovals).toBe(3)
    expect(r.removalPer1000Km).toBeCloseTo(0.03, 9)
  })

  it('returns 0 rather than dividing by zero distance', () => {
    expect(computeRemovalRate([unusable()]).removalPer1000Km).toBe(0)
  })
})

describe('computeFailureRate - Critical counts as a failure', () => {
  it('includes both High and Critical', () => {
    const recs = [
      { risk_level: 'Critical' }, { risk_level: 'High' },
      { risk_level: 'Low' }, { risk_level: 'Medium' },
    ]
    const r = computeFailureRate(recs)
    expect(r.failureCount).toBe(2)
    expect(r.totalCount).toBe(4)
  })
})
