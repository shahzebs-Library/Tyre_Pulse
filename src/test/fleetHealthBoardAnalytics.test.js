import { describe, it, expect } from 'vitest'
import {
  tyreHealth, vehicleHealthScore, worstRisk, riskCounts, avgTread, groupVehicles, enrichVehicle,
  matchesRiskFilter, matchesSearch, isVehicleHealthy, fleetHealthSummary, monthlyHealthTrend,
  criticalVehicles, assetRiskTrend, daysSince, vehicleExportRows,
} from '../lib/fleetHealthBoardAnalytics'

describe('fleetHealthBoardAnalytics', () => {
  it('an unassessed tyre and vehicle score null, never 50', () => {
    expect(tyreHealth({})).toBeNull()
    expect(vehicleHealthScore([{}, {}])).toBeNull()
    expect(tyreHealth({ risk_level: 'Low' })).toBe(100)
    expect(tyreHealth({ tread_depth: 4 })).toBe(50)
    expect(tyreHealth({ risk_level: 'Critical', tread_depth: 8 })).toBeCloseTo(30)
  })

  it('worst risk and counts ignore unrated tyres', () => {
    const t = [{ risk_level: 'Low' }, { risk_level: 'High' }, {}]
    expect(worstRisk(t)).toBe('High')
    expect(worstRisk([{}])).toBeNull()
    expect(riskCounts(t)).toEqual({ Critical: 0, High: 1, Medium: 0, Low: 1, unrated: 1 })
    expect(avgTread([{}, { tread_depth: 4 }, { tread_depth: 6 }])).toBe(5)
    expect(avgTread([{}])).toBeNull()
  })

  it('groups and enriches vehicles', () => {
    const map = groupVehicles([{ asset_no: 'A', issue_date: '2026-01-01', risk_level: 'Low' }, { asset_no: 'A', issue_date: '2026-03-01' }, { asset_no: null }])
    expect(map.size).toBe(1)
    const v = enrichVehicle(map.get('A'))
    expect(v).toMatchObject({ worst: 'Low', rated: 1, lastIssue: '2026-03-01' })
  })

  it('filters and search', () => {
    expect(matchesRiskFilter(null, 'Unrated')).toBe(true)
    expect(matchesRiskFilter('High', 'Medium')).toBe(true)
    expect(matchesRiskFilter('Low', 'High')).toBe(false)
    expect(matchesSearch({ asset_no: 'TM514', site: 'NHC' }, 'nhc')).toBe(true)
    expect(matchesSearch({ asset_no: 'TM514' }, 'x')).toBe(false)
  })

  it('fleet health is null when nothing is rated', () => {
    expect(isVehicleHealthy({ tyres: [{}] })).toBeNull()
    expect(isVehicleHealthy({ tyres: [{ risk_level: 'High' }] })).toBe(false)
    const s = fleetHealthSummary({ total: 2, criticalVehicles: 0, healthyVehicles: 0, ratedVehicles: 0, scopedTyres: [{}] })
    expect(s.fleetHealth).toBeNull()
    expect(s.atRiskCount).toBeNull()
    expect(s.avgTread).toBeNull()
    const s2 = fleetHealthSummary({ total: 2, criticalVehicles: 1, healthyVehicles: 1, ratedVehicles: 2, scopedTyres: [{ risk_level: 'Critical', tread_depth: 2 }] })
    expect(s2).toMatchObject({ fleetHealth: 50, atRiskCount: 1, avgTread: 2 })
  })

  it('monthly trend leaves unrated months as gaps', () => {
    const anchor = new Date(2026, 8, 1)
    const { months, values } = monthlyHealthTrend([
      { asset_no: 'A', issue_date: '2026-09-02', risk_level: 'Low' },
      { asset_no: 'B', issue_date: '2026-09-03', risk_level: 'High' },
      { asset_no: 'C', issue_date: '2026-08-03' },
    ], anchor)
    expect(months[11]).toBe('2026-09')
    expect(values[11]).toBe(50)
    expect(values[10]).toBeNull()
  })

  it('critical list sorts lowest tread first, unknown last', () => {
    const rows = criticalVehicles([
      { asset_no: 'A', tyres: [{ risk_level: 'Critical' }] },
      { asset_no: 'B', tyres: [{ risk_level: 'Critical', tread_depth: 2 }] },
      { asset_no: 'C', tyres: [{ risk_level: 'Low' }] },
    ])
    expect(rows.map(r => r.asset_no)).toEqual(['B', 'A'])
    expect(rows[1].worstTread).toBeNull()
  })

  it('asset trend, days since and export rows', () => {
    const pts = assetRiskTrend([{ asset_no: 'A', issue_date: '2026-02-01', risk_level: 'Low' }, { asset_no: 'A', issue_date: '2026-01-01' }], 'A')
    expect(pts).toEqual([{ date: '2026-02-01', value: 100 }])
    expect(daysSince('2026-09-01', new Date('2026-09-11T00:00:00Z'))).toBe(10)
    expect(daysSince(null)).toBeNull()
    const v = enrichVehicle({ asset_no: 'A', tyres: [{}] })
    expect(vehicleExportRows([v])[0]).toMatchObject({ health: 'Not assessed', worst: 'Not rated', avgTread: 'N/A', site: 'N/A' })
  })
})
