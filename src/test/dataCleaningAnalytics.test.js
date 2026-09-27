import { describe, expect, it } from 'vitest'
import {
  computeQualityScore, scoreBand, scoreVerdict, detectSerialIssues, groupDuplicateSerials,
  findInvalidPressure, summarizeMissingTread, inspectionCutoff, findMissingInspections,
  detectOdometerIssues, detectUnrealisticLife, odometerEditVerdict, searchCleaned,
  summarizeCleaned, cleanedShare, qualityIssueExportRows,
} from '../lib/dataCleaningAnalytics'

const clean = { count: 0, issues: [], records: [], groups: [], affectedCount: 0, asset_nos: [] }
const allClean = {
  odometer: clean, duplicateSerial: clean, missingTread: clean, invalidPressure: clean,
  serialIssues: clean, unrealisticLife: clean, missingInspect: clean,
}

describe('computeQualityScore', () => {
  it('is null with no records instead of a flattering 100', () => {
    expect(computeQualityScore(allClean, 0)).toBeNull()
  })
  it('is 100 for clean data and weights the bad ratio', () => {
    expect(computeQualityScore(allClean, 100)).toBe(100)
    expect(computeQualityScore({ ...allClean, odometer: { count: 100, issues: [] } }, 100)).toBe(75)
    expect(computeQualityScore({ ...allClean, duplicateSerial: { affectedCount: 50, groups: [] } }, 100)).toBe(90)
  })
  it('refuses to score while any check failed or is not applicable', () => {
    expect(computeQualityScore({ ...allClean, missingTread: { error: true } }, 100)).toBeNull()
    expect(computeQualityScore({ ...allClean, invalidPressure: { notApplicable: true } }, 100)).toBeNull()
  })
  it('bands and verdicts', () => {
    expect(scoreBand(90)).toBe('good'); expect(scoreBand(75)).toBe('warn'); expect(scoreBand(10)).toBe('crit')
    expect(scoreBand(null)).toBeNull()
    expect(scoreVerdict(null, { totalRecords: 0 })).toMatch(/nothing to score/)
    expect(scoreVerdict(90, { incomplete: true })).toMatch(/incomplete/)
  })
})

describe('checks', () => {
  it('serial issues flag blanks, short and reuse without double counting', () => {
    const r = detectSerialIssues([
      { id: 1, tyre_serial: '', asset_no: 'A' },
      { id: 2, tyre_serial: 'AB', asset_no: 'A' },
      { id: 3, tyre_serial: 'SER123', asset_no: 'A' },
      { id: 4, tyre_serial: 'SER123 ', asset_no: 'B' },
      { id: 5, tyre_serial: 'UNIQUE1', asset_no: 'C' },
    ])
    expect(r.count).toBe(4)
    expect(r.issues.find((i) => i.id === 3).issue_type).toMatch(/reused/)
  })
  it('groups duplicate active serials', () => {
    const r = groupDuplicateSerials([
      { id: 1, tyre_serial: 'X1', asset_no: 'A' }, { id: 2, tyre_serial: 'X1', asset_no: 'B' },
      { id: 3, tyre_serial: 'Y', asset_no: 'C' },
    ])
    expect(r.groupCount).toBe(1); expect(r.affectedCount).toBe(2); expect(r.groups[0].asset_nos).toEqual(['A', 'B'])
  })
  it('pressure outside band and blanks are invalid', () => {
    expect(findInvalidPressure([{ pressure_reading: 10 }, { pressure_reading: 110 }, { pressure_reading: null }, { pressure_reading: 250 }]).count).toBe(3)
  })
  it('missing tread pct is null when nothing read', () => {
    expect(summarizeMissingTread([]).pct).toBeNull()
    const r = summarizeMissingTread([{ tread_depth: 0, site: 'S1' }, { tread_depth: null, site: 'S1' }, { tread_depth: 8 }, { tread_depth: 9 }])
    expect(r.count).toBe(2); expect(r.pct).toBe(50); expect(r.bySite).toEqual([{ site: 'S1', count: 2 }])
  })
  it('inspection cutoff uses the local calendar', () => {
    expect(inspectionCutoff(new Date(2026, 2, 5, 23, 30), 30)).toBe('2026-02-03')
  })
  it('missing inspections', () => {
    expect(findMissingInspections([{ asset_no: 'A' }, { asset_no: 'B' }, { asset_no: 'A' }], [{ asset_no: 'A' }]))
      .toEqual({ count: 1, asset_nos: ['B'] })
  })
  it('odometer issues: impossible, too long, non-sequential', () => {
    const r = detectOdometerIssues([
      { id: 1, asset_no: 'A', km_at_fitment: 100, km_at_removal: 50 },
      { id: 2, asset_no: 'B', km_at_fitment: 0, km_at_removal: 600000 },
      { id: 3, asset_no: 'C', km_at_fitment: 0, km_at_removal: 1000 },
      { id: 4, asset_no: 'C', km_at_fitment: 500, km_at_removal: 2000 },
    ])
    expect(r.issues.map((i) => i.severity).sort()).toEqual(['critical', 'high', 'medium'])
  })
  it('unrealistic life and cost', () => {
    const r = detectUnrealisticLife([
      { id: 1, km_at_fitment: 0, km_at_removal: 100 },
      { id: 2, km_at_fitment: 0, km_at_removal: 500000 },
      { id: 3, km_at_fitment: 0, km_at_removal: 50000, cost_per_tyre: 10 },
      { id: 4, km_at_fitment: null, km_at_removal: null, cost_per_tyre: null },
    ])
    expect(r.count).toBe(3)
  })
  it('odometer edit verdict', () => {
    expect(odometerEditVerdict('', 1)).toBeNull()
    expect(odometerEditVerdict(100, 50).tone).toBe('crit')
    expect(odometerEditVerdict(0, 60000).tone).toBe('good')
  })
})

describe('cleaned register', () => {
  const rows = [
    { id: 1, asset_no: 'TM1', risk_level: 'Critical', category: 'Puncture' },
    { id: 2, asset_no: 'TM2', risk_level: 'Low', category: 'Puncture' },
    { id: 3, asset_no: 'PL3', risk_level: null, category: null },
  ]
  it('searches and summarises honestly', () => {
    expect(searchCleaned(rows, 'tm').length).toBe(2)
    const s = summarizeCleaned(rows)
    expect(s.highRisk).toBe(1); expect(s.byRisk.Unrated).toBe(1); expect(s.topCategory.category).toBe('Puncture')
    expect(summarizeCleaned([]).highRiskPct).toBeNull()
  })
  it('share is null with no records', () => {
    expect(cleanedShare(0, 0)).toBeNull(); expect(cleanedShare(3, 1)).toBe(25)
  })
  it('flattens issues for export', () => {
    const rows2 = qualityIssueExportRows({ missingInspect: { asset_nos: ['X'] }, serialIssues: { issues: [{ tyre_serial: '', issue_type: 'Empty/null serial' }] } })
    expect(rows2).toHaveLength(2); expect(rows2[0].serial).toBe('N/A')
  })
})
