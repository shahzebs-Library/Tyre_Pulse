import { describe, it, expect } from 'vitest'
import {
  costByAsset,
  costByCategory,
  monthlyServiceCost,
  meanIntervalBetweenServices,
  outcomeBreakdown,
  complianceTrend,
  topOverdue,
  pmSummary,
} from './pmAnalytics'

const NOW = '2026-07-16T00:00:00Z'

const RECORDS = [
  { pm_program_id: 1, asset_no: 'A1', service_date: '2026-07-05', total_cost: 300, outcome: 'completed' },
  { pm_program_id: 1, asset_no: 'A1', service_date: '2026-06-05', total_cost: 200, outcome: 'partial' },
  { pm_program_id: 2, asset_no: 'A2', service_date: '2026-07-10', total_cost: 500, outcome: 'completed' },
  { pm_program_id: 3, asset_no: 'A3', service_date: '2026-05-01', total_cost: 100, outcome: 'failed' },
]

const PLANS = [
  { id: 1, asset_no: 'A1', asset_category: 'truck', status: 'active' },
  { id: 2, asset_no: 'A2', asset_category: 'trailer', status: 'active' },
  { id: 3, asset_no: 'A3', asset_category: 'truck', status: 'paused' },
]

describe('costByAsset', () => {
  it('sums total cost + services per asset, desc by total', () => {
    expect(costByAsset(RECORDS)).toEqual([
      { asset_no: 'A1', total: 500, services: 2 },
      { asset_no: 'A2', total: 500, services: 1 },
      { asset_no: 'A3', total: 100, services: 1 },
    ])
  })
  it('skips rows without asset_no and treats missing cost as 0', () => {
    const out = costByAsset([
      { asset_no: '', total_cost: 999 },
      { asset_no: 'X', total_cost: null },
    ])
    expect(out).toEqual([{ asset_no: 'X', total: 0, services: 1 }])
  })
  it('returns [] for empty input', () => {
    expect(costByAsset([])).toEqual([])
    expect(costByAsset()).toEqual([])
  })
})

describe('costByCategory', () => {
  it('joins records to plan asset_category, desc by total', () => {
    expect(costByCategory(PLANS, RECORDS)).toEqual([
      { category: 'truck', total: 600 }, // A1 500 + A3 100
      { category: 'trailer', total: 500 },
    ])
  })
  it('falls back to other when plan is unknown', () => {
    const out = costByCategory([], [{ pm_program_id: 99, total_cost: 50 }])
    expect(out).toEqual([{ category: 'other', total: 50 }])
  })
  it('returns [] for empty records', () => {
    expect(costByCategory(PLANS, [])).toEqual([])
  })
})

describe('monthlyServiceCost', () => {
  it('buckets by service month, zero-filled oldest first', () => {
    const out = monthlyServiceCost(RECORDS, { now: NOW, months: 3 })
    expect(out).toEqual([
      { month: '2026-05', total: 100, count: 1 },
      { month: '2026-06', total: 200, count: 1 },
      { month: '2026-07', total: 800, count: 2 },
    ])
  })
  it('ignores records outside the window', () => {
    const out = monthlyServiceCost(
      [{ asset_no: 'A', service_date: '2020-01-01', total_cost: 100 }],
      { now: NOW, months: 2 },
    )
    expect(out).toEqual([
      { month: '2026-06', total: 0, count: 0 },
      { month: '2026-07', total: 0, count: 0 },
    ])
  })
  it('returns [] when now is unusable', () => {
    expect(monthlyServiceCost(RECORDS, { now: null })).toEqual([])
  })
})

