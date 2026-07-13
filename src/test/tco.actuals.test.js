import { describe, it, expect } from 'vitest'
import {
  recordTyreCost, recordKm,
  computeAssetsActualTco, computeFleetActualRollup,
  cpkPercentile, cpkBand,
  computeMonthlyActualCpk, computeSpendByPosition,
  deriveSavingsInputs, computeSavingsPotential,
  computeGccBenchmarks, computeFleetActuals,
  TCO_ASSUMPTIONS,
} from '../lib/tco'

// ── record-level helpers ──────────────────────────────────────────────────────
describe('recordTyreCost / recordKm', () => {
  it('multiplies cost by qty only when qty > 0', () => {
    expect(recordTyreCost({ cost_per_tyre: 850, qty: 4 })).toBe(3400)
    expect(recordTyreCost({ cost_per_tyre: 850, qty: 0 })).toBe(850) // qty 0 → single
    expect(recordTyreCost({ cost_per_tyre: 850 })).toBe(850) // no qty → single
    expect(recordTyreCost({ cost_per_tyre: null })).toBe(0)
  })

  it('uses the fitment→removal stint when valid, else total_km', () => {
    expect(recordKm({ km_at_fitment: 10000, km_at_removal: 55000 })).toBe(45000)
    // removal not greater than fitment → fall back to total_km
    expect(recordKm({ km_at_fitment: 60000, km_at_removal: 50000, total_km: 30000 })).toBe(30000)
    // no odometer at all → total_km
    expect(recordKm({ total_km: 12000 })).toBe(12000)
    // nothing usable → 0
    expect(recordKm({})).toBe(0)
  })
})

// ── per-asset TCO ─────────────────────────────────────────────────────────────
describe('computeAssetsActualTco', () => {
  const records = [
    { asset_no: 'A1', cost_per_tyre: 1000, qty: 2, km_at_fitment: 0, km_at_removal: 40000 },
    { asset_no: 'A1', cost_per_tyre: 500, qty: 0, km_at_fitment: 40000, km_at_removal: 60000 },
    { asset_no: 'A2', cost_per_tyre: 900, total_km: 30000 },
  ]

  it('aggregates procurement (qty-weighted) and km per asset with 3dp cpk', () => {
    const rows = computeAssetsActualTco(records, { vehicleTypeByAsset: { A1: 'Semi-Trailer 40T' } })
    const a1 = rows.find((r) => r.asset_no === 'A1')
    const a2 = rows.find((r) => r.asset_no === 'A2')
    // A1: cost = 1000*2 + 500 = 2500 ; km = 40000 + 20000 = 60000 ; cpk = 0.042
    expect(a1.tyre_procurement).toBe(2500)
    expect(a1.km).toBe(60000)
    expect(a1.cost_per_km).toBeCloseTo(0.042, 6)
    expect(a1.vehicle_type).toBe('Semi-Trailer 40T')
    // A2: cost 900 / km 30000 = 0.03
    expect(a2.cost_per_km).toBe(0.03)
  })

  it('sorts by tyre_procurement (TCO) descending', () => {
    const rows = computeAssetsActualTco(records)
    expect(rows[0].asset_no).toBe('A1') // 2500 > 900
  })

  it('guards cost_per_km when km is 0 → null (not Infinity)', () => {
    const rows = computeAssetsActualTco([{ asset_no: 'Z', cost_per_tyre: 700 }])
    expect(rows[0].km).toBe(0)
    expect(rows[0].cost_per_km).toBeNull()
  })
})

