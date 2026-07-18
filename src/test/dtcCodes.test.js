import { describe, it, expect } from 'vitest'
import {
  summarizeDtc, normalizeSeverity, severityRank, isOpenStatus,
  rankMostCommonCodes, detectRecurring, assetFaultBurden, bySystemBreakdown,
  ageOpenCodes, dataQualityFlags, analyzeDtc, SEVERITY_RANK,
} from '../lib/dtcCodes'

const rows = [
  { asset_no: 'TRK-01', status: 'active', severity: 'critical' },
  { asset_no: 'TRK-01', status: 'active', severity: 'warning' },
  { asset_no: 'TRK-02', status: 'acknowledged', severity: 'critical' },
  { asset_no: 'TRK-03', status: 'cleared', severity: 'info' },
  { asset_no: ' TRK-01 ', status: 'active', severity: 'critical' }, // dup asset (trimmed)
]

describe('summarizeDtc', () => {
  it('returns zeroed summary for empty / non-array input', () => {
    const empty = summarizeDtc([])
    expect(empty.total).toBe(0)
    expect(empty.byStatus).toEqual({ active: 0, acknowledged: 0, cleared: 0 })
    expect(empty.bySeverity).toEqual({ info: 0, warning: 0, critical: 0 })
    expect(empty.active).toBe(0)
    expect(empty.criticalActive).toBe(0)
    expect(empty.assetsAffected).toBe(0)
    // non-array is tolerated
    expect(summarizeDtc(null).total).toBe(0)
    expect(summarizeDtc(undefined).total).toBe(0)
  })

  it('counts by status', () => {
    const s = summarizeDtc(rows)
    expect(s.total).toBe(5)
    expect(s.byStatus).toEqual({ active: 3, acknowledged: 1, cleared: 1 })
    expect(s.active).toBe(3)
  })

  it('counts by severity', () => {
    const s = summarizeDtc(rows)
    expect(s.bySeverity).toEqual({ info: 1, warning: 1, critical: 3 })
  })

  it('counts active-critical codes only', () => {
    const s = summarizeDtc(rows)
    // two active+critical (TRK-01 and the trimmed dup); TRK-02 critical is acknowledged
    expect(s.criticalActive).toBe(2)
  })

  it('counts distinct affected assets (trimmed)', () => {
    const s = summarizeDtc(rows)
    // TRK-01 (incl. " TRK-01 "), TRK-02, TRK-03 => 3 distinct
    expect(s.assetsAffected).toBe(3)
  })

  it('ignores unknown status/severity values and null rows', () => {
    const s = summarizeDtc([
      { asset_no: 'X', status: 'bogus', severity: 'nope' },
      null,
      { asset_no: '', status: 'active', severity: 'info' },
    ])
    expect(s.total).toBe(3)
    expect(s.byStatus).toEqual({ active: 1, acknowledged: 0, cleared: 0 })
    expect(s.bySeverity).toEqual({ info: 1, warning: 0, critical: 0 })
    expect(s.assetsAffected).toBe(1) // only 'X' (empty asset ignored)
  })
})

// Fixed clock for deterministic ageing tests.
const NOW = Date.parse('2026-07-18T00:00:00Z')
const daysAgo = (n) => new Date(NOW - n * 86400000).toISOString().slice(0, 10)

describe('normalizeSeverity / severityRank / isOpenStatus', () => {
  it('maps canonical and alias severities, null for unknown', () => {
    expect(normalizeSeverity('critical')).toBe('critical')
    expect(normalizeSeverity(' HIGH ')).toBe('critical')
    expect(normalizeSeverity('Medium')).toBe('warning')
    expect(normalizeSeverity('low')).toBe('info')
    expect(normalizeSeverity('')).toBeNull()
    expect(normalizeSeverity(null)).toBeNull()
    expect(normalizeSeverity('banana')).toBeNull()
  })
  it('ranks severities with 0 for unknown', () => {
    expect(severityRank('critical')).toBe(SEVERITY_RANK.critical)
    expect(severityRank('warning')).toBe(2)
    expect(severityRank('info')).toBe(1)
    expect(severityRank('nope')).toBe(0)
  })
  it('treats non-cleared statuses as open', () => {
    expect(isOpenStatus('active')).toBe(true)
    expect(isOpenStatus('acknowledged')).toBe(true)
    expect(isOpenStatus('cleared')).toBe(false)
    expect(isOpenStatus('')).toBe(false)
    expect(isOpenStatus(null)).toBe(false)
  })
})

