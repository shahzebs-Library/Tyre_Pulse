import { describe, it, expect } from 'vitest'
import {
  filterWashes, byType, bySite, monthlyTrend, summarizeWashes,
  isCompletedWash, completedWashes, washDue, overdueSchedules, upcomingSchedules,
  costBasis, formatWashCost, WASH_INTERVAL_DAYS,
} from '../lib/washAnalytics'

const rows = [
  { wash_date: '2026-07-10', asset_no: 'A1', wash_type: 'Full', site: 'NHC', area: 'North', status: 'Completed' },
  { wash_date: '2026-07-15', asset_no: 'A1', wash_type: 'Exterior', site: 'NHC', area: 'North', status: 'Completed' },
  { wash_date: '2026-06-20', asset_no: 'A2', wash_type: 'Full', site: 'METRO', area: 'South', status: 'Completed' },
  { wash_date: '2026-05-01', asset_no: 'A3', wash_type: 'Steam', site: 'METRO', area: 'South', status: 'Completed' },
]

describe('filterWashes', () => {
  it('filters by inclusive date range (both ends)', () => {
    const out = filterWashes(rows, { from: '2026-06-20', to: '2026-07-10' })
    expect(out.map((r) => r.wash_date).sort()).toEqual(['2026-06-20', '2026-07-10'])
  })

  it('filters by site, area and type independently', () => {
    expect(filterWashes(rows, { site: 'NHC' })).toHaveLength(2)
    expect(filterWashes(rows, { area: 'South' })).toHaveLength(2)
    expect(filterWashes(rows, { type: 'Full' })).toHaveLength(2)
  })

  it('ignores blank / All filters and returns all rows', () => {
    expect(filterWashes(rows, { site: 'All', type: '', from: '' })).toHaveLength(4)
  })

  it('returns [] for non-array input', () => {
    expect(filterWashes(null)).toEqual([])
  })
})

describe('byType / bySite grouping', () => {
  it('groups by wash type with counts', () => {
    const t = byType(rows)
    const full = t.find((g) => g.key === 'Full')
    expect(full.count).toBe(2)
  })

  it('groups by site', () => {
    const s = bySite(rows)
    expect(s.find((g) => g.key === 'NHC').count).toBe(2)
    expect(s.find((g) => g.key === 'METRO').count).toBe(2)
  })

  it('buckets blank keys as Unspecified', () => {
    const t = byType([{ wash_date: '2026-07-01', asset_no: 'X' }])
    expect(t[0].key).toBe('Unspecified')
  })
})

describe('monthlyTrend', () => {
  it('returns 12 ordered buckets ending at the anchor month', () => {
    const out = monthlyTrend(rows, new Date('2026-07-31T00:00:00Z'))
    expect(out).toHaveLength(12)
    expect(out[11].month).toBe('2026-07')
    expect(out[0].month).toBe('2025-08')
  })

  it('accumulates count into the right month', () => {
    const out = monthlyTrend(rows, new Date('2026-07-31T00:00:00Z'))
    const jul = out.find((b) => b.month === '2026-07')
    expect(jul.count).toBe(2)
  })
})

describe('summarizeWashes', () => {
  it('computes honest volume KPIs over all rows', () => {
    const k = summarizeWashes(rows, {}, new Date('2026-07-31T00:00:00Z'))
    expect(k.totalWashes).toBe(4)
    expect(k.distinctAssets).toBe(3)
    expect(k.byType.length).toBeGreaterThan(0)
    expect(k.bySite.length).toBeGreaterThan(0)
  })

  it('applies filters before summarising', () => {
    const k = summarizeWashes(rows, { site: 'NHC' }, new Date('2026-07-31T00:00:00Z'))
    expect(k.totalWashes).toBe(2)
    expect(k.distinctAssets).toBe(1)
  })

  it('returns honest zeros on empty input', () => {
    const k = summarizeWashes([], {}, new Date('2026-07-31T00:00:00Z'))
    expect(k).toMatchObject({ totalWashes: 0, distinctAssets: 0 })
    expect(k.byType).toEqual([])
    expect(k.bySite).toEqual([])
    expect(k.monthlyTrend).toHaveLength(12)
  })

  it('does not expose removed cost / water / duration metrics', () => {
    const k = summarizeWashes(rows, {}, new Date('2026-07-31T00:00:00Z'))
    expect(k.totalCost).toBeUndefined()
    expect(k.avgCost).toBeUndefined()
    expect(k.totalWater).toBeUndefined()
    expect(k.avgDuration).toBeUndefined()
  })
})

