import { describe, it, expect } from 'vitest'
import {
  runningUnitForAssetType,
  costPerUnit,
  buildCostIntelligence,
  UNIT_META,
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