// ── fleet rollup + percentile + band ─────────────────────────────────────────
describe('computeFleetActualRollup + percentile + band', () => {
  const assets = [
    { asset_no: 'A1', tyre_procurement: 2500, km: 60000, cost_per_km: 0.042 },
    { asset_no: 'A2', tyre_procurement: 900, km: 30000, cost_per_km: 0.03 },
    { asset_no: 'A3', tyre_procurement: 500, km: 0, cost_per_km: null },
  ]

  it('rolls up totals and fleet_avg_cpkm over assets with a cpk', () => {
    const r = computeFleetActualRollup(assets)
    expect(r.total_tco).toBe(3900)
    expect(r.total_km).toBe(90000)
    // blended = 3900 / 90000 = 0.043333 → 0.043
    expect(r.fleet_cost_per_km).toBe(0.043)
    // fleet_avg_cpkm = mean(0.042, 0.03) = 0.036
    expect(r.fleet_avg_cpkm).toBe(0.036)
    expect(r.assets_with_cpk).toBe(2)
  })

  it('cpkPercentile clamps to [1,99] and is null-safe', () => {
    const avg = 0.036
    // cheaper than avg → above 50
    expect(cpkPercentile(0.03, avg)).toBeGreaterThan(50)
    // exactly average → 50
    expect(cpkPercentile(0.036, avg)).toBe(50)
    // far worse than avg clamps to floor 1
    expect(cpkPercentile(1.0, avg)).toBe(1)
    // far better than avg clamps to ceiling 99
    expect(cpkPercentile(0.0001, avg)).toBe(99)
    // free-of-charge extreme still clamps
    expect(cpkPercentile(0, avg)).toBe(99)
    expect(cpkPercentile(null, avg)).toBeNull()
    expect(cpkPercentile(0.03, 0)).toBeNull()
  })

  it('cpkBand buckets by ratio to reference', () => {
    const ref = 1.0
    expect(cpkBand(0.7, ref)).toBe('excellent') // ratio 0.70 ≤ 0.80
    expect(cpkBand(0.95, ref)).toBe('good') // ≤ 1.00
    expect(cpkBand(1.1, ref)).toBe('average') // ≤ 1.20
    expect(cpkBand(1.4, ref)).toBe('poor') // ≤ 1.50
    expect(cpkBand(2.0, ref)).toBe('critical') // > 1.50
    expect(cpkBand(null, ref)).toBeNull()
    expect(cpkBand(1.0, 0)).toBeNull()
  })
})

// ── monthly trend ─────────────────────────────────────────────────────────────
describe('computeMonthlyActualCpk', () => {
  it('buckets by removal month and yields cpk (or null when km unknown)', () => {
    const rows = computeMonthlyActualCpk([
      { removal_date: '2025-01-15', cost_per_tyre: 1000, qty: 1, km_at_fitment: 0, km_at_removal: 50000 },
      { removal_date: '2025-01-20', cost_per_tyre: 500, qty: 1, km_at_fitment: 0, km_at_removal: 25000 },
      // no km attributable → contributes cost but km stays 0
      { removal_date: '2025-02-10', cost_per_tyre: 800, qty: 1, total_km: 40000 },
    ])
    const jan = rows.find((m) => m.month === '2025-01')
    const feb = rows.find((m) => m.month === '2025-02')
    expect(jan.cost).toBe(1500)
    expect(jan.km).toBe(75000)
    expect(jan.cpk).toBe(0.02) // 1500 / 75000
    // Feb: total_km is not a stint → km 0 → honest null
    expect(feb.km).toBe(0)
    expect(feb.cpk).toBeNull()
    // sorted ascending
    expect(rows.map((m) => m.month)).toEqual(['2025-01', '2025-02'])
  })

  it('falls back to issue_date when removal_date is absent', () => {
    const rows = computeMonthlyActualCpk([{ issue_date: '2024-11-03', cost_per_tyre: 300, km_at_fitment: 0, km_at_removal: 10000 }])
    expect(rows[0].month).toBe('2024-11')
  })
})

// ── spend by position ─────────────────────────────────────────────────────────
describe('computeSpendByPosition', () => {
  it('sums costed records per position and drops empty buckets', () => {
    const rows = computeSpendByPosition([
      { position: 'Drive', cost_per_tyre: 1000, qty: 2 },
      { position: 'Steer', cost_per_tyre: 900 },
      { position: '', cost_per_tyre: 0 }, // no cost → dropped
    ])
    expect(rows.find((r) => r.label === 'Drive').amount).toBe(2000)
    expect(rows[0].label).toBe('Drive') // sorted desc
    expect(rows.some((r) => r.label === 'Unspecified')).toBe(false)
  })
})

