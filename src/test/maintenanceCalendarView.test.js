import { describe, it, expect } from 'vitest'
import {
  buildWorkOrderEvents, buildTyreEvents, buildPmEvents, buildEvents, filterEvents, activeFilterCount,
  siteOptions, groupByDate, agendaGroups, calendarKpis, sourceBreakdown, monthCells, weekDays,
  periodLabel, viewRange, fmtDay, fmtDayLong, exportRows, EXPORT_COLUMNS, EXPORT_HEADERS, sortByPriority,
} from '../lib/maintenanceCalendarView'

const TODAY = new Date(2026, 9, 5) // Mon 05 Oct 2026
const TODAY_KEY = '2026-10-05'

describe('event builders', () => {
  it('marks a past, open work order overdue and leaves a closed one alone', () => {
    const ev = buildWorkOrderEvents([
      { id: 1, work_order_no: 'WO-1', target_completion: '2026-10-01', status: 'Open', asset_no: 'TM1', site: 'NHC' },
      { id: 2, work_order_no: 'WO-2', target_completion: '2026-10-01', status: 'Completed' },
      { id: 3, work_order_no: 'WO-3', target_completion: '2026-10-09', status: 'Open' },
      { id: 4, target_completion: null },
    ], TODAY_KEY)
    expect(ev.map((e) => e.type)).toEqual(['overdue_work_order', 'work_order', 'work_order'])
    expect(ev[0]).toMatchObject({ isOverdue: true, site: 'NHC', source: 'work_order', priority: 'Medium' })
  })

  it('estimates tyre dates from risk and tread and flags them estimated', () => {
    const ev = buildTyreEvents([
      { id: 1, risk_level: 'Critical', tread_depth: 5 },
      { id: 2, risk_level: 'High', tread_depth: null },
      { id: 3, risk_level: 'High', tread_depth: 2.5 },
      { id: 4, risk_level: 'Low' },
    ], TODAY)
    expect(ev.map((e) => e.date)).toEqual(['2026-10-12', '2026-10-19', '2026-10-08'])
    expect(ev.every((e) => e.estimated)).toBe(true)
    expect(ev[1].description).toContain('not recorded')
  })

  it('builds PM events only for active plans with a next due date', () => {
    const ev = buildPmEvents([
      { id: 1, name: 'Service A', status: 'active', next_due: '2026-09-20', interval_value: 3, interval_type: 'months' },
      { id: 2, name: 'Service B', status: 'active', next_due: '2026-11-20' },
      { id: 3, name: 'Paused', status: 'paused', next_due: '2026-10-10' },
      { id: 4, name: 'No date', status: 'active' },
    ], TODAY)
    expect(ev).toHaveLength(2)
    expect(ev[0]).toMatchObject({ type: 'overdue_pm', priority: 'Critical', isOverdue: true })
    expect(ev[0].subtitle).toContain('Every 3 months')
    expect(ev[1].type).toBe('pm_plan')
  })
})

const EVENTS = buildEvents({
  workOrders: [
    { id: 1, work_order_no: 'WO-1', target_completion: '2026-10-01', status: 'Open', asset_no: 'TM1', site: 'NHC', priority: 'High' },
    { id: 2, work_order_no: 'WO-2', target_completion: '2026-10-05', status: 'Open', asset_no: 'TM2', site: 'JED', priority: 'Critical' },
    { id: 3, work_order_no: 'WO-3', target_completion: '2026-11-20', status: 'Open', asset_no: 'TM3', site: 'NHC' },
  ],
  tyres: [{ id: 9, risk_level: 'Critical', tread_depth: 6, asset_no: 'TM9', site: 'JED' }],
  pmPrograms: [{ id: 7, name: 'Gen service', status: 'active', next_due: '2026-10-08', asset_no: 'GN1' }],
  today: TODAY,
})

