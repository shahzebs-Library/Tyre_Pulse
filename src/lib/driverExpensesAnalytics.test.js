import { describe, it, expect } from 'vitest'
import {
  EXPENSE_STATUSES,
  APPROVED_STATUSES,
  KNOWN_CATEGORIES,
  toAmount,
  normStatus,
  statusLabel,
  normCategory,
  categoryLabel,
  expenseTime,
  statusBreakdown,
  categoryBreakdown,
  topDrivers,
  monthlyTrend,
  computeKpis,
  filterExpenses,
  sortExpenses,
  distinctValues,
  distinctCategories,
  analyzeExpenses,
} from './driverExpensesAnalytics'

const ex = (o) => ({ driver_name: 'Ahmed', category: 'fuel', amount: 100, expense_date: '2026-07-01', status: 'pending', ...o })

const SAMPLE = [
  ex({ driver_name: 'Ahmed', category: 'fuel', amount: 200, expense_date: '2026-07-10', status: 'approved', asset_no: 'TRK-1' }),
  ex({ driver_name: 'Ahmed', category: 'toll', amount: 50, expense_date: '2026-07-12', status: 'reimbursed', asset_no: 'TRK-1' }),
  ex({ driver_name: 'Bilal', category: 'fuel', amount: 300, expense_date: '2026-06-05', status: 'pending', asset_no: 'TRK-2' }),
  ex({ driver_name: 'Bilal', category: 'maintenance', amount: 400, expense_date: '2026-07-15', status: 'rejected', asset_no: 'TRK-2', description: 'brake pads' }),
  ex({ driver_name: 'Carlos', category: 'meals', amount: 80, expense_date: '2026-05-01', status: 'approved' }),
  ex({ driver_name: 'Carlos', category: 'fuel', amount: null, expense_date: '2026-07-20', status: 'pending' }),
]

describe('constants', () => {
  it('exposes the real status + category vocab', () => {
    expect(EXPENSE_STATUSES).toEqual(['pending', 'approved', 'rejected', 'reimbursed'])
    expect(APPROVED_STATUSES).toEqual(['approved', 'reimbursed'])
    expect(KNOWN_CATEGORIES).toContain('fuel')
    expect(KNOWN_CATEGORIES).toContain('accommodation')
  })
})

describe('toAmount', () => {
  it('coerces numbers, strings and blanks', () => {
    expect(toAmount(12.5)).toBe(12.5)
    expect(toAmount('30.25')).toBe(30.25)
    expect(toAmount('')).toBe(0)
    expect(toAmount(null)).toBe(0)
    expect(toAmount('abc')).toBe(0)
  })
})

describe('normStatus / statusLabel', () => {
  it('keeps known statuses and folds unknown to pending', () => {
    expect(normStatus('approved')).toBe('approved')
    expect(normStatus('REIMBURSED')).toBe('reimbursed')
    expect(normStatus('mystery')).toBe('pending')
    expect(normStatus(null)).toBe('pending')
  })
  it('labels are human readable', () => {
    expect(statusLabel('reimbursed')).toBe('Reimbursed')
    expect(statusLabel('rejected')).toBe('Rejected')
    expect(statusLabel('weird')).toBe('Weird')
  })
})

describe('normCategory / categoryLabel', () => {
  it('lowercases and defaults blank to other', () => {
    expect(normCategory('Fuel')).toBe('fuel')
    expect(normCategory('  ')).toBe('other')
    expect(normCategory(null)).toBe('other')
  })
  it('keeps unknown categories verbatim (not folded)', () => {
    expect(normCategory('visa')).toBe('visa')
    expect(categoryLabel('visa')).toBe('Visa')
    expect(categoryLabel('fuel')).toBe('Fuel')
  })
})

describe('expenseTime', () => {
  it('parses date-only strings as UTC midnight', () => {
    expect(expenseTime({ expense_date: '2026-07-01' })).toBe(Date.parse('2026-07-01T00:00:00Z'))
  })
  it('falls back to created_at then null', () => {
    expect(expenseTime({ created_at: '2026-01-02T05:00:00Z' })).toBe(Date.parse('2026-01-02T05:00:00Z'))
    expect(expenseTime({})).toBeNull()
    expect(expenseTime({ expense_date: 'not-a-date' })).toBeNull()
  })
})

