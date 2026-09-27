import { describe, expect, it } from 'vitest'
import {
  normaliseRecords, recordsForYear, monthlyActuals, averageCpk, derivedAnnualBudget, ytdThroughMonth,
  budgetPosition, budgetStatus, siteAllocation, brandAnalysis, linearRegression, historicalTrend,
  scenarioProjection, quarterSummary, cpkImprovementSaving, monthlyExportRows, filterSites,
} from '../lib/budgetPlannerAnalytics'

const raw = [
  { issue_date: '2026-01-15', cost_per_tyre: '1000', site: 'NHC', brand: 'A', km_at_fitment: 0, km_at_removal: 10000 },
  { issue_date: '2026-02-01', cost_per_tyre: 500, site: 'JED', brand: 'B' },
  { issue_date: '2025-03-10', cost_per_tyre: 600, site: 'NHC', brand: 'A', km_at_fitment: 0, km_at_removal: 6000 },
  { issue_date: '2024-05-10', cost_per_tyre: 300, site: 'NHC', brand: 'A' },
  { issue_date: null, cost_per_tyre: 999 },
]
const rows = normaliseRecords(raw)

describe('normalise + actuals', () => {
  it('parses the date without timezone drift', () => {
    expect(rows[0].year).toBe(2026); expect(rows[0].month).toBe(0); expect(rows[4].year).toBeNull()
  })
  it('buckets monthly spend', () => {
    const m = monthlyActuals(recordsForYear(rows, 2026))
    expect(m[0]).toBe(1000); expect(m[1]).toBe(500)
  })
  it('CPK is null without measured distance', () => {
    expect(averageCpk([{ cost: 100, kmFit: 0, kmRem: 0 }])).toBeNull()
    expect(averageCpk(recordsForYear(rows, 2026))).toBeCloseTo(0.1)
  })
})

describe('budget position', () => {
  it('derived annual budget is null without history', () => {
    expect(derivedAnnualBudget(rows, 2024)).toBeNull()
    expect(derivedAnnualBudget(rows, 2026)).toBe(Math.round(((600 + 300) / 2) * 1.05))
  })
  it('YTD month for past, current, future years', () => {
    expect(ytdThroughMonth(2025, 2026, 4)).toBe(11)
    expect(ytdThroughMonth(2026, 2026, 4)).toBe(4)
    expect(ytdThroughMonth(2027, 2026, 4)).toBe(-1)
  })
  it('pct and variance are null with no budget', () => {
    const p = budgetPosition({ actuals: [100, 100, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], annualBudget: null, throughMonth: 1 })
    expect(p.pctUsed).toBeNull(); expect(p.variance).toBeNull(); expect(p.projectedYearEnd).toBe(1200)
    const q = budgetPosition({ actuals: Array(12).fill(100), annualBudget: 2400, throughMonth: 11 })
    expect(q.pctUsed).toBe(50); expect(q.variance).toBe(1200)
    expect(budgetPosition({ actuals: [], annualBudget: 100, throughMonth: -1 }).projectedYearEnd).toBeNull()
  })
  it('status bands', () => {
    expect(budgetStatus(null)).toBe('No Budget'); expect(budgetStatus(101)).toBe('Over Budget')
    expect(budgetStatus(95)).toBe('Warning'); expect(budgetStatus(10)).toBe('On Track')
  })
})

describe('sites, brands, quarters', () => {
  const ty = recordsForYear(rows, 2026)
  const py = recordsForYear(rows, 2025)
  it('site allocation uses stored budget, even share, or none', () => {
    const s = siteAllocation({ yearRows: ty, prevYearRows: py, siteBudgets: { NHC: 2000 }, annualBudget: 3000, monthsElapsed: 2 })
    const nhc = s.find((x) => x.site === 'NHC'); const jed = s.find((x) => x.site === 'JED')
    expect(nhc.budget).toBe(2000); expect(nhc.budgetSource).toBe('stored'); expect(nhc.prevActual).toBe(600)
    expect(jed.budget).toBe(1500); expect(jed.budgetSource).toBe('even-share')
    const none = siteAllocation({ yearRows: ty, annualBudget: null, monthsElapsed: 2 })
    expect(none[0].budget).toBeNull(); expect(none[0].status).toBe('No Budget')
  })
  it('brand analysis compares years', () => {
    const b = brandAnalysis(ty, py)
    const a = b.find((x) => x.brand === 'A')
    expect(a.change).toBeCloseTo(66.67, 1); expect(b.find((x) => x.brand === 'B').change).toBeNull()
  })
  it('quarters report null pct without budget', () => {
    const q = quarterSummary({ actuals: Array(12).fill(10), monthlyBudget: 0, selectedYear: 2025, currentYear: 2026, currentMonth: 0 })
    expect(q[0].pct).toBeNull(); expect(q[0].status).toBe('Complete')
    const q2 = quarterSummary({ actuals: Array(12).fill(10), monthlyBudget: 5, selectedYear: 2026, currentYear: 2026, currentMonth: 1 })
    expect(q2[0].status).toBe('Over')
  })
})

describe('trend, scenario, exports', () => {
  it('regression and trend', () => {
    expect(linearRegression([1, 2, 3]).predict(3)).toBeCloseTo(4)
    expect(historicalTrend(normaliseRecords([{ issue_date: '2026-01-01', cost_per_tyre: 1 }])).nextYearProjection).toBeNull()
    expect(historicalTrend(rows).trendYears).toEqual([2024, 2025, 2026])
  })
  it('scenario', () => {
    expect(scenarioProjection({ projectedYearEnd: null })).toBeNull()
    const s = scenarioProjection({ projectedYearEnd: 1000, currentAvgCpk: 2, cpkTarget: 1, volumeChange: 10 })
    expect(s.projected).toBeCloseTo(550); expect(s.saving).toBeCloseTo(450)
  })
  it('cpk improvement + exports + filters', () => {
    expect(cpkImprovementSaving({ cpk: null })).toEqual({ target: null, saving: null })
    expect(cpkImprovementSaving({ cpk: 1, actual: 1000 }).saving).toBeCloseTo(150)
    expect(monthlyExportRows(Array(12).fill(5), 0)[0].used).toBe('N/A')
    expect(filterSites([{ site: 'NHC', status: 'Warning' }, { site: 'JED', status: 'On Track' }], { query: 'nh' })).toHaveLength(1)
    expect(filterSites([{ site: 'NHC', status: 'Warning' }], { status: 'On Track' })).toHaveLength(0)
  })
})
