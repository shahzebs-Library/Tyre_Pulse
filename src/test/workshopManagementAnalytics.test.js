import { describe, it, expect } from 'vitest'
import {
  isOpenJob, turnaroundHours, isOnTime, filterJobs, workshopKpis, sitePerformance,
  technicianPerformance, workTypeCounts, monthlySeries, costSplit, lastMonths, monthLabel, ratingFor,
} from '../lib/workshopManagementAnalytics'

const now = new Date('2026-07-20T12:00:00')

const rows = [
  { id: 1, site: 'NHC', status: 'Completed', work_type: 'Repair', assigned_to: 'Ali', created_at: '2026-07-01T08:00:00', completed_at: '2026-07-01T12:00:00', scheduled_date: '2026-07-02', total_cost: 100, labour_cost: 40, parts_cost: 60 },
  { id: 2, site: 'NHC', status: 'In Progress', work_type: 'Tyre Change', assigned_to: 'Ali', created_at: '2026-07-10T08:00:00', total_cost: 50, labour_cost: 50, parts_cost: 0 },
  { id: 3, site: 'METRO', status: 'Closed', work_type: 'Weird', assigned_to: 'Sara', created_at: '2026-06-01T08:00:00', completed_at: '2026-06-03T08:00:00', scheduled_date: '2026-06-02', total_cost: 200, labour_cost: 100, parts_cost: 100 },
  { id: 4, site: 'METRO', status: '', work_type: 'Repair', created_at: '2026-05-01T08:00:00' },
]

describe('workshopManagementAnalytics', () => {
  it('open-job predicate goes through the canonical vocabulary; blank is not open', () => {
    expect(isOpenJob({ status: 'In Progress' })).toBe(true)
    expect(isOpenJob({ status: 'Awaiting Parts' })).toBe(true)
    expect(isOpenJob({ status: 'Closed' })).toBe(false)
    expect(isOpenJob({ status: '' })).toBe(false)
  })

  it('turnaround and on-time are null when unmeasurable', () => {
    expect(turnaroundHours(rows[0])).toBe(4)
    expect(turnaroundHours(rows[1])).toBeNull()
    expect(isOnTime(rows[0])).toBe(true)
    expect(isOnTime(rows[2])).toBe(false)
    expect(isOnTime(rows[1])).toBeNull()
  })

  it('computes KPIs, with null rates on an empty set', () => {
    const k = workshopKpis(rows, now)
    expect(k.total).toBe(4)
    expect(k.totalThisMonth).toBe(2)
    expect(k.completedCount).toBe(2) // Closed normalises to Completed
    expect(k.completionRate).toBe(50)
    expect(k.openJobs).toBe(1)
    expect(k.onTimePct).toBe(50)
    expect(k.totalCost).toBe(350)
    const empty = workshopKpis([], now)
    expect(empty.completionRate).toBeNull()
    expect(empty.onTimePct).toBeNull()
    expect(empty.avgTA).toBeNull()
  })

  it('filters on the canonical status, technician and text', () => {
    expect(filterJobs(rows, { status: 'Completed' }).map((r) => r.id)).toEqual([1, 3])
    expect(filterJobs(rows, { techSearch: 'sar' }).map((r) => r.id)).toEqual([3])
    expect(filterJobs(rows, { search: 'metro' }).map((r) => r.id)).toEqual([3, 4])
  })

  it('site scorecard carries its cost split and honest nulls', () => {
    const s = sitePerformance(rows, now)
    const nhc = s.find((x) => x.site === 'NHC')
    expect(nhc.total).toBe(2)
    expect(nhc.openJobs).toBe(1)
    expect(nhc.labourCost).toBe(90)
    expect(nhc.avgPerJob).toBe(75)
    expect(nhc.compRate).toBe(50)
    expect(nhc.otRate).toBe(100)
  })

  it('technician scorecard rates completion', () => {
    const t = technicianPerformance(rows)
    expect(t.find((x) => x.tech === 'Unassigned').compRate).toBe(0)
    expect(t.find((x) => x.tech === 'Sara').rating.label).toBe('Excellent')
    expect(ratingFor(null).label).toBe('Not rated')
  })

  it('folds unknown work types into Other', () => {
    expect(workTypeCounts(rows)).toEqual([
      { type: 'Tyre Change', count: 1 }, { type: 'Repair', count: 2 }, { type: 'Other', count: 1 },
    ])
  })

  it('builds 12-month series with null turnaround for empty months', () => {
    const m = monthlySeries(rows, { now })
    expect(m.keys).toHaveLength(12)
    expect(m.keys.at(-1)).toBe('2026-07')
    expect(m.labour.at(-1)).toBe(90)
    expect(m.avgTurnaround.at(-1)).toBe(4)
    expect(m.avgTurnaround.at(-3)).toBeNull()
    expect(m.completedBySite.NHC.at(-1)).toBe(1)
    expect(m.hasCost).toBe(true)
    expect(lastMonths(2, now)).toEqual(['2026-06', '2026-07'])
    expect(monthLabel('2026-07')).toBe('Jul 2026')
  })

  it('cost split shares are null when there is no cost', () => {
    expect(costSplit([]).labourPct).toBeNull()
    const c = costSplit(rows)
    expect(c.total).toBe(350)
    expect(c.labourPct).toBeCloseTo(54.29, 1)
  })
})
