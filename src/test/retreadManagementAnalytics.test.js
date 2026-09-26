import { describe, it, expect } from 'vitest'
import {
  kmLife, cpk, retreadCycle, daysInService, last12Months, splitRecords, retreadKpis,
  filterRetreads, brandSummary, vendorScorecard, failureRate, successRate, monthlyFitments,
  vendorCpkTrend, bestSize, cycleDistribution, retreadInsights, roiProjection, scoreVendor,
} from '../lib/retreadManagementAnalytics'

const NOW = new Date(2026, 8, 15) // 15 Sep 2026

const rows = [
  { id: 1, category: 'Retread', brand: 'A', size: '315/80', site: 'NHC', km_at_fitment: 0, km_at_removal: 50000, cost_per_tyre: 500, risk_level: 'Low', issue_date: '2026-09-01', serial_number: 'S1' },
  { id: 2, category: 'Retread x2', brand: 'A', size: '315/80', site: 'NHC', km_at_fitment: 10000, km_at_removal: 50000, cost_per_tyre: 600, risk_level: 'Critical', issue_date: '2026-08-10' },
  { id: 3, category: 'Retread 3', brand: 'B', size: '385/65', site: 'JED', km_at_fitment: 0, km_at_removal: null, cost_per_tyre: 400, issue_date: '2026-07-05' },
  { id: 4, category: 'New', brand: 'N', km_at_fitment: 0, km_at_removal: 100000, cost_per_tyre: 2000, issue_date: '2026-05-01' },
  { id: 5, category: 'Scrap', brand: 'N', km_at_fitment: 0, km_at_removal: 1000, cost_per_tyre: 2000 },
]

describe('retreadManagementAnalytics primitives', () => {
  it('km life and cpk are null when not measurable', () => {
    expect(kmLife({ km_at_fitment: 0, km_at_removal: 1000 })).toBe(1000)
    expect(kmLife({ km_at_fitment: 100 })).toBeNull()
    expect(kmLife({ km_at_fitment: 500, km_at_removal: 100 })).toBeNull()
    expect(cpk({ km_at_fitment: 0, km_at_removal: 1000, cost_per_tyre: 0 })).toBeNull()
    expect(cpk({ km_at_fitment: 0, km_at_removal: 1000, cost_per_tyre: 100 })).toBeCloseTo(0.1)
  })
  it('reads retread cycle depth', () => {
    expect(retreadCycle({ category: 'Retread' })).toBe(1)
    expect(retreadCycle({ category: 'Retread x2' })).toBe(2)
    expect(retreadCycle({ category: 'Retread', retread_count: 3 })).toBe(3)
    expect(retreadCycle({ category: 'New' })).toBeNull()
  })
  it('uses the injected now', () => {
    expect(daysInService({ issue_date: '2026-09-05' }, NOW)).toBe(10)
    expect(daysInService({}, NOW)).toBeNull()
    const m = last12Months(NOW)
    expect(m).toHaveLength(12)
    expect(m[11]).toBe('2026-09')
    expect(m[0]).toBe('2025-10')
  })
})

describe('retread KPIs', () => {
  const { retreads, newTyres } = splitRecords(rows, NOW)
  it('splits retreads from the new-tyre baseline and excludes scrap', () => {
    expect(retreads).toHaveLength(3)
    expect(newTyres.map(r => r.id)).toEqual([4])
  })
  it('computes cpk, savings, success and failure honestly', () => {
    const k = retreadKpis(retreads, newTyres)
    expect(k.totalRetreads).toBe(3)
    expect(k.removedCount).toBe(2)
    expect(k.activeCount).toBe(1)
    expect(k.newCpk).toBeCloseTo(0.02)
    expect(k.retreadCpk).toBeCloseTo((0.01 + 0.015) / 2)
    // saving = 0.02*50000-500 + 0.02*40000-600 = 500 + 200
    expect(k.savings).toBeCloseTo(700)
    expect(k.successRate).toBeCloseTo(50)
    expect(k.failureRate).toBeCloseTo(50)
    expect(k.maxCycle).toBe(3)
  })
  it('unknown success rate is unknown failure rate, never 0%', () => {
    const k = retreadKpis([{ category: 'Retread', status: 'Active', km_at_removal: null }], [])
    expect(k.successRate).toBeNull()
    expect(k.failureRate).toBeNull()
    expect(k.newCpk).toBeNull()
    expect(k.savings).toBeNull()
    expect(failureRate(null)).toBeNull()
    expect(successRate([])).toBeNull()
  })
})

