import { describe, it, expect } from 'vitest'
import { scoreTyres } from '../lib/fleetRisk'
import {
  measuredFactors, evidenceLevel, filterTyreRows, filterVehicleRows,
  evidenceCoverage, siteRiskRollup, bandCounts, fleetAverage,
} from '../lib/fleetRiskScoreAnalytics'

const NOW = Date.parse('2026-09-27T00:00:00Z')
const tyres = [
  { id: 1, serial_no: 'S1', asset_no: 'T1', site: 'NHC', status: 'Active', brand: 'X', tread_depth: 1.2, pressure_reading: 60, fitment_date: '2021-01-01', total_km: 90000 },
  { id: 2, serial_no: 'S2', asset_no: 'T1', site: 'NHC', status: 'Active', brand: 'Y' },
  { id: 3, serial_no: 'S3', asset_no: 'T2', site: 'JED', status: 'Active', brand: 'X', tread_depth: 9, fitment_date: '2026-06-01' },
]
const scored = scoreTyres({ tyres }, { now: NOW })

describe('fleetRiskScoreAnalytics', () => {
  it('counts only real inputs, never the imputed defaults', () => {
    const s1 = scored.find((r) => r.serial === 'S1')
    expect(measuredFactors(s1).count).toBe(4)
    expect(evidenceLevel(s1)).toBe('measured')
    const s2 = scored.find((r) => r.serial === 'S2')
    expect(measuredFactors(s2).count).toBe(0)
    expect(evidenceLevel(s2)).toBe('estimated')
    expect(evidenceLevel(scored.find((r) => r.serial === 'S3'))).toBe('partial')
  })

  it('filters tyres and vehicles', () => {
    expect(filterTyreRows(scored, { site: 'JED' })).toHaveLength(1)
    expect(filterTyreRows(scored, { evidence: 'estimated' }).map((r) => r.serial)).toEqual(['S2'])
    expect(filterTyreRows(scored, { search: 's3' })).toHaveLength(1)
    expect(filterVehicleRows([{ asset_no: 'T1', site: 'NHC', vehicle_risk_level: 'critical' }], { band: 'low' })).toHaveLength(0)
  })

  it('reports evidence coverage and null on empty', () => {
    const c = evidenceCoverage(scored)
    expect(c.levels).toEqual({ measured: 1, partial: 1, estimated: 1 })
    expect(c.tread).toBe(66.7)
    expect(evidenceCoverage([]).measuredShare).toBeNull()
  })

  it('rolls up sites worst first and keeps averages null-safe', () => {
    const s = siteRiskRollup(scored)
    expect(s[0].site).toBe('NHC')
    expect(fleetAverage([])).toBeNull()
    const counts = bandCounts(scored)
    expect(Object.keys(counts)).toEqual(['critical', 'high', 'medium', 'low'])
    expect(Object.values(counts).reduce((a, b) => a + b, 0)).toBe(3)
  })
})