describe('rankMostCommonCodes', () => {
  const rows = [
    { asset_no: 'A1', code: 'p0301', status: 'active', severity: 'critical' },
    { asset_no: 'A2', code: 'P0301', status: 'cleared', severity: 'warning' },
    { asset_no: 'A1', code: 'P0420', status: 'active', severity: 'warning' },
    { asset_no: 'A3', code: '', status: 'active', severity: 'info' }, // no code -> ignored
  ]
  it('groups case-insensitively and ranks by count', () => {
    const r = rankMostCommonCodes(rows)
    expect(r[0].code).toBe('P0301')
    expect(r[0].count).toBe(2)
    expect(r[0].open).toBe(1)      // one active, one cleared
    expect(r[0].active).toBe(1)
    expect(r[0].assets).toBe(2)
    expect(r[0].worstSeverity).toBe('critical')
  })
  it('honours limit and ignores empty', () => {
    expect(rankMostCommonCodes(rows, { limit: 1 })).toHaveLength(1)
    expect(rankMostCommonCodes([])).toEqual([])
  })
})

describe('detectRecurring', () => {
  const rows = [
    { asset_no: 'A1', code: 'P0301', status: 'active', severity: 'critical', detected_at: daysAgo(30) },
    { asset_no: 'A1', code: 'P0301', status: 'cleared', severity: 'warning', detected_at: daysAgo(60) },
    { asset_no: 'A1', code: 'P0420', status: 'active', severity: 'warning', detected_at: daysAgo(10) }, // single
    { asset_no: 'A2', code: 'P0301', status: 'active', severity: 'critical', detected_at: daysAgo(5) }, // diff asset, single
  ]
  it('flags same code recurring on the same asset', () => {
    const r = detectRecurring(rows)
    expect(r).toHaveLength(1)
    expect(r[0]).toMatchObject({ asset_no: 'A1', code: 'P0301', occurrences: 2, open: 1, worstSeverity: 'critical' })
    expect(r[0].firstSeen).toBe(daysAgo(60))
    expect(r[0].lastSeen).toBe(daysAgo(30))
    expect(r[0].spanDays).toBe(30)
  })
  it('respects minOccurrences and ignores rows without asset+code', () => {
    expect(detectRecurring(rows, { minOccurrences: 3 })).toEqual([])
    expect(detectRecurring([{ asset_no: '', code: 'X' }, { code: 'Y', asset_no: 'A' }])).toEqual([])
  })
})

describe('assetFaultBurden', () => {
  const rows = [
    { asset_no: 'A1', code: 'C1', status: 'active', severity: 'critical' },   // 3
    { asset_no: 'A1', code: 'C2', status: 'acknowledged', severity: 'warning' }, // 2 (open)
    { asset_no: 'A1', code: 'C3', status: 'cleared', severity: 'critical' },   // 0 (cleared)
    { asset_no: 'A2', code: 'C1', status: 'active', severity: 'warning' },     // 2
  ]
  it('weights open codes by severity, worst asset first', () => {
    const r = assetFaultBurden(rows)
    expect(r[0].asset_no).toBe('A1')
    expect(r[0].burden).toBe(5)        // 3 + 2, cleared excluded
    expect(r[0].openCodes).toBe(2)
    expect(r[0].activeCodes).toBe(1)
    expect(r[0].criticalActive).toBe(1)
    expect(r[0].distinctCodes).toBe(3)
    expect(r[1].asset_no).toBe('A2')
    expect(r[1].burden).toBe(2)
  })
})

