import { describe, it, expect } from 'vitest'
import {
  buildReadings, inspectionPressureRows, filterInspections, filterReadings, pressureKpis,
  siteCompliance, groupBreakdown, psiHistogram, monthlyTrend, inspectorPressureQuality,
  repeatDeviations, pressureInsights, readingExportRows, READING_EXPORT_COLS, READING_EXPORT_HEADERS,
} from '../lib/pressureIntelligenceAnalytics'
import { computePressureCompliance } from '../lib/kpiEngine'

const wheels = (vals) => Object.fromEntries(vals.map((v, i) => [
  ['F1L', 'F1R', 'R1Lo', 'R1Ro', 'R1Li', 'R1Ri'][i],
  { position: 'x', condition: 'Good', pressure_psi: v == null ? '' : String(v) },
]))
const ins = (id, vals, o = {}) => ({ id, asset_no: `TM${id}`, site: 'NHC', inspector: 'ALI', inspection_date: '2026-06-10', status: 'Done', tyre_conditions: wheels(vals), ...o })

const data = [
  ins(1, [120, 120, 120, 120, 90, 120]),              // one low
  ins(2, [120, 120, 120, 120], { site: 'JED' }),     // uniform
  ins(3, [110, 120]),                                 // unmeasured (2 readings)
  ins(4, [100, 100, 100, 100, 100, 130], { inspection_date: '2026-05-01' }), // one high
  ins(5, [120, 120, 120, 120], { status: 'Cancelled' }),
]

describe('buildReadings', () => {
  it('reads tyre_conditions pressures and applies the vehicle-median rule', () => {
    const r = buildReadings(data)
    expect(r).toHaveLength(6 + 4 + 2 + 6)
    expect(r.filter((x) => x.status === 'under')).toHaveLength(1)
    expect(r.filter((x) => x.status === 'over')).toHaveLength(1)
    expect(r.filter((x) => x.status === 'unmeasured')).toHaveLength(2)
    expect(r.find((x) => x.status === 'under').deviationPct).toBe(-25)
    expect(r.find((x) => x.status === 'unmeasured').median).toBeNull()
    expect(r.find((x) => x.position === 'F1L').group).toBe('Steer')
  })
})

describe('pressureKpis', () => {
  it('matches kpiEngine compliance exactly', () => {
    const k = pressureKpis(data)
    const c = computePressureCompliance(data.filter((d) => d.status !== 'Cancelled'))
    expect(k.compliancePct).toBe(c.compliancePct)
    expect(k.inspections).toBe(4)
    expect(k.measuredInspections).toBe(3)
    expect(k.under).toBe(1)
    expect(k.over).toBe(1)
    expect(k.flaggedVehicles).toBe(2)
    expect(k.uniformInspections).toBe(1)
  })
  it('is null, never 0, with nothing measurable', () => {
    const k = pressureKpis([ins(9, [110])])
    expect(k.compliancePct).toBeNull()
    expect(k.medianAbsDeviationPct).toBeNull()
    expect(pressureKpis([]).medianPsi).toBeNull()
    expect(pressureKpis([]).measurableCoveragePct).toBeNull()
  })
})

describe('breakdowns', () => {
  it('site, group, histogram and trend', () => {
    expect(siteCompliance(data).map((s) => s.site).sort()).toEqual(['JED', 'NHC'])
    const g = groupBreakdown(buildReadings(data))
    expect(g.find((x) => x.group === 'Steer').readings).toBeGreaterThan(0)
    const h = psiHistogram(buildReadings(data))
    expect(h.reduce((s, b) => s + b.count, 0)).toBe(18)
    expect(psiHistogram([])).toEqual([])
    const outlier = psiHistogram([...Array.from({ length: 200 }, (_, i) => ({ pressure: 100 + (i % 30) })), { pressure: 130130 }])
    expect(outlier[outlier.length - 1].outlier).toBe(true)
    expect(outlier[outlier.length - 1].count).toBe(1)
    expect(outlier.reduce((s, b) => s + b.count, 0)).toBe(201)
    expect(outlier.length).toBeLessThanOrEqual(33)
    const t = monthlyTrend(buildReadings(data), { now: new Date(2026, 5, 20).getTime(), months: 2 })
    expect(t.map((m) => m.month)).toEqual(['2026-05', '2026-06'])
    expect(t[0].readings).toBe(6)
    expect(monthlyTrend([], { now: 0, months: 1 })[0].compliancePct).toBeNull()
  })
  it('inspector quality and per-inspection rows', () => {
    const q = inspectorPressureQuality(data)
    expect(q[0].inspector).toBe('ALI')
    expect(q[0].inspections).toBe(4)
    const rows = inspectionPressureRows(data)
    expect(rows.find((r) => r.id === 3).measured).toBe(false)
    expect(rows.find((r) => r.id === 3).flagged).toBeNull()
  })
  it('finds repeated deviations on the same wheel', () => {
    const repeat = [ins(1, [120, 120, 120, 90]), ins(2, [120, 120, 120, 85], { asset_no: 'TM1', inspection_date: '2026-06-20' })]
    const r = repeatDeviations(buildReadings(repeat))
    expect(r).toHaveLength(1)
    expect(r[0].occurrences).toBe(2)
    expect(r[0].likelyCause).toMatch(/slow leak/)
  })
})

describe('filters, insights, export', () => {
  it('filters inspections and readings', () => {
    expect(filterInspections(data, { site: 'JED' })).toHaveLength(1)
    expect(filterInspections(data, { from: '2026-06-01' })).toHaveLength(4)
    expect(filterInspections(data, { search: 'tm4' })).toHaveLength(1)
    expect(filterReadings(buildReadings(data), { status: 'under' })).toHaveLength(1)
  })
  it('insights carry no dash punctuation', () => {
    for (const i of pressureInsights(data, { minSample: 1 })) expect(i.message).not.toMatch(/[–—]/)
  })
  it('export rows match headers and use N/A', () => {
    expect(READING_EXPORT_COLS).toHaveLength(READING_EXPORT_HEADERS.length)
    const e = readingExportRows(buildReadings(data))
    expect(e.find((r) => r.statusLabel === 'Not measured').median).toBe('N/A')
  })
})