describe('statusBreakdown', () => {
  it('counts and values every status, zero-filled', () => {
    const b = statusBreakdown(SAMPLE)
    expect(b.total).toBe(6)
    expect(b.byStatus.approved.count).toBe(2) // Ahmed 200 + Carlos 80
    expect(b.byStatus.approved.value).toBe(280)
    expect(b.byStatus.reimbursed.value).toBe(50)
    expect(b.byStatus.rejected.value).toBe(400)
    expect(b.byStatus.pending.value).toBe(300) // Bilal 300 + Carlos null(0)
    expect(b.totalValue).toBe(1030)
  })
  it('items only include present statuses with pct of total value', () => {
    const b = statusBreakdown(SAMPLE)
    const rej = b.items.find((i) => i.status === 'rejected')
    expect(rej.pct).toBe(pct(400, 1030))
    expect(b.items.every((i) => i.count > 0)).toBe(true)
  })
  it('handles empty input honestly', () => {
    const b = statusBreakdown([])
    expect(b.total).toBe(0)
    expect(b.totalValue).toBe(0)
    expect(b.items).toEqual([])
    expect(b.byStatus.pending.count).toBe(0)
  })
})

describe('categoryBreakdown', () => {
  it('aggregates spend + count per category sorted by value desc', () => {
    const c = categoryBreakdown(SAMPLE)
    const fuel = c.find((x) => x.category === 'fuel')
    expect(fuel.value).toBe(500) // 200 + 300 + null(0)
    expect(fuel.count).toBe(3)
    // maintenance 400 is highest single value -> above fuel? fuel=500 wins
    expect(c[0].category).toBe('fuel')
  })
  it('respects a limit', () => {
    expect(categoryBreakdown(SAMPLE, 2)).toHaveLength(2)
  })
  it('surfaces unknown categories under their own key', () => {
    const c = categoryBreakdown([ex({ category: 'visa', amount: 10 })])
    expect(c[0].category).toBe('visa')
    expect(c[0].label).toBe('Visa')
  })
})

describe('topDrivers', () => {
  it('ranks by total spend and tracks pending/approved value', () => {
    const d = topDrivers(SAMPLE)
    expect(d[0].driver).toBe('Bilal') // 300 + 400 = 700
    expect(d[0].value).toBe(700)
    expect(d[0].pendingValue).toBe(300)
    const ahmed = d.find((x) => x.driver === 'Ahmed')
    expect(ahmed.approvedValue).toBe(250) // 200 approved + 50 reimbursed
    expect(ahmed.lastDate).toBe('2026-07-12')
  })
  it('ignores blank driver names and respects limit', () => {
    const d = topDrivers([...SAMPLE, ex({ driver_name: '', amount: 999 })], 2)
    expect(d).toHaveLength(2)
    expect(d.every((x) => x.driver)).toBe(true)
  })
})

describe('monthlyTrend', () => {
  it('buckets value + approved value into the right months', () => {
    const t = monthlyTrend(SAMPLE, 6, new Date('2026-07-15T00:00:00Z'))
    expect(t).toHaveLength(6)
    const jul = t.find((b) => b.key === '2026-07')
    // Jul: 200(appr) + 50(reimb) + 400(rej) + null(0) = 650
    expect(jul.value).toBe(650)
    expect(jul.approvedValue).toBe(250) // 200 + 50
    const jun = t.find((b) => b.key === '2026-06')
    expect(jun.value).toBe(300)
    expect(jun.approvedValue).toBe(0)
  })
  it('returns a clean window on empty input', () => {
    const t = monthlyTrend([], 3, new Date('2026-07-15T00:00:00Z'))
    expect(t).toHaveLength(3)
    expect(t.every((b) => b.value === 0 && b.count === 0)).toBe(true)
  })
})

