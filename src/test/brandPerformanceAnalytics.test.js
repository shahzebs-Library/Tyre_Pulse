import { describe, it, expect } from 'vitest'
import {
  sitesOf, filterBrandRecords, buildBrandMetrics, summarizeBrands, failureBand,
  categoryBreakdown, brandExportRows, flattenSizeGroups,
} from '../lib/brandPerformanceAnalytics'

const rows = [
  { brand: 'A', site: 'NHC', risk_level: 'High', cost_per_tyre: 1000, qty: 1, category: 'Wear' },
  { brand: 'A', site: 'NHC', risk_level: 'Low', cost_per_tyre: 500, qty: 2, category: 'Wear' },
  { brand: 'A', site: 'JED', risk_level: null, cost_per_tyre: null, category: null },
  { brand: 'B', site: 'JED', risk_level: 'Critical', cost_per_tyre: 800 },
  { brand: 'B', site: 'JED', risk_level: 'Critical', cost_per_tyre: 0 },
  { brand: 'C', site: ' ', risk_level: '', cost_per_tyre: null },
]

describe('brandPerformanceAnalytics', () => {
  it('lists distinct non-blank sites', () => {
    expect(sitesOf(rows)).toEqual(['JED', 'NHC'])
  })

  it('filters by site and risk (empty selection = all)', () => {
    expect(filterBrandRecords(rows)).toHaveLength(6)
    expect(filterBrandRecords(rows, { sites: ['NHC'] })).toHaveLength(2)
    expect(filterBrandRecords(rows, { riskLevels: ['critical'] })).toHaveLength(2)
  })

  it('measures failure rate over RATED rows only and nulls unrated brands', () => {
    const m = buildBrandMetrics(rows)
    const a = m.find(x => x.brand === 'A')
    expect(a.count).toBe(3)
    expect(a.ratedCount).toBe(2)
    expect(a.failureRate).toBe(50)
    const c = m.find(x => x.brand === 'C')
    expect(c.failureRate).toBeNull()
    expect(c.riskScore).toBeNull()
    expect(c.totalCost).toBeNull()
    expect(c.avgCost).toBeNull()
  })

  it('averages cost over priced rows only (qty-weighted line)', () => {
    const a = buildBrandMetrics(rows).find(x => x.brand === 'A')
    expect(a.pricedCount).toBe(2)
    expect(a.totalCost).toBe(2000)
    expect(a.avgCost).toBe(1000)
  })

  it('summary prefers the grid cost and picks best/worst among measured brands', () => {
    const m = buildBrandMetrics(rows)
    const s = summarizeBrands(m, { fleetTyreCost: 99 })
    expect(s.totalCost).toBe(99)
    expect(s.costBasis).toBe('grid')
    expect(s.best.brand).toBe('A')
    expect(s.worst.brand).toBe('B')
    expect(s.fleetFailureRate).toBeCloseTo((3 / 4) * 100)
    const noGrid = summarizeBrands(m)
    expect(noGrid.costBasis).toBe('records')
  })

  it('returns honest nulls when nothing is rated', () => {
    const s = summarizeBrands(buildBrandMetrics([{ brand: 'X' }]))
    expect(s.best).toBeNull()
    expect(s.worst).toBeNull()
    expect(s.fleetFailureRate).toBeNull()
    expect(s.totalCost).toBeNull()
  })

  it('bands failure rates', () => {
    expect(failureBand(null)).toBeNull()
    expect(failureBand(40)).toBe('high')
    expect(failureBand(20)).toBe('elevated')
    expect(failureBand(5)).toBe('low')
  })

  it('breaks down categories and exports N/A for unknowns', () => {
    const b = categoryBreakdown(rows.filter(r => r.brand === 'A'))
    expect(b[0]).toMatchObject({ category: 'Wear', count: 2 })
    const ex = brandExportRows(buildBrandMetrics(rows)).find(r => r.brand === 'C')
    expect(ex.failure_rate).toBe('N/A')
    expect(ex.top_category).toBe('N/A')
  })

  it('flattens size groups into one row per size and brand', () => {
    const flat = flattenSizeGroups([{ size: '315/80R22.5', currency: 'SAR', brands: [{ brand: 'A', cpk: 0.01, isBestValue: true }, { brand: 'B', cpk: null }] }])
    expect(flat).toHaveLength(2)
    expect(flat[0]).toMatchObject({ id: '315/80R22.5|A', isBestValue: true, currency: 'SAR' })
    expect(flat[1].cpk).toBeNull()
  })
})
