import { describe, it, expect } from 'vitest'
import {
  parseDate, parseDotCode, resolveTyreDate,
  tyreAgeYears, classifyAge, tyreAgeBand,
  isCompliantBand, isNonCompliantBand,
  assessTyre, assessFleet, summarizeTyreAges,
  DEFAULT_AGE_POLICY, AGE_BANDS, AGE_BAND_META, DATE_SOURCE_META,
  serialOf, positionOf,
} from './tyreAgeCompliance'

// Fixed reference clock so every test is deterministic.
const NOW = new Date('2026-07-12T00:00:00Z').getTime()

describe('parseDate', () => {
  it('parses valid dates and rejects junk', () => {
    expect(parseDate('2020-01-01')).toBeInstanceOf(Date)
    expect(parseDate(new Date('2020-01-01'))).toBeInstanceOf(Date)
    expect(parseDate('')).toBeNull()
    expect(parseDate(null)).toBeNull()
    expect(parseDate('not-a-date')).toBeNull()
  })
})

describe('parseDotCode', () => {
  it('parses a WWYY DOT code to an approximate manufacture date', () => {
    const d = parseDotCode('2519') // week 25 of 2019
    expect(d).toBeInstanceOf(Date)
    expect(d.getUTCFullYear()).toBe(2019)
    // week 25 lands in June
    expect(d.getUTCMonth()).toBe(5)
  })
  it('uses trailing 4 digits of a longer sidewall string', () => {
    const d = parseDotCode('DOT HXHY 2519')
    expect(d.getUTCFullYear()).toBe(2019)
  })
  it('rejects invalid weeks and non-4-digit codes', () => {
    expect(parseDotCode('9919')).toBeNull() // week 99 invalid
    expect(parseDotCode('123')).toBeNull()  // 3-digit pre-2000
    expect(parseDotCode(null)).toBeNull()
    expect(parseDotCode('')).toBeNull()
  })
})

describe('resolveTyreDate', () => {
  it('prefers DOT code, then manufacture, then issue, then fitment', () => {
    expect(resolveTyreDate({ dot_code: '0120', manufacture_date: '2022-01-01', fitment_date: '2024-01-01' }).source).toBe('dot')
    expect(resolveTyreDate({ manufacture_date: '2022-01-01', issue_date: '2023-01-01' }).source).toBe('manufacture')
    expect(resolveTyreDate({ issue_date: '2023-01-01', fitment_date: '2024-01-01' }).source).toBe('issue')
    expect(resolveTyreDate({ fitment_date: '2024-01-01' }).source).toBe('fitment')
  })
  it('marks DOT/manufacture as true dates and issue/fitment as estimated', () => {
    expect(resolveTyreDate({ manufacture_date: '2022-01-01' }).estimated).toBe(false)
    expect(resolveTyreDate({ fitment_date: '2022-01-01' }).estimated).toBe(true)
  })
  it('returns unknown when no usable date and is null-safe', () => {
    expect(resolveTyreDate({}).source).toBe('unknown')
    expect(resolveTyreDate(null).source).toBe('unknown')
    expect(resolveTyreDate({}).date).toBeNull()
  })
})

describe('tyreAgeYears', () => {
  it('computes age from the best available date', () => {
    expect(tyreAgeYears({ fitment_date: '2020-07-12' }, NOW)).toBe(6)
    expect(tyreAgeYears({ issue_date: '2024-07-12' }, NOW)).toBe(2)
    // manufacture wins over fitment
    expect(tyreAgeYears({ manufacture_date: '2019-07-12', fitment_date: '2025-01-01' }, NOW)).toBe(7)
  })
  it('returns null when undated and clamps future dates to 0', () => {
    expect(tyreAgeYears({}, NOW)).toBeNull()
    expect(tyreAgeYears({ fitment_date: '2030-01-01' }, NOW)).toBe(0)
  })
})

describe('classifyAge / bands', () => {
  it('classifies across the OK / Watch / Replace / Overdue ladder', () => {
    expect(classifyAge(1)).toBe('ok')       // < 3
    expect(classifyAge(3)).toBe('watch')    // >= 3, < 5
    expect(classifyAge(4.9)).toBe('watch')
    expect(classifyAge(5)).toBe('replace')  // >= 5, < 7
    expect(classifyAge(6.5)).toBe('replace')
    expect(classifyAge(7)).toBe('overdue')  // >= 7
    expect(classifyAge(12)).toBe('overdue')
    expect(classifyAge(null)).toBe('unknown')
  })
  it('respects custom policy thresholds', () => {
    const p = { watchYears: 2, replaceYears: 4, overdueYears: 6 }
    expect(tyreAgeBand({ fitment_date: '2023-07-12' }, NOW, p)).toBe('watch')   // 3y
    expect(tyreAgeBand({ fitment_date: '2019-07-12' }, NOW, p)).toBe('overdue') // 7y
  })
  it('compliance predicates', () => {
    expect(isCompliantBand('ok')).toBe(true)
    expect(isCompliantBand('watch')).toBe(true)
    expect(isCompliantBand('replace')).toBe(false)
    expect(isNonCompliantBand('overdue')).toBe(true)
    expect(isNonCompliantBand('ok')).toBe(false)
  })
})

