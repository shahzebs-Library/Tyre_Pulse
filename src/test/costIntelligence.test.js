import { describe, it, expect } from 'vitest'
import {
  runningUnitForAssetType,
  costPerUnit,
  buildCostIntelligence,
  UNIT_META,
  cpkUnitForAssetType,
  assetCpk,
  rollupFleetCpk,
} from '../lib/costIntelligence'

describe('runningUnitForAssetType', () => {
  it('maps volume assets to m3', () => {
    expect(runningUnitForAssetType('Concrete Pump')).toBe('m3')
    expect(runningUnitForAssetType('Boom Pump Truck')).toBe('m3')
    expect(runningUnitForAssetType('Water Treatment Unit')).toBe('m3')
    expect(runningUnitForAssetType('BATCHING PLANT')).toBe('m3')
  })

  it('maps power / plant assets to engine_hours', () => {
    expect(runningUnitForAssetType('Generator')).toBe('engine_hours')
    expect(runningUnitForAssetType('genset 500kva')).toBe('engine_hours')
    expect(runningUnitForAssetType('Wheel Loader')).toBe('engine_hours')
  })

  it('defaults to km for on-road / unknown types', () => {
    expect(runningUnitForAssetType('Tr-Mixer')).toBe('km')
    expect(runningUnitForAssetType('Bus')).toBe('km')
    expect(runningUnitForAssetType('')).toBe('km')
    expect(runningUnitForAssetType(null)).toBe('km')
    expect(runningUnitForAssetType(undefined)).toBe('km')
  })
})

describe('costPerUnit', () => {
  it('divides expenses by the running total when positive', () => {
    const r = costPerUnit({ expenses: 1000, m3: 250, unit: 'm3' })
    expect(r.value).toBe(4)
    expect(r.running).toBe(250)
    expect(r.unit).toBe('m3')
  })

  it('selects the running total by unit', () => {
    expect(costPerUnit({ expenses: 100, km: 50, hours: 10, m3: 5, unit: 'km' }).value).toBe(2)
    expect(costPerUnit({ expenses: 100, km: 50, hours: 10, m3: 5, unit: 'engine_hours' }).value).toBe(10)
    expect(costPerUnit({ expenses: 100, km: 50, hours: 10, m3: 5, unit: 'm3' }).value).toBe(20)
  })

  it('returns null (no fabrication) when the running total is zero / missing / negative', () => {
    expect(costPerUnit({ expenses: 1000, m3: 0, unit: 'm3' }).value).toBeNull()
    expect(costPerUnit({ expenses: 1000, unit: 'm3' }).value).toBeNull()
    expect(costPerUnit({ expenses: 1000, km: -5, unit: 'km' }).value).toBeNull()
    expect(costPerUnit({ expenses: 1000, hours: NaN, unit: 'engine_hours' }).value).toBeNull()
  })

  it('treats non-finite expenses as zero, not NaN', () => {
    const r = costPerUnit({ expenses: undefined, km: 100, unit: 'km' })
    expect(r.value).toBe(0)
  })
})

describe('buildCostIntelligence', () => {
  const split = { tyre: 600, maintenance: 400 }

  it('derives expenses from the mode via pickCost', () => {
    expect(buildCostIntelligence({ split, mode: 'combined' }).expenses).toBe(1000)
    expect(buildCostIntelligence({ split, mode: 'tyres' }).expenses).toBe(600)
    expect(buildCostIntelligence({ split, mode: 'maintenance' }).expenses).toBe(400)
  })

  it('computes each per-unit figure from its running total', () => {
    const out = buildCostIntelligence({ split, mode: 'combined', km: 2000, hours: 100, m3: 500 })
    expect(out.perKm.value).toBe(0.5)
    expect(out.perHour.value).toBe(10)
    expect(out.perM3.value).toBe(2)
  })

  it('leaves a per-unit figure null when its running total is absent', () => {
    const out = buildCostIntelligence({ split, mode: 'tyres', km: 3000 })
    expect(out.perKm.value).toBe(0.2)
    expect(out.perHour.value).toBeNull()
    expect(out.perM3.value).toBeNull()
  })

  it('m3 path: expenses / m3 for the combined mode', () => {
    const out = buildCostIntelligence({ split: { tyre: 0, maintenance: 1200 }, mode: 'maintenance', m3: 300 })
    expect(out.expenses).toBe(1200)
    expect(out.perM3.value).toBe(4)
    expect(out.perM3.unit).toBe('m3')
  })

  it('exposes unit metadata suffixes', () => {
    expect(UNIT_META.m3.suffix).toBe('/m3')
    expect(UNIT_META.km.suffix).toBe('/km')
    expect(UNIT_META.engine_hours.suffix).toBe('/hour')
  })
})

describe('cpkUnitForAssetType (mirror of SQL cpk_unit_for_asset_type)', () => {
  it('road assets measure by km', () => {
    expect(cpkUnitForAssetType('TR-MIXER')).toBe('km')
    expect(cpkUnitForAssetType('PICKUP')).toBe('km')
    expect(cpkUnitForAssetType('BUS')).toBe('km')
    expect(cpkUnitForAssetType('BT-PLANT')).toBe('km')
    expect(cpkUnitForAssetType('')).toBe('km')
    expect(cpkUnitForAssetType(null)).toBe('km')
  })

  it('power / plant assets (hour keywords) measure by engine_hours', () => {
    expect(cpkUnitForAssetType('GENERATOR')).toBe('engine_hours')
    expect(cpkUnitForAssetType('WHEEL_LOADER')).toBe('engine_hours')
    expect(cpkUnitForAssetType('EXCAVATOR')).toBe('engine_hours')
    expect(cpkUnitForAssetType('FORKLIFT')).toBe('engine_hours')
  })

  it('m3 assets (pumps / water treatment) collapse to engine_hours for CPK', () => {
    expect(cpkUnitForAssetType('PUMPS')).toBe('engine_hours')
    expect(cpkUnitForAssetType('SPIDER PUMP')).toBe('engine_hours')
    expect(cpkUnitForAssetType('WATER TREATMENT PLANT')).toBe('engine_hours')
  })
})

