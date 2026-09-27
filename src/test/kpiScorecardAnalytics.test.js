import { describe, it, expect } from 'vitest'
import {
  DEFAULT_TARGETS, monthWindow, priorYearMonths, monthsToDateRange, gridCostByMonth,
  monthlyActuals, overdueActionCount, passes, costRegression, performanceAlerts, siteRows,
  deltaOf, actualsExportRows,
} from '../lib/kpiScorecardAnalytics'

const NOW = new Date(2026, 8, 15)

describe('kpiScorecardAnalytics', () => {
  it('rolling window ends at the injected month; custom ranges clamp to 24', () => {
    const w = monthWindow({ now: NOW })
    expect(w.months).toHaveLength(12)
    expect(w.months[11]).toBe('2026-09')
    expect(w.custom).toBe(false)
    const c = monthWindow({ rangeFrom: '2023-01-10', rangeTo: '2026-02-01', now: NOW })
    expect(c.custom).toBe(true)
    expect(c.clamped).toBe(true)
    expect(c.months).toHaveLength(24)
    expect(c.months[23]).toBe('2026-02')
    expect(monthWindow({ rangeFrom: '2026-05-01', rangeTo: '2026-01-01', now: NOW }).custom).toBe(false)
  })

  it('prior-year months and date range', () => {
    expect(priorYearMonths(['2026-01', '2026-02'])).toEqual(['2025-01', '2025-02'])
    expect(monthsToDateRange(['2026-01', '2026-02'])).toEqual({ from: '2026-01-01', to: '2026-02-28' })
    expect(monthsToDateRange([])).toEqual({ from: null, to: null })
  })

  it('gridCostByMonth refuses a blended split', () => {
    expect(gridCostByMonth({ blended: true, byMonth: [] })).toBeNull()
    expect(gridCostByMonth(null)).toBeNull()
    const m = gridCostByMonth({ blended: false, byMonth: [{ month: '2026-01', tyre: 50 }] })
    expect(m.get('2026-01')).toBe(50)
  })

  it('monthlyActuals: cost from the grid map, high-risk over rated tyres only', () => {
    const records = [
      { issue_date: '2026-01-05', risk_level: 'High', cost_per_tyre: 999 },
      { issue_date: '2026-01-06', risk_level: 'Low' },
      { issue_date: '2026-01-07' },
      { issue_date: '2026-02-01' },
    ]
    const cost = new Map([['2026-01', 300]])
    const [jan, feb] = monthlyActuals(records, ['2026-01', '2026-02'], cost)
    expect(jan).toMatchObject({ count: 3, rated: 2, highRiskPct: 50, totalCost: 300, avgCostPerTyre: 100 })
    expect(feb).toMatchObject({ count: 1, rated: 0, highRiskPct: null, totalCost: 0 })
    const [janNoCost] = monthlyActuals(records, ['2026-01'], null)
    expect(janNoCost.totalCost).toBeNull() // never the cost_per_tyre sum
    expect(janNoCost.avgCostPerTyre).toBeNull()
  })

  it('overdue actions use the injected clock', () => {
    const acts = [{ due_date: '2026-09-01', status: 'Open' }, { due_date: '2026-10-01', status: 'Open' }, { due_date: '2026-01-01', status: 'Closed' }]
    expect(overdueActionCount(acts, NOW)).toBe(1)
  })

  it('passes is null for an unmeasured actual', () => {
    expect(passes(null, 10, true)).toBeNull()
    expect(passes(5, 10, true)).toBe(true)
    expect(passes(5, 10, false)).toBe(false)
    expect(deltaOf(null, 2)).toBeNull()
    expect(deltaOf(5, 2)).toBe(3)
  })

  it('costRegression needs two measured months', () => {
    expect(costRegression([{ totalCost: null }, { totalCost: 5 }])).toBeNull()
    const r = costRegression([{ totalCost: 10 }, { totalCost: 20 }, { totalCost: 30 }])
    expect(r.slope).toBeCloseTo(10)
    expect(r.r2).toBeCloseTo(1)
    expect(r.predict(3)).toBeCloseTo(40)
  })

  it('performanceAlerts skips unmeasured metrics', () => {
    const cur = { totalCost: null, highRiskPct: 50, avgCostPerTyre: null }
    const a = performanceAlerts(cur, DEFAULT_TARGETS, 1)
    expect(a.map(x => x.key)).toEqual(['max_high_risk_pct'])
    expect(performanceAlerts(null, DEFAULT_TARGETS, 0)).toEqual([])
  })

  it('siteRows measures per site for the month', () => {
    const recs = [
      { site: 'A', issue_date: '2026-09-02', risk_level: 'High' },
      { site: 'A', issue_date: '2026-08-02' },
      { site: 'B', issue_date: '2026-09-03' },
    ]
    const rows = siteRows(recs, '2026-09', { ...DEFAULT_TARGETS, min_records_month: 1 })
    const a = rows.find(r => r.site === 'A')
    const b = rows.find(r => r.site === 'B')
    expect(a).toMatchObject({ count: 1, windowCount: 2, rated: 1, highRiskPct: 100, recordsPass: true, riskPass: false })
    expect(b).toMatchObject({ highRiskPct: null, riskPass: null })
  })

  it('export rows say N/A for unmeasured values', () => {
    const rows = actualsExportRows([{ month: '2026-01', count: 1, rated: 0, totalCost: null, highRiskPct: null, avgCostPerTyre: null }], DEFAULT_TARGETS)
    expect(rows[0]).toMatchObject({ totalCost: 'N/A', costVsTarget: 'N/A', highRiskPct: 'N/A', avgCostPerTyre: 'N/A' })
  })
})