describe('filters and grouping', () => {
  it('filters by source, priority, site and search', () => {
    expect(filterEvents(EVENTS, { source: 'tyre' })).toHaveLength(1)
    expect(filterEvents(EVENTS, { priority: 'Critical' }).map((e) => e.title)).toEqual(['WO-2', 'TM9'])
    expect(filterEvents(EVENTS, { site: 'NHC' })).toHaveLength(2)
    expect(filterEvents(EVENTS, { search: 'gen ser' })).toHaveLength(1)
    expect(activeFilterCount({ source: 'All', priority: 'High', site: 'All', search: ' x ' })).toBe(2)
  })

  it('lists sites sorted and unique', () => {
    expect(siteOptions(EVENTS)).toEqual(['JED', 'NHC'])
  })

  it('groups by date with the most urgent first', () => {
    const g = groupByDate([
      { id: 'a', date: '2026-10-05', priority: 'Low', title: 'a' },
      { id: 'b', date: '2026-10-05', priority: 'Critical', title: 'b' },
    ])
    expect(g['2026-10-05'].map((e) => e.id)).toEqual(['b', 'a'])
    expect(sortByPriority([{ priority: 'Medium', title: 'x' }, { priority: 'High', title: 'y' }])[0].title).toBe('y')
  })

  it('builds ascending agenda groups inside a range', () => {
    const a = agendaGroups(EVENTS, '2026-10-01', '2026-10-31')
    expect(a.map((g) => g.date)).toEqual(['2026-10-01', '2026-10-05', '2026-10-08', '2026-10-12'])
  })
})

describe('KPIs', () => {
  it('counts overdue, this week, next 30 days, month and critical today', () => {
    const k = calendarKpis(EVENTS, TODAY, new Date(2026, 9, 1))
    expect(k).toEqual({ overdue: 1, dueThisWeek: 2, upcoming30: 3, thisMonth: 4, criticalToday: 1 })
  })

  it('reports zeros for an empty list, never N/A shaped garbage', () => {
    expect(calendarKpis([], TODAY)).toEqual({ overdue: 0, dueThisWeek: 0, upcoming30: 0, thisMonth: 0, criticalToday: 0 })
    expect(sourceBreakdown(EVENTS)).toEqual({ work_order: 3, tyre: 1, pm_plan: 1 })
  })
})

describe('grid and labels', () => {
  it('builds a 42 cell Sunday-first month grid with local day keys', () => {
    const cells = monthCells(new Date(2026, 9, 1))
    expect(cells).toHaveLength(42)
    expect(cells[0].key).toBe('2026-09-27')
    expect(cells.filter((c) => c.inMonth)).toHaveLength(31)
    expect(cells[4].key).toBe('2026-10-01')
  })

  it('builds a Sunday to Saturday week', () => {
    const w = weekDays(TODAY)
    expect(w[0].getDay()).toBe(0)
    expect(w[0].getDate()).toBe(4)
  })

  it('formats day-first without dashes', () => {
    expect(fmtDay('2026-10-05')).toBe('05 Oct 2026')
    expect(fmtDayLong('2026-10-05')).toBe('Monday 05 October 2026')
    expect(fmtDay(null)).toBe('N/A')
    expect(periodLabel('month', new Date(2026, 9, 1))).toBe('October 2026')
    expect(periodLabel('week', TODAY)).toBe('04 Oct 2026 to 10 Oct 2026')
    expect(periodLabel('week', TODAY)).not.toMatch(/[–—]/)
  })

  it('reports the range of each view', () => {
    expect(viewRange('month', new Date(2026, 1, 1))).toEqual({ from: '2026-02-01', to: '2026-02-28' })
    expect(viewRange('week', TODAY)).toEqual({ from: '2026-10-04', to: '2026-10-10' })
    expect(viewRange('day', TODAY, new Date(2026, 9, 7))).toEqual({ from: '2026-10-07', to: '2026-10-07' })
  })
})

describe('export', () => {
  it('produces one row per event with every column, sorted by date', () => {
    const rows = exportRows(EVENTS)
    expect(rows).toHaveLength(EVENTS.length)
    expect(EXPORT_COLUMNS).toHaveLength(EXPORT_HEADERS.length)
    expect(Object.keys(rows[0])).toEqual(EXPORT_COLUMNS)
    expect(rows[0].date).toBe('01 Oct 2026')
    expect(rows.find((r) => r.title === 'TM9').source).toContain('estimated')
  })
})