describe('assessTyre', () => {
  it('enriches a record without mutating it', () => {
    const rec = { id: 1, fitment_date: '2019-07-12', brand: 'X' }
    const out = assessTyre(rec, NOW)
    expect(out.ageYears).toBe(7)
    expect(out.ageBand).toBe('overdue')
    expect(out.dateSource).toBe('fitment')
    expect(out.dateEstimated).toBe(true)
    expect(out.birthDate).toBe('2019-07-12')
    expect(typeof out.ageMonths).toBe('number')
    expect(rec.ageYears).toBeUndefined() // original untouched
  })
  it('handles undated records honestly', () => {
    const out = assessTyre({ id: 2 }, NOW)
    expect(out.ageYears).toBeNull()
    expect(out.ageBand).toBe('unknown')
    expect(out.birthDate).toBeNull()
  })
})

describe('assessFleet', () => {
  const recs = [
    { id: 1, fitment_date: '2018-01-01', site: 'A', brand: 'Double Coin' }, // overdue (~8.5y)
    { id: 2, fitment_date: '2020-07-12', site: 'A', brand: 'Double Coin' }, // replace (6y)
    { id: 3, fitment_date: '2022-07-12', site: 'B', brand: 'BF' },          // watch (4y)
    { id: 4, fitment_date: '2025-07-12', site: 'B', brand: 'BF' },          // ok (1y)
    { id: 5 },                                                               // unknown
  ]

  it('produces band counts and honest KPIs', () => {
    const r = assessFleet(recs, NOW)
    expect(r.counts).toMatchObject({ total: 5, ok: 1, watch: 1, replace: 1, overdue: 1, unknown: 1 })
    expect(r.kpis.totalAssessed).toBe(5)
    expect(r.kpis.withDate).toBe(4)
    expect(r.kpis.unknownDate).toBe(1)
    expect(r.kpis.compliantCount).toBe(2)       // ok + watch
    expect(r.kpis.nonCompliantCount).toBe(2)    // replace + overdue
    expect(r.kpis.overdueCount).toBe(1)
    expect(r.kpis.compliancePct).toBe(50)       // 2 of 4 dated
    expect(typeof r.kpis.avgAgeYears).toBe('number')
  })
  it('identifies the oldest tyre', () => {
    const r = assessFleet(recs, NOW)
    expect(r.kpis.oldest.serial).toBe('N/A')
    expect(r.kpis.oldest.site).toBe('A')
    expect(r.kpis.oldest.ageYears).toBeGreaterThanOrEqual(8)
    expect(r.kpis.oldest.band).toBe('overdue')
  })
  it('emits an ordered band distribution and site/brand breakdowns', () => {
    const r = assessFleet(recs, NOW)
    expect(r.distribution.map((d) => d.band)).toEqual(AGE_BANDS)
    expect(r.bySite.length).toBe(2)
    const siteA = r.bySite.find((s) => s.name === 'A')
    expect(siteA.total).toBe(2)
    expect(siteA.nonCompliant).toBe(2)
    expect(typeof siteA.avgAge).toBe('number')
    expect(r.byBrand.find((b) => b.name === 'Double Coin').nonCompliant).toBe(2)
  })
  it('is null-safe / empty-safe', () => {
    const r = assessFleet([], NOW)
    expect(r.counts.total).toBe(0)
    expect(r.kpis.compliancePct).toBeNull()
    expect(r.kpis.avgAgeYears).toBeNull()
    expect(r.kpis.oldest).toBeNull()
    expect(assessFleet(null, NOW).rows).toEqual([])
  })
})

describe('summarizeTyreAges back-compat shim', () => {
  it('maps advisory/nonCompliant thresholds onto the policy', () => {
    const recs = [
      { id: 1, fitment_date: '2019-01-01' },
      { id: 2, fitment_date: '2025-07-12' },
      { id: 3 },
    ]
    const s = summarizeTyreAges(recs, NOW, { advisory: 3, nonCompliant: 5 })
    expect(s.counts.total).toBe(3)
    expect(s.rows).toHaveLength(3)
    expect(typeof s.compliancePct).toBe('number')
  })
})

describe('metadata + helpers', () => {
  it('exposes complete band + source metadata', () => {
    AGE_BANDS.forEach((b) => expect(AGE_BAND_META[b]).toBeTruthy())
    expect(DATE_SOURCE_META.dot.estimated).toBe(false)
    expect(DEFAULT_AGE_POLICY.replaceYears).toBe(5)
  })
  it('serial/position extraction with aliases', () => {
    expect(serialOf({ tyre_serial: 'T9' })).toBe('T9')
    expect(serialOf({})).toBeNull()
    expect(positionOf({ tyre_position: 'LHF' })).toBe('LHF')
    expect(positionOf({})).toBeNull()
  })
})
