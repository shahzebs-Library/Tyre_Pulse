import { describe, it, expect } from 'vitest'
import {
  makeBenchmarks, KPI_KEYS, periodDates, prevPeriodDates, kpiScore, ratingKey, overallScore,
  extractKpiValues, pctChange, isImprovement, deltaVsGood, targetStatus, monthlyMatrix,
  siteKpiRows, vehicleRows, kpiAlerts, kpiSummaryExportRows,
} from '../lib/kpiCommandCenterAnalytics'

const ANCHOR = new Date(2026, 8, 15)
const r = (o) => ({ asset_no: 'TM1', site: 'NHC', issue_date: '2026-09-01', ...o })

describe('kpiCommandCenterAnalytics', () => {
  it('period windows count back from the injected anchor', () => {
    expect(periodDates('30d', {}, ANCHOR)).toEqual({ from: '2026-08-16', to: '2026-09-15' })
    expect(periodDates('custom', { from: '2026-01-01', to: '2026-02-01' }, ANCHOR)).toEqual({ from: '2026-01-01', to: '2026-02-01' })
    expect(prevPeriodDates('2026-08-16', '2026-09-15')).toEqual({ from: '2026-07-17', to: '2026-08-15' })
  })

  it('an unmeasured KPI scores null, not 0 / Critical', () => {
    expect(kpiScore('failure_rate', null)).toBeNull()
    expect(ratingKey(null)).toBe('notMeasured')
    expect(kpiScore('cpk', 0.5)).toBe(100)
    expect(kpiScore('tyre_life', 150000)).toBe(100)
    expect(ratingKey(kpiScore('failure_rate', 60))).toBe('critical')
  })

  it('overallScore averages measured KPIs only', () => {
    const o = overallScore({ cpk: 0.5, tyre_life: null, failure_rate: null, scrap_rate: null, pressure_compliance: null, inspection_compliance: null })
    expect(o).toEqual({ score: 100, measured: 1, total: KPI_KEYS.length })
    expect(overallScore({}).score).toBeNull()
  })

  it('extractKpiValues returns nulls when nothing is measurable', () => {
    const v = extractKpiValues([r({})], [])
    expect(v.cpk).toBeNull()
    expect(v.tyre_life).toBeNull()
    expect(v.failure_rate).toBeNull()
    expect(v.inspection_compliance).toBeNull()
    expect(v.scrap_rate).toBe(0)
    expect(extractKpiValues([], []).scrap_rate).toBeNull()
  })

  it('pctChange and improvement are null-safe', () => {
    expect(pctChange(null, 2)).toBeNull()
    expect(pctChange(2, 0)).toBeNull()
    expect(pctChange(3, 2)).toBe(50)
    expect(isImprovement('cpk', 50)).toBe(false)
    expect(isImprovement('tyre_life', 50)).toBe(true)
    expect(isImprovement('cpk', null)).toBeNull()
    expect(deltaVsGood('failure_rate', null)).toBeNull()
    expect(deltaVsGood('failure_rate', 16)).toBe(100)
  })

  it('targetStatus', () => {
    expect(targetStatus('failure_rate', null, 8)).toBe('notMeasured')
    expect(targetStatus('failure_rate', 5, 8)).toBe('exceeded')
    expect(targetStatus('failure_rate', 7.5, 8)).toBe('onTrack')
    expect(targetStatus('failure_rate', 9, 8)).toBe('behind')
  })

  it('monthlyMatrix groups by month, keeps last 12', () => {
    const recs = Array.from({ length: 14 }, (_, i) => r({ issue_date: `2025-${String((i % 12) + 1).padStart(2, '0')}-01` }))
    recs.push(r({ issue_date: '2026-01-05' }), r({ issue_date: '2026-02-05' }))
    const m = monthlyMatrix(recs)
    expect(m).toHaveLength(12)
    expect(m[m.length - 1].month).toBe('2026-02')
    expect(m[0].failure_rate).toBeNull()
  })

  it('site and vehicle rows sort measured first', () => {
    const recs = [
      r({ site: 'A', asset_no: 'X', risk_level: 'Low' }), r({ site: 'A', asset_no: 'X', risk_level: 'High' }),
      r({ site: 'B', asset_no: 'Y' }), r({ site: 'B', asset_no: 'Y' }),
      r({ site: 'B', asset_no: 'Z' }),
    ]
    const sites = siteKpiRows(recs, [])
    // B: scrap 0% measured, failure unrated -> 100; A: failure 50% -> lower
    expect(sites.map(s => s.site)).toEqual(['B', 'A'])
    expect(sites[0].overall).toBeGreaterThan(sites[1].overall)
    const veh = vehicleRows(recs, 2)
    expect(veh.map(v => v.asset)).toEqual(['Y', 'X']) // Z has one record and is left out
    expect(veh[1].failure_rate).toBe(50)
    expect(veh[0].failure_rate).toBeNull()
    expect(veh[0].measured).toBe(1)
  })

  it('kpiAlerts ignores unmeasured KPIs and flags deterioration', () => {
    expect(kpiAlerts({ cpk: null }, [])).toEqual([])
    const matrix = [{ failure_rate: 5 }, { failure_rate: 10 }, { failure_rate: 20 }]
    const a = kpiAlerts({ failure_rate: 20 }, matrix)
    expect(a.map(x => x.type)).toEqual(['warning', 'deteriorating'])
    expect(a[1].change).toBe(300)
    expect(kpiAlerts({ cpk: 0.5 }, [])[0].type).toBe('achievement')
  })

  it('export rows say N/A for unmeasured', () => {
    const rows = kpiSummaryExportRows({ cpk: null }, {}, makeBenchmarks('SAR'))
    expect(rows[0]).toMatchObject({ value: 'N/A', score: 'N/A', rating: 'Not measured', change: 'N/A' })
    expect(makeBenchmarks('SAR').cpk.format(1.2)).toBe('SAR 1.200')
  })
})
