import { describe, it, expect } from 'vitest'
import {
  daysSince, inspectionStatus, treadClass, pressureFlag, treadStats, pressureStats,
  inspectionCompliance, overallScore, scoreBand, criticalCount, fullyCompliantVehicles,
  monthlyTreadTrend, treadDistribution, treadBySite, pressureBySite, inspectionBySite,
  nonCompliantTyres, pressureExceptions,
} from '../lib/complianceDashboardAnalytics'

const NOW = new Date('2026-09-15T12:00:00Z')

const tyres = [
  { id: 1, asset_no: 'A', site: 'NHC', tread_depth: 1.2, pressure_reading: 100, risk_level: 'High', issue_date: '2026-09-01' },
  { id: 2, asset_no: 'A', site: 'NHC', tread_depth: 8, pressure_reading: 150, issue_date: '2026-09-02' },
  { id: 3, asset_no: 'B', site: 'JED', tread_depth: 2.5, pressure_reading: null, issue_date: '2026-08-02' },
  { id: 4, asset_no: 'C', site: 'JED', tread_depth: null, pressure_reading: 0, risk_level: 'Critical' },
  { id: 5, asset_no: 'D', site: 'JED', tread_depth: 6, pressure_reading: 110, issue_date: '2026-09-03' },
]

describe('per-tyre classification', () => {
  it('tread and pressure classes', () => {
    expect(tyres.map(treadClass)).toEqual(['legal_fail', 'ok', 'below_min', 'no_data', 'ok'])
    expect(tyres.map(pressureFlag)).toEqual(['OK', 'Anomaly', 'No Data', 'No Data', 'OK'])
  })
  it('inspection status bands', () => {
    expect(inspectionStatus(null)).toBe('no_data')
    expect(inspectionStatus(30)).toBe('compliant')
    expect(inspectionStatus(45)).toBe('due_soon')
    expect(inspectionStatus(46)).toBe('overdue')
    expect(daysSince('2026-09-05T12:00:00Z', NOW)).toBe(10)
    expect(daysSince(null, NOW)).toBeNull()
  })
})

describe('area statistics', () => {
  it('tread stats over measured tyres', () => {
    const s = treadStats(tyres)
    expect(s).toMatchObject({ total: 5, withData: 4, compliant: 2, legalFail: 1, fleetFail: 2, noData: 1 })
    expect(s.pct).toBeCloseTo(50)
  })
  it('pressure stats over tyres with a reading', () => {
    const s = pressureStats(tyres)
    expect(s).toMatchObject({ withReading: 3, compliant: 2, anomalies: 1, noReading: 2 })
    expect(s.pct).toBeCloseTo(66.667, 2)
  })
  it('nothing measured is null, never 0', () => {
    expect(treadStats([{ tread_depth: null }]).pct).toBeNull()
    expect(pressureStats([{}]).pct).toBeNull()
    expect(inspectionCompliance([], [], NOW).pct).toBeNull()
  })
  it('inspection compliance against the scoped register', () => {
    const r = inspectionCompliance(
      [
        { asset_no: 'A', scheduled_date: '2026-09-10', site: 'NHC', inspector: 'X' },
        { asset_no: 'A', scheduled_date: '2026-06-01' },
        { asset_no: 'B', scheduled_date: '2026-07-01' },
      ],
      [{ asset_no: 'A', vehicle_type: 'TM' }, { asset_no: 'B' }, { asset_no: 'C', site: 'JED' }],
      NOW,
    )
    expect(r.total).toBe(3)
    expect(r.compliant).toBe(1)
    expect(r.overdue).toBe(1)
    expect(r.noData).toBe(1)
    expect(r.rows[0].status).toBe('overdue')
    expect(r.rows.find(x => x.asset_no === 'A')).toMatchObject({ vehicle_type: 'TM', next_due: '2026-10-10', days_since: 5 })
    expect(r.rows.find(x => x.asset_no === 'C').vehicle_type).toBeNull()
  })
})

describe('overall score', () => {
  it('re-normalises over measured areas', () => {
    expect(overallScore({ tread: 80, pressure: 60, inspection: 100 }).score).toBe(80)
    const two = overallScore({ tread: 80, pressure: null, inspection: 50 })
    expect(two.score).toBe(Math.round((80 * 0.4 + 50 * 0.3) / 0.7))
    expect(two.missing).toEqual(['pressure'])
    const none = overallScore({ tread: null, pressure: null, inspection: null })
    expect(none.score).toBeNull()
    expect(scoreBand(null)).toBe('unknown')
    expect(scoreBand(85)).toBe('good')
    expect(scoreBand(65)).toBe('marginal')
    expect(scoreBand(10)).toBe('poor')
  })
})

describe('breakdowns', () => {
  it('counts, vehicles and trend', () => {
    expect(criticalCount(tyres)).toBe(1)
    // A has a legal failure, B below min, C critical, D passes
    expect(fullyCompliantVehicles(tyres)).toBe(1)
    const t = monthlyTreadTrend(tyres, NOW)
    expect(t.months[5]).toBe('2026-09')
    expect(t.values[5]).toBeCloseTo(66.667, 2)
    expect(t.values[4]).toBe(0)
    expect(t.values[0]).toBeNull()
    expect(t.trend).toBeCloseTo(66.667, 2)
  })
  it('distribution and by-site denominators exclude unmeasured tyres', () => {
    expect(treadDistribution(tyres).map(b => b.count)).toEqual([1, 1, 0, 1, 1])
    expect(treadBySite(tyres).find(s => s.site === 'JED')).toMatchObject({ ok: 1, total: 2 })
    const p = pressureBySite(tyres)
    expect(p.find(s => s.site === 'JED')).toMatchObject({ ok: 1, total: 1 })
    expect(pressureBySite([{ site: 'X', pressure_reading: null }])).toEqual([])
  })
  it('exception lists', () => {
    const nc = nonCompliantTyres(tyres, NOW)
    expect(nc.map(r => r.id)).toEqual([4, 1, 3])
    expect(nc.find(r => r.id === 1).days_in_service).toBe(14)
    expect(pressureExceptions(tyres).map(r => r.pressureFlag)).toEqual(['Anomaly', 'No Data', 'No Data'])
    expect(inspectionBySite([{ site: 'N', status: 'overdue' }, { site: 'N', status: 'compliant' }, { site: null, status: 'overdue' }]))
      .toEqual([{ site: 'N', compliant: 1, due_soon: 0, overdue: 1, no_data: 0 }])
  })
})
