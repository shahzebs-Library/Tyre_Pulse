import { describe, it, expect } from 'vitest'
import {
  inspectionDay, isApproved, inspectionFacts, filterInspections, windowFrom, dataQuality,
  inspectionKpis, siteSummary, monthlyTrend, conditionMix, duplicateInspections,
  inspectorBoard, inspectionRecommendations, inspectionExportRows,
  INSPECTION_EXPORT_COLS, INSPECTION_EXPORT_HEADERS,
} from '../lib/inspectionIntelligenceAnalytics'

const tc = (conds, psi = []) => Object.fromEntries(conds.map((c, i) => [`P${i}`, { condition: c, pressure_psi: psi[i] ?? '' }]))
const ins = (id, o = {}) => ({
  id, asset_no: `TM${id}`, site: 'NHC', inspector: 'ALI', inspection_date: '2026-06-10',
  status: 'Done', odometer_km: 1000, tyre_conditions: tc(['Good', 'Good', 'Worn', 'Good'], [120, 120, 120, 120]), ...o,
})

const now = new Date(2026, 5, 20).getTime()
const data = [
  ins(1),
  ins(2, { status: 'In Progress', tyre_conditions: tc(['Flat', 'Good'], [60, 120]), odometer_km: null }),
  ins(3, { inspector: '', site: 'JED', inspection_date: '2026-05-01', tyre_conditions: {} }),
  ins(4, { asset_no: 'TM1' }),
  ins(5, { status: 'Cancelled' }),
]

describe('facts and filters', () => {
  it('reads both condition vocabularies by stem', () => {
    const f = inspectionFacts(data[1])
    expect(f.faults).toBe(1)
    expect(f.severe).toBe(1)
    expect(f.pressureMeasurable).toBe(false)
    expect(inspectionFacts(data[0]).uniformPressure).toBe(true)
  })
  it('dates and approval', () => {
    expect(inspectionDay({ created_at: '2026-01-02T10:00:00Z' })).toBe('2026-01-02')
    expect(isApproved({ status: 'Done' })).toBe(true)
    expect(isApproved({ status: 'In Progress' })).toBe(false)
    expect(windowFrom(10, Date.UTC(2026, 0, 11))).toBe('2026-01-01')
    expect(windowFrom(0)).toBe('')
  })
  it('filters', () => {
    expect(filterInspections(data, { site: 'JED' })).toHaveLength(1)
    expect(filterInspections(data, { status: 'pending' }).map((r) => r.id)).toEqual([2])
    expect(filterInspections(data, { from: '2026-06-01' })).toHaveLength(3)
    expect(filterInspections(data, { search: 'tm2' })).toHaveLength(1)
  })
})

describe('kpis and breakdowns', () => {
  it('computes honest KPIs excluding cancelled rows', () => {
    const k = inspectionKpis(data)
    expect(k.inspections).toBe(4)
    expect(k.approved).toBe(3)
    expect(k.approvalPct).toBe(75)
    expect(k.vehicles).toBe(3)
    expect(k.severe).toBe(1)
    expect(inspectionKpis([]).approvalPct).toBeNull()
  })
  it('site, trend, conditions, duplicates', () => {
    expect(siteSummary(data)[0].site).toBe('NHC')
    const t = monthlyTrend(data, { now, months: 2 })
    expect(t.map((m) => m.inspections)).toEqual([1, 3])
    expect(monthlyTrend([], { now, months: 1 })[0].approvalPct).toBeNull()
    const mix = conditionMix(data)
    expect(mix.critical).toBe(1)
    expect(mix.warning).toBe(2)
    const d = duplicateInspections(data)
    expect(d).toHaveLength(1)
    expect(d[0].asset_no).toBe('TM1')
  })
  it('data quality names each failing check', () => {
    const dq = dataQuality(data, new Set(['TM1', 'TM2']))
    const by = Object.fromEntries(dq.checks.map((c) => [c.key, c]))
    expect(by.inspector.failing).toBe(1)
    expect(by.meter.failing).toBe(1)
    expect(by.fleet.failing).toBe(1)
    expect(dq.score).toBeGreaterThan(0)
    expect(dataQuality([]).score).toBeNull()
  })
  it('inspector board extends inspectorActivity', () => {
    const b = inspectorBoard(data, { now })
    const ali = b.find((a) => a.inspector === 'ALI')
    expect(ali.total).toBe(3)
    expect(ali.faultsReported).toBeGreaterThan(0)
  })
  it('recommendations and exports', () => {
    const recs = inspectionRecommendations({
      kpis: inspectionKpis(data), coverage: { vehicles: 10, never: 2, notDone: 5, coveragePct: 50 },
      dq: dataQuality(data), duplicates: duplicateInspections(data), board: [],
    })
    expect(recs[0].priority).toBe('Critical')
    for (const r of recs) expect(r.message).not.toMatch(/[–—]/)
    expect(INSPECTION_EXPORT_COLS).toHaveLength(INSPECTION_EXPORT_HEADERS.length)
    expect(inspectionExportRows(data)).toHaveLength(4)
  })
})
