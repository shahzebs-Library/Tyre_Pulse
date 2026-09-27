import { describe, expect, it } from 'vitest'
import {
  daysUntil, dueLabel, jobCardRows, summarizeJobCards, pmDueRows, summarizePmDue,
  countryCostRows, formatMoney,
} from '../lib/reportShareAnalytics'

const NOW = new Date(2026, 8, 26, 15, 30) // local 26 Sep 2026, mid-afternoon

describe('due dates', () => {
  it('counts whole calendar days and ignores the time of day', () => {
    expect(daysUntil('2026-09-26', NOW)).toBe(0)
    expect(daysUntil('2026-09-30', NOW)).toBe(4)
    expect(daysUntil('2026-09-20', NOW)).toBe(-6)
    expect(daysUntil(null, NOW)).toBeNull()
    expect(daysUntil('not a date', NOW)).toBeNull()
  })
  it('labels due states honestly', () => {
    expect(dueLabel(-3)).toBe('Overdue 3d')
    expect(dueLabel(0)).toBe('Due today')
    expect(dueLabel(5)).toBe('In 5d')
    expect(dueLabel(null)).toBe('N/A')
  })
})

describe('job cards', () => {
  const rows = jobCardRows([
    { wo_no: 'WO-1', asset_no: 'TM1', status: 'Open', priority: 'High', site: 'NHC' },
    { wo_no: 'WO-2', asset_no: '', status: 'Open', priority: 'Critical' },
    { wo_no: 'WO-3', status: 'In Progress', priority: 'low' },
  ])
  it('keeps blanks as null and gives every row a stable key', () => {
    expect(rows[1].asset_no).toBeNull()
    expect(rows[2].site).toBeNull()
    expect(new Set(rows.map((r) => r.key)).size).toBe(3)
  })
  it('summarises the listed rows', () => {
    const s = summarizeJobCards(rows)
    expect(s).toMatchObject({ listed: 3, highPriority: 2 })
    expect(s.byStatus).toEqual({ Open: 2, 'In Progress': 1 })
  })
  it('tolerates a missing list', () => {
    expect(jobCardRows(undefined)).toEqual([])
  })
})

describe('maintenance due', () => {
  const rows = pmDueRows([
    { asset_no: 'TM1', name: 'Service A', next_due: '2026-09-20', priority: 'High' },
    { asset_no: 'TM2', name: 'Service B', next_due: '2026-09-26' },
    { asset_no: 'TM3', name: 'Service C', next_due: null },
  ], NOW)
  it('derives overdue flags and labels', () => {
    expect(rows.map((r) => r.due_label)).toEqual(['Overdue 6d', 'Due today', 'N/A'])
    expect(rows.map((r) => r.overdue)).toEqual([true, false, false])
  })
  it('summarises overdue, today and undated plans', () => {
    expect(summarizePmDue(rows)).toEqual({ listed: 3, overdue: 1, dueToday: 1, undated: 1, worstOverdueDays: 6 })
    expect(summarizePmDue([]).worstOverdueDays).toBeNull()
  })
})

describe('country cost', () => {
  it('keeps each currency and never invents a zero', () => {
    const rows = countryCostRows([
      { country: 'KSA', currency: 'SAR', total: 1000.4, tyre: null, maintenance: '200' },
      { country: 'UAE', currency: 'AED', total: 'x' },
    ])
    expect(rows[0]).toMatchObject({ total: 1000.4, tyre: null, maintenance: 200 })
    expect(rows[1].total).toBeNull()
    expect(formatMoney(rows[0].total, rows[0].currency)).toBe('SAR 1,000')
    expect(formatMoney(null, 'SAR')).toBe('N/A')
    expect(formatMoney(5, null)).toBe('5')
  })
})