describe('bySystemBreakdown', () => {
  it('groups by system, blank bucket kept', () => {
    const r = bySystemBreakdown([
      { system: 'Engine', status: 'active', severity: 'critical' },
      { system: 'Engine', status: 'cleared', severity: 'info' },
      { system: '', status: 'active', severity: 'warning' },
    ])
    expect(r[0]).toMatchObject({ system: 'Engine', count: 2, open: 1, criticalActive: 1 })
    expect(r.find((g) => g.system === '')).toMatchObject({ count: 1, open: 1 })
  })
})

describe('ageOpenCodes', () => {
  const rows = [
    { status: 'active', detected_at: daysAgo(3) },
    { status: 'acknowledged', detected_at: daysAgo(20) },
    { status: 'active', detected_at: daysAgo(120) },
    { status: 'cleared', detected_at: daysAgo(200) }, // excluded (cleared)
    { status: 'active', detected_at: null, created_at: null }, // undated
  ]
  it('buckets open codes by age and computes aggregates', () => {
    const r = ageOpenCodes(rows, { asOf: NOW })
    expect(r.buckets['0 to 7d']).toBe(1)
    expect(r.buckets['8 to 30d']).toBe(1)
    expect(r.buckets['over 90d']).toBe(1)
    expect(r.buckets.undated).toBe(1)
    expect(r.openTotal).toBe(4)      // cleared excluded
    expect(r.dated).toBe(3)
    expect(r.oldestDays).toBe(120)
    expect(r.items[0].ageDays).toBe(120) // oldest first
  })
})

describe('dataQualityFlags', () => {
  it('flags missing code / date / system and unknown severity/status', () => {
    const r = dataQualityFlags([
      { id: 1, asset_no: 'A1', code: 'P0301', system: 'Engine', severity: 'critical', status: 'active', detected_at: daysAgo(1) },
      { id: 2, asset_no: 'A2', code: '', system: '', severity: 'bogus', status: 'weird', detected_at: null, created_at: null },
    ])
    expect(r.counts.missingCode).toBe(1)
    expect(r.counts.missingSystem).toBe(1)
    expect(r.counts.missingDetectedAt).toBe(1)
    expect(r.counts.unknownSeverity).toBe(1)
    expect(r.counts.unknownStatus).toBe(1)
    expect(r.flaggedRows).toBe(1)
    expect(r.issues[0].id).toBe(2)
  })
})

describe('analyzeDtc', () => {
  it('composes all analytics with honest empty defaults', () => {
    const empty = analyzeDtc([])
    expect(empty.summary.total).toBe(0)
    expect(empty.mostCommon).toEqual([])
    expect(empty.recurring).toEqual([])
    expect(empty.kpis).toEqual({ activeCodes: 0, criticalActive: 0, repeatOffenderAssets: 0, distinctCodes: 0 })

    const a = analyzeDtc([
      { asset_no: 'A1', code: 'P0301', status: 'active', severity: 'critical', detected_at: daysAgo(2), system: 'Engine' },
      { asset_no: 'A1', code: 'P0301', status: 'cleared', severity: 'warning', detected_at: daysAgo(40), system: 'Engine' },
      { asset_no: 'A2', code: 'P0420', status: 'active', severity: 'warning', detected_at: daysAgo(5), system: 'Emissions' },
    ], { asOf: NOW })
    expect(a.kpis.distinctCodes).toBe(2)
    expect(a.kpis.repeatOffenderAssets).toBe(1) // A1 P0301 recurs
    expect(a.kpis.activeCodes).toBe(2)
    expect(a.kpis.criticalActive).toBe(1)
    expect(a.recurring[0].asset_no).toBe('A1')
  })
})