describe('computeKpis', () => {
  it('computes totals, avg, approval rate and outstanding', () => {
    const k = computeKpis(SAMPLE, { now: new Date('2026-07-25T00:00:00Z'), periodDays: 30 })
    expect(k.total).toBe(6)
    expect(k.totalValue).toBe(1030)
    // avg over the 5 amounted claims (200,50,300,400,80) = 1030/5 = 206
    expect(k.avgClaim).toBe(206)
    // decided = approved(2)+reimbursed(1)+rejected(1)=4 wait approved count=2,reimb=1,rej=1 => 4 decided; approvedOutcome=3
    expect(k.decidedCount).toBe(4)
    expect(k.approvalRate).toBe(pct(3, 4))
    expect(k.reimbursementOutstanding).toBe(280) // approved value
    expect(k.reimbursedValue).toBe(50)
    expect(k.pendingValue).toBe(300)
    expect(k.drivers).toBe(3)
  })
  it('null avg / approval rate when data cannot support them', () => {
    const k = computeKpis([ex({ amount: null, status: 'pending' })])
    expect(k.avgClaim).toBeNull()
    expect(k.approvalRate).toBeNull()
  })
  it('counts only claims within the period window', () => {
    const k = computeKpis(SAMPLE, { now: new Date('2026-07-25T00:00:00Z'), periodDays: 20 })
    // within 20 days of Jul 25 -> from Jul 5: Jul10,12,15,20 = 4 claims
    expect(k.thisPeriodCount).toBe(4)
  })
})

describe('filterExpenses', () => {
  it('filters by status, category and driver', () => {
    expect(filterExpenses(SAMPLE, { status: 'approved' })).toHaveLength(2)
    expect(filterExpenses(SAMPLE, { category: 'fuel' })).toHaveLength(3)
    expect(filterExpenses(SAMPLE, { driver: 'bilal' })).toHaveLength(2)
    expect(filterExpenses(SAMPLE, { status: 'all', category: 'all' })).toHaveLength(6)
  })
  it('filters by date range and search', () => {
    expect(filterExpenses(SAMPLE, { from: '2026-07-01', to: '2026-07-31' })).toHaveLength(4)
    expect(filterExpenses(SAMPLE, { search: 'brake' })).toHaveLength(1)
    expect(filterExpenses(SAMPLE, { search: 'TRK-1' })).toHaveLength(2)
  })
})

describe('sortExpenses', () => {
  it('sorts by amount with nulls handled', () => {
    const asc = sortExpenses(SAMPLE, 'amount', 'asc')
    expect(toAmount(asc[0].amount)).toBe(0) // null -> 0 lowest
    const desc = sortExpenses(SAMPLE, 'amount', 'desc')
    expect(desc[0].amount).toBe(400)
  })
  it('sorts by date with null dates last, does not mutate input', () => {
    const withNull = [...SAMPLE, ex({ expense_date: null, created_at: null, amount: 1 })]
    const sorted = sortExpenses(withNull, 'expense_date', 'desc')
    expect(sorted[sorted.length - 1].expense_date).toBeNull()
    expect(withNull.length).toBe(7) // original untouched
  })
})

describe('distinctValues / distinctCategories', () => {
  it('returns sorted unique non-empty values', () => {
    expect(distinctValues(SAMPLE, 'driver_name')).toEqual(['Ahmed', 'Bilal', 'Carlos'])
    expect(distinctCategories(SAMPLE)).toEqual(['fuel', 'maintenance', 'meals', 'toll'])
  })
})

describe('analyzeExpenses', () => {
  it('returns the full roll-up in one pass and is safe on empty', () => {
    const a = analyzeExpenses(SAMPLE, { now: new Date('2026-07-25T00:00:00Z') })
    expect(a.kpis.total).toBe(6)
    expect(a.status.totalValue).toBe(1030)
    expect(a.categories.length).toBeGreaterThan(0)
    expect(a.topDrivers[0].driver).toBe('Bilal')
    expect(a.trend).toHaveLength(12)
    expect(a.drivers).toEqual(['Ahmed', 'Bilal', 'Carlos'])

    const empty = analyzeExpenses([])
    expect(empty.kpis.total).toBe(0)
    expect(empty.kpis.avgClaim).toBeNull()
    expect(empty.categories).toEqual([])
    expect(empty.topDrivers).toEqual([])
  })
  it('is defensive against non-array / garbage input', () => {
    expect(analyzeExpenses(null).kpis.total).toBe(0)
    expect(analyzeExpenses([null, undefined, 5, {}]).kpis.total).toBe(1)
  })
})

// helper mirroring the engine's pct1 rounding for assertions
function pct(part, whole) {
  return Math.round((part / whole) * 100 * 10) / 10
}
