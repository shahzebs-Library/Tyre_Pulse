import { describe, it, expect } from 'vitest'
import {
  recomputeFleetCpk,
  isNoMeter,
  isExcluded,
  distinctTypes,
  distinctBrands,
} from '../lib/cpkScenario'

// A small KSA fleet: two km trucks and one hour loader that has cost but NO meter,
// plus a km truck that also has no meter (cost with 0 km).
const perVehicle = [
  { asset_no: 'TM001', vehicle_type: 'TR-MIXER', brand: 'PIRELLI', country: 'KSA', currency: 'SAR', unit: 'km', distance_or_hours: 10000, tyre_cost: 2000, maintenance_cost: 1000, total_cost: 3000 },
  { asset_no: 'TM002', vehicle_type: 'TR-MIXER', brand: 'ROADX', country: 'KSA', currency: 'SAR', unit: 'km', distance_or_hours: 20000, tyre_cost: 3000, maintenance_cost: 1000, total_cost: 4000 },
  // wheel loader: hour asset, cost but distance_or_hours 0 -> no meter
  { asset_no: 'WL001', vehicle_type: 'WHEEL LOADER', brand: 'PIRELLI', country: 'KSA', currency: 'SAR', unit: 'engine_hours', distance_or_hours: 0, tyre_cost: 5000, maintenance_cost: 0, total_cost: 5000 },
  // a genuine hour asset WITH hours
  { asset_no: 'GN001', vehicle_type: 'GENERATOR', brand: 'ROADX', country: 'KSA', currency: 'SAR', unit: 'engine_hours', distance_or_hours: 1000, tyre_cost: 0, maintenance_cost: 2000, total_cost: 2000 },
]

const kmGroup = (res) => res.groups.find((g) => g.country === 'KSA' && g.unit === 'km')
const hrGroup = (res) => res.groups.find((g) => g.country === 'KSA' && g.unit === 'engine_hours')

describe('isNoMeter', () => {
  it('flags cost-with-no-distance and nothing else', () => {
    expect(isNoMeter({ distance_or_hours: 0, total_cost: 5000 })).toBe(true)
    expect(isNoMeter({ distance_or_hours: null, total_cost: 100 })).toBe(true)
    expect(isNoMeter({ distance_or_hours: 10, total_cost: 5000 })).toBe(false)
    expect(isNoMeter({ distance_or_hours: 0, total_cost: 0 })).toBe(false)
  })
})

describe('recomputeFleetCpk baseline', () => {
  it('with no exclusions scenario equals baseline and deltas are 0', () => {
    const res = recomputeFleetCpk(perVehicle, {})
    expect(res.totalCount).toBe(4)
    expect(res.includedCount).toBe(4)
    expect(res.excludedCount).toBe(0)
    expect(res.noMeterCount).toBe(1)

    const km = kmGroup(res)
    // km side: cost 7000 over 30000 -> 0.2333.., tyre 5000/30000
    expect(km.baseline.cpk_total).toBeCloseTo(7000 / 30000, 10)
    expect(km.baseline.cpk_tyre).toBeCloseTo(5000 / 30000, 10)
    expect(km.scenario.cpk_total).toBeCloseTo(km.baseline.cpk_total, 10)
    expect(km.delta.cpk_total).toBe(0)
    expect(km.pctChange.cpk_total).toBe(0)

    const hr = hrGroup(res)
    // hour side baseline: cost 5000+2000=7000 over 1000 hours (loader has 0) -> 7.0
    expect(hr.baseline.cpk_total).toBeCloseTo(7000 / 1000, 10)
    expect(hr.baseline.noMeterCount).toBe(1)
    expect(hr.baseline.noMeterCost).toBe(5000)
  })
})

describe('recomputeFleetCpk exclude an asset', () => {
  it('excluding the no-meter loader lowers the hour-side CPK (corrected)', () => {
    const res = recomputeFleetCpk(perVehicle, { excludedAssets: new Set(['WL001']) })
    expect(res.includedCount).toBe(3)
    expect(res.excludedCount).toBe(1)
    const hr = hrGroup(res)
    // scenario hour side: only GN001 -> 2000 over 1000 -> 2.0, down from 7.0
    expect(hr.scenario.cpk_total).toBeCloseTo(2000 / 1000, 10)
    expect(hr.delta.cpk_total).toBeCloseTo(2 - 7, 10)
    expect(hr.pctChange.cpk_total).toBeCloseTo((100 * (2 - 7)) / 7, 10)
    // km side untouched
    expect(kmGroup(res).delta.cpk_total).toBe(0)
  })

  it('accepts an array of excluded assets too', () => {
    const res = recomputeFleetCpk(perVehicle, { excludedAssets: ['TM001'] })
    const km = kmGroup(res)
    expect(km.scenario.cpk_total).toBeCloseTo(4000 / 20000, 10)
  })
})

