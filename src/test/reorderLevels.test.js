import { describe, it, expect } from 'vitest'
import {
  suggestReorderLevels, leadTimeFor, summarizeSuggestions, buildReorderSuggestions, levelPatch, DEFAULT_LEAD_DAYS,
} from '../lib/inventory/reorderLevels'

const row = (over = {}) => ({ id: 'r1', site: 'NHC', country: 'KSA', min_level: 0, critical_level: 0, reorder_qty: 0, ...over })

describe('suggestReorderLevels', () => {
  it('sizes levels from a site rate with the default lead time', () => {
    const s = suggestReorderLevels(row(), { scope: 'site', avgPerMonth: 4 })
    expect(s.ok).toBe(true)
    expect(s.leadDays).toBe(DEFAULT_LEAD_DAYS)
    expect(s.leadSource).toBe('default')
    expect(s.critical).toBe(4)
    expect(s.min).toBe(6)
    expect(s.reorderQty).toBe(8)
    expect(s.differs).toBe(true)
    expect(s.explanation).toMatch(/4 a month/)
    expect(s.explanation).toMatch(/default lead time/)
  })

  it('uses the Material Master lead time when set', () => {
    const s = suggestReorderLevels(row({ item: { lead_time_days: 60 } }), { scope: 'site', avgPerMonth: 3 })
    expect(s.leadSource).toBe('material_master')
    expect(s.critical).toBe(6)
    expect(s.min).toBe(8)
    expect(s.reorderQty).toBe(6)
  })

  it('rounds fractional usage up to whole units', () => {
    const s = suggestReorderLevels(row(), { scope: 'site', avgPerMonth: 0.08 })
    expect(s.critical).toBe(1)
    expect(s.min).toBe(2)
    expect(s.reorderQty).toBe(1)
    for (const v of [s.critical, s.min, s.reorderQty]) expect(Number.isInteger(v)).toBe(true)
  })

  it('does not round an exact value up because of float noise', () => {
    const s = suggestReorderLevels(row(), { scope: 'site', avgPerMonth: 0.1 * 3 })
    expect(s.reorderQty).toBe(1)
    expect(s.critical).toBe(1)
  })

  it('refuses a country-only rate and says why', () => {
    const s = suggestReorderLevels(row(), { scope: 'country', avgPerMonth: 10 })
    expect(s.ok).toBe(false)
    expect(s.reason).toBe('country_only')
    expect(s.critical).toBeNull()
    expect(s.explanation).toMatch(/site/)
  })

  it('refuses no usage and missing code with nulls, not zeros', () => {
    const a = suggestReorderLevels(row(), { scope: 'none', avgPerMonth: 0 })
    expect(a.reason).toBe('no_usage')
    expect(a.min).toBeNull()
    const b = suggestReorderLevels(row(), null)
    expect(b.reason).toBe('no_code')
    expect(b.reorderQty).toBeNull()
    expect(levelPatch(b)).toBeNull()
  })

  it('reports no difference when the row already holds the suggestion', () => {
    const s = suggestReorderLevels(row({ critical_level: 4, min_level: 6, reorder_qty: 8 }), { scope: 'site', avgPerMonth: 4 })
    expect(s.differs).toBe(false)
  })

  it('treats a missing current level as different, not equal to 0', () => {
    const s = suggestReorderLevels(row({ critical_level: null, min_level: null, reorder_qty: null }), { scope: 'site', avgPerMonth: 4 })
    expect(s.current.min).toBeNull()
    expect(s.differs).toBe(true)
  })
})

describe('leadTimeFor', () => {
  it('ignores zero and junk lead times', () => {
    expect(leadTimeFor({ item: { lead_time_days: 0 } }).source).toBe('default')
    expect(leadTimeFor({ item: { lead_time_days: 'x' } }).days).toBe(DEFAULT_LEAD_DAYS)
    expect(leadTimeFor({ item: { lead_time_days: 14 } })).toEqual({ days: 14, source: 'material_master' })
  })
})

describe('summary and patch', () => {
  it('counts each outcome', () => {
    const usages = { a: { scope: 'site', avgPerMonth: 2 }, b: { scope: 'country', avgPerMonth: 2 }, c: { scope: 'none', avgPerMonth: 0 }, d: null }
    const items = buildReorderSuggestions(['a', 'b', 'c', 'd'].map(id => row({ id })), r => usages[r.id])
    expect(summarizeSuggestions(items)).toEqual({ total: 4, suggested: 1, differs: 1, countryOnly: 1, noUsage: 1, noCode: 1 })
    expect(levelPatch(items[0].s)).toEqual({ min_level: 3, critical_level: 2, reorder_qty: 4 })
  })
})
