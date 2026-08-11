import { describe, it, expect } from 'vitest'
import { computeCpkFleet, computeRemovalRate, computeFailureRate, computeCostTrend, computePressureCompliance } from '../lib/kpiEngine'

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

  // risk_level is populated on 0 of 11,132 live tyres, so dividing by every
  // record produced 0/total = 0% and rendered a perfect fleet from no data.
  it('reports null - not 0% - when nothing carries a risk_level', () => {
    const r = computeFailureRate([{ asset_no: 'A' }, { asset_no: 'B' }, { risk_level: '  ' }])
    expect(r.failureRate).toBe(null)
    expect(r.criticalRate).toBe(null)
    expect(r.measured).toBe(false)
    expect(r.ratedCount).toBe(0)
    expect(r.totalCount).toBe(3)   // the fleet size is still honest
  })

  it('rates over the rated subset only, and publishes its coverage', () => {
    // 1 of 4 rows is rated, and that row is a failure -> 100% OF WHAT WAS RATED,
    // never 25% (which would silently treat unrated tyres as healthy).
    const r = computeFailureRate([{ risk_level: 'High' }, {}, {}, {}])
    expect(r.failureRate).toBe(1)
    expect(r.ratedCount).toBe(1)
    expect(r.coveragePct).toBe(25)
    expect(r.measured).toBe(true)
  })
})

describe('computePressureCompliance - measures pressure, not typing', () => {
  const withPsi = (...psi) => ({
    status: 'Done',
    tyre_conditions: Object.fromEntries(psi.map((p, i) => [`P${i}`, { pressure_psi: String(p) }])),
  })

  it('scores each reading against its own vehicle median', () => {
    // median 100: 60 is 40% low and fails; the other three are within 15%
    const r = computePressureCompliance([withPsi(100, 100, 100, 60)])
    expect(r.compliancePct).toBe(75)
    expect(r.readings).toBe(4)
    expect(r.measuredInspections).toBe(1)
  })

  it('does NOT count findings text as a pressure reading', () => {
    // the exact defect this replaced: an inspector typing "ok" used to score
    // as compliant without a single pressure being recorded
    const r = computePressureCompliance([
      { status: 'Done', findings: 'ok' },
      { status: 'Done', findings: 'pressures fine' },
    ])
    expect(r.compliancePct).toBe(null)
    expect(r.readings).toBe(0)
    expect(r.notMeasuredInspections).toBe(2)
  })

  it('ignores an inspection with too few readings to trust its median', () => {
    expect(computePressureCompliance([withPsi(100, 100, 40)]).compliancePct).toBe(null)
  })

  it('tolerates a JSON string and an array of positions', () => {
    const asString = { status: 'Done', tyre_conditions: JSON.stringify({
      A: { pressure_psi: 100 }, B: { pressure_psi: 100 },
      C: { pressure_psi: 100 }, D: { pressure_psi: 100 } }) }
    const asArray = { status: 'Done', tyre_conditions: [
      { position: 'A', pressure_psi: 100 }, { position: 'B', pressure_psi: 100 },
      { position: 'C', pressure_psi: 100 }, { position: 'D', pressure_psi: 100 } ] }
    expect(computePressureCompliance([asString]).compliancePct).toBe(100)
    expect(computePressureCompliance([asArray]).compliancePct).toBe(100)
  })

  it('excludes Cancelled inspections and survives junk', () => {
    const cancelled = { ...withPsi(100, 100, 100, 100), status: 'Cancelled' }
    expect(computePressureCompliance([cancelled]).compliancePct).toBe(null)
    expect(computePressureCompliance([{ status: 'Done', tyre_conditions: 'not json' }]).compliancePct).toBe(null)
    expect(computePressureCompliance([]).compliancePct).toBe(null)
  })
})

describe('computeCostTrend - forecast honesty', () => {
  const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-15`
  it('single month of data forecasts that month, never a fabricated 0', () => {
    const now = new Date()
    const recs = [
      { issue_date: iso(now), cost_per_tyre: 1200, qty: 1 },
      { issue_date: iso(now), cost_per_tyre: 800, qty: 1 },
    ]
    const t = computeCostTrend(recs)
    expect(t.byMonth.length).toBe(1)
    expect(t.forecastNextMonth).toBe(2000)
  })
  it('no data yields a null forecast', () => {
    const t = computeCostTrend([])
    expect(t.forecastNextMonth).toBeNull()
  })
  it('two months regress normally', () => {
    const now = new Date()
    const prev = new Date(now.getFullYear(), now.getMonth() - 1, 15)
    const recs = [
      { issue_date: iso(prev), cost_per_tyre: 1000, qty: 1 },
      { issue_date: iso(now), cost_per_tyre: 2000, qty: 1 },
    ]
    const t = computeCostTrend(recs)
    expect(t.forecastNextMonth).toBe(3000)
  })
})
