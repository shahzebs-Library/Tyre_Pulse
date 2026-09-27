import { describe, it, expect } from 'vitest'
import {
  turnaroundHours, isOnTime, scheduleVarianceDays, costSplit, parseParts, partsSummary,
  assetHistorySummary, formatHours, formatMoney, formatPct, partsExportRows, historyExportRows,
} from '../lib/workshopJobDetailAnalytics'

const NOW = new Date('2026-09-27T00:00:00Z').getTime()
const job = {
  id: 'j1', work_order_no: 'WO-1', asset_no: 'TM1', status: 'Completed',
  created_at: '2026-09-10T00:00:00Z', completed_at: '2026-09-12T00:00:00Z', scheduled_date: '2026-09-11',
  labour_cost: 300, parts_cost: 600, total_cost: 1000,
  parts_used: JSON.stringify([{ name: 'Valve', qty: 2, cost: 100 }, { part_name: 'Seal', qty: 1 }, 'junk']),
}

describe('workshopJobDetailAnalytics', () => {
  it('measures turnaround and schedule honestly', () => {
    expect(turnaroundHours(job)).toBe(48)
    expect(isOnTime(job)).toBe(false)
    expect(scheduleVarianceDays(job, NOW)).toBe(1)
    expect(turnaroundHours({ created_at: job.created_at })).toBeNull()
    expect(isOnTime({ completed_at: job.completed_at })).toBeNull()
    expect(scheduleVarianceDays({ status: 'Open', scheduled_date: '2026-09-20' }, NOW)).toBe(7)
    expect(scheduleVarianceDays({ status: 'Open', scheduled_date: '2026-10-20' }, NOW)).toBeNull()
    expect(scheduleVarianceDays({ status: 'Open' }, NOW)).toBeNull()
  })

  it('splits cost with N/A shares when there is no total', () => {
    const s = costSplit(job)
    expect(s.labourPct).toBe(30)
    expect(s.partsPct).toBe(60)
    expect(s.other).toBe(100)
    const none = costSplit({ labour_cost: 5, total_cost: 0 })
    expect(none.labourPct).toBeNull()
    expect(none.other).toBeNull()
  })

  it('parses parts defensively and reconciles priced lines only', () => {
    const parts = parseParts(job)
    expect(parts).toHaveLength(2)
    expect(parseParts({ parts_used: '{bad' })).toEqual([])
    const sum = partsSummary(parts, job)
    expect(sum).toMatchObject({ lines: 2, qty: 3, costed: 1, unpriced: 1, lineCost: 100, recordedPartsCost: 600, reconcileGap: 500 })
    expect(partsSummary([], job).lineCost).toBeNull()
  })

  it('summarises asset history and repeat visits', () => {
    const history = [
      job,
      { id: 'j0', work_order_no: 'WO-0', created_at: '2026-09-01T00:00:00Z', completed_at: '2026-09-01T12:00:00Z', total_cost: 200 },
      { id: 'jold', created_at: '2024-01-01T00:00:00Z', total_cost: 50 },
    ]
    const h = assetHistorySummary(history, job, { now: NOW })
    expect(h.otherJobs).toBe(2)
    expect(h.jobs12m).toBe(1)
    expect(h.cost12m).toBe(200)
    expect(h.repeatWithin30).toBe(1)
    expect(h.priorJob).toBe('WO-0')
    expect(h.daysSincePrior).toBe(9)
    expect(h.avgTurnaroundHours).toBe(12)
    expect(assetHistorySummary([], job, { now: NOW }).cost12m).toBeNull()
  })

  it('formats and exports with N/A for gaps', () => {
    expect(formatHours(null)).toBe('N/A')
    expect(formatHours(0.5)).toBe('30m')
    expect(formatHours(96)).toBe('4.0 days')
    expect(formatMoney(null, 'SAR')).toBe('N/A')
    expect(formatMoney(1500, 'SAR')).toBe('SAR 1.5K')
    expect(formatPct(null)).toBe('N/A')
    expect(partsExportRows(parseParts(job))[1]).toEqual({ line: 2, part: 'Seal', qty: 1, cost: 'N/A' })
    expect(historyExportRows([{ id: 'x' }])[0]).toMatchObject({ work_order_no: 'x', total_cost: 'N/A', turnaround: 'N/A' })
  })
})
