import { describe, it, expect } from 'vitest'
import { costPerKwh, summariseCharging, toFiniteNumber } from '../lib/chargingSessions'

describe('chargingSessions — costPerKwh', () => {
  it('computes cost / energy_kwh', () => {
    expect(costPerKwh({ cost: 60, energy_kwh: 40 })).toBe(1.5)
  })

  it('coerces numeric strings', () => {
    expect(costPerKwh({ cost: '63.75', energy_kwh: '42.5' })).toBeCloseTo(1.5, 6)
  })

  it('returns null on divide-by-zero energy', () => {
    expect(costPerKwh({ cost: 50, energy_kwh: 0 })).toBeNull()
  })

  it('returns null when cost or energy is missing/invalid', () => {
    expect(costPerKwh({ cost: 50 })).toBeNull()
    expect(costPerKwh({ energy_kwh: 40 })).toBeNull()
    expect(costPerKwh({ cost: 'abc', energy_kwh: 40 })).toBeNull()
    expect(costPerKwh(null)).toBeNull()
    expect(costPerKwh({})).toBeNull()
  })
})

describe('chargingSessions — summariseCharging', () => {
  it('returns a zeroed summary for empty / non-array input', () => {
    const empty = {
      totalSessions: 0, totalKwh: 0, totalCost: 0, avgCostPerKwh: null,
      distinctAssets: 0, completedCount: 0, avgSocGainPct: null,
    }
    expect(summariseCharging([])).toEqual(empty)
    expect(summariseCharging()).toEqual(empty)
    expect(summariseCharging(null)).toEqual(empty)
  })

  it('sums energy and cost and derives avg cost per kWh', () => {
    const rows = [
      { asset_no: 'EV1', energy_kwh: 40, cost: 60, status: 'completed', start_soc: 20, end_soc: 80 },
      { asset_no: 'EV2', energy_kwh: 60, cost: 90, status: 'failed', start_soc: 10, end_soc: 50 },
    ]
    const s = summariseCharging(rows)
    expect(s.totalSessions).toBe(2)
    expect(s.totalKwh).toBe(100)
    expect(s.totalCost).toBe(150)
    expect(s.avgCostPerKwh).toBeCloseTo(1.5, 6)
    expect(s.distinctAssets).toBe(2)
    expect(s.completedCount).toBe(1)
    // (60 + 40) / 2 = 50
    expect(s.avgSocGainPct).toBe(50)
  })

  it('leaves avgCostPerKwh null when total energy is zero', () => {
    const rows = [{ asset_no: 'EV1', energy_kwh: 0, cost: 25 }]
    expect(summariseCharging(rows).avgCostPerKwh).toBeNull()
  })

  it('only averages SoC gain over rows with both start and end present, clamped 0..100', () => {
    const rows = [
      { asset_no: 'EV1', start_soc: 20, end_soc: 90 }, // gain 70
      { asset_no: 'EV1', start_soc: 10 },              // ignored (no end)
      { asset_no: 'EV2', end_soc: 80 },                // ignored (no start)
    ]
    expect(summariseCharging(rows).avgSocGainPct).toBe(70)
  })

  it('clamps a negative mean SoC gain to 0 and an over-100 mean to 100', () => {
    expect(summariseCharging([{ start_soc: 80, end_soc: 20 }]).avgSocGainPct).toBe(0)
    expect(summariseCharging([{ start_soc: 0, end_soc: 150 }]).avgSocGainPct).toBe(100)
  })

  it('counts distinct assets ignoring blank asset numbers', () => {
    const rows = [
      { asset_no: 'EV1' }, { asset_no: 'EV1' }, { asset_no: '' }, { asset_no: 'EV2' }, {},
    ]
    expect(summariseCharging(rows).distinctAssets).toBe(2)
  })

  it('tolerates missing numeric fields without NaN', () => {
    const rows = [{ asset_no: 'EV1' }, { asset_no: 'EV2', energy_kwh: 30, cost: 45 }]
    const s = summariseCharging(rows)
    expect(s.totalKwh).toBe(30)
    expect(s.totalCost).toBe(45)
    expect(Number.isNaN(s.totalKwh)).toBe(false)
  })
})

describe('chargingSessions — toFiniteNumber', () => {
  it('parses numbers, numeric strings, and rejects junk', () => {
    expect(toFiniteNumber(42)).toBe(42)
    expect(toFiniteNumber('1,200')).toBe(1200)
    expect(toFiniteNumber('')).toBeNull()
    expect(toFiniteNumber(null)).toBeNull()
    expect(toFiniteNumber('abc')).toBeNull()
  })
})
