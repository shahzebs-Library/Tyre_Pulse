/**
 * ENG-1: one metric, one name, one definition, one source function.
 *
 * The figures below are the live read-only measurements of 2026-11-12 for the
 * twelve months to 2026-10-31. They are here as a worked example of WHY the
 * four measurements must never share the name "cost per km": for the same
 * country and year they differ 12.6 times.
 */
import { describe, it, expect } from 'vitest'
import {
  CPK_METRIC, CPK_METRICS, metricDef, metricLabel, metricShort, sanitizeFleetCpk,
  rowRate, rowRateMetric, tyreRateMetric, totalRateMetric, glossaryRows,
  TOTAL_PER_TYRE_KM_WITHHELD, TYRE_SPEND_RATIO_BASIS,
} from '../lib/cpkMetrics'
import { fleetTiles, tileCells, tileBasis, sortByTypeWorstFirst, byTypeExportRows, fmtCpkValue, rateHeaders } from '../lib/fleetCpkView'
import { fleetSideFor } from '../lib/cpkModule'
import { overviewKpis, assetTypeRows, rateBars } from '../lib/cpkOverviewView'
import { cpkView } from '../lib/costCpk'
import { cpkTypeRows as boardTypeRows } from '../lib/boardOverviewAnalytics'
import { cpkTypeRows as expenseTypeRows, cpkTypeSummary, aggregateTyres } from '../lib/expenseReportAnalytics'
import { rankByCpkTotal, buildCpkReport } from '../lib/cpkReport'

// get_fleet_cpk('KSA', 2025-11-01, 2026-10-31), fleet[0], as the server returns it
const KSA_FLEET = {
  country: 'KSA', currency: 'SAR', tyre_cost: 3191777.7, maintenance_cost: 3276413.78,
  km: { cpk_tyre: 0.0168, cpk_total: 0.0235, total_km: 146144345, coverage_pct: 65.2, tyre_cost_matched: 2455880.94, total_cost_matched: 3432503.16 },
  hours: { cpk_tyre: 2.2723, cpk_total: 4.9701, total_hours: 229204.6, coverage_pct: 32.8, tyre_cost_matched: 520811.74, total_cost_matched: 1139163.31 },
}
const RAW = {
  perVehicle: [
    { asset_no: 'TM001', vehicle_type: 'TR-MIXER', unit: 'km', distance_or_hours: 400000, tyre_cost: 8000, maintenance_cost: 12000, total_cost: 20000, cpk_tyre: 0.02, cpk_total: 0.05 },
    { asset_no: 'WL001', vehicle_type: 'WHEEL_LOADER', unit: 'engine_hours', distance_or_hours: 1000, tyre_cost: 3000, maintenance_cost: 2000, total_cost: 5000, cpk_tyre: 3, cpk_total: 5 },
  ],
  byType: [
    { vehicle_type: 'TR-MIXER', unit: 'km', distance_or_hours: 400000, tyre_cost: 8000, maintenance_cost: 12000, total_cost: 20000, cpk_tyre: 0.02, cpk_total: 0.05 },
    { vehicle_type: 'WHEEL_LOADER', unit: 'engine_hours', distance_or_hours: 1000, tyre_cost: 3000, maintenance_cost: 2000, total_cost: 5000, cpk_tyre: 3, cpk_total: 5 },
    { vehicle_type: 'BUS', unit: 'km', distance_or_hours: 0, tyre_cost: 100, maintenance_cost: 0, total_cost: 100, cpk_tyre: null, cpk_total: null },
  ],
  fleet: [KSA_FLEET],
}

