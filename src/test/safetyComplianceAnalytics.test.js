import { describe, it, expect } from 'vitest'
import {
  computeSafetyCompliance, treadFailRows, pressureRows, siteTread, monthlyTrend,
  scoreBand, riskScore, legalMinFor, rangeCutoff, filterBySite, siteOptions,
  complianceSummaryRows, toNum,
} from '../lib/safetyComplianceAnalytics'

const NOW = new Date('2026-09-15T12:00:00Z')

describe('safetyComplianceAnalytics', () => {
  it('returns null when no tyre records are in scope', () => {
    expect(computeSafetyCompliance({ tyreRecords: [], now: NOW })).toBeNull()
  })

  it('reports unmeasured components as null and renormalises the overall score', () => {
    const c = computeSafetyCompliance({
      tyreRecords: [
        { id: 1, asset_no: 'A1', tread_depth: '5', tyre_position: 'LHF1', site: 'NHC' },
        { id: 2, asset_no: 'A1', tread_depth: '1', tyre_position: 'LHF1', site: 'NHC' },
      ],
      inspections: [],
      now: NOW,
    })
    expect(c.treadCompliance).toBe(50)
    expect(c.pressureCompliance).toBeNull()
    expect(c.criticalPct).toBeNull()
    expect(c.riskScore).toBeNull()
    expect(c.inspectionCompliance).toBe(0)
    // tread 50 x .35 + inspection 0 x .30 over .65
    expect(c.overallScore).toBeCloseTo((50 * 0.35) / 0.65, 1)
    expect(c.measuredComponents).toEqual(['tread', 'inspection'])
    expect(c.accidentCorrelation).toBeNull()
  })

  it('overall score is null when nothing is measurable', () => {
    const c = computeSafetyCompliance({ tyreRecords: [{ id: 1 }], now: NOW })
    expect(c.overallScore).toBeNull()
    expect(c.avgTread).toBeNull()
    expect(c.belowLimitPct).toBeNull()
  })

  it('rates critical share over rated tyres only', () => {
    const c = computeSafetyCompliance({
      tyreRecords: [
        { id: 1, asset_no: 'A', risk_level: 'Critical' },
        { id: 2, asset_no: 'B', risk_level: 'Low' },
        { id: 3, asset_no: 'C' },
        { id: 4, asset_no: 'D', risk_level: '  ' },
      ],
      accidents: [{ asset_no: 'A' }, { asset_no: 'Z' }],
      now: NOW,
    })
    expect(c.ratedCount).toBe(2)
    expect(c.criticalPct).toBe(50)
    expect(c.riskScore).toBe(riskScore(50))
    expect(c.accidentsWithTyreIssue).toBe(1)
    expect(c.accidentCorrelation).toBe(50)
    expect(c.accidentSafety).toBe(50)
  })

  it('counts inspection coverage over tyre-carrying assets only', () => {
    const c = computeSafetyCompliance({
      tyreRecords: [{ id: 1, asset_no: 'A' }, { id: 2, asset_no: 'B' }],
      inspections: [{ asset_no: 'A' }, { asset_no: 'X' }, { asset_no: 'Y' }],
      now: NOW,
    })
    expect(c.inspectedAssets).toBe(1)
    expect(c.inspectionCompliance).toBe(50)
  })

  it('flags tread below the position legal minimum with a deficit', () => {
    expect(legalMinFor('Steer')).toBe(3)
    expect(legalMinFor('spare')).toBe(2)
    const rows = treadFailRows([
      { id: 1, asset_no: 'A', tread_depth: 2.5, position: 'Steer' },
      { id: 2, asset_no: 'B', tread_depth: 2.5, position: 'spare' },
      { id: 3, asset_no: 'C', tread_depth: 'n/a', position: 'Steer' },
    ])
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ asset: 'A', legalMin: 3, deficit: 0.5 })
  })

  it('computes pressure deviation and ignores rows without a target', () => {
    const rows = pressureRows([
      { id: 1, pressure_reading: 110, recommended_pressure: 100 },
      { id: 2, pressure_reading: 111, recommended_pressure: 100 },
      { id: 3, pressure_reading: 100 },
      { id: 4, pressure_reading: 100, recommended_pressure: 0 },
    ])
    expect(rows).toHaveLength(2)
    expect(rows[0].compliant).toBe(true)
    expect(rows[1].compliant).toBe(false)
  })

  it('site tread is null for a site with no measured tyre and sorts it last', () => {
    const s = siteTread([
      { site: 'A', tread_depth: 1, position: 'Steer' },
      { site: 'B' },
    ])
    expect(s[0]).toMatchObject({ site: 'A', compliance: 0 })
    expect(s[1]).toMatchObject({ site: 'B', compliance: null })
  })

  it('builds six month buckets from the injected now', () => {
    const t = monthlyTrend(
      [{ created_at: '2026-09-02', risk_level: 'Critical' }, { created_at: '2026-09-03' }],
      [{ inspection_date: '2026-08-10' }],
      NOW,
    )
    expect(t).toHaveLength(6)
    expect(t[5].key).toBe('2026-09')
    expect(t[5].critPct).toBe(100)
    expect(t[4].inspections).toBe(1)
    expect(t[0].critPct).toBeNull()
  })

  it('bands carry a text label, including not measured', () => {
    expect(scoreBand(null).label).toBe('Not measured')
    expect(scoreBand(95).key).toBe('compliant')
    expect(scoreBand(80).key).toBe('warning')
    expect(scoreBand(65).key).toBe('attention')
    expect(scoreBand(10).key).toBe('non_compliant')
  })

  it('range cut-off, site filter and options are deterministic', () => {
    expect(rangeCutoff('30d', NOW).slice(0, 10)).toBe('2026-08-16')
    const data = { tyreRecords: [{ site: 'A' }, { site: 'B' }], inspections: [{ site: 'B' }], accidents: [] }
    expect(siteOptions(data)).toEqual(['A', 'B'])
    expect(filterBySite(data, 'B').tyreRecords).toHaveLength(1)
    expect(filterBySite(data, 'all').tyreRecords).toHaveLength(2)
  })

  it('summary rows print N/A for unmeasured metrics', () => {
    const c = computeSafetyCompliance({ tyreRecords: [{ id: 1 }], now: NOW })
    const rows = complianceSummaryRows(c)
    expect(rows.find((r) => r.metric === 'Pressure compliance').score).toBe('N/A')
    expect(complianceSummaryRows(null)).toEqual([])
    expect(toNum('')).toBeNull()
  })
})
