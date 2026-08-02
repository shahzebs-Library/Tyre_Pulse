import { describe, it, expect } from 'vitest'
import {
  fmtCpkValue, fmtDistance, fmtMoney, fmtCoverage, unitSuffix,
  sortByTypeWorstFirst, filterPerVehicle, fleetTiles, byTypeExportRows,
} from '../lib/fleetCpkView'

describe('fleetCpkView - formatting', () => {
  it('renders N/A for a null CPK (no denominator), never a fake 0', () => {
    expect(fmtCpkValue(null, 'SAR', 'km')).toBe('N/A')
    expect(fmtCpkValue(undefined, 'SAR', 'engine_hours')).toBe('N/A')
    expect(fmtCpkValue(1.23456, 'SAR', 'km')).toBe('SAR 1.2346/km')
    expect(fmtCpkValue(2.5, 'AED', 'engine_hours')).toBe('AED 2.5000/hour')
  })

  it('unit suffix follows km vs plant', () => {
    expect(unitSuffix('km')).toBe('/km')
    expect(unitSuffix('engine_hours')).toBe('/hour')
    expect(unitSuffix('anything')).toBe('/km')
  })

  it('distance renders with unit label; 0 -> N/A', () => {
    expect(fmtDistance(12000, 'km')).toBe('12,000 km')
    expect(fmtDistance(450, 'engine_hours')).toBe('450 hour')
    expect(fmtDistance(0, 'km')).toBe('N/A')
  })

  it('money and coverage format honestly', () => {
    expect(fmtMoney(1234.7, 'SAR')).toBe('SAR 1,235')
    expect(fmtCoverage(83.4)).toBe('83%')
    expect(fmtCoverage(null)).toBe('N/A')
  })
})

describe('fleetCpkView - sorting and filtering', () => {
  it('sorts by-type worst CPK first, nulls last', () => {
    const rows = [
      { vehicle_type: 'A', cpk_total: 0.5, total_cost: 10 },
      { vehicle_type: 'B', cpk_total: null, total_cost: 999 },
      { vehicle_type: 'C', cpk_total: 2.0, total_cost: 5 },
    ]
    const out = sortByTypeWorstFirst(rows)
    expect(out.map(r => r.vehicle_type)).toEqual(['C', 'A', 'B'])
  })

  it('filters per-vehicle by asset or type and sorts by cost desc', () => {
    const rows = [
      { asset_no: 'TM10', vehicle_type: 'Mixer', total_cost: 100 },
      { asset_no: 'GN01', vehicle_type: 'Generator', total_cost: 900 },
      { asset_no: 'TM11', vehicle_type: 'Mixer', total_cost: 500 },
    ]
    const all = filterPerVehicle(rows)
    expect(all.map(r => r.asset_no)).toEqual(['GN01', 'TM11', 'TM10'])
    const mixers = filterPerVehicle(rows, 'mix')
    expect(mixers.map(r => r.asset_no)).toEqual(['TM11', 'TM10'])
  })
})

describe('fleetCpkView - fleet tiles', () => {
  it('emits a km tile and an hour tile per country, skipping empty sides', () => {
    const fleet = [
      {
        country: 'KSA', currency: 'SAR',
        km: { total: 100000, total_cost_matched: 50000, cpk_tyre: 0.2, cpk_total: 0.5, coverage_pct: 80 },
        hours: { total: 0, total_cost_matched: 0, cpk_total: null },
      },
    ]
    const tiles = fleetTiles(fleet)
    expect(tiles).toHaveLength(1)
    expect(tiles[0].unit).toBe('km')
    expect(tiles[0].currency).toBe('SAR')
    expect(tiles[0].cpkTotal).toBe(0.5)
    expect(tiles[0].coveragePct).toBe(80)
  })

  it('supports camelCase side keys too', () => {
    const fleet = [
      { country: 'UAE', currency: 'AED', hours: { total: 500, totalCostMatched: 3000, cpkTotal: 6, coveragePct: 40 } },
    ]
    const tiles = fleetTiles(fleet)
    expect(tiles).toHaveLength(1)
    expect(tiles[0].unit).toBe('engine_hours')
    expect(tiles[0].cpkTotal).toBe(6)
  })
})

describe('fleetCpkView - export rows', () => {
  it('flattens by-type to string-safe rows with N/A for null cpk', () => {
    const rows = byTypeExportRows([
      { country: 'KSA', vehicle_type: 'Mixer', unit: 'km', distance_or_hours: 1000.6, tyre_cost: 500, total_cost: 900, cpk_tyre: 0.5, cpk_total: 0.9 },
      { country: 'KSA', vehicle_type: 'Generator', unit: 'engine_hours', distance_or_hours: 0, tyre_cost: 100, total_cost: 100, cpk_tyre: null, cpk_total: null },
    ])
    expect(rows[0].cpk_total).toBe('0.9000')
    expect(rows[0].unit).toBe('km')
    const gen = rows.find(r => r.vehicle_type === 'Generator')
    expect(gen.cpk_total).toBe('N/A')
    expect(gen.unit).toBe('hour')
  })
})
