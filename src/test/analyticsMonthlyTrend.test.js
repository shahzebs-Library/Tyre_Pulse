import { describe, it, expect } from 'vitest'
import { buildMonthlyTrend } from '../pages/Analytics'
import { computeSiteMetrics, computeBrandMetrics } from '../lib/analyticsEngine'

/**
 * The Monthly Trend chart on /analytics used to sum cost_per_tyre WITHOUT the
 * qty multiplier. cost_per_tyre is the "Unit Cost / Tyre" (see TYRE_FIELDS in
 * src/lib/import/synonyms.js) and a single tyre_records row can cover several
 * tyres, so the chart understated every month with a qty > 1 row while the
 * Total Cost KPI and the site/brand tables on the SAME page multiplied by qty.
 *
 * The KPI formula these tests reconcile against is the one in Analytics.jsx:
 *   totalCost = sum( (parseFloat(cost_per_tyre) || 0) * (qty || 1) )
 */
const kpiTotalCost = (rows) =>
  rows.reduce((s, r) => s + (parseFloat(r.cost_per_tyre) || 0) * (r.qty || 1), 0)

describe('buildMonthlyTrend (Analytics monthly cost)', () => {
  it('multiplies cost_per_tyre by qty', () => {
    const rows = [{ issue_date: '2026-03-11', cost_per_tyre: 100, qty: 4 }]
    expect(buildMonthlyTrend(rows)[0].cost).toBe(400)
  })

  it('treats a missing/null/zero qty as 1 rather than dropping the cost', () => {
    const rows = [
      { issue_date: '2026-03-01', cost_per_tyre: 100 },
      { issue_date: '2026-03-02', cost_per_tyre: 100, qty: null },
      { issue_date: '2026-03-03', cost_per_tyre: 100, qty: 0 },
    ]
    const [march] = buildMonthlyTrend(rows)
    expect(march.cost).toBe(300)
    expect(march.count).toBe(3)
  })

  it('reconciles with the page Total Cost KPI across months', () => {
    const rows = [
      { issue_date: '2026-01-05', cost_per_tyre: 250, qty: 6 },
      { issue_date: '2026-01-20', cost_per_tyre: 100, qty: 1 },
      { issue_date: '2026-02-14', cost_per_tyre: 80, qty: 12 },
      { issue_date: '2026-02-15', cost_per_tyre: 500 },
    ]
    const trend = buildMonthlyTrend(rows)
    const charted = trend.reduce((s, m) => s + m.cost, 0)

    expect(trend.map((m) => m.month)).toEqual(['2026-01', '2026-02'])
    expect(trend[0].cost).toBe(1600)
    expect(trend[1].cost).toBe(1460)
    // The bars must add up to the KPI card sitting directly above the chart.
    expect(charted).toBe(kpiTotalCost(rows))
    expect(charted).toBe(3060)
  })

  it('agrees with the site and brand tables on the same page', () => {
    const rows = [
      { issue_date: '2026-04-02', cost_per_tyre: 300, qty: 4, site: 'NHC', brand: 'Double Coin' },
      { issue_date: '2026-04-09', cost_per_tyre: 150, qty: 2, site: 'RED SEA', brand: 'Double Coin' },
    ]
    const charted = buildMonthlyTrend(rows).reduce((s, m) => s + m.cost, 0)
    const siteTotal = computeSiteMetrics(rows).reduce((s, r) => s + r.totalCost, 0)
    const brandTotal = computeBrandMetrics(rows).reduce((s, r) => s + r.totalCost, 0)

    expect(charted).toBe(1500)
    expect(siteTotal).toBe(charted)
    expect(brandTotal).toBe(charted)
  })

  it('counts every record but only costs the ones carrying a price', () => {
    const rows = [
      { issue_date: '2026-05-01', cost_per_tyre: null, qty: 4 },
      { issue_date: '2026-05-02', cost_per_tyre: 90, qty: 2 },
    ]
    const [may] = buildMonthlyTrend(rows)
    expect(may.count).toBe(2)
    expect(may.cost).toBe(180)
  })

  it('buckets by month, sorts chronologically and skips undated rows', () => {
    const rows = [
      { issue_date: '2026-12-31', cost_per_tyre: 10, qty: 1 },
      { issue_date: '2026-02-01', cost_per_tyre: 10, qty: 1 },
      { issue_date: null, cost_per_tyre: 999, qty: 99 },
      { cost_per_tyre: 999, qty: 99 },
    ]
    const trend = buildMonthlyTrend(rows)
    expect(trend.map((m) => m.month)).toEqual(['2026-02', '2026-12'])
    expect(trend.reduce((s, m) => s + m.cost, 0)).toBe(20)
  })

  it('degrades honestly on empty or non-array input', () => {
    expect(buildMonthlyTrend([])).toEqual([])
    expect(buildMonthlyTrend()).toEqual([])
    expect(buildMonthlyTrend(null)).toEqual([])
  })
})