// A scheduled wash is a plan, not work done. This is the single most important
// rule in the module: every count, rate and trend must exclude it.
describe('a scheduled wash is not work done', () => {
  const mixed = [
    ...rows,
    { wash_date: '2026-07-20', asset_no: 'A9', wash_type: 'Full', site: 'NHC', status: 'Scheduled' },
    { wash_date: '2026-07-21', asset_no: 'A8', wash_type: 'Steam', site: 'ZONE9', status: 'Cancelled' },
    { wash_date: '2026-07-22', asset_no: 'A7', wash_type: 'Interior', site: 'ZONE9', status: 'Missed' },
  ]
  const at = new Date('2026-07-31T00:00:00Z')

  it('classifies each status, treating a blank status as work done', () => {
    expect(isCompletedWash({ status: 'Completed' })).toBe(true)
    expect(isCompletedWash({ status: '' })).toBe(true)
    expect(isCompletedWash({ status: 'Scheduled' })).toBe(false)
    expect(isCompletedWash({ status: 'Missed' })).toBe(false)
    expect(isCompletedWash({ status: 'Cancelled' })).toBe(false)
    expect(completedWashes(mixed)).toHaveLength(4)
  })

  it('keeps totalWashes to work done and reports plans separately', () => {
    const k = summarizeWashes(mixed, {}, at)
    expect(k.totalWashes).toBe(4)
    expect(k.totalRecords).toBe(7)
    expect(k.scheduledCount).toBe(1)
    expect(k.cancelledCount).toBe(1)
    expect(k.missedCount).toBe(1)
    expect(k.distinctAssets).toBe(3) // A9/A8/A7 never had a wash performed
  })

  it('excludes plans from the type, site and month breakdowns', () => {
    expect(byType(mixed).find((g) => g.key === 'Interior')).toBeUndefined()
    expect(bySite(mixed).find((g) => g.key === 'ZONE9')).toBeUndefined()
    const jul = monthlyTrend(mixed, at).find((b) => b.month === '2026-07')
    expect(jul.count).toBe(2) // the two completed July washes only
  })

  it('still shows every row in the log view, including plans', () => {
    expect(filterWashes(mixed, {})).toHaveLength(7)
    expect(filterWashes(mixed, { status: 'Scheduled' })).toHaveLength(1)
    expect(filterWashes(mixed, { assetNo: 'a1' })).toHaveLength(2)
  })
})

describe('washDue', () => {
  const at = '2026-07-31'

  it('reports an asset past its interval, most overdue first', () => {
    const due = washDue(rows, null, { now: at })
    expect(due.map((d) => d.asset_no)).toEqual(['A3', 'A2', 'A1'])
    expect(due[2]).toMatchObject({
      asset_no: 'A1', last_wash_date: '2026-07-15', next_due_date: '2026-07-22', days_overdue: 9, basis: 'washed',
    })
  })

  it('does not count a scheduled wash as having washed the asset', () => {
    const withPlan = [{ wash_date: '2026-07-30', asset_no: 'A3', status: 'Scheduled' }, ...rows]
    const a3 = washDue(withPlan, null, { now: at }).find((d) => d.asset_no === 'A3')
    expect(a3.last_wash_date).toBe('2026-05-01')
  })

  it('omits an asset washed inside the interval', () => {
    const fresh = [{ wash_date: '2026-07-29', asset_no: 'B1', status: 'Completed' }]
    expect(washDue(fresh, null, { now: at })).toEqual([])
    expect(WASH_INTERVAL_DAYS).toBe(7)
  })

  it('reports a never-washed fleet asset without inventing a due date', () => {
    const due = washDue(rows, [{ asset_no: 'Z9', site: 'NHC' }], { now: at })
    const z9 = due[due.length - 1]
    expect(z9).toMatchObject({ asset_no: 'Z9', basis: 'never', next_due_date: null, days_overdue: null })
  })

  it('returns [] for empty input', () => {
    expect(washDue(null, null, { now: at })).toEqual([])
  })
})

