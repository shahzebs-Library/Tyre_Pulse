import { describe, it, expect } from 'vitest'
import { computeTco } from '../lib/tco'
import {
  honestWhatIf, savingsView, filterAssets, assetKpis, hasMeasuredTyreCost,
  recordKmCoverage, assetExportRows, vehicleTypeOptions, benchmarkExportRows, bandLegend,
} from '../lib/tcoCalculatorAnalytics'

describe('honestWhatIf', () => {
  it('never fabricates a denominator: zero km / vehicles / years give null', () => {
    const r = honestWhatIf(computeTco({ vehicle_count: 0, ownership_years: 0, annual_km: 0 }))
    expect(r.costPerKm).toBeNull()
    expect(r.tcoPerVehicle).toBeNull()
    expect(r.tcoPerYear).toBeNull()
    expect(r.costPerVehicleKm).toBeNull()
  })
  it('passes real ratios through', () => {
    const r = honestWhatIf(computeTco({}))
    expect(r.costPerKm).toBeGreaterThan(0)
    expect(r.tcoPerVehicle).toBeGreaterThan(0)
  })
})

describe('savingsView', () => {
  it('share is null when every initiative is 0 and per-vehicle null with no vehicles', () => {
    const v = savingsView({ vehicleCount: 0, perVehicle: 0, initiatives: [{ initiative: 'A', annual: 0 }] })
    expect(v.perVehicle).toBeNull()
    expect(v.initiatives[0].sharePct).toBeNull()
  })
  it('shares are relative to the largest initiative', () => {
    const v = savingsView({ vehicleCount: 2, perVehicle: 50, initiatives: [{ annual: 100 }, { annual: 50 }] }, { measuredCost: false })
    expect(v.initiatives.map((i) => i.sharePct)).toEqual([100, 50])
    expect(v.measuredCost).toBe(false)
  })
  it('detects measured tyre cost', () => {
    expect(hasMeasuredTyreCost([{ cost_per_tyre: 0 }, { cost_per_tyre: null }])).toBe(false)
    expect(hasMeasuredTyreCost([{ cost_per_tyre: '850' }])).toBe(true)
  })
})

const assets = [
  { asset_no: 'TM1', vehicle_type: 'Semi Trailer', km: 1000, band: 'good', cost_per_km: 0.5, percentile: 60, tyre_procurement: 500, tyre_count: 2 },
  { asset_no: 'TM2', vehicle_type: 'Bus', km: 0, band: null, cost_per_km: null, percentile: null, tyre_procurement: 800, tyre_count: 1 },
  { asset_no: 'TM3', vehicle_type: 'Bus', km: 500, band: 'critical', cost_per_km: 2, percentile: 1, tyre_procurement: 1000, tyre_count: 3 },
]

describe('assets', () => {
  it('filters by band, type, km coverage and search', () => {
    expect(filterAssets(assets, { band: 'critical' })[0].asset_no).toBe('TM3')
    expect(filterAssets(assets, { band: 'none' })[0].asset_no).toBe('TM2')
    expect(filterAssets(assets, { vehicleType: 'Bus' })).toHaveLength(2)
    expect(filterAssets(assets, { km: 'without' })[0].asset_no).toBe('TM2')
    expect(filterAssets(assets, { search: 'semi' })[0].asset_no).toBe('TM1')
  })
  it('kpis count bands and km coverage; empty gives null coverage', () => {
    const k = assetKpis(assets)
    expect(k.withKm).toBe(2)
    expect(k.kmCoveragePct).toBe(67)
    expect(k.atRisk).toBe(1)
    expect(assetKpis([]).kmCoveragePct).toBeNull()
  })
  it('record km coverage is null with no records', () => {
    expect(recordKmCoverage([])).toBeNull()
    expect(recordKmCoverage([{ km_at_fitment: 1, km_at_removal: 5 }, {}])).toBe(50)
  })
  it('exports use N/A for unmeasured', () => {
    const ex = assetExportRows(assets)
    expect(ex[1].km).toBe('N/A')
    expect(ex[1].band).toBe('N/A')
    expect(ex[0].percentile).toBe('P60')
    expect(vehicleTypeOptions(assets)).toEqual(['Bus', 'Semi Trailer'])
    expect(benchmarkExportRows([{ type: 'X', benchmarkCpk: 1, actualCpk: null, assetCount: 0, variancePct: null }])[0].actualCpk).toBe('N/A')
    expect(bandLegend().at(-1).band).toBe('critical')
  })
})
