import { describe, it, expect } from 'vitest'
import {
  taasKpis, filterTaas, renewalsDue, renewalLabel, mrrByCurrency, taasExportRows,
  EXPORT_COLS, EXPORT_HEADERS,
} from '../lib/taasAnalytics'

const NOW = new Date('2026-09-27T00:00:00Z').getTime()
const rows = [
  { id: 1, customer_name: 'Gulf Co', plan_type: 'per_km', status: 'active', monthly_fee: 1000, currency: 'SAR', committed_km: 1000, actual_km: 1200, billed_to_date: 600, renewal_date: '2026-10-05', tyres_covered: 6, country: 'KSA' },
  { id: 2, customer_name: 'Desert Ltd', plan_type: 'hybrid', status: 'trial', monthly_fee: 500, currency: 'SAR', committed_km: 1000, actual_km: 500, renewal_date: '2026-09-20', tyres_covered: 4, country: 'KSA' },
  { id: 3, customer_name: 'Old Co', plan_type: 'per_month', status: 'expired', monthly_fee: 900, renewal_date: '2026-01-01', country: 'UAE' },
]

describe('taasKpis', () => {
  it('sums MRR in one currency and averages measurable utilisation only', () => {
    const k = taasKpis(rows, { now: NOW, currency: 'SAR' })
    expect(k.mrr).toBe(1500)
    expect(k.mrrCurrency).toBe('SAR')
    expect(k.mixedCurrency).toBe(false)
    expect(k.avgUtilization).toBe(85)
    expect(k.overrunCount).toBe(1)
    expect(k.renewalsOverdue).toBe(1)
    expect(k.liveCount).toBe(2)
  })
  it('refuses to blend currencies', () => {
    const k = taasKpis([...rows, { id: 4, status: 'active', monthly_fee: 100, currency: 'AED' }], { now: NOW })
    expect(k.mixedCurrency).toBe(true)
    expect(k.mrr).toBeNull()
    expect(k.mrrByCurrency).toEqual({ SAR: 1500, AED: 100 })
  })
  it('returns N/A-able nulls for an empty book', () => {
    const k = taasKpis([], { now: NOW })
    expect(k.avgUtilization).toBeNull()
    expect(k.mrr).toBe(0)
  })
})

describe('filters and renewals', () => {
  it('filters', () => {
    expect(filterTaas(rows, { status: 'active' })).toHaveLength(1)
    expect(filterTaas(rows, { plan: 'hybrid' })).toHaveLength(1)
    expect(filterTaas(rows, { country: 'UAE' })).toHaveLength(1)
    expect(filterTaas(rows, { search: 'desert' })).toHaveLength(1)
  })
  it('lists live renewals soonest first including overdue', () => {
    const due = renewalsDue(rows, NOW, 30)
    expect(due.map((d) => d.r.id)).toEqual([2, 1])
    expect(due[0].days).toBeLessThan(0)
  })
  it('labels renewals', () => {
    expect(renewalLabel(-3)).toBe('3d overdue')
    expect(renewalLabel(0)).toBe('due today')
    expect(renewalLabel(5)).toBe('in 5d')
    expect(renewalLabel(null)).toBe('')
  })
  it('groups MRR by currency with fallback', () => {
    expect(mrrByCurrency([{ status: 'active', monthly_fee: 10 }], 'egp')).toEqual({ EGP: 10 })
  })
  it('export rows align with headers', () => {
    const out = taasExportRows(rows, 'SAR')
    expect(Object.keys(out[0])).toEqual(EXPORT_COLS)
    expect(EXPORT_HEADERS).toHaveLength(EXPORT_COLS.length)
    expect(out[0].utilization).toBe(120)
    expect(out[0].cost_per_km).toBe(0.5)
    expect(out[2].currency).toBe('SAR')
  })
})
