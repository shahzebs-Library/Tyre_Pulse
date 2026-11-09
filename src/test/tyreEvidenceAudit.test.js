import { describe, it, expect } from 'vitest'
import {
  coverageStatus, shapeClasses, shapeFlags, shapeMonthly, coverageSummary, shapeAudit,
  evidenceExportRows, EVIDENCE_CLASSES,
} from '../lib/tyreEvidenceAudit'

describe('coverageStatus (installs recorded vs tyres issued by the ERP)', () => {
  it('flags the KSA Sep 2025 opening-baseline load as over-recorded (live: 1,788 installs vs 208 issued)', () => {
    const r = coverageStatus({ new_physical: 1326, unidentified: 462, duplicate_copies: 0, grid_issued_qty: 208 })
    expect(r.status).toBe('OVER_RECORDED')
    expect(r.ratio).toBeGreaterThan(8)
  })
  it('reconciles a month inside +/-15% (live KSA Jan 2026: 214 vs 237)', () => {
    expect(coverageStatus({ new_physical: 135, unidentified: 79, grid_issued_qty: 237 }).status).toBe('RECONCILED')
  })
  it('flags missing fitment records (live KSA Jan 2025: 1 vs 150)', () => {
    expect(coverageStatus({ new_physical: 0, unidentified: 1, grid_issued_qty: 150 }).status).toBe('UNDER_RECORDED')
  })
  it('does not count refits and removes identical copies', () => {
    const r = coverageStatus({ new_physical: 10, unidentified: 2, refits: 50, duplicate_copies: 2, grid_issued_qty: 10 })
    expect(r.installs).toBe(10)
    expect(r.status).toBe('RECONCILED')
  })
  it('a missing grid figure is never read as zero issued', () => {
    expect(coverageStatus({ new_physical: 3, grid_issued_qty: null }).status).toBe('NO_ERP_ISSUES')
    expect(coverageStatus({ new_physical: 0, grid_issued_qty: 40 }).status).toBe('NO_FITMENTS')
  })
  it('refuses a ratio on fewer than 5 issued tyres', () => {
    expect(coverageStatus({ new_physical: 4, grid_issued_qty: 2 }).status).toBe('LOW_VOLUME')
  })
})

describe('shaping', () => {
  it('fills every class, keeps totals and the verified share honest', () => {
    const [eg] = shapeClasses({ Egypt: { VERIFIED: 336, PARTIALLY_VERIFIED: 82, DUPLICATE: 33, CONFLICTING: 32, PROVISIONAL: 7, MISSING_EVIDENCE: 1 } })
    expect(eg.total).toBe(491)
    expect(eg.verifiedPct).toBe(68.4)
    expect(Object.keys(eg.counts)).toEqual(EVIDENCE_CLASSES.map((c) => c.id))
  })
  it('an empty country has no verified share (N/A), not 0%', () => {
    expect(shapeClasses({ UAE: {} })[0].verifiedPct).toBeNull()
  })
  it('labels reasons and sorts largest first', () => {
    const [k] = shapeFlags({ KSA: { job_card_not_found: 10, price_missing: 30, mystery: 1 } })
    expect(k.reasons[0].label).toBe('Purchase price missing')
    expect(k.reasons.find((r) => r.reason === 'mystery').label).toBe('mystery')
  })
  it('summarises months by coverage status', () => {
    const rows = shapeMonthly([
      { country: 'KSA', month: '2026-01-01', new_physical: 214, grid_issued_qty: 237 },
      { country: 'KSA', month: '2025-09-01', new_physical: 1788, grid_issued_qty: 208 },
    ])
    expect(rows[0].month).toBe('2026-01')
    expect(coverageSummary(rows).KSA).toEqual({ months: 2, RECONCILED: 1, OVER_RECORDED: 1 })
  })
  it('survives an empty response', () => {
    const a = shapeAudit(null)
    expect(a.classes).toEqual([])
    expect(a.monthly).toEqual([])
    expect(a.legacy).toEqual([])
  })
  it('export rows carry readable reasons', () => {
    const [r] = evidenceExportRows([{ id: 'x', reasons: ['serial_not_verified', 'price_missing'] }])
    expect(r.reasons_text).toBe('Serial not verified; Purchase price missing')
  })
})
