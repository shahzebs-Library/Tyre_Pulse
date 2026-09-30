import { describe, it, expect } from 'vitest'
import {
  pctChange, movement, buildComparison, filterRows, formatPct, periodText, comparisonExportRows, UNRECORDED,
} from '../lib/comparisonAnalytics'

const A = { year: 2025, months: [0, 1] }
const B = { year: 2026, months: [0, 1] }
const recs = [
  { issue_date: '2025-01-10', cost_per_tyre: 100, qty: 1, site: 'NHC', brand: 'X' },
  { issue_date: '2025-02-10', cost_per_tyre: 100, qty: 2, site: 'NHC', brand: 'X' },
  { issue_date: '2025-03-10', cost_per_tyre: 999, qty: 1, site: 'NHC', brand: 'X' }, // month not selected
  { issue_date: '2026-01-10', cost_per_tyre: 300, qty: 1, site: 'JED', brand: 'Y' },
  { issue_date: '2026-01-11', cost_per_tyre: null, qty: 1, site: null, brand: 'Y' },
  { issue_date: '2026-02-11', cost_per_tyre: 50, qty: 1, site: 'NHC', brand: 'X' },
]

describe('comparisonAnalytics', () => {
  it('never invents a percentage from a zero base', () => {
    expect(pctChange(0, 5)).toBeNull()
    expect(pctChange(0, 0)).toBeNull()
    expect(pctChange(100, 150)).toBe(50)
    expect(movement(0, 5)).toBe('New')
    expect(movement(5, 0)).toBe('Stopped')
    expect(movement(0, 0)).toBe('Flat')
    expect(movement(3, 1)).toBe('Down')
    expect(formatPct(null)).toBe('N/A')
    expect(formatPct(12)).toBe('+12%')
  })

  it('overall by month honours the month chips', () => {
    const r = buildComparison(recs, { periodA: A, periodB: B, metric: 'count', dimension: 'overall' })
    expect(r.rows.map((x) => x.label)).toEqual(['Jan', 'Feb'])
    expect(r.rows[0]).toMatchObject({ a: 1, b: 2, diff: 1, pct: 100, movement: 'Up' })
    expect(r.totals).toEqual({ a: 2, b: 3, diff: 1, pct: 50 })
    expect(r.recordsA).toBe(2)
  })

  it('cost metric reports priced coverage and average price', () => {
    const r = buildComparison(recs, { periodA: A, periodB: B, metric: 'cost', dimension: 'overall' })
    expect(r.totals.a).toBe(300)
    expect(r.totals.b).toBe(350)
    expect(r.pricedPctA).toBe(100)
    expect(r.pricedPctB).toBe(67)
    expect(r.avgCostB).toBe(175)
  })

  it('breakdown keeps unrecorded values so totals agree with overall', () => {
    const r = buildComparison(recs, { periodA: A, periodB: B, metric: 'count', dimension: 'site' })
    const labels = r.rows.map((x) => x.label)
    expect(labels).toContain(UNRECORDED)
    expect(r.totals.b).toBe(3)
    const jed = r.rows.find((x) => x.label === 'JED')
    expect(jed.movement).toBe('New')
    expect(jed.pct).toBeNull()
    expect(r.added).toBe(2)
    expect(r.biggestFaller.label).toBe('NHC')
  })

  it('filters, labels periods and exports', () => {
    const r = buildComparison(recs, { periodA: A, periodB: B, metric: 'count', dimension: 'site' })
    expect(filterRows(r.rows, { movement: 'New' }).map((x) => x.label).sort()).toEqual(['JED', UNRECORDED].sort())
    expect(filterRows(r.rows, { search: 'nh' }).map((x) => x.label)).toEqual(['NHC'])
    expect(periodText({ year: 2026, months: [0, 1] })).toBe('Jan, Feb 2026')
    expect(periodText({ year: 2026, months: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11] })).toBe('2026 (full year)')
    const out = comparisonExportRows(r.rows)
    expect(out.find((x) => x.label === 'JED').pct_change).toBe('N/A')
  })
})

describe('comparisonMetricFor (currency scope, audit 2026-09-30)', () => {
  it('never allows a cost total across all countries (SAR+AED+EGP)', async () => {
    const { comparisonMetricFor } = await import('../lib/comparisonAnalytics')
    expect(comparisonMetricFor('All', 'cost')).toBe('count')
    expect(comparisonMetricFor(undefined, 'cost')).toBe('count')
    expect(comparisonMetricFor('KSA', 'cost')).toBe('cost')
    expect(comparisonMetricFor('All', 'count')).toBe('count')
    expect(comparisonMetricFor('UAE', 'bogus')).toBe('count')
  })
})