describe('assetCpk', () => {
  it('picks km as the denominator for a road asset and divides cost by it', () => {
    const a = assetCpk({ asset_no: 'TM1', vehicle_type: 'TR-MIXER', km: 30000, hours: 8000, tyre_cost: 15000, maintenance_cost: 3000 })
    expect(a.unit).toBe('km')
    expect(a.distanceOrHours).toBe(30000)
    expect(a.totalCost).toBe(18000)
    expect(a.cpkTyre).toBeCloseTo(0.5, 6)
    expect(a.cpkTotal).toBeCloseTo(0.6, 6)
  })

  it('picks engine_hours for a plant asset', () => {
    const a = assetCpk({ asset_no: 'MP1', vehicle_type: 'PUMPS', km: 30000, hours: 5000, tyre_cost: 5000 })
    expect(a.unit).toBe('engine_hours')
    expect(a.distanceOrHours).toBe(5000)
    expect(a.cpkTotal).toBeCloseTo(1, 6)
  })

  it('returns null cpk (never fabricated) when the denominator is 0 / missing', () => {
    const a = assetCpk({ vehicle_type: 'TR-MIXER', tyre_cost: 1000 })
    expect(a.cpkTyre).toBeNull()
    expect(a.cpkTotal).toBeNull()
    expect(a.distanceOrHours).toBe(0)
  })

  it('honours an explicit unit + distance_or_hours (RPC row shape)', () => {
    const a = assetCpk({ unit: 'engine_hours', distance_or_hours: 652, tyre_cost: 1400, maintenance_cost: 35967.19 })
    expect(a.unit).toBe('engine_hours')
    expect(a.cpkTotal).toBeCloseTo(37367.19 / 652, 6)
  })
})

describe('rollupFleetCpk', () => {
  const rows = [
    // KSA km assets
    { country: 'KSA', currency: 'SAR', asset_no: 'TM1', vehicle_type: 'TR-MIXER', km: 30000, tyre_cost: 15000, maintenance_cost: 3000 },
    { country: 'KSA', currency: 'SAR', asset_no: 'TM2', vehicle_type: 'TR-MIXER', km: 10000, tyre_cost: 5000, maintenance_cost: 0 },
    // KSA km asset with cost but NO measured distance -> counts to coverage denominator only
    { country: 'KSA', currency: 'SAR', asset_no: 'TM3', vehicle_type: 'TR-MIXER', tyre_cost: 4000, maintenance_cost: 0 },
    // KSA hour asset
    { country: 'KSA', currency: 'SAR', asset_no: 'MP1', vehicle_type: 'PUMPS', hours: 5000, tyre_cost: 5000, maintenance_cost: 5000 },
    // UAE km asset (separate currency, must never blend with KSA)
    { country: 'UAE', currency: 'AED', asset_no: 'RM1', vehicle_type: 'PICKUP', km: 20000, tyre_cost: 1000, maintenance_cost: 1000 },
  ]

  it('per-vehicle lists only cost-bearing assets, richest first', () => {
    const { perVehicle } = rollupFleetCpk(rows)
    expect(perVehicle).toHaveLength(5)
    expect(perVehicle[0].totalCost).toBeGreaterThanOrEqual(perVehicle[1].totalCost)
  })

  it('by-type groups per country + vehicle_type + unit with matched-only cpk', () => {
    const { byType } = rollupFleetCpk(rows)
    const mixer = byType.find((g) => g.country === 'KSA' && g.vehicle_type === 'TR-MIXER')
    expect(mixer.unit).toBe('km')
    expect(mixer.assets).toBe(3)
    expect(mixer.assetsMeasured).toBe(2)
    // matched total 23000 (TM1 18000 + TM2 5000) / matched km 40000 (TM3 has no km, excluded from cpk)
    expect(mixer.cpkTotal).toBeCloseTo(23000 / 40000, 6)
    expect(mixer.cpkTyre).toBeCloseTo(20000 / 40000, 6)
  })

  it('fleet splits km vs hours, keeps currency per country, and reports coverage', () => {
    const { fleet } = rollupFleetCpk(rows)
    const ksa = fleet.find((f) => f.country === 'KSA')
    expect(ksa.currency).toBe('SAR')
    // km side: 3 cost assets, 2 measured -> coverage 66.7%
    expect(ksa.km.costAssets).toBe(3)
    expect(ksa.km.measuredAssets).toBe(2)
    expect(ksa.km.coveragePct).toBeCloseTo(200 / 3, 4)
    expect(ksa.km.total).toBe(40000)
    expect(ksa.km.cpkTotal).toBeCloseTo(23000 / 40000, 6)
    // hours side is separate
    expect(ksa.hours.total).toBe(5000)
    expect(ksa.hours.cpkTotal).toBeCloseTo(10000 / 5000, 6)

    const uae = fleet.find((f) => f.country === 'UAE')
    expect(uae.currency).toBe('AED')
    expect(uae.km.cpkTotal).toBeCloseTo(2000 / 20000, 6)
  })

  it('never divides by zero: a country with cost but no distance yields null cpk', () => {
    const { fleet } = rollupFleetCpk([
      { country: 'KSA', currency: 'SAR', vehicle_type: 'TR-MIXER', tyre_cost: 500 },
    ])
    expect(fleet[0].km.cpkTotal).toBeNull()
    expect(fleet[0].km.coveragePct).toBe(0)
  })
})
