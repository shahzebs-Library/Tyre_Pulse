import { describe, it, expect } from 'vitest'
import { reportFileName, reportDateLabel } from '../lib/exportUtils'

const CLEAN = /^[A-Za-z0-9 ()]+$/

describe('reportFileName', () => {
  it('replaces underscores with spaces', () => {
    const out = reportFileName('TyrePulse_Accident_Report')
    expect(out).toBe('TyrePulse Accident Report')
    expect(out).toMatch(CLEAN)
  })

  it('replaces hyphens with spaces', () => {
    const out = reportFileName('Rear-end', 'Case-42')
    expect(out).toBe('Rear end Case 42')
    expect(out).not.toContain('-')
    expect(out).toMatch(CLEAN)
  })

  it('replaces en and em dashes with spaces', () => {
    const out = reportFileName('Q1–Q2', 'Board—Report')
    expect(out).toBe('Q1 Q2 Board Report')
    expect(out).not.toMatch(/[‒–—―]/)
    expect(out).toMatch(CLEAN)
  })

  it('replaces slashes and colons with spaces', () => {
    const out = reportFileName('Vendor/Procurement', '12:30')
    expect(out).toBe('Vendor Procurement 12 30')
    expect(out).toMatch(CLEAN)
  })

  it('skips null / undefined / empty / whitespace parts', () => {
    const out = reportFileName('Alpha', '', null, undefined, '   ', 'Beta')
    expect(out).toBe('Alpha Beta')
    expect(out).toMatch(CLEAN)
  })

  it('collapses runs of whitespace and trims', () => {
    const out = reportFileName('  Alpha   Beta  ', 'Gamma')
    expect(out).toBe('Alpha Beta Gamma')
    expect(out).toMatch(CLEAN)
  })

  it('strips dots, commas and other unsafe characters', () => {
    const out = reportFileName('Report.v2', 'A,B*C?')
    expect(out).toMatch(CLEAN)
    expect(out).toBe('Report v2 A B C')
  })
})

describe('reportDateLabel', () => {
  it('produces a hyphen-free "D Mon YYYY" label', () => {
    const out = reportDateLabel(new Date(2026, 6, 14))
    expect(out).toBe('14 Jul 2026')
    expect(out).not.toContain('-')
    expect(out).toMatch(CLEAN)
  })

  it('returns empty string for an invalid date', () => {
    expect(reportDateLabel(new Date('not-a-date'))).toBe('')
  })
})