// ── savings potential (verbatim formulas) ─────────────────────────────────────
describe('deriveSavingsInputs + computeSavingsPotential', () => {
  it('derives counts: active vehicles, non-scrapped tyres, avg tyre cost', () => {
    const records = [
      { asset_no: 'A1', cost_per_tyre: 800, status: 'fitted' },
      { asset_no: 'A2', cost_per_tyre: 1200, status: 'scrapped' },
      { asset_no: 'A2', cost_per_tyre: 1000, status: 'removed' },
    ]
    const active = new Set(['A1', 'A2'])
    const inp = deriveSavingsInputs(records, active)
    expect(inp.vehicleCount).toBe(2)
    expect(inp.tyreCount).toBe(2) // one scrapped excluded
    expect(inp.avgTyreCost).toBe(1000) // mean(800,1200,1000)
  })

  it('defaults avg tyre cost to 850 when no costed records', () => {
    const inp = deriveSavingsInputs([{ asset_no: 'A1', cost_per_tyre: 0 }], new Set(['A1']))
    expect(inp.avgTyreCost).toBe(TCO_ASSUMPTIONS.avg_tyre_cost)
    expect(inp.avgTyreCost).toBe(850)
  })

  it('applies the five ported formulas exactly', () => {
    const vc = 10
    const tyreCount = 40
    const cost = 850
    const s = computeSavingsPotential({ vehicleCount: vc, tyreCount, avgTyreCost: cost })
    const rotation = vc * 4 * cost * 0.08
    const pressure = (vc * 250 * 365 * 0.28) / 100 * TCO_ASSUMPTIONS.fuel_price * 0.03
    const retread = vc * 2 * cost * 0.55
    const early = tyreCount * cost * 0.05
    const procurement = vc * 4 * cost * 0.06
    const total = rotation + pressure + retread + early + procurement

    const byName = Object.fromEntries(s.initiatives.map((i) => [i.initiative, i.annual]))
    expect(byName['Tyre Rotation Optimisation']).toBe(Math.round(rotation))
    expect(byName['Pressure Compliance (TPMS)']).toBe(Math.round(pressure))
    expect(byName['Retread Programme']).toBe(Math.round(retread))
    expect(byName['Early Failure Detection']).toBe(Math.round(early))
    expect(byName['Consolidated Procurement']).toBe(Math.round(procurement))
    expect(s.total).toBe(Math.round(total))
    expect(s.perVehicle).toBe(Math.round(total / vc))
  })

  it('is safe with zero vehicles (no divide-by-zero)', () => {
    const s = computeSavingsPotential({ vehicleCount: 0, tyreCount: 0 })
    expect(s.total).toBe(0)
    expect(s.perVehicle).toBe(0)
  })
})

// ── GCC benchmarks ────────────────────────────────────────────────────────────
describe('computeGccBenchmarks', () => {
  it('matches assets by vehicle type and computes variance', () => {
    const assets = [
      { vehicle_type: 'Semi-Trailer 40T', cost_per_km: 2.30 },
      { vehicle_type: 'Semi-Trailer', cost_per_km: 1.90 },
      { vehicle_type: 'City Bus', cost_per_km: null }, // no km → excluded
    ]
    const rows = computeGccBenchmarks(assets)
    const semi = rows.find((r) => r.type === 'Semi-Trailer 40T')
    expect(semi.benchmarkCpk).toBe(2.10)
    expect(semi.actualCpk).toBe(2.1) // mean(2.30,1.90)
    expect(semi.assetCount).toBe(2)
    expect(semi.variancePct).toBe(0) // (2.10-2.10)/2.10
    const bus = rows.find((r) => r.type === 'City Bus')
    expect(bus.actualCpk).toBeNull()
    expect(bus.variancePct).toBeNull()
  })
})

// ── full bundle ───────────────────────────────────────────────────────────────
describe('computeFleetActuals (orchestrator)', () => {
  const records = [
    { asset_no: 'A1', cost_per_tyre: 1000, qty: 2, km_at_fitment: 0, km_at_removal: 40000, position: 'Drive', removal_date: '2025-01-10', status: 'removed' },
    { asset_no: 'A2', cost_per_tyre: 900, total_km: 30000, position: 'Steer', issue_date: '2025-02-01', status: 'fitted' },
  ]
  const fleet = [
    { asset_no: 'A1', vehicle_type: 'Semi-Trailer 40T', is_active: true },
    { asset_no: 'A2', vehicle_type: 'City Bus', is_active: false },
  ]

  it('returns every derived surface and joins vehicle_type', () => {
    const out = computeFleetActuals(records, { fleet })
    expect(out.assets).toHaveLength(2)
    expect(out.assets[0].asset_no).toBe('A1') // top by spend
    expect(out.assets.find((a) => a.asset_no === 'A1').vehicle_type).toBe('Semi-Trailer 40T')
    expect(out.rollup.total_tco).toBe(2900) // 2000 + 900
    expect(out.monthly.length).toBeGreaterThan(0)
    expect(out.breakdown.length).toBeGreaterThan(0)
    expect(out.benchmarks.length).toBe(5)
    // only A1 is active
    expect(out.meta.activeVehicleCount).toBe(1)
    expect(out.savings.vehicleCount).toBe(1)
  })

  it('is null-safe on empty input', () => {
    const out = computeFleetActuals([], { fleet: [] })
    expect(out.assets).toEqual([])
    expect(out.rollup.total_tco).toBe(0)
    expect(out.rollup.fleet_avg_cpkm).toBeNull()
    expect(out.savings.total).toBe(0)
    expect(out.benchmarks).toHaveLength(5)
  })
})