describe('filters, brands and vendors', () => {
  const { retreads, newTyres } = splitRecords(rows, NOW)
  it('filters by site, status and search', () => {
    expect(filterRetreads(retreads, { site: 'JED' })).toHaveLength(1)
    expect(filterRetreads(retreads, { status: 'Active' }).map(r => r.id)).toEqual([3])
    expect(filterRetreads(retreads, { search: 's1' }).map(r => r.id)).toEqual([1])
  })
  it('brand summary and vendor scorecard', () => {
    const b = brandSummary(retreads)
    expect(b[0]).toMatchObject({ brand: 'A', count: 2, successRate: 50 })
    const B = b.find(x => x.brand === 'B')
    expect(B.successRate).toBeNull()
    expect(B.avgCpk).toBeNull()
    const v = vendorScorecard(b, retreadKpis(retreads, newTyres).newCpk)
    expect(v.find(x => x.brand === 'B').failureRate).toBeNull()
    expect(v.find(x => x.brand === 'B').savingsVsNew).toBeNull()
  })
  it('neutral score for missing metrics', () => {
    expect(scoreVendor({ avgCpk: null, avgLife: null, successRate: null }, { cpkMin: 0, cpkMax: 0, lifeMin: 0, lifeMax: 0 })).toBe(50)
  })
  it('charts data', () => {
    const m = monthlyFitments(retreads, NOW)
    expect(m[11]).toEqual({ month: '2026-09', count: 1 })
    const t = vendorCpkTrend(retreads, ['A'], NOW)
    expect(t.series[0].data[11]).toBeCloseTo(0.01)
    expect(t.series[0].data[0]).toBeNull()
    expect(bestSize(retreads)).toBe('315/80')
    expect(cycleDistribution(retreads)).toEqual([{ cycle: '1', count: 1 }, { cycle: '2', count: 1 }, { cycle: '3', count: 1 }])
  })
  it('insights only fire on real conditions', () => {
    const k = retreadKpis(retreads, newTyres)
    const out = retreadInsights({ retreads, kpis: k, brands: brandSummary(retreads) })
    expect(out.some(i => /cutting cost per km/.test(i.title))).toBe(true)
    expect(out.some(i => /retreaded 3 times/.test(i.title))).toBe(true)
    expect(retreadInsights({ retreads: [], kpis: retreadKpis([], []), brands: [] })).toEqual([])
    expect(out.every(i => !/[–—]/.test(i.title + i.body))).toBe(true)
  })
})

describe('ROI projection', () => {
  it('computes the standard case', () => {
    const r = roiProjection({ newCost: 1000, retreadCost: 400, newLifeKm: 100000, retreadLifeKm: 80000, fleetSize: 10, annualKm: 100000 })
    expect(r.newCpkVal).toBeCloseTo(0.01)
    expect(r.rCpkVal).toBeCloseTo(0.005)
    expect(r.savingsPerTyre).toBeCloseTo(400)
    expect(r.breakEvenKm).toBeCloseTo(40000)
    expect(r.annualSavings).toBeCloseTo(400 * 10 * 1.25)
  })
  it('never divides by a placeholder of 1', () => {
    const r = roiProjection({ newCost: 1000, retreadCost: 400, newLifeKm: 100000, retreadLifeKm: '', fleetSize: 10 })
    expect(r.rCpkVal).toBeNull()
    expect(r.savingsPerTyre).toBeNull()
    expect(r.annualSavings).toBeNull()
    expect(r.cpkImprovement).toBeNull()
    expect(r.breakEvenKm).toBeCloseTo(40000)
    const z = roiProjection({ newCost: 0, retreadCost: 400, newLifeKm: 0, retreadLifeKm: 80000 })
    expect(z.newCpkVal).toBeNull()
    expect(z.breakEvenKm).toBeNull()
  })
})
