import { describe, it, expect } from 'vitest'
import {
  tyreAgeYears, tyreAgeBand, summarizeTyreAges, DEFAULT_AGE_THRESHOLDS,
} from '../lib/tyreAge'

// Fixed reference clock so tests are deterministic.
const NOW = new Date('2026-07-12T00:00:00Z').getTime()

describe('tyreAge helpers', () => {
  it('computes age in years from fitment date (falling back to issue date)', () => {
    expect(tyreAgeYears({ fitment_date: '2020-07-12' }, NOW)).toBe(6)
    expect(tyreAgeYears({ issue_date: '2024-07-12' }, NOW)).toBe(2)
    // fitment_date wins over issue_date
    expect(tyreAgeYears({ fitment_date: '2023-07-12', issue_date: '2010-01-01' }, NOW)).toBe(3)
    expect(tyreAgeYears({}, NOW)).toBeNull()
    // future date clamps to 0
    expect(tyreAgeYears({ fitment_date: '2030-01-01' }, NOW)).toBe(0)
  })

  it('bands tyres by age against the default thresholds', () => {
    expect(tyreAgeBand({ fitment_date: '2019-01-01' }, NOW)).toBe('non_compliant') // >5y
    expect(tyreAgeBand({ fitment_date: '2022-07-12' }, NOW)).toBe('advisory')      // ~4y (3–5)
    expect(tyreAgeBand({ fitment_date: '2025-01-01' }, NOW)).toBe('compliant')     // <3y
    expect(tyreAgeBand({}, NOW)).toBe('unknown')
  })

  it('respects custom thresholds', () => {
    const t = { advisory: 2, nonCompliant: 4 }
    expect(tyreAgeBand({ fitment_date: '2023-07-12' }, NOW, t)).toBe('advisory') // 3y, ≥2 <4
    expect(tyreAgeBand({ fitment_date: '2021-07-12' }, NOW, t)).toBe('non_compliant') // 5y >4
  })

  it('summarizes a fleet into counts, compliance % and average age', () => {
    const recs = [
      { id: 1, fitment_date: '2019-01-01' }, // non_compliant
      { id: 2, fitment_date: '2018-01-01' }, // non_compliant
      { id: 3, fitment_date: '2022-07-12' }, // advisory
      { id: 4, fitment_date: '2025-07-12' }, // compliant
      { id: 5 },                              // unknown
    ]
    const s = summarizeTyreAges(recs, NOW, DEFAULT_AGE_THRESHOLDS)
    expect(s.counts).toMatchObject({ total: 5, non_compliant: 2, advisory: 1, compliant: 1, unknown: 1 })
    // compliance% is over the 4 known tyres: 1/4 = 25%
    expect(s.compliancePct).toBe(25)
    expect(typeof s.avgAge).toBe('number')
    expect(s.rows).toHaveLength(5)
    expect(s.rows[0]).toHaveProperty('ageBand')
  })
})
