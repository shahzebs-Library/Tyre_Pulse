import { describe, it, expect } from 'vitest'
import {
  gridTyreSpend, gridMonthlyActuals, derivedAnnualBudgetFromYears, historicalTrendFromYears,
  budgetPosition, quarterSummary, monthlyExportRows, GROWTH_ASSUMPTION,
} from '../lib/budgetPlannerAnalytics'

// The shape loadCostSplit returns for the grid path: zero-filled months across the window.
const window = (from, to, values = {}) => {
  const out = []
  let [y, m] = from.split('-').map(Number)
  const [ty, tm] = to.split('-').map(Number)
  while (y < ty || (y === ty && m <= tm)) {
    const k = `${y}-${String(m).padStart(2, '0')}`
    out.push({ month: k, tyre: values[k] ?? 0, maintenance: 0 })
    m += 1; if (m > 12) { m = 1; y += 1 }
  }
  return out
}

describe('gridTyreSpend', () => {
  it('sums the grid tyre bucket per year and month', () => {
    const g = gridTyreSpend(window('2025-01', '2026-12', { '2025-03': 100, '2025-11': 50, '2026-02': 70 }))
    expect(g.byYear).toEqual({ 2025: 150, 2026: 70 })
    expect(g.byYearMonth[2026][1]).toBe(70)
  })
  it('a year with only zero-filled months is NO DATA, not zero spend', () => {
    const g = gridTyreSpend(window('2022-01', '2026-12', { '2026-01': 10 }))
    expect(Object.keys(g.byYear)).toEqual(['2026'])
    expect(gridMonthlyActuals(g, 2024)).toBeNull()
    expect(gridMonthlyActuals(g, 2026)[0]).toBe(10)
  })
  it('ignores junk months and non-numeric amounts', () => {
    const g = gridTyreSpend([{ month: 'x', tyre: 5 }, { month: '2026-13', tyre: 5 }, { month: '2026-01', tyre: 'abc' }])
    expect(g.byYear).toEqual({})
  })
  it('gridMonthlyActuals returns a copy (no shared mutation)', () => {
    const g = gridTyreSpend(window('2026-01', '2026-12', { '2026-01': 10 }))
    gridMonthlyActuals(g, 2026)[0] = 999
    expect(g.byYearMonth[2026][0]).toBe(10)
  })
})

describe('budget from grid years', () => {
  it('derives the budget from up to 3 prior years x growth', () => {
    expect(derivedAnnualBudgetFromYears({ 2023: 100, 2024: 200, 2025: 300, 2026: 999 }, 2026)).toBe(Math.round(200 * GROWTH_ASSUMPTION))
    expect(derivedAnnualBudgetFromYears({ 2026: 5 }, 2026)).toBeNull()
    expect(derivedAnnualBudgetFromYears(null, 2026)).toBeNull()
  })
  it('trend over grid years', () => {
    const t = historicalTrendFromYears({ 2024: 100, 2025: 200 })
    expect(t.trendYears).toEqual([2024, 2025])
    expect(t.nextYearProjection).toBeCloseTo(300)
    expect(historicalTrendFromYears(null).nextYearProjection).toBeNull()
  })
})

describe('unknown spend is N/A, never 0', () => {
  it('budgetPosition with no actuals', () => {
    const p = budgetPosition({ actuals: null, annualBudget: 1200, throughMonth: 2 })
    expect(p.ytdActual).toBeNull()
    expect(p.variance).toBeNull()
    expect(p.pctUsed).toBeNull()
    expect(p.projectedYearEnd).toBeNull()
    expect(p.monthlyBudget).toBe(100)
  })
  it('quarters and export with no actuals', () => {
    const q = quarterSummary({ actuals: null, monthlyBudget: 100, selectedYear: 2026, currentYear: 2026, currentMonth: 10 })
    expect(q[0].actual).toBeNull()
    expect(q[0].variance).toBeNull()
    expect(q[0].pct).toBeNull()
    const rows = monthlyExportRows(null, 100)
    expect(rows[0].actual).toBe('N/A')
    expect(rows[0].variance).toBe('N/A')
  })
  it('known actuals still behave as before', () => {
    const p = budgetPosition({ actuals: [100, 100, 100, 0, 0, 0, 0, 0, 0, 0, 0, 0], annualBudget: 1200, throughMonth: 2 })
    expect(p.ytdActual).toBe(300)
    expect(p.variance).toBe(0)
  })
})
