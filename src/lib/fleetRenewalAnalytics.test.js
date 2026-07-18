import { describe, it, expect } from 'vitest'
import {
  numOrNull, toDate, daysUntil,
  statusDistribution, priorityDistribution, groupByField, bySite, byVehicleType,
  renewalPipeline, estimateBudget, ageBands, mileageBands,
  overduePlans, dueWithin, sortBySoonest, buildRenewalKpis, buildRenewalInsights,
  AGE_BANDS, MILEAGE_BANDS, RENEWAL_STATUSES, RENEWAL_PRIORITIES,
} from './fleetRenewalAnalytics'

const NOW = '2026-07-18'

const ROWS = [
  { id: 1, asset_no: 'TRK-1', site: 'DHAHBAN', vehicle_type: 'TR-MIXER', current_km: 620000, age_years: 12, est_cost: 250000, priority: 'high', status: 'planned', target_replace_date: '2026-06-01' }, // overdue
  { id: 2, asset_no: 'TRK-2', site: 'DHAHBAN', vehicle_type: 'BUS', current_km: 90000, age_years: 3, est_cost: 180000, priority: 'medium', status: 'approved', target_replace_date: '2026-08-15' }, // due soon
  { id: 3, asset_no: 'TRK-3', site: 'NHC', vehicle_type: 'TR-MIXER', current_km: 300000, age_years: 8, est_cost: null, priority: 'low', status: 'deferred', target_replace_date: '2027-03-01' }, // future, no cost
  { id: 4, asset_no: 'TRK-4', site: 'NHC', vehicle_type: 'PUMPS', current_km: 510000, age_years: 16, est_cost: 400000, priority: 'high', status: 'completed', target_replace_date: '2026-05-01' }, // completed (not overdue)
  { id: 5, asset_no: 'TRK-5', site: '', current_km: null, age_years: null, est_cost: null, priority: 'medium', status: 'planned', target_replace_date: null }, // undated, unknowns
]

describe('numOrNull', () => {
  it('returns finite numbers and null for blanks/garbage', () => {
    expect(numOrNull(5)).toBe(5)
    expect(numOrNull('12.5')).toBe(12.5)
    expect(numOrNull('')).toBeNull()
    expect(numOrNull(null)).toBeNull()
    expect(numOrNull('abc')).toBeNull()
  })
})

describe('toDate / daysUntil', () => {
  it('parses date strings and computes whole-day deltas', () => {
    expect(toDate('2026-07-18')).toBeInstanceOf(Date)
    expect(toDate('')).toBeNull()
    expect(toDate('nope')).toBeNull()
    expect(daysUntil('2026-07-20', NOW)).toBe(2)
    expect(daysUntil('2026-07-16', NOW)).toBe(-2)
    expect(daysUntil(null, NOW)).toBeNull()
  })
})

describe('statusDistribution', () => {
  it('counts every status in fixed order with summed cost', () => {
    const d = statusDistribution(ROWS)
    expect(d.map((x) => x.key)).toEqual(RENEWAL_STATUSES)
    expect(d.find((x) => x.key === 'planned').count).toBe(2)
    expect(d.find((x) => x.key === 'completed').count).toBe(1)
    expect(d.find((x) => x.key === 'planned').estCost).toBe(250000)
  })
  it('handles non-array input', () => {
    expect(statusDistribution(null).every((x) => x.count === 0)).toBe(true)
  })
})

describe('priorityDistribution', () => {
  it('counts each priority', () => {
    const d = priorityDistribution(ROWS)
    expect(d.map((x) => x.key)).toEqual(RENEWAL_PRIORITIES)
    expect(d.find((x) => x.key === 'high').count).toBe(2)
    expect(d.find((x) => x.key === 'medium').count).toBe(2)
    expect(d.find((x) => x.key === 'low').count).toBe(1)
  })
})

describe('groupByField / bySite / byVehicleType', () => {
  it('groups by site, blanks -> Unassigned, sorted by count desc', () => {
    const g = bySite(ROWS)
    expect(g[0].key).toBe('DHAHBAN')
    expect(g[0].count).toBe(2)
    expect(g.find((x) => x.key === 'Unassigned').count).toBe(1)
  })
  it('groups by vehicle_type only counting cost when present', () => {
    const g = byVehicleType(ROWS)
    const mixer = g.find((x) => x.key === 'TR-MIXER')
    expect(mixer.count).toBe(2)
    expect(mixer.withCost).toBe(1) // TRK-3 has null cost
    expect(mixer.estCost).toBe(250000)
  })
  it('returns [] when no row carries the field (honest empty)', () => {
    const rows = [{ asset_no: 'A' }, { asset_no: 'B' }]
    expect(byVehicleType(rows)).toEqual([])
    expect(groupByField(rows, 'vehicle_type')).toEqual([])
  })
})

