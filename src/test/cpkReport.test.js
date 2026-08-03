import { describe, it, expect } from 'vitest'
import {
  REPORT_SECTIONS, PER_VEHICLE_COLUMNS, BY_TYPE_COLUMNS,
  buildCpkReport, cpkReportExportRows, rankByCpkTotal, coverageSummary,
  isCpkNull, fmtCpk, fmtMoney, fmtInt,
} from '../lib/cpkReport'

const perVehicle = [
  { asset_no: 'TM01', vehicle_type: 'Mixer', unit: 'km', distance_or_hours: 10000, tyre_cost: 5000, maintenance_cost: 2000, total_cost: 7000, cpk_tyre: 0.5, cpk_total: 0.7 },
  { asset_no: 'TM02', vehicle_type: 'Mixer', unit: 'km', distance_or_hours: 20000, tyre_cost: 4000, maintenance_cost: 1000, total_cost: 5000, cpk_tyre: 0.2, cpk_total: 0.25 },
  { asset_no: 'GN01', vehicle_type: 'Generator', unit: 'engine_hours', distance_or_hours: 0, tyre_cost: 0, maintenance_cost: 900, total_cost: 900, cpk_tyre: null, cpk_total: null },
  { asset_no: 'TM03', vehicle_type: 'Mixer', unit: 'km', distance_or_hours: 5000, tyre_cost: 8000, maintenance_cost: 3000, total_cost: 11000, cpk_tyre: 1.6, cpk_total: 2.2 },
]
const byType = [
  { vehicle_type: 'Mixer', unit: 'km', distance_or_hours: 35000, tyre_cost: 17000, maintenance_cost: 6000, total_cost: 23000, cpk_tyre: 0.48, cpk_total: 0.65 },
  { vehicle_type: 'Generator', unit: 'engine_hours', distance_or_hours: 0, tyre_cost: 0, maintenance_cost: 900, total_cost: 900, cpk_tyre: null, cpk_total: null },
]
const fleet = [
  { country: 'KSA', currency: 'SAR', cpk_tyre: 0.45, cpk_total: 0.63, coverage_pct: 75, unregistered_cost: 1200 },
]

describe('formatters honour null CPK as N/A (never 0)', () => {
  it('isCpkNull / fmtCpk', () => {
    expect(isCpkNull(null)).toBe(true)
    expect(isCpkNull(undefined)).toBe(true)
    expect(isCpkNull(0)).toBe(false)
    expect(fmtCpk(null, 'SAR')).toBe('N/A')
    expect(fmtCpk(0.5, 'SAR')).toBe('SAR 0.5000')
  })
  it('fmtMoney / fmtInt use thousands separators and N/A', () => {
    expect(fmtMoney(12345, 'SAR')).toBe('SAR 12,345')
    expect(fmtMoney(null, 'SAR')).toBe('N/A')
    expect(fmtInt(10000)).toBe('10,000')
    expect(fmtInt(null)).toBe('N/A')
  })
})

describe('section toggles include/exclude', () => {
  it('includes only requested sections in canonical order', () => {
    const rep = buildCpkReport({ perVehicle, byType, fleet, sections: ['per_vehicle', 'fleet_summary'] })
    expect(rep.sections.map((s) => s.key)).toEqual(['fleet_summary', 'per_vehicle'])
  })
  it('excludes a section not requested', () => {
    const rep = buildCpkReport({ perVehicle, byType, fleet, sections: ['fleet_summary'] })
    expect(rep.sections.find((s) => s.key === 'by_type')).toBeUndefined()
  })
  it('defaults to the defaultOn sections when none passed', () => {
    const rep = buildCpkReport({ perVehicle, byType, fleet })
    const want = REPORT_SECTIONS.filter((s) => s.defaultOn).map((s) => s.key)
    expect(rep.sections.map((s) => s.key)).toEqual(want)
  })
})

describe('column selection', () => {
  it('per-vehicle table carries only the selected columns, in catalog order', () => {
    const rep = buildCpkReport({
      perVehicle, byType, fleet,
      sections: ['per_vehicle'],
      columns: { perVehicle: ['cpk_total', 'asset_no'] },
    })
    const t = rep.sections.find((s) => s.key === 'per_vehicle')
    expect(t.columns.map((c) => c.key)).toEqual(['asset_no', 'cpk_total'])
    expect(t.rows[0].cells.map((c) => c.key)).toEqual(['asset_no', 'cpk_total'])
  })
  it('empty column selection falls back to full catalog', () => {
    const rep = buildCpkReport({ perVehicle, byType, fleet, sections: ['by_type'], columns: { byType: [] } })
    const t = rep.sections.find((s) => s.key === 'by_type')
    expect(t.columns.map((c) => c.key)).toEqual(BY_TYPE_COLUMNS.map((c) => c.key))
  })
})

