import { describe, it, expect } from 'vitest'
import {
  DASHBOARD_RANGE_PRESETS, DEFAULT_DASHBOARD_FILTERS,
  normalizeFilters, resolveDashboardFilters,
  validateLayout, makeLayout,
} from '../lib/dashboardBuilder'

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/

describe('DASHBOARD_RANGE_PRESETS', () => {
  it('exposes the expected range vocabulary', () => {
    const values = DASHBOARD_RANGE_PRESETS.map(p => p.value)
    expect(values).toEqual(['all', 'last_7', 'last_30', 'last_90', 'mtd', 'ytd', 'custom'])
    DASHBOARD_RANGE_PRESETS.forEach(p => expect(typeof p.label).toBe('string'))
  })
})

describe('normalizeFilters', () => {
  it('returns the neutral default for missing / invalid input', () => {
    expect(normalizeFilters(undefined)).toEqual(DEFAULT_DASHBOARD_FILTERS)
    expect(normalizeFilters(null)).toEqual(DEFAULT_DASHBOARD_FILTERS)
    expect(normalizeFilters('nope')).toEqual(DEFAULT_DASHBOARD_FILTERS)
  })

  it('falls back to "all" for an unknown range and clears custom dates', () => {
    const out = normalizeFilters({ range: 'weird', from: '2026-01-01', to: '2026-02-01' })
    expect(out.range).toBe('all')
    expect(out.from).toBeNull()
    expect(out.to).toBeNull()
  })

  it('keeps custom dates only for the custom range and only when valid', () => {
    expect(normalizeFilters({ range: 'custom', from: '2026-01-01', to: '2026-02-01' }))
      .toMatchObject({ range: 'custom', from: '2026-01-01', to: '2026-02-01' })
    // invalid date shapes are dropped
    expect(normalizeFilters({ range: 'custom', from: '01/01/2026', to: 'x' }))
      .toMatchObject({ range: 'custom', from: null, to: null })
    // a preset range never carries custom dates
    expect(normalizeFilters({ range: 'last_30', from: '2026-01-01' }).from).toBeNull()
  })

  it('normalises site/country scope, collapsing empty and "all" (any case) to "All"', () => {
    expect(normalizeFilters({ site: '  Riyadh Depot ' }).site).toBe('Riyadh Depot')
    expect(normalizeFilters({ site: '', country: 'all' })).toMatchObject({ site: 'All', country: 'All' })
    expect(normalizeFilters({ country: 'KSA' }).country).toBe('KSA')
  })
})

describe('resolveDashboardFilters', () => {
  it('"all" range yields no date bound and null scopes', () => {
    const r = resolveDashboardFilters({ range: 'all', site: 'All', country: 'All' })
    expect(r).toMatchObject({ range: 'all', from: null, to: null, site: null, country: null })
  })

  it('maps selected site/country to concrete values and All to null', () => {
    const r = resolveDashboardFilters({ range: 'all', site: 'Jeddah', country: 'UAE' })
    expect(r.site).toBe('Jeddah')
    expect(r.country).toBe('UAE')
  })

  it('resolves a relative range to an inclusive YYYY-MM-DD window (from <= to)', () => {
    const r = resolveDashboardFilters({ range: 'last_30' })
    expect(r.from).toMatch(ISO_DATE)
    expect(r.to).toMatch(ISO_DATE)
    expect(r.from <= r.to).toBe(true)
    expect(typeof r.label).toBe('string')
  })

  it('passes a custom range through deterministically', () => {
    const r = resolveDashboardFilters({ range: 'custom', from: '2026-03-01', to: '2026-03-31' })
    expect(r.from).toBe('2026-03-01')
    expect(r.to).toBe('2026-03-31')
  })
})

describe('layout filter persistence (backward compatible)', () => {
  it('validateLayout adds default filters when none are stored', () => {
    const l = validateLayout({ id: 'L', name: 'X', widgets: [] })
    expect(l.filters).toEqual(DEFAULT_DASHBOARD_FILTERS)
  })

  it('validateLayout normalises stored filters', () => {
    const l = validateLayout({
      id: 'L', name: 'X', widgets: [],
      filters: { range: 'ytd', site: ' Depot 2 ', country: 'KSA', from: '2020-01-01' },
    })
    expect(l.filters).toMatchObject({ range: 'ytd', site: 'Depot 2', country: 'KSA', from: null })
  })

  it('makeLayout carries provided filters through validation', () => {
    const l = makeLayout({ name: 'Board', filters: { range: 'last_7', site: 'S1' } })
    expect(l.filters).toMatchObject({ range: 'last_7', site: 'S1', country: 'All' })
  })
})
