import { describe, it, expect } from 'vitest'
import { analyzeTraining, filterTraining, attentionList } from '../lib/driverTrainingAnalytics'

const NOW = Date.UTC(2026, 8, 27)
const rows = [
  { id: 1, driver_name: 'Ali', category: 'hazmat', result: 'pass', score: 90, expiry_date: '2026-09-01', cost: 100, currency: 'SAR', country: 'KSA' },
  { id: 2, driver_name: 'ali ', category: 'hazmat', result: 'fail', score: 50, expiry_date: '2026-10-10', cost: 50, currency: 'SAR', country: 'KSA' },
  { id: 3, driver_name: 'Omar', category: 'first_aid', result: 'pending', expiry_date: '2027-12-01', country: 'UAE' },
  { id: 4, driver_name: 'Sara', category: '', result: '', expiry_date: null },
]

describe('driverTrainingAnalytics', () => {
  it('computes honest rates and buckets', () => {
    const { kpis, expiry, categories } = analyzeTraining(rows, NOW)
    expect(kpis.totalRecords).toBe(4)
    expect(kpis.distinctDrivers).toBe(3)
    expect(kpis.passRate).toBe(50)
    expect(kpis.avgScore).toBe(70)
    expect(kpis.expiredCount).toBe(1)
    expect(kpis.expiringSoonCount).toBe(1)
    expect(kpis.currencyRate).toBeCloseTo(66.7, 1)
    expect(kpis.driversWithExpired).toBe(1)
    expect(kpis.totalCost).toBe(150)
    expect(kpis.costCurrency).toBe('SAR')
    expect(expiry.find((b) => b.key === 'unknown').count).toBe(1)
    expect(categories[0]).toMatchObject({ category: 'hazmat', count: 2, passRate: 50 })
  })

  it('returns null, never zero, when nothing is measurable', () => {
    const { kpis } = analyzeTraining([], NOW)
    expect(kpis.passRate).toBeNull()
    expect(kpis.avgScore).toBeNull()
    expect(kpis.currencyRate).toBeNull()
    expect(kpis.totalCost).toBeNull()
  })

  it('refuses to add costs across currencies', () => {
    const { kpis } = analyzeTraining([{ cost: 1, currency: 'SAR' }, { cost: 2, currency: 'AED' }], NOW)
    expect(kpis.totalCost).toBeNull()
    expect(kpis.mixedCurrency).toBe(true)
  })

  it('filters by expiry, result, country and search', () => {
    expect(filterTraining(rows, { expiry: 'expired' }, NOW).map((r) => r.id)).toEqual([1])
    expect(filterTraining(rows, { result: 'PASS' }, NOW).map((r) => r.id)).toEqual([1])
    expect(filterTraining(rows, { country: 'UAE' }, NOW).map((r) => r.id)).toEqual([3])
    expect(filterTraining(rows, { search: 'sara', category: 'all' }, NOW).map((r) => r.id)).toEqual([4])
  })

  it('orders attention most overdue first', () => {
    expect(attentionList(rows, NOW).map((x) => x.r.id)).toEqual([1, 2])
  })
})