describe('worst / best exclude nulls and order correctly', () => {
  it('worst = highest cpk_total first, nulls excluded', () => {
    const worst = rankByCpkTotal(perVehicle, 'desc', 10)
    expect(worst.map((r) => r.asset_no)).toEqual(['TM03', 'TM01', 'TM02'])
    expect(worst.find((r) => r.asset_no === 'GN01')).toBeUndefined()
  })
  it('best = lowest cpk_total first, nulls never ranked best', () => {
    const best = rankByCpkTotal(perVehicle, 'asc', 10)
    expect(best[0].asset_no).toBe('TM02')
    expect(best.some((r) => r.cpk_total == null)).toBe(false)
  })
  it('topN limits the subset', () => {
    const rep = buildCpkReport({ perVehicle, byType, fleet, sections: ['worst_cpk'], topN: 2 })
    const t = rep.sections.find((s) => s.key === 'worst_cpk')
    expect(t.rows).toHaveLength(2)
    expect(t.rows[0].raw.asset_no).toBe('TM03')
  })
})

describe('N/A handling in rendered cells', () => {
  it('a null cpk renders N/A, a zero-distance renders N/A distance not 0', () => {
    const rep = buildCpkReport({ perVehicle, byType, fleet, sections: ['by_type'] })
    const t = rep.sections.find((s) => s.key === 'by_type')
    const gen = t.rows.find((r) => r.raw.vehicle_type === 'Generator')
    const cpkCell = gen.cells.find((c) => c.key === 'cpk_total')
    const distCell = gen.cells.find((c) => c.key === 'distance_or_hours')
    expect(cpkCell.display).toBe('N/A')
    expect(distCell.display).toBe('N/A')
  })
  it('fleet_summary tiles show N/A when coverage_pct absent', () => {
    const rep = buildCpkReport({ perVehicle, byType, fleet: [{ currency: 'SAR' }], sections: ['fleet_summary'] })
    const k = rep.sections.find((s) => s.key === 'fleet_summary')
    expect(k.tiles.find((t) => t.label === 'Meter coverage').value).toBe('N/A')
  })
})

describe('coverageSummary', () => {
  it('counts measured vs unmeasured assets', () => {
    const c = coverageSummary(fleet, perVehicle)
    expect(c.total_assets).toBe(4)
    expect(c.measured_assets).toBe(3)
    expect(c.unmeasured_assets).toBe(1)
    expect(c.coverage_pct).toBe(75)
    expect(c.unregistered_cost).toBe(1200)
  })
})

describe('cpkReportExportRows shape', () => {
  it('emits a section column and flattens kpis + tables', () => {
    const rep = buildCpkReport({ perVehicle, byType, fleet, sections: ['fleet_summary', 'per_vehicle'], columns: { perVehicle: ['asset_no', 'cpk_total'] } })
    const rows = cpkReportExportRows(rep)
    expect(rows.every((r) => 'section' in r)).toBe(true)
    const kpi = rows.find((r) => r.metric === 'Fleet CPK (tyre)')
    expect(kpi.section).toBe('Fleet summary')
    const tableRow = rows.find((r) => r.asset_no === 'TM01')
    expect(tableRow.section).toBe('Per vehicle')
    expect(tableRow.cpk_total).toBe(0.7)
  })
  it('table export keeps N/A for null cpk and rounds money', () => {
    const rep = buildCpkReport({ perVehicle, byType, fleet, sections: ['by_type'] })
    const rows = cpkReportExportRows(rep)
    const gen = rows.find((r) => r.vehicle_type === 'Generator')
    expect(gen.cpk_total).toBe('N/A')
    const mixer = rows.find((r) => r.vehicle_type === 'Mixer')
    expect(mixer.total_cost).toBe(23000)
  })
})

describe('currency is never blended', () => {
  it('uses fleet[0].currency and only formats given rows', () => {
    const rep = buildCpkReport({ perVehicle, byType, fleet })
    expect(rep.currency).toBe('SAR')
    const t = rep.sections.find((s) => s.key === 'per_vehicle')
    const moneyCell = t.rows[0].cells.find((c) => c.key === 'total_cost')
    expect(moneyCell.display.startsWith('SAR ')).toBe(true)
  })
  it('explicit currency arg overrides', () => {
    const rep = buildCpkReport({ perVehicle, byType, fleet, currency: 'AED' })
    expect(rep.currency).toBe('AED')
  })
})

describe('catalogs expose money flags', () => {
  it('PER_VEHICLE_COLUMNS and BY_TYPE_COLUMNS mark money columns', () => {
    expect(PER_VEHICLE_COLUMNS.find((c) => c.key === 'total_cost').money).toBe(true)
    expect(BY_TYPE_COLUMNS.find((c) => c.key === 'tyre_cost').money).toBe(true)
    expect(PER_VEHICLE_COLUMNS.find((c) => c.key === 'asset_no').money).toBeFalsy()
  })
})
