import { describe, it, expect } from 'vitest'
import { enrichTyres, vehicleMetrics } from '../lib/fuelEfficiencyAnalytics'
import {
  vehicleStatus, priorityOf, savingsOpportunities, topPerformers, sitePenalty, fleetPenaltyPct,
  treadBands, wornReplacementSavings, scenarioOutputs, filterVehicles,
} from '../lib/fuelEfficiencyView'

const tyres = enrichTyres([
  { asset_no: 'A1', site: 'NHC', pressure_reading: 110, tread_depth: 10 },
  { asset_no: 'A1', site: 'NHC', pressure_reading: 110, tread_depth: 9 },
  { asset_no: 'A2', site: 'NHC', pressure_reading: 88, tread_depth: 6 },
  { asset_no: 'A3', site: 'JED', pressure_reading: 99, tread_depth: 2 },
  { asset_no: 'A4', site: 'JED' },
])
const inputs = { consumptionL100: 40, monthlyKm: 5000, pricePerL: 2 }
const vehicles = vehicleMetrics(tyres, inputs)

describe('fuelEfficiencyView', () => {
  it('status never calls an unmeasured vehicle good', () => {
    const by = Object.fromEntries(vehicles.map((v) => [v.asset_no, vehicleStatus(v).key]))
    expect(by.A1).toBe('good')
    expect(by.A3).toBe('service')
    expect(by.A4).toBe('unmeasured')
    expect(['check', 'service']).toContain(by.A2)
  })

  it('priority bands', () => {
    expect(priorityOf(null)).toBeNull()
    expect(priorityOf(4).label).toBe('High')
    expect(priorityOf(2).label).toBe('Medium')
    expect(priorityOf(0.5).label).toBe('Low')
  })

  it('opportunities rank by waste and skip zero penalty', () => {
    const o = savingsOpportunities(vehicles)
    expect(o.map((v) => v.asset_no)).not.toContain('A1')
    expect(o.map((v) => v.asset_no)).not.toContain('A4')
    expect(o[0].annualExtraCost).toBeGreaterThanOrEqual(o[o.length - 1].annualExtraCost)
  })

  it('top performers are the lowest measured penalty', () => {
    const p = topPerformers(vehicles)
    expect(p[0].asset_no).toBe('A1')
    expect(p.map((v) => v.asset_no)).not.toContain('A4')
  })

  it('site penalty averages measured vehicles only', () => {
    const s = sitePenalty(vehicles)
    expect(s.map((x) => x.site)).toEqual(['NHC', 'JED'])
    expect(s.find((x) => x.site === 'JED').measuredVehicles).toBe(1)
    expect(fleetPenaltyPct([])).toBeNull()
  })

  it('tread bands and regression', () => {
    const b = treadBands(tyres)
    expect(b.worn).toHaveLength(1)
    expect(b.monitor).toHaveLength(1)
    expect(b.good).toHaveLength(2)
    expect(b.points).toBe(4)
    expect(b.line).toHaveLength(2)
    expect(b.r2).toBeGreaterThan(0)
    expect(treadBands([]).line).toBeNull()
  })

  it('worn replacement saving needs inputs and counts worn tyres', () => {
    const s = wornReplacementSavings(tyres, inputs)
    expect(s.wornTyres).toBe(1)
    expect(s.vehicles).toBe(1)
    expect(s.monthlyLitres).toBe(60) // 3% of 40 L/100km x 5000 km
    expect(s.annualCost).toBe(1440)
    const none = wornReplacementSavings(tyres, {})
    expect(none.monthlyLitres).toBeNull()
    expect(none.wornTyres).toBe(1)
  })

  it('scenario outputs', () => {
    expect(scenarioOutputs({ monthlyLitres: 100, annualCost: 2400 })).toEqual({ annualCost: 2400, annualLitres: 1200, co2Tonnes: 3.2 })
    expect(scenarioOutputs(null)).toEqual({ annualCost: null, annualLitres: null, co2Tonnes: null })
  })

  it('filters vehicles by search, site and status', () => {
    expect(filterVehicles(vehicles, { search: 'a3' }).map((v) => v.asset_no)).toEqual(['A3'])
    expect(filterVehicles(vehicles, { site: 'JED' })).toHaveLength(2)
    expect(filterVehicles(vehicles, { status: 'unmeasured' }).map((v) => v.asset_no)).toEqual(['A4'])
  })
})

describe('fuelEfficiencyView: asset type and trend window', () => {
  it('groups modelled penalty by asset type, unmeasured dropped, missing type labelled', async () => {
    const { typePenalty, assetTypeOptions } = await import('../lib/fuelEfficiencyView')
    const types = { A1: 'Mixer', A2: 'Mixer', A3: 'Pump' }
    const out = typePenalty(vehicles, (a) => types[a])
    expect(out.map((e) => e.type)).toEqual(expect.arrayContaining(['Mixer', 'Pump']))
    expect(out.find((e) => e.type === 'Type not recorded')).toBeUndefined()
    expect(out[0].penaltyPct).toBeLessThanOrEqual(out[out.length - 1].penaltyPct)
    expect(assetTypeOptions(vehicles, (a) => types[a])).toEqual(['Mixer', 'Pump'])
  })
  it('slices the last n months', async () => {
    const { trendWindow } = await import('../lib/fuelEfficiencyView')
    const t = Array.from({ length: 12 }, (_, i) => ({ key: i }))
    expect(trendWindow(t, 6).map((x) => x.key)).toEqual([6, 7, 8, 9, 10, 11])
    expect(trendWindow(t, 99)).toHaveLength(12)
    expect(trendWindow([], 6)).toEqual([])
  })
})

describe('fuelEfficiencyView: compare periods', () => {
  it('weights by measured tyres and returns null when a side is empty', async () => {
    const { comparePeriods } = await import('../lib/fuelEfficiencyView')
    const t = Array.from({ length: 12 }, (_, i) => ({ key: i, measured: i < 6 ? 2 : 1, avgPenaltyPct: i < 6 ? 2 : 1 }))
    const c = comparePeriods(t, 6)
    expect(c.current.penaltyPct).toBe(1)
    expect(c.previous.penaltyPct).toBe(2)
    expect(c.changePct).toBe(-50)
    const empty = comparePeriods(t.map((m, i) => (i < 6 ? { ...m, measured: 0, avgPenaltyPct: null } : m)), 6)
    expect(empty.previous.penaltyPct).toBeNull()
    expect(empty.changePct).toBeNull()
  })
})
