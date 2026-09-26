import { describe, it, expect } from 'vitest'
import {
  toIsoDay, addDays, weekRange, prevWeek, inDayRange, onDay, tyreSpend, weekDelta,
  dailyBudgetFromTargets, siteActivity, fleetStatus, upcomingWorkOrders, buildPriorityQueue,
  queueCounts, filterActionItems, isSlaBreached, actionKpis, buildBriefingHtml, escapeHtml,
} from '../lib/dailyOpsAnalytics'

const DAY = '2026-09-16' // a Wednesday

describe('dailyOpsAnalytics dates', () => {
  it('formats local days and shifts across month ends', () => {
    expect(toIsoDay(new Date(2026, 0, 5))).toBe('2026-01-05')
    expect(addDays('2026-01-31', 1)).toBe('2026-02-01')
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28')
  })

  it('builds Monday to Sunday weeks', () => {
    expect(weekRange(DAY)).toEqual({ start: '2026-09-14', end: '2026-09-20' })
    expect(prevWeek(DAY)).toEqual({ start: '2026-09-07', end: '2026-09-13' })
  })

  it('filters by day for dates and timestamps', () => {
    const rows = [{ d: '2026-09-16' }, { d: '2026-09-16T10:00:00Z' }, { d: '2026-09-17' }, { d: null }]
    expect(onDay(rows, 'd', DAY)).toHaveLength(2)
    expect(inDayRange(rows, 'd', '2026-09-16', '2026-09-17')).toHaveLength(3)
  })
})

describe('dailyOpsAnalytics money and deltas', () => {
  it('sums priced spend with qty and reports unpriced as unknown', () => {
    expect(tyreSpend([{ cost_per_tyre: 100, qty: 2 }, { cost_per_tyre: 50 }])).toEqual({ total: 250, priced: 2, count: 2 })
    expect(tyreSpend([{ cost_per_tyre: null }, { cost_per_tyre: '' }]).total).toBeNull()
    expect(tyreSpend([]).total).toBe(0)
  })

  it('has no percentage from a zero base', () => {
    expect(weekDelta(5, 0)).toEqual({ val: 5, pct: null })
    expect(weekDelta(0, 0)).toEqual({ val: 0, pct: 0 })
    expect(weekDelta(15, 10)).toEqual({ val: 5, pct: 50 })
  })

  it('daily budget is null when no target is set', () => {
    expect(dailyBudgetFromTargets({})).toBeNull()
    expect(dailyBudgetFromTargets({ annual_budget: '0' })).toBeNull()
    expect(dailyBudgetFromTargets({ annual_budget: '365000' })).toBe(1000)
  })
})

describe('dailyOpsAnalytics fleet and work', () => {
  it('ranks site activity', () => {
    expect(siteActivity([{ site: 'A' }, { site: 'B' }, { site: 'A' }, {}])).toEqual([['A', 2], ['B', 1], ['Unknown', 1]])
  })

  it('counts active, critical and dormant vehicles', () => {
    const s = fleetStatus({
      todayRecs: [{ asset_no: 'T1', risk_level: 'Critical' }],
      todayIns: [{ asset_no: 'T2' }],
      tyreRecords: [{ asset_no: 'T1', issue_date: DAY }],
      allTyres30: [{ asset_no: 'T1' }, { asset_no: 'T9' }],
      selectedDate: DAY,
    })
    expect(s).toEqual({ active: 2, critical: 1, dormant: 1 })
  })

  it('lists open upcoming work orders and ignores closed ones in any case', () => {
    const wos = [
      { id: 1, scheduled_date: '2026-09-18', status: 'Open' },
      { id: 2, scheduled_date: '2026-09-17', status: 'completed' },
      { id: 3, scheduled_date: '2026-09-30', status: 'Open' },
      { id: 4, scheduled_date: '2026-09-17', status: 'In Progress' },
    ]
    expect(upcomingWorkOrders(wos, DAY).map((w) => w.id)).toEqual([4, 1])
  })

  it('builds a severity-ordered priority queue', () => {
    const q = buildPriorityQueue({
      todayRecs: [{ id: 1, asset_no: 'T1', risk_level: 'Critical', issue_date: DAY }],
      workOrders: [{ id: 5, scheduled_date: '2026-09-15', status: 'Open', asset_no: 'T2' }, { id: 6, scheduled_date: '2026-09-01', status: 'Open' }],
      tyreRecords: [{ asset_no: 'T1', issue_date: DAY }],
      inspections: [],
      allTyres30: [{ asset_no: 'T1' }, { asset_no: 'T3' }],
      selectedDate: DAY,
    })
    expect(q.map((i) => i.severity)).toEqual(['Critical', 'Critical', 'High', 'Medium'])
    expect(q.find((i) => i.id === 'inactive-T3')).toBeTruthy()
    expect(queueCounts(q)).toEqual({ Critical: 2, High: 1, Medium: 1, Low: 0 })
  })

  it('filters operational work by status, owner, search and my work', () => {
    const items = [
      { id: 1, status: 'open', assigned_to: 'Ali', site: 'NHC', title: 'Fix TM1', due_date: '2026-09-10' },
      { id: 2, status: 'resolved', assigned_to: 'Sara', site: 'JED', title: 'Done' },
      { id: 3, status: 'open', assigned_user_id: 'u1', title: 'Mine' },
    ]
    expect(filterActionItems(items, { selectedDate: DAY })).toHaveLength(2)
    expect(filterActionItems(items, { status: 'overdue', selectedDate: DAY }).map((i) => i.id)).toEqual([1])
    expect(filterActionItems(items, { status: 'all', search: 'tm1', selectedDate: DAY })).toHaveLength(1)
    expect(filterActionItems(items, { status: 'all', myWork: true, selectedDate: DAY }, { userId: 'u1', names: ['Ali'] }).map((i) => i.id)).toEqual([1, 3])
  })

  it('computes SLA breach and work KPIs with an injected now', () => {
    const now = new Date('2026-09-16T12:00:00Z')
    const items = [
      { status: 'open', sla_due_at: '2026-09-16T10:00:00Z', due_date: '2026-09-15', approval_status: 'pending' },
      { status: 'blocked', sla_due_at: '2026-09-17T10:00:00Z' },
      { status: 'resolved', sla_due_at: '2026-09-01T00:00:00Z' },
    ]
    expect(isSlaBreached(items[0], now)).toBe(true)
    expect(isSlaBreached(items[2], now)).toBe(false)
    expect(actionKpis(items, DAY, now)).toEqual({ active: 2, overdue: 1, slaBreached: 1, pendingApproval: 1, blocked: 1 })
  })
})

describe('dailyOpsAnalytics briefing document', () => {
  it('escapes every value', () => {
    expect(escapeHtml('<b>"x"&</b>')).toBe('&lt;b&gt;&quot;x&quot;&amp;&lt;/b&gt;')
    const html = buildBriefingHtml({
      dateLabel: 'Wed', dateIso: DAY,
      summary: [['Alerts', 2]],
      queue: [{ severity: 'Evil', type: 't', asset: '<script>', description: 'd' }],
      sites: [['<img>', 3]],
      generatedAt: 'now',
    })
    expect(html).not.toContain('<script>')
    expect(html).not.toContain('<img>')
    expect(html).toContain('class="sev-Low"')
    expect(html).toContain('Priority Action Queue (1)')
  })
})
