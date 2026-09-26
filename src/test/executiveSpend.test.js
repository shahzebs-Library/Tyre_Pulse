import { describe, it, expect } from 'vitest'
import { resolveReportTyreSpend, spendShare, spendWindow, distinctCountries } from '../lib/executiveSpend'

describe('resolveReportTyreSpend', () => {
  it('prefers the expense grid when it holds a single-currency total', () => {
    expect(resolveReportTyreSpend({ grid: { amount: 500, blended: false }, legacy: 200, legacyCountries: 1 }))
      .toEqual({ amount: 500, source: 'grid', reason: null })
  })
  it('falls back to the per-tyre sum only when the grid is empty', () => {
    expect(resolveReportTyreSpend({ grid: { amount: 0, blended: false }, legacy: 200, legacyCountries: 1 }).source).toBe('tyre_records')
    expect(resolveReportTyreSpend({ grid: null, legacy: 200, legacyCountries: 1 }).amount).toBe(200)
  })
  it('refuses a blended grid total and a multi-country legacy sum', () => {
    const r = resolveReportTyreSpend({ grid: { amount: 900, blended: true }, legacy: 300, legacyCountries: 3 })
    expect(r.amount).toBeNull()
    expect(r.reason).toBe('mixed_currency')
  })
  it('uses a single-country legacy sum when the grid is blended', () => {
    expect(resolveReportTyreSpend({ grid: { amount: 900, blended: true }, legacy: 300, legacyCountries: 1 }).amount).toBe(300)
  })
  it('returns null, never zero, when nothing is measured', () => {
    expect(resolveReportTyreSpend({ grid: null, legacy: 0, legacyCountries: 0 }))
      .toEqual({ amount: null, source: 'none', reason: 'no_data' })
  })
})

describe('spendShare', () => {
  it('scales a known total and keeps unknown as null', () => {
    expect(spendShare(1000, 0.1)).toBe(100)
    expect(spendShare(null, 0.1)).toBeNull()
  })
})

describe('spendWindow', () => {
  it('turns exclusive server bounds into an inclusive window', () => {
    expect(spendWindow({ from: '2026-01-01', toExclusive: '2027-01-01' })).toEqual({ from: '2026-01-01', to: '2026-12-31' })
  })
  it('uses the record date span for all time', () => {
    expect(spendWindow(null, [{ issue_date: '2025-03-04' }, { issue_date: '2024-01-02T10:00:00Z' }, {}]))
      .toEqual({ from: '2024-01-02', to: '2025-03-04' })
  })
  it('returns null with no bounds and no dates', () => {
    expect(spendWindow(null, [])).toBeNull()
  })
})

describe('distinctCountries', () => {
  it('counts distinct non-empty countries', () => {
    expect(distinctCountries([{ country: 'KSA' }, { country: 'KSA' }, { country: 'UAE' }, { country: null }])).toBe(2)
  })
})
