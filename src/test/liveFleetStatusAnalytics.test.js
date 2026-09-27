import { describe, it, expect } from 'vitest'
import {
  healthScore, scoreBand, daysSince, enrichVehicles, fleetKpis, filterVehicles,
  topAttention, weekBounds, upcomingInspections, riskBreakdown, exportRows,
} from '../lib/liveFleetStatusAnalytics'

const NOW = new Date(2026, 8, 16, 12) // Wed 16 Sep 2026

describe('liveFleetStatusAnalytics', () => {
  it('scores tyre health and returns null (not 0) with no tyres', () => {
    expect(healthScore([])).toBeNull()
    expect(healthScore([{ risk_level: 'Critical' }, { risk_level: 'High' }])).toBe(60)
    expect(healthScore(Array(5).fill({ risk_level: 'Critical' }))).toBe(0)
    expect(scoreBand(null)).toBe('noData')
    expect(scoreBand(85)).toBe('operational')
    expect(scoreBand(39)).toBe('critical')
  })

  it('computes days since with an injectable now', () => {
    expect(daysSince('2026-09-06', NOW)).toBe(10)
    expect(daysSince(null, NOW)).toBeNull()
    expect(daysSince('not a date', NOW)).toBeNull()
  })

  const src = {
    fleet: [
      { asset_no: 'TM1', site: 'NHC' },
      { asset_no: 'TM2', site: 'JED' },
      { asset_no: 'TM3', site: 'NHC' },
    ],
    tyres: [
      { asset_no: 'TM1', risk_level: 'Critical' },
      { asset_no: 'TM2', risk_level: 'Low' },
    ],
    inspections: [
      { asset_no: 'TM1', scheduled_date: '2026-08-01', status: 'Overdue' },
      { asset_no: 'TM2', scheduled_date: '2026-09-15', status: 'Scheduled' },
    ],
    alerts: [{ asset_no: 'TM1', is_active: true }],
  }

  it('enriches vehicles and keeps no-data vehicles out of operational', () => {
    const v = enrichVehicles(src, { now: NOW })
    const byNo = Object.fromEntries(v.map((x) => [x.asset_no, x]))
    expect(byNo.TM1).toMatchObject({ score: 75, criticalCount: 1, isOverdue: true, alertCount: 1, inspectionStale: true })
    expect(byNo.TM3.score).toBeNull()
    const k = fleetKpis(v, src.alerts)
    expect(k).toMatchObject({ total: 3, operational: 1, atRisk: 1, noData: 1, overdue: 1, activeAlerts: 1 })
    expect(k.avgScore).toBe(87.5)
  })

  it('filters by status and sorts no-data last', () => {
    const v = enrichVehicles(src, { now: NOW })
    expect(filterVehicles(v, { status: 'No data' }).map((x) => x.asset_no)).toEqual(['TM3'])
    expect(filterVehicles(v, { status: 'Operational' }).map((x) => x.asset_no)).toEqual(['TM2'])
    expect(filterVehicles(v).map((x) => x.asset_no)).toEqual(['TM1', 'TM2', 'TM3'])
    expect(filterVehicles(v, { search: 'jed' })).toHaveLength(1)
    expect(topAttention(v).map((x) => x.asset_no)).toEqual(['TM1'])
  })

  it('bounds this week and lists its inspections', () => {
    expect(weekBounds(NOW)).toEqual({ start: '2026-09-13', end: '2026-09-19' })
    expect(upcomingInspections(src.inspections, { now: NOW }).map((i) => i.asset_no)).toEqual(['TM2'])
  })

  it('breaks risk down and exports N/A for unmeasured values', () => {
    expect(riskBreakdown([{ risk_level: 'High' }, {}])).toMatchObject({ High: 1, none: 1 })
    const rows = exportRows(enrichVehicles(src, { now: NOW }))
    const tm3 = rows.find((r) => r.asset_no === 'TM3')
    expect(tm3).toMatchObject({ score: 'N/A', status: 'No data', last_inspection: 'None', days_since_inspection: 'N/A' })
  })
})