describe('meanIntervalBetweenServices', () => {
  it('averages days between consecutive services', () => {
    const out = meanIntervalBetweenServices([
      { asset_no: 'A1', service_date: '2026-01-01' },
      { asset_no: 'A1', service_date: '2026-01-11' },
      { asset_no: 'A1', service_date: '2026-01-31' },
    ])
    expect(out).toEqual([{ asset_no: 'A1', avgDays: 15, services: 3 }]) // (10 + 20) / 2
  })
  it('returns null avgDays when fewer than 2 services', () => {
    const out = meanIntervalBetweenServices([{ asset_no: 'B', service_date: '2026-01-01' }])
    expect(out).toEqual([{ asset_no: 'B', avgDays: null, services: 1 }])
  })
  it('returns [] for empty input', () => {
    expect(meanIntervalBetweenServices([])).toEqual([])
  })
})

describe('outcomeBreakdown', () => {
  it('counts records over the fixed outcome vocabulary', () => {
    expect(outcomeBreakdown(RECORDS)).toEqual([
      { outcome: 'completed', count: 2 },
      { outcome: 'partial', count: 1 },
      { outcome: 'deferred', count: 0 },
      { outcome: 'failed', count: 1 },
    ])
  })
  it('ignores unknown outcomes but still returns all four rows', () => {
    expect(outcomeBreakdown([{ outcome: 'weird' }])).toEqual([
      { outcome: 'completed', count: 0 },
      { outcome: 'partial', count: 0 },
      { outcome: 'deferred', count: 0 },
      { outcome: 'failed', count: 0 },
    ])
  })
})

describe('complianceTrend', () => {
  it('computes completed / total / pct per month', () => {
    const out = complianceTrend(RECORDS, { now: NOW, months: 3 })
    expect(out).toEqual([
      { month: '2026-05', completed: 0, total: 1, pct: 0 },
      { month: '2026-06', completed: 0, total: 1, pct: 0 },
      { month: '2026-07', completed: 2, total: 2, pct: 100 },
    ])
  })
  it('pct is null for a month with no records', () => {
    const out = complianceTrend([], { now: NOW, months: 1 })
    expect(out).toEqual([{ month: '2026-07', completed: 0, total: 0, pct: null }])
  })
})

describe('topOverdue', () => {
  const overduePlans = [
    { id: 1, asset_no: 'A1', status: 'active', next_due: '2026-07-01' }, // 15d overdue
    { id: 2, asset_no: 'A2', status: 'active', next_due: '2026-06-01' }, // 45d overdue (worst)
    { id: 3, asset_no: 'A3', status: 'active', next_due: '2026-08-01' }, // future, not overdue
  ]
  it('returns only overdue plans, worst-first', () => {
    const out = topOverdue(overduePlans, { now: NOW })
    expect(out.map((p) => p.asset_no)).toEqual(['A2', 'A1'])
    expect(out[0].band).toBe('overdue')
  })
  it('honours the limit', () => {
    expect(topOverdue(overduePlans, { now: NOW }, 1).map((p) => p.asset_no)).toEqual(['A2'])
  })
  it('returns [] for empty input', () => {
    expect(topOverdue([], { now: NOW })).toEqual([])
  })
})

describe('pmSummary', () => {
  it('combines plan + record aggregates honestly', () => {
    const overduePlans = [
      { id: 1, asset_no: 'A1', status: 'active', next_due: '2026-06-01' }, // overdue
      { id: 2, asset_no: 'A2', status: 'paused', next_due: '2026-08-01' }, // future, not overdue
    ]
    const out = pmSummary(overduePlans, RECORDS, { now: NOW })
    expect(out).toEqual({
      totalServiceCost: 1100,
      servicesCount: 4,
      activePlans: 1,
      overdueCount: 1, // only the active overdue plan
      avgCostPerService: 275,
    })
  })
  it('returns null avgCostPerService and 0 counts with no data', () => {
    const out = pmSummary([], [], { now: NOW })
    expect(out).toEqual({
      totalServiceCost: 0,
      servicesCount: 0,
      activePlans: 0,
      overdueCount: 0,
      avgCostPerService: null,
    })
  })
})