describe('recomputeFleetCpk exclude a type', () => {
  it('excluding WHEEL LOADER removes the no-meter case from the hour side', () => {
    const res = recomputeFleetCpk(perVehicle, { excludedTypes: ['WHEEL LOADER'] })
    const hr = hrGroup(res)
    expect(hr.scenario.assetCount).toBe(1)
    expect(hr.scenario.cpk_total).toBeCloseTo(2000 / 1000, 10)
    expect(hr.scenario.noMeterCount).toBe(0)
  })
})

describe('recomputeFleetCpk excludeNoMeter', () => {
  it('drops every cost-but-no-meter case in one toggle', () => {
    const res = recomputeFleetCpk(perVehicle, { excludeNoMeter: true })
    expect(res.excludedCount).toBe(1)
    const hr = hrGroup(res)
    expect(hr.scenario.noMeterCount).toBe(0)
    expect(hr.scenario.cpk_total).toBeCloseTo(2000 / 1000, 10)
    // the excluded cost is reflected in the delta
    expect(hr.delta.cost).toBeCloseTo(-5000, 10)
  })
})

describe('recomputeFleetCpk onlyUnit', () => {
  it('km-only zeroes out the hour scenario side while baseline stays', () => {
    const res = recomputeFleetCpk(perVehicle, { onlyUnit: 'km' })
    const hr = hrGroup(res)
    expect(hr.baseline.cpk_total).toBeCloseTo(7000 / 1000, 10)
    expect(hr.scenario.assetCount).toBe(0)
    expect(hr.scenario.cpk_total).toBeNull()
    // km side fully included
    const km = kmGroup(res)
    expect(km.scenario.assetCount).toBe(2)
    expect(km.delta.cpk_total).toBe(0)
  })
})

describe('recomputeFleetCpk empty', () => {
  it('handles empty / non-array input', () => {
    const res = recomputeFleetCpk([], {})
    expect(res.groups).toEqual([])
    expect(res.totalCount).toBe(0)
    expect(res.includedCount).toBe(0)
    const res2 = recomputeFleetCpk(undefined, {})
    expect(res2.groups).toEqual([])
  })

  it('CPK is null (never 0) when the included denominator is 0', () => {
    const rows = [{ asset_no: 'A', vehicle_type: 'X', country: 'KSA', currency: 'SAR', unit: 'km', distance_or_hours: 0, total_cost: 100, tyre_cost: 100 }]
    const res = recomputeFleetCpk(rows, {})
    const g = res.groups[0]
    expect(g.baseline.cpk_total).toBeNull()
    expect(g.scenario.cpk_total).toBeNull()
    expect(g.pctChange.cpk_total).toBeNull()
  })
})

describe('helpers', () => {
  it('isExcluded honors each control', () => {
    const loader = perVehicle[2]
    expect(isExcluded(loader, { excludeNoMeter: true })).toBe(true)
    expect(isExcluded(loader, { onlyUnit: 'km' })).toBe(true)
    expect(isExcluded(loader, { excludedBrands: ['PIRELLI'] })).toBe(true)
    expect(isExcluded(loader, {})).toBe(false)
  })

  it('distinctTypes counts and flags no-meter', () => {
    const types = distinctTypes(perVehicle)
    const loaderType = types.find((t) => t.type === 'WHEEL LOADER')
    expect(loaderType.count).toBe(1)
    expect(loaderType.noMeterCount).toBe(1)
    expect(types.find((t) => t.type === 'TR-MIXER').count).toBe(2)
  })

  it('distinctBrands aggregates', () => {
    const brands = distinctBrands(perVehicle)
    expect(brands.find((b) => b.brand === 'PIRELLI').count).toBe(2)
    expect(brands.find((b) => b.brand === 'ROADX').count).toBe(2)
  })
})
