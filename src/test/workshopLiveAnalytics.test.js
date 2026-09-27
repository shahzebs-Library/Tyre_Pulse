import { describe, expect, it } from 'vitest'
import {
  fmtMins, relTime, pct, jobColumnKey, siteOptions, filterBoard, filterJobs,
  bucketJobs, boardExportRows, delayTotals, techMatches, jobMatches,
} from '../lib/workshopLiveAnalytics'

const NOW = Date.UTC(2026, 8, 27, 12, 0, 0)

describe('workshopLiveAnalytics formatting', () => {
  it('formats minutes and relative time against an injected now', () => {
    expect(fmtMins(0)).toBe('0m'); expect(fmtMins(65)).toBe('1h 5m'); expect(fmtMins(120)).toBe('2h')
    expect(relTime(NOW - 10_000, NOW)).toBe('just now')
    expect(relTime(NOW - 5 * 60_000, NOW)).toBe('5m ago')
    expect(relTime(NOW - 3 * 86400_000, NOW)).toBe('3d ago')
    expect(relTime(null, NOW)).toBe('N/A'); expect(relTime(NOW, undefined)).toBe('N/A')
    expect(pct(null)).toBe('N/A'); expect(pct(42)).toBe('42%')
  })
})

describe('kanban + filters', () => {
  const jobs = [
    { id: 1, status: 'In Progress', site: 'NHC', work_order_no: 'WO-1', asset_no: 'TM1', target_completion: new Date(NOW - 3600_000).toISOString() },
    { id: 2, status: 'Completed', site: 'NHC', work_order_no: 'WO-2', asset_no: 'TM2', target_completion: new Date(NOW - 3600_000).toISOString() },
    { id: 3, status: 'New', site: 'JED', work_order_no: 'WO-3', asset_no: 'PL3', vor: true },
  ]
  it('derives Overdue only for open jobs past target', () => {
    expect(jobColumnKey(jobs[0], NOW)).toBe('Overdue')
    expect(jobColumnKey(jobs[1], NOW)).not.toBe('Overdue')
  })
  it('site options', () => {
    expect(siteOptions([{ site: 'ZED' }], jobs)).toEqual(['All', 'JED', 'NHC', 'ZED'])
  })
  it('filters jobs by site, predicate, column and query', () => {
    expect(filterJobs(jobs, { site: 'NHC', now: NOW })).toHaveLength(2)
    expect(filterJobs(jobs, { pred: (j) => j.vor === true, now: NOW }).map((j) => j.id)).toEqual([3])
    expect(filterJobs(jobs, { column: 'Overdue', now: NOW }).map((j) => j.id)).toEqual([1])
    expect(filterJobs(jobs, { query: 'pl3', now: NOW }).map((j) => j.id)).toEqual([3])
    expect(jobMatches(jobs[0], '')).toBe(true)
  })
  it('buckets jobs into columns with a fallback', () => {
    const b = bucketJobs(jobs, ['Overdue', 'Completed', 'Awaiting Assignment'], NOW)
    expect(b.Overdue).toHaveLength(1); expect(b.Completed).toHaveLength(1)
  })
  it('filters the board', () => {
    const board = [{ name: 'Ali', site: 'NHC', status: 'working' }, { name: 'Omar', site: 'JED', status: 'available', job: { no: 'WO-9' } }]
    expect(filterBoard(board, { site: 'JED' })).toHaveLength(1)
    expect(filterBoard(board, { query: 'wo-9' })[0].name).toBe('Omar')
    expect(filterBoard(board, { pred: (x) => x.status === 'working' })[0].name).toBe('Ali')
    expect(techMatches(board[0], 'nhc')).toBe(true)
  })
})

describe('exports and totals', () => {
  it('board export keeps unmeasured utilisation as N/A', () => {
    const [r] = boardExportRows([{ name: 'Ali', productiveMin: 90, utilization: null, lastActivityAt: NOW - 120_000 }], NOW)
    expect(r.utilization).toBe('N/A'); expect(r.productive).toBe('1h 30m'); expect(r.last_activity).toBe('2m ago')
    expect(boardExportRows([{ utilization: 0.756 }], NOW)[0].utilization).toBe('76%')
  })
  it('delay totals report null cost when nothing was costed', () => {
    expect(delayTotals([{ hoursLost: 1.5, affectedJobs: 2, costImpact: null }])).toEqual({ hours: 1.5, cost: null, affectedJobs: 2, causes: 1 })
    expect(delayTotals([{ hoursLost: 2, costImpact: 240 }, { hoursLost: 1, costImpact: 120 }]).cost).toBe(360)
  })
})
