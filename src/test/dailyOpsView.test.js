import { describe, it, expect } from 'vitest'
import {
  pctChange, activeAssetsOn, isWoDelayed, delayDays, headlineKpis, shiftProgress, jobBacklog,
  turnaround, activityShare, siteBoard, dispatchRows, exceptionQueues, jobTimeline, fmtHours,
} from '../lib/dailyOpsView'

const D = '2026-10-05'
const P = '2026-10-04'

describe('pctChange', () => {
  it('returns null without a real base', () => {
    expect(pctChange(5, 0)).toBeNull()
    expect(pctChange(5, null)).toBeNull()
    expect(pctChange(null, 4)).toBeNull()
  })
  it('rounds the change', () => {
    expect(pctChange(6, 4)).toBe(50)
    expect(pctChange(3, 4)).toBe(-25)
  })
})

describe('active assets and delay', () => {
  it('counts distinct assets across tyres and inspections on the day', () => {
    const s = activeAssetsOn({
      tyreRecords: [{ asset_no: 'TM1', issue_date: D }, { asset_no: 'TM1', issue_date: D }, { asset_no: 'TM2', issue_date: P }],
      inspections: [{ asset_no: 'TM3', inspection_date: `${D}T08:00:00` }],
    }, D)
    expect([...s].sort()).toEqual(['TM1', 'TM3'])
  })
  it('flags only open jobs past target', () => {
    expect(isWoDelayed({ status: 'Open', scheduled_date: '2026-10-01' }, D)).toBe(true)
    expect(isWoDelayed({ status: 'Completed', scheduled_date: '2026-10-01' }, D)).toBe(false)
    expect(isWoDelayed({ status: 'Open', scheduled_date: null }, D)).toBe(false)
    expect(delayDays({ status: 'Open', scheduled_date: '2026-10-01' }, D)).toBe(4)
  })
})

describe('headlineKpis', () => {
  const workOrders = [
    { id: 1, status: 'Open', created_at: `${D}T07:00:00`, scheduled_date: '2026-10-02' },
    { id: 2, status: 'Completed', created_at: `${P}T07:00:00`, scheduled_date: '2026-10-05', completed_at: `${D}T10:00:00` },
    { id: 3, status: 'Completed', created_at: `${P}T07:00:00`, scheduled_date: '2026-10-03', completed_at: `${D}T10:00:00` },
  ]
  it('measures tiles; a trend only where the previous day has a base', () => {
    const k = headlineKpis({ tyreRecords: [], inspections: [], workOrders, accidents: [{ incident_date: D }], selectedDate: D })
    expect(k.workOrdersOpened).toEqual({ value: 1, trend: -50 })
    expect(k.incidents).toEqual({ value: 1, trend: null })
    expect(k.delayedJobs.value).toBe(1)
    expect(k.onTime).toEqual({ value: 50, judged: 2 })
    expect(k.activeVehicles).toEqual({ value: 0, trend: null })
  })
  it('on-time is null when no job can be judged', () => {
    expect(headlineKpis({ workOrders: [], selectedDate: D }).onTime.value).toBeNull()
  })
})

describe('shift progress, backlog, turnaround', () => {
  it('buckets statuses and excludes cancelled from the percentage', () => {
    const s = shiftProgress([{ status: 'Completed' }, { status: 'In Progress' }, { status: 'New' }, { status: 'Cancelled' }])
    expect(s).toMatchObject({ completed: 1, inProgress: 1, pending: 1, cancelled: 1, total: 4, pct: 33 })
    expect(shiftProgress([]).pct).toBeNull()
  })
  it('counts open jobs by priority', () => {
    const b = jobBacklog([
      { status: 'Open', priority: 'High', created_at: D },
      { status: 'Open', priority: 'weird', created_at: D },
      { status: 'Completed', priority: 'High', created_at: D },
      { status: 'Open', priority: 'Low', created_at: '2026-10-09' },
    ], D)
    expect(b).toMatchObject({ high: 1, unset: 1, low: 0, total: 2 })
  })
  it('averages opened-to-completed hours for jobs completed that day', () => {
    const t = turnaround([
      { opened_at: `${D}T06:00:00Z`, completed_at: `${D}T08:00:00Z` },
      { opened_at: `${D}T06:00:00Z`, completed_at: `${D}T10:00:00Z` },
    ], D)
    expect(t).toEqual({ hours: 3, n: 2, trend: null })
    expect(turnaround([], D).hours).toBeNull()
  })
})

describe('activity share and site board', () => {
  it('is null with no 30-day base', () => {
    expect(activityShare({ activeCount: 3, allTyres30: [] }).pct).toBeNull()
    expect(activityShare({ activeCount: 1, allTyres30: [{ asset_no: 'A' }, { asset_no: 'B' }] }).pct).toBe(50)
  })
  it('groups activity by site', () => {
    const rows = siteBoard({ todayRecs: [{ site: 'NHC' }], todayIns: [{ site: 'NHC' }], todayWO: [{ site: '' }] })
    expect(rows[0]).toMatchObject({ site: 'NHC', total: 2 })
    expect(rows[1].site).toBe('No site')
  })
})

describe('dispatchRows and exceptions', () => {
  const wos = [
    { id: 1, work_order_no: 'WO1', status: 'Open', priority: 'Low', created_at: `${D}T07:00:00`, scheduled_date: '2026-10-01', site: 'NHC', work_type: 'Emergency' },
    { id: 2, work_order_no: 'WO2', status: 'Open', priority: 'High', created_at: `${P}T07:00:00`, scheduled_date: '2026-10-10', site: 'JED' },
    { id: 3, work_order_no: 'WO3', status: 'Completed', priority: 'High', created_at: `${P}T07:00:00` },
  ]
  it('lists open and today jobs, delayed first, with filters', () => {
    const rows = dispatchRows(wos, D)
    expect(rows.map((r) => r.ref)).toEqual(['WO1', 'WO2'])
    expect(dispatchRows(wos, D, { status: 'delayed' }).map((r) => r.ref)).toEqual(['WO1'])
    expect(dispatchRows(wos, D, { search: 'jed' }).map((r) => r.ref)).toEqual(['WO2'])
    expect(dispatchRows(wos, D, { priority: 'high' }).map((r) => r.ref)).toEqual(['WO2'])
  })
  it('builds the exception queues', () => {
    const q = exceptionQueues({
      workOrders: wos,
      alerts: [{ id: 9, severity: 'Critical', created_at: `${D}T01:00:00Z`, resolved: false, message: 'Low pressure' }, { id: 10, severity: 'Low', created_at: D }],
      actionItems: [{ id: 5, status: 'open', sla_due_at: '2026-10-05T01:00:00Z', title: 'Fix' }, { id: 6, status: 'resolved', sla_due_at: '2026-10-01T00:00:00Z' }],
      iso: D,
      now: '2026-10-05T03:00:00Z',
    })
    expect(q.delays).toHaveLength(1)
    expect(q.breakdowns).toHaveLength(1)
    expect(q.sla).toHaveLength(1)
    expect(q.alerts).toHaveLength(1)
    expect(q.alerts[0].when).toBe('2h ago')
  })
  it('builds a job timeline and formats hours', () => {
    const [row] = dispatchRows(wos, D)
    const tl = jobTimeline(row, D)
    expect(tl.map((e) => e.key)).toEqual(['opened', 'target', 'open'])
    expect(tl[1].note).toBe('4 days late')
    expect(jobTimeline(null, D)).toEqual([])
    expect(fmtHours(null)).toBe('N/A')
    expect(fmtHours(0.5)).toBe('30 min')
  })
})