describe('metric glossary', () => {
  it('every metric has a name, a definition, a formula and a source on both sides', () => {
    expect(Object.keys(CPK_METRICS).sort()).toEqual(Object.values(CPK_METRIC).sort())
    for (const m of Object.values(CPK_METRICS)) {
      expect(m.name, m.id).toBeTruthy()
      expect(m.definition.length, m.id).toBeGreaterThan(40)
      expect(m.formula, m.id).toMatch(/\//)
      expect(m.source.js, m.id).toBeTruthy()
      expect(m.source.sql, m.id).toBeTruthy()
    }
  })
  it('no two metrics share a name or a short name', () => {
    const names = Object.values(CPK_METRICS).map((m) => m.name)
    const shorts = Object.values(CPK_METRICS).map((m) => m.short)
    expect(new Set(names).size).toBe(names.length)
    expect(new Set(shorts).size).toBe(shorts.length)
  })
  it('only the lifetime and fitment figures are called CPK', () => {
    const cpkNamed = Object.values(CPK_METRICS).filter((m) => /\bCPK\b/.test(m.name)).map((m) => m.id).sort()
    expect(cpkNamed).toEqual([CPK_METRIC.TYRE_CPK_FITMENT, CPK_METRIC.TYRE_CPK_LIFETIME].sort())
    expect(metricDef(CPK_METRIC.TYRE_SPEND_RATIO).definition).toMatch(/not a tyre CPK/)
  })
  it('a maintenance or operating figure is never per tyre km', () => {
    for (const id of [CPK_METRIC.MAINTENANCE_COST_PER_VEHICLE_KM, CPK_METRIC.OPERATING_COST_PER_VEHICLE_KM, CPK_METRIC.TYRE_COST_PER_VEHICLE_KM]) {
      expect(metricDef(id).per).toBe('per vehicle km')
    }
    expect(metricDef(CPK_METRIC.TYRE_CPK_LIFETIME).per).toBe('per tyre km')
    expect(totalRateMetric('km')).toBe(null)
    expect(totalRateMetric('engine_hours')).toBe(CPK_METRIC.OPERATING_COST_PER_ENGINE_HOUR)
  })
  it('labels carry the currency and the denominator', () => {
    expect(metricLabel(CPK_METRIC.TYRE_CPK_LIFETIME, 'SAR')).toBe('Tyre CPK (lifetime), SAR per tyre km')
    expect(metricShort(CPK_METRIC.OPERATING_COST_PER_VEHICLE_KM, 'AED')).toBe('Operating cost per vehicle km (AED per vehicle km)')
    expect(metricLabel('nope')).toBe('')
  })
  it('no user facing string in the glossary contains an em or en dash', () => {
    const text = JSON.stringify(CPK_METRICS) + TOTAL_PER_TYRE_KM_WITHHELD + TYRE_SPEND_RATIO_BASIS + JSON.stringify(glossaryRows())
    expect(text).not.toMatch(/[–—]/)
  })
})

describe('the 12.6 times gap, KSA, twelve months to 2026-10-31 (live read-only figures)', () => {
  // numerators and denominators as measured
  const tyreMatchedTyreKm = 2455880.94; const totalMatchedTyreKm = 3432503.16; const tyreKm = 146144345
  const tyreMatchedVehicleKm = 3082290; const maintMatchedVehicleKm = 1703401; const vehicleKm = 16165110
  const retiredPrice = 1584756.58; const retiredTyreKm = 55292625

  it('the four figures are four different divisions', () => {
    expect(tyreMatchedTyreKm / tyreKm).toBeCloseTo(0.0168, 4)                              // tyre spend ratio
    expect(totalMatchedTyreKm / tyreKm).toBeCloseTo(0.0235, 4)                             // withheld: maintenance over tyre km
    expect(retiredPrice / retiredTyreKm).toBeCloseTo(0.028661, 6)                          // Tyre CPK (lifetime)
    expect((tyreMatchedVehicleKm + maintMatchedVehicleKm) / vehicleKm).toBeCloseTo(0.2961, 4) // operating cost per vehicle km
    expect(0.296 / 0.0235).toBeCloseTo(12.6, 1)
  })
  it('operating cost per vehicle km is exactly tyre plus maintenance per vehicle km', () => {
    const tyre = tyreMatchedVehicleKm / vehicleKm
    const maint = maintMatchedVehicleKm / vehicleKm
    expect(tyre).toBeCloseTo(0.1907, 4)
    expect(maint).toBeCloseTo(0.1054, 4)
    expect(tyre + maint).toBeCloseTo((tyreMatchedVehicleKm + maintMatchedVehicleKm) / vehicleKm, 12)
  })
  it('tyre km is about nine times vehicle km (wheels), which is why the two bases cannot be mixed', () => {
    expect(tyreKm / vehicleKm).toBeGreaterThan(8)
    expect(tyreKm / vehicleKm).toBeLessThan(10)
  })
})

describe('sanitizeFleetCpk: the gate every get_fleet_cpk payload passes', () => {
  const clean = sanitizeFleetCpk(RAW)
  it('withholds the total on km rows and keeps the raw value only for traceability', () => {
    const km = clean.perVehicle[0]
    expect(km.cpk_total).toBe(null)
    expect(km.cpk_total_withheld).toBe(true)
    expect(km.legacy_total_per_tyre_km).toBe(0.05)
    expect(km.cpk_tyre).toBe(0.02)
    expect(km.rate).toBe(0.02)
    expect(km.rate_metric).toBe(CPK_METRIC.TYRE_SPEND_RATIO)
  })
  it('leaves hour rows valid: cost per machine engine hour', () => {
    const hr = clean.perVehicle[1]
    expect(hr.cpk_total).toBe(5)
    expect(hr.rate).toBe(5)
    expect(hr.rate_metric).toBe(CPK_METRIC.OPERATING_COST_PER_ENGINE_HOUR)
  })
  it('withholds the fleet km total and names the km tyre rate', () => {
    const f = clean.fleet[0]
    expect(f.km.cpk_total).toBe(null)
    expect(f.km.cpk_tyre).toBe(0.0168)
    expect(f.km.metric).toBe(CPK_METRIC.TYRE_SPEND_RATIO)
    expect(f.km.legacy_total_per_tyre_km).toBe(0.0235)
    expect(f.hours.cpk_total).toBe(4.9701)
  })
  it('is idempotent and never mutates its input', () => {
    expect(sanitizeFleetCpk(clean)).toEqual(clean)
    expect(RAW.perVehicle[0].cpk_total).toBe(0.05)
    expect(sanitizeFleetCpk(null)).toEqual({ perVehicle: [], byType: [], fleet: [] })
  })
  it('rowRate reads the tyre ratio for km and the total for hours, even on a raw row', () => {
    expect(rowRate(RAW.perVehicle[0])).toBe(0.02)
    expect(rowRate(RAW.perVehicle[1])).toBe(5)
    expect(rowRate(RAW.byType[2])).toBe(null)
    expect(rowRate(null)).toBe(null)
    expect(rowRateMetric({ unit: 'km' })).toBe(CPK_METRIC.TYRE_SPEND_RATIO)
    expect(tyreRateMetric('engine_hours')).toBe(CPK_METRIC.TYRE_COST_PER_ENGINE_HOUR)
  })
})

describe('no view helper can produce a total cost per km on the tyre km basis', () => {
  // the views are fed the RAW server payload on purpose: they must be safe on their own
  it('fleetTiles and fleetSideFor', () => {
    const [km, hr] = fleetTiles(RAW.fleet)
    expect(km.cpkTotal).toBe(null)
    expect(km.rate).toBe(0.0168)
    expect(km.rateLabel).toBe('Tyre spend ratio')
    expect(hr.cpkTotal).toBe(4.9701)
    expect(hr.rateLabel).toBe('Operating cost per hour')
    expect(fleetSideFor(KSA_FLEET, 'movable').cpkTotal).toBe(null)
    expect(fleetSideFor(KSA_FLEET, 'non_movable').cpkTotal).toBe(4.9701)
  })
  it('tile cells: one named figure for km, two for hours, with the tyre km suffix', () => {
    const [km, hr] = fleetTiles(RAW.fleet)
    expect(tileCells(km)).toEqual([{ label: 'Tyre spend ratio', value: 'SAR 0.0168 per tyre km', primary: true }])
    expect(tileCells(hr).map((c) => c.label)).toEqual(['Operating cost per hour', 'Tyre cost per hour'])
    expect(tileCells(hr)[0].value).toBe('SAR 4.9701/hour')
    expect(tileBasis(km)).toBe(TYRE_SPEND_RATIO_BASIS)
    expect(fmtCpkValue(null, 'SAR', 'km')).toBe('N/A')
    expect(rateHeaders('movable')).toEqual({ tyre: 'Tyre spend ratio', total: null })
    expect(rateHeaders('non_movable').total).toBe('Operating cost per hour')
  })
  it('overview KPIs, type rows and bars', () => {
    const k = overviewKpis(KSA_FLEET, null)
    expect(k.cpkTotal).toEqual({ value: null, trend: null, withheld: true })
    expect(k.cpkTyre.value).toBe(0.0168)
    expect(k.cph.value).toBe(4.9701)
    const rows = assetTypeRows(RAW.byType, RAW.perVehicle)
    const mixer = rows.find((r) => r.vehicle_type === 'TR-MIXER')
    expect(mixer.cpk_total).toBe(null)
    expect(mixer.rate).toBe(0.02)
    expect(rateBars(rows, 'movable').bars.map((b) => [b.label, b.value])).toEqual([['TR-MIXER', 0.02]])
    expect(rateBars(rows, 'movable').unmeasured).toEqual(['BUS'])
    expect(rateBars(rows, 'non_movable').bars[0].value).toBe(5)
  })
  it('sorting, exports and the board and expense type rows', () => {
    expect(sortByTypeWorstFirst(RAW.byType).map((r) => r.vehicle_type)).toEqual(['WHEEL_LOADER', 'TR-MIXER', 'BUS'])
    const exp = byTypeExportRows(RAW.byType)
    expect(exp.find((r) => r.vehicle_type === 'TR-MIXER').cpk_total).toBe('N/A')
    expect(exp.find((r) => r.vehicle_type === 'WHEEL_LOADER').cpk_total).toBe('5.0000')
    expect(boardTypeRows(RAW.byType).map((r) => r.cpk)).toEqual([0.02, 5, null])
    const e = expenseTypeRows(RAW.byType)
    expect(e[0].cpk_total).toBe(null)
    expect(e[0].rate).toBe(0.02)
    expect(e[1].cpk_total).toBe(5)
    expect(cpkTypeSummary(RAW.byType)).toMatchObject({ types: 3, measured: 2, unmeasured: 1, worstType: 'TR-MIXER' })
  })
  it('the custom report ranks by the valid rate and reads the fleet figures from where they are', () => {
    expect(rankByCpkTotal(RAW.perVehicle.filter((r) => r.unit === 'km')).map((r) => r.asset_no)).toEqual(['TM001'])
    const rep = buildCpkReport({ ...sanitizeFleetCpk(RAW), sections: ['fleet_summary'], currency: 'SAR' })
    const tiles = rep.sections[0].tiles
    expect(tiles[0]).toEqual({ label: 'Tyre spend ratio', value: 'SAR 0.0168' })
    expect(tiles[1]).toEqual({ label: 'Operating cost per hour', value: 'SAR 4.9701' })
  })
})

describe('Expenses and CPK: operating cost per vehicle km and its split', () => {
  const snap = (extra) => ({ currency: 'SAR', cpk: { current: { km: 16165110, cpk: 0.296, comparable: true, spend_total: 6469890, coverage_pct: 0.7397, spend_matched: 4785691, assets_measured: 353, ...extra } } })
  it('reads N/A for the split until the server returns it', () => {
    const v = cpkView(snap({}))
    expect(v.current.cpk).toBe(0.296)
    expect(v.current.cpkTyre).toBe(null)
    expect(v.current.cpkMaintenance).toBe(null)
  })
  it('carries the split once the server returns it, and the parts add up', () => {
    const v = cpkView(snap({ cpk_tyre: 0.191, cpk_maintenance: 0.105 }))
    expect(v.current.cpkTyre + v.current.cpkMaintenance).toBeCloseTo(v.current.cpk, 3)
  })
})

describe('ENG-11: site tyre cost per km in the expense chart builder uses the km rule', () => {
  it('a placeholder fitment odometer contributes no km, and quantity is on both sides', () => {
    const rows = [
      // measured: 2 tyres at 1,000 each over 40,000 km each
      { site: 'A', issue_date: '2026-01-10', qty: 2, cost_per_tyre: 1000, km_at_fitment: 10000, km_at_removal: 50000, total_km: 40000, vehicle_type: 'TRAILER' },
      // placeholder: total_km is the machine odometer and must not be a tyre life
      { site: 'B', issue_date: '2026-01-11', qty: 1, cost_per_tyre: 1000, km_at_fitment: 1, km_at_removal: 184300, total_km: 184299, vehicle_type: 'TR-MIXER' },
    ]
    const agg = aggregateTyres(rows)
    expect(agg.cpkSite).toEqual([{ label: 'A', value: 2000 / 80000 }])
  })
})