describe('renewalPipeline', () => {
  it('buckets dated plans by month, ascending, undated separate', () => {
    const p = renewalPipeline(ROWS, { granularity: 'month', now: NOW })
    expect(p.hasDated).toBe(true)
    expect(p.periods.map((x) => x.key)).toEqual(['2026-05', '2026-06', '2026-08', '2027-03'])
    expect(p.periods[0].label).toBe('May 2026')
    expect(p.undated.count).toBe(1)
    expect(p.overdueCount).toBe(1) // only the open overdue row (completed excluded)
    expect(p.overdueCost).toBe(250000)
  })
  it('buckets by year', () => {
    const p = renewalPipeline(ROWS, { granularity: 'year', now: NOW })
    expect(p.periods.map((x) => x.key)).toEqual(['2026', '2027'])
    expect(p.periods.find((x) => x.key === '2026').count).toBe(3)
  })
  it('honest empty when nothing dated', () => {
    const p = renewalPipeline([{ asset_no: 'A', status: 'planned' }], { now: NOW })
    expect(p.hasDated).toBe(false)
    expect(p.periods).toEqual([])
    expect(p.undated.count).toBe(1)
  })
})

describe('estimateBudget', () => {
  it('sums only costed rows and reports coverage', () => {
    const b = estimateBudget(ROWS)
    expect(b.total).toBe(250000 + 180000 + 400000)
    expect(b.withCost).toBe(3)
    expect(b.withoutCost).toBe(2)
    expect(b.coverage).toBeCloseTo(3 / 5)
    expect(b.openTotal).toBe(250000 + 180000) // completed TRK-4 excluded from open
  })
  it('returns null total when no row is costed (never fabricates 0)', () => {
    const b = estimateBudget([{ est_cost: null }, { est_cost: '' }])
    expect(b.total).toBeNull()
    expect(b.openTotal).toBeNull()
    expect(b.withCost).toBe(0)
  })
})

describe('ageBands / mileageBands', () => {
  it('bands ages, only counting rows with age_years', () => {
    const a = ageBands(ROWS)
    expect(a.withData).toBe(4)
    expect(a.bands.map((b) => b.key)).toEqual(AGE_BANDS.map((b) => b.key))
    expect(a.bands.find((b) => b.key === 'under5').count).toBe(1) // age 3
    expect(a.bands.find((b) => b.key === '10to15').count).toBe(1) // age 12
    expect(a.bands.find((b) => b.key === '15plus').count).toBe(1) // age 16
  })
  it('bands mileage, honest hasData flag', () => {
    const m = mileageBands(ROWS)
    expect(m.withData).toBe(4)
    expect(m.bands.find((b) => b.key === '500kplus').count).toBe(2) // 620k, 510k
    expect(mileageBands([{ current_km: null }]).hasData).toBe(false)
  })
  it('bands cover MILEAGE_BANDS keys', () => {
    expect(mileageBands(ROWS).bands.map((b) => b.key)).toEqual(MILEAGE_BANDS.map((b) => b.key))
  })
})

describe('overduePlans / dueWithin', () => {
  it('overdue excludes completed and undated', () => {
    const o = overduePlans(ROWS, NOW)
    expect(o.map((r) => r.id)).toEqual([1])
  })
  it('dueWithin window is open + future only', () => {
    const d = dueWithin(ROWS, 90, NOW)
    expect(d.map((r) => r.id)).toEqual([2]) // 2026-08-15 is ~28 days out
    expect(dueWithin(ROWS, 5, NOW)).toEqual([])
  })
})

describe('sortBySoonest', () => {
  it('overdue/nearest first, undated last, non-mutating', () => {
    const sorted = sortBySoonest(ROWS, NOW)
    expect(sorted[0].id).toBe(4) // earliest target date (2026-05-01)
    expect(sorted[1].id).toBe(1) // next earliest (2026-06-01)
    expect(sorted[sorted.length - 1].id).toBe(5) // undated last
    expect(ROWS[0].id).toBe(1) // original untouched
  })
  it('breaks ties on undated by priority', () => {
    const rows = [
      { id: 'a', priority: 'low', target_replace_date: null },
      { id: 'b', priority: 'high', target_replace_date: null },
    ]
    expect(sortBySoonest(rows, NOW)[0].id).toBe('b')
  })
})

describe('buildRenewalKpis', () => {
  it('produces headline metrics from real data', () => {
    const k = buildRenewalKpis(ROWS, NOW)
    expect(k.total).toBe(5)
    expect(k.open).toBe(4)
    expect(k.completed).toBe(1)
    expect(k.highPriorityOpen).toBe(1) // TRK-1 open high; TRK-4 high but completed
    expect(k.overdue).toBe(1)
    expect(k.dueSoon).toBe(1)
    expect(k.estBudget).toBe(830000)
    expect(k.avgAge).toBeCloseTo((12 + 3 + 8 + 16) / 4)
  })
  it('estBudget null when nothing costed', () => {
    expect(buildRenewalKpis([{ status: 'planned', est_cost: null }], NOW).estBudget).toBeNull()
  })
})

describe('buildRenewalInsights', () => {
  it('surfaces overdue, due-soon, high-priority and cost-gap findings', () => {
    const ins = buildRenewalInsights(ROWS, NOW)
    expect(ins.some((s) => s.includes('past the target'))).toBe(true)
    expect(ins.some((s) => s.includes('within 90 days'))).toBe(true)
    expect(ins.some((s) => s.includes('high priority'))).toBe(true)
    expect(ins.some((s) => s.includes('no estimated cost'))).toBe(true)
  })
  it('empty for no rows', () => {
    expect(buildRenewalInsights([])).toEqual([])
  })
})
