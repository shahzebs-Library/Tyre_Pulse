import { describe, it, expect } from 'vitest'
import {
  librarySections, canvasSummary, relativeAgo, saveStatus, gridColumns, spanFor,
  filterSummary, accessSummary, sectionOf,
} from '../lib/dashboardBuilderView'
import { WIDGET_CATALOG, WIDGET_BY_ID, DEFAULT_LAYOUT, DASHBOARD_RANGE_PRESETS } from '../lib/dashboardBuilder'

const NOW = '2026-10-05T12:00:00Z'

describe('librarySections', () => {
  it('covers every catalog widget across the three sections', () => {
    const secs = librarySections(WIDGET_CATALOG)
    const n = secs.reduce((s, x) => s + x.items.length, 0)
    expect(n).toBe(WIDGET_CATALOG.length)
    expect(secs.map((s) => s.key)).toEqual(['kpi', 'visual', 'data'])
  })
  it('filters by tab and search, and counts placed widgets', () => {
    const kpis = librarySections(WIDGET_CATALOG, { tab: 'kpis', placedIds: ['total-vehicles', 'total-vehicles'] })
    expect(kpis).toHaveLength(1)
    expect(kpis[0].items.find((w) => w.id === 'total-vehicles').placed).toBe(2)
    const hit = librarySections(WIDGET_CATALOG, { search: 'failure' })
    expect(hit.flatMap((s) => s.items).map((w) => w.id)).toEqual(['tyre-failure-reasons'])
    expect(librarySections(WIDGET_CATALOG, { search: 'zzz' })).toEqual([])
  })
  it('maps kinds to sections', () => {
    expect(sectionOf('gauge')).toBe('kpi')
    expect(sectionOf('donut')).toBe('visual')
    expect(sectionOf('list')).toBe('data')
  })
})

describe('canvasSummary', () => {
  it('counts widgets and distinct sources', () => {
    const s = canvasSummary(DEFAULT_LAYOUT, WIDGET_BY_ID)
    expect(s.widgets).toBe(DEFAULT_LAYOUT.widgets.length)
    expect(s.sources).toBeGreaterThan(1)
    expect(canvasSummary(null, WIDGET_BY_ID)).toEqual({ widgets: 0, sources: 0, categories: [] })
  })
})

describe('time helpers', () => {
  it('relativeAgo', () => {
    expect(relativeAgo('2026-10-05T11:58:00Z', NOW)).toBe('2 minutes ago')
    expect(relativeAgo('2026-10-05T11:59:50Z', NOW)).toBe('just now')
    expect(relativeAgo(null, NOW)).toBeNull()
  })
  it('saveStatus never claims auto-save', () => {
    expect(saveStatus({ dirty: true, layout: {}, now: NOW }).text).toBe('Unsaved changes')
    expect(saveStatus({ dirty: false, isStarter: true, layout: {}, now: NOW }).tone).toBe('muted')
    expect(saveStatus({ dirty: false, layout: { updated_at: '2026-10-05T09:00:00Z' }, now: NOW }).text).toBe('Saved 3 hours ago')
  })
})

describe('grid', () => {
  it('device columns and spans', () => {
    expect(gridColumns('tablet', 2000)).toBe(2)
    expect(gridColumns('mobile', 2000)).toBe(1)
    expect(gridColumns('desktop', 1200)).toBe(4)
    expect(gridColumns('desktop', 700)).toBe(2)
    expect(gridColumns('desktop', 0)).toBe(4)
    expect(spanFor(3, 2)).toBe(2)
    expect(spanFor(1, 4)).toBe(1)
  })
})

describe('filterSummary / accessSummary', () => {
  it('describes filters', () => {
    expect(filterSummary({ range: 'last_30', site: 'All', country: 'KSA' }, DASHBOARD_RANGE_PRESETS)).toBe('Last 30 days, all sites, KSA')
    expect(filterSummary({ range: 'custom', from: '2026-01-01', to: null, site: 'NHC' }, DASHBOARD_RANGE_PRESETS)).toBe('2026-01-01 to today, NHC, all countries')
  })
  it('access', () => {
    expect(accessSummary({ created_by: 'u1', shared: false }, { userId: 'u1' }).owner).toBe('You')
    expect(accessSummary({ created_by: 'u2', shared: true }, { userId: 'u1' }).canEdit).toBe(false)
    expect(accessSummary({}, { isStarter: true }).canEdit).toBe(false)
    expect(accessSummary(null)).toBeNull()
  })
})
