import { describe, it, expect } from 'vitest'
import {
  yearMonthOf, tyreRowCost, buildSpendIndex, spendFor, utilization, utilBand, monthlyRows,
  summarizeMonth, unbudgetedSpend, filterMonthlyRows, annualGrid, annualSummary, cumulativeSeries,
  monthlyExportRows, annualExportRows, annualExportColumns,
} from '../lib/budgetsAnalytics'

const TYRES = [
  { site: 'NHC', cost_per_tyre: 1000, qty: 2, issue_date: '2026-03-04' },
  { site: 'NHC', cost_per_tyre: 500, qty: null, issue_date: '2026-03-20' },
  { site: 'JED', cost_per_tyre: '800', qty: 1, issue_date: '2026-04-01' },
  { site: 'RUH', cost_per_tyre: 300, qty: 1, issue_date: '2026-03-10' },
  { site: 'NHC', cost_per_tyre: 999, qty: 1, issue_date: null },
]
const BUDGETS = [
  { id: 1, site: 'NHC', monthly_budget: 2000, year: 2026, month: 3, status: 'Approved' },
  { id: 2, site: 'JED', monthly_budget: 0, year: 2026, month: 3 },
  { id: 3, site: 'JED', monthly_budget: 1000, year: 2026, month: 4 },
]

describe('budgetsAnalytics', () => {
  it('reads year and month from the date text without timezone drift', () => {
    expect(yearMonthOf('2026-12-31T23:30:00Z')).toEqual({ year: 2026, month: 12 })
    expect(yearMonthOf('')).toBeNull()
    expect(yearMonthOf('nonsense')).toBeNull()
  })

  it('costs a tyre row as price x qty, a missing qty counting as one tyre', () => {
    expect(tyreRowCost({ cost_per_tyre: 100, qty: 3 })).toBe(300)
    expect(tyreRowCost({ cost_per_tyre: 100 })).toBe(100)
    expect(tyreRowCost({ cost_per_tyre: 'x', qty: 2 })).toBe(0)
  })

  it('attributes rows to the fixed month when one is given, else to their own month', () => {
    const month = buildSpendIndex(TYRES.slice(0, 2), { year: 2026, month: 3 })
    expect(spendFor(month, 'NHC', 2026, 3)).toBe(2500)
    const year = buildSpendIndex(TYRES, { year: 2026 })
    expect(spendFor(year, 'NHC', 2026, 3)).toBe(2500)
    expect(spendFor(year, 'JED', 2026, 4)).toBe(800)
    // the undated row is skipped rather than guessed into a month
    expect(Object.values(year).reduce((a, b) => a + b, 0)).toBe(3600)
  })

  it('returns null utilisation, never 0%, when there is no budget', () => {
    expect(utilization(0, 500)).toBeNull()
    expect(utilization(null, 0)).toBeNull()
    expect(utilization(1000, 850)).toBe(85)
    expect(utilBand(null)).toBe('none')
    expect(utilBand(120)).toBe('over')
    expect(utilBand(80)).toBe('warn')
    expect(utilBand(10)).toBe('ok')
  })

  it('builds monthly rows and a summary, keeping the no-budget band honest', () => {
    const index = buildSpendIndex(TYRES, { year: 2026 })
    const rows = monthlyRows(BUDGETS.filter((b) => b.month === 3), index, 2026, 3)
    expect(rows.find((r) => r.site === 'NHC')).toMatchObject({ budget: 2000, spent: 2500, remaining: -500, band: 'over' })
    expect(rows.find((r) => r.site === 'JED')).toMatchObject({ utilPct: null, band: 'none', status: 'Draft' })
    const sum = summarizeMonth(rows)
    expect(sum).toMatchObject({ sites: 2, totalBudget: 2000, totalSpend: 2500, overCount: 1, noBudgetCount: 1 })
    expect(sum.utilPct).toBe(125)
    expect(summarizeMonth([]).utilPct).toBeNull()
  })

  it('reports spend at sites that carry no budget row', () => {
    const index = buildSpendIndex(TYRES, { year: 2026 })
    const out = unbudgetedSpend(index, BUDGETS.filter((b) => b.month === 3), 2026, 3)
    expect(out).toEqual([{ site: 'RUH', spent: 300 }])
  })

  it('filters by search, band and status', () => {
    const index = buildSpendIndex(TYRES, { year: 2026 })
    const rows = monthlyRows(BUDGETS.filter((b) => b.month === 3), index, 2026, 3)
    expect(filterMonthlyRows(rows, { query: 'nh' })).toHaveLength(1)
    expect(filterMonthlyRows(rows, { band: 'none' })[0].site).toBe('JED')
    expect(filterMonthlyRows(rows, { status: 'Approved' })[0].site).toBe('NHC')
  })

  it('builds the planner grid with edits taking precedence and overruns flagged', () => {
    const index = buildSpendIndex(TYRES, { year: 2026 })
    const grid = annualGrid(BUDGETS, index, 2026, { 'JED~4': '500' })
    const jed = grid.find((r) => r.site === 'JED')
    expect(jed.cells[3]).toMatchObject({ value: '500', budget: 500, spent: 800, over: true, edited: true })
    const nhc = grid.find((r) => r.site === 'NHC')
    expect(nhc.budgetTotal).toBe(2000)
    expect(nhc.cells[2].over).toBe(true)
    const sum = annualSummary(grid)
    expect(sum.overCells).toBe(2)
    const series = cumulativeSeries(grid)
    expect(series.cumBudget[11]).toBe(sum.budget)
    expect(series.cumSpend[11]).toBe(sum.spend)
  })

  it('shapes export rows with N/A for an unmeasurable utilisation', () => {
    const rows = monthlyExportRows([{ site: 'A', budget: 0, spent: 10, remaining: -10, utilPct: null, band: 'none' }])
    expect(rows[0]).toMatchObject({ util: 'N/A', band: 'No budget set', status: 'Draft' })
    const grid = annualGrid(BUDGETS, {}, 2026)
    const { keys, headers } = annualExportColumns()
    expect(keys).toHaveLength(headers.length)
    expect(Object.keys(annualExportRows(grid)[0])).toEqual(keys)
  })
})
