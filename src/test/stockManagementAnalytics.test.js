import { describe, it, expect } from 'vitest'
import {
  deriveStatus, buildVelocityMap, reorderSuggestion, coverBand, enrichStock, filterStock,
  summarizeStock, timelineByDate, timelineSummary, todayStr, offsetDate, firstOfMonth,
  velocitySince, stockExportRows, STOCK_EXPORT_COLS, STOCK_EXPORT_HEADERS,
} from '../lib/stockManagementAnalytics'

const NOW = new Date(2026, 8, 26, 10, 0, 0) // local 26 Sep 2026

const STOCK = [
  { id: 's1', site: 'NHC', description: '315/80', stock_qty: 2, min_level: 5, critical_level: 3, reorder_qty: 0 },
  { id: 's2', site: 'JED', description: '385/65', stock_qty: 4, min_level: 5, critical_level: 3, reorder_qty: 12 },
  { id: 's3', site: 'RUH', description: 'spare', stock_qty: 40, min_level: 5, critical_level: 3, management_action: 'hold' },
]
const ISSUES = [
  { site: 'NHC', qty: 3 }, { site: 'NHC', qty: null }, { site: 'NHC', qty: 2 },
  { site: 'JED', qty: 30 }, { site: null, qty: 9 },
]

describe('dates', () => {
  it('builds local date keys from an injected clock', () => {
    expect(todayStr(NOW)).toBe('2026-09-26')
    expect(offsetDate(-1, NOW)).toBe('2026-09-25')
    expect(offsetDate(-29, NOW)).toBe('2026-08-28')
    expect(firstOfMonth(NOW)).toBe('2026-09-01')
    expect(velocitySince(NOW, 3)).toBe('2026-06-26')
  })
})

describe('status and velocity', () => {
  it('keeps the historical status bands', () => {
    expect(deriveStatus(STOCK[0])).toBe('Critical')
    expect(deriveStatus(STOCK[1])).toBe('Low')
    expect(deriveStatus(STOCK[2])).toBe('OK')
  })
  it('builds per-site velocity and leaves cover null without consumption', () => {
    const v = buildVelocityMap(STOCK, ISSUES, 3)
    expect(v.s1.avgPerMonth).toBe(2) // (3 + 1 + 2) / 3
    expect(v.s1.daysRemaining).toBe(30)
    expect(v.s2.avgPerMonth).toBe(10)
    expect(v.s2.daysRemaining).toBe(12)
    expect(v.s3.avgPerMonth).toBe(0)
    expect(v.s3.daysRemaining).toBeNull()
  })
  it('suggests reorder only under 30 days', () => {
    expect(reorderSuggestion(STOCK[1], { daysRemaining: 12 })).toBe(12)
    expect(reorderSuggestion(STOCK[0], { daysRemaining: 10 })).toBe(8)
    expect(reorderSuggestion(STOCK[0], { daysRemaining: 30 })).toBeNull()
    expect(reorderSuggestion(STOCK[0], null)).toBeNull()
  })
  it('bands cover', () => {
    expect(coverBand(null)).toBe('unknown')
    expect(coverBand(31)).toBe('healthy')
    expect(coverBand(10)).toBe('watch')
    expect(coverBand(9)).toBe('urgent')
  })
})

describe('KPIs and filters', () => {
  const rows = enrichStock(STOCK, buildVelocityMap(STOCK, ISSUES, 3))
  it('summarises an enriched set honestly', () => {
    const k = summarizeStock(rows)
    expect(k.items).toBe(3)
    expect(k.units).toBe(46)
    expect(k.counts).toEqual({ OK: 1, Low: 1, Critical: 1 })
    expect(k.atRisk).toBe(1)
    expect(k.toReorder).toBe(12)
    expect(k.sites).toBe(3)
    expect(k.avgCoverDays).toBe(21)
    const empty = summarizeStock([])
    expect(empty.units).toBeNull()
    expect(empty.avgCoverDays).toBeNull()
  })
  it('filters by search, site and status', () => {
    expect(filterStock(rows, { search: 'hold' }).map(r => r.id)).toEqual(['s3'])
    expect(filterStock(rows, { site: 'JED' }).map(r => r.id)).toEqual(['s2'])
    expect(filterStock(rows, { status: 'Critical' }).map(r => r.id)).toEqual(['s1'])
  })
  it('exports every column with N/A for unmeasured cover', () => {
    const out = stockExportRows(rows)
    expect(STOCK_EXPORT_COLS).toHaveLength(STOCK_EXPORT_HEADERS.length)
    expect(out.find(r => r.site === 'RUH').days_left).toBe('N/A')
  })
})

describe('timeline', () => {
  const days = timelineByDate([
    { issue_date: '2026-09-26', qty: 2 },
    { issue_date: '2026-09-26T08:00:00', qty: -1 },
    { issue_date: '2026-09-25', qty: 4 },
    { issue_date: null, qty: 9 },
  ])
  it('groups by day with returns as stock in', () => {
    expect(days).toEqual([
      { date: '2026-09-25', in: 0, out: 4, net: -4 },
      { date: '2026-09-26', in: 1, out: 2, net: -1 },
    ])
  })
  it('compares today with yesterday and returns null without a baseline', () => {
    const s = timelineSummary(days, NOW)
    expect(s.todayIssues).toBe(2)
    expect(s.yesterdayIssues).toBe(4)
    expect(s.changePct).toBe(-50)
    expect(s.busiest.date).toBe('2026-09-25')
    expect(timelineSummary([], NOW).changePct).toBeNull()
    expect(timelineSummary([], NOW).busiest).toBeNull()
  })
})
