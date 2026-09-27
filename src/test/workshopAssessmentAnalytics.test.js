import { describe, it, expect } from 'vitest'
import { canonDamageLevel, summarizeDamageMarks, damageSummaryLine } from '../lib/workshopAssessmentAnalytics'

describe('workshopAssessmentAnalytics', () => {
  it('canonicalises stored severities', () => {
    expect(canonDamageLevel('Major')).toBe('severe')
    expect(canonDamageLevel('moderate')).toBe('moderate')
    expect(canonDamageLevel('weird')).toBe('minor')
    expect(canonDamageLevel(null)).toBe('')
  })

  it('summarises marks and what is left to decide', () => {
    const s = summarizeDamageMarks([
      { severity: 'severe', action: 'repair', photo_refs: ['a'] },
      { severity: 'major', action: '', photo_refs: [] },
      { severity: 'minor' },
      { severity: null, action: 'monitor', photo_refs: [' '] },
    ])
    expect(s).toMatchObject({ total: 4, withoutAction: 2, withoutPhoto: 3, decided: 2 })
    expect(s.bySeverity).toEqual({ minor: 1, moderate: 0, severe: 2, unrated: 1 })
    expect(damageSummaryLine(s)).toBe('2 major, 1 minor, 1 unrated. 2 still need an action, 3 without a photo.')
  })

  it('says nothing when there are no marks', () => {
    expect(damageSummaryLine(summarizeDamageMarks([]))).toBe('')
    expect(damageSummaryLine(summarizeDamageMarks([{ severity: 'minor', action: 'repair', photo_refs: ['x'] }])))
      .toBe('1 minor. every mark has an action.')
  })
})