describe('overdueSchedules / upcomingSchedules', () => {
  const at = '2026-07-31'
  const plans = [
    { id: 'p1', asset_no: 'A1', wash_date: '2026-07-20', status: 'Scheduled' },
    { id: 'p2', asset_no: 'A2', wash_date: '2026-08-05', status: 'Scheduled' },
    { id: 'p3', asset_no: 'A3', wash_date: '2026-07-10', status: 'Cancelled' },
  ]

  it('flags a passed schedule with no wash recorded for it', () => {
    const late = overdueSchedules(plans, { now: at })
    expect(late.map((r) => r.id)).toEqual(['p1'])
    expect(late[0].days_late).toBe(11)
  })

  it('clears a passed schedule once the wash was actually done', () => {
    const withWork = [...plans, { asset_no: 'A1', wash_date: '2026-07-21', status: 'Completed' }]
    expect(overdueSchedules(withWork, { now: at })).toEqual([])
  })

  it('a wash done BEFORE the scheduled day does not clear the plan', () => {
    const early = [...plans, { asset_no: 'A1', wash_date: '2026-07-01', status: 'Completed' }]
    expect(overdueSchedules(early, { now: at }).map((r) => r.id)).toEqual(['p1'])
  })

  it('lists only schedules still ahead as upcoming', () => {
    expect(upcomingSchedules(plans, { now: at }).map((r) => r.id)).toEqual(['p2'])
  })
})

describe('costBasis / formatWashCost', () => {
  it('keeps zero (no charge) and null (not recorded) apart', () => {
    const b = costBasis([{ cost: 0 }, { cost: 0 }, { cost: null }])
    expect(b).toMatchObject({ records: 3, noCharge: 2, charged: 0, notRecorded: 1, chargedTotal: null, allNoCharge: true })
    expect(formatWashCost(0)).toBe('No charge')
    expect(formatWashCost(null)).toBe('Not recorded')
    expect(formatWashCost(undefined)).toBe('Not recorded')
    expect(formatWashCost('')).toBe('Not recorded')
    expect(formatWashCost(125)).toBe('125.00')
  })

  it('reports a vendor charge without pretending the in-house washes cost money', () => {
    const b = costBasis([{ cost: 0 }, { cost: 50 }])
    expect(b).toMatchObject({ noCharge: 1, charged: 1, chargedTotal: 50, allNoCharge: false })
    expect(b.note).toContain('1 of these washes were charged')
  })

  it('says nothing about cost when there are no records', () => {
    const b = costBasis([])
    expect(b).toMatchObject({ records: 0, chargedTotal: null, allNoCharge: false })
    expect(b.note).toContain('nothing to state')
  })
})

describe('a wash still in the bay is not compliance', () => {
  const row = (status) => ({ asset_no: 'TM1', wash_date: '2026-08-01', status })

  it('does not count In Progress as work done', () => {
    expect(isCompletedWash(row('In Progress'))).toBe(false)
    expect(completedWashes([row('Completed'), row('In Progress')])).toHaveLength(1)
  })

  it('keeps counting a legacy row that carries no status', () => {
    expect(isCompletedWash({ asset_no: 'TM1', wash_date: '2026-08-01' })).toBe(true)
  })

  it('summarises only completed washes', () => {
    const s = summarizeWashes([row('Completed'), row('In Progress'), row('Scheduled')])
    expect(s.totalWashes).toBe(1)
  })
})
