import { describe, expect, it } from 'vitest'
import {
  SORT_FIELDS, pageStats, compactMoney, breakdownEntries, isOverdue, daysOpen, totalPages,
  selectionFromIds, mergeSelection, activeFilterCount,
} from '../lib/workOrdersAnalytics'

const NOW = Date.UTC(2026, 8, 27, 12, 0, 0)

describe('pageStats', () => {
  it('is all null when the aggregate was not read', () => {
    expect(Object.values(pageStats(null)).every((v) => v === null)).toBe(true)
  })
  it('maps the server aggregate and keeps unmeasurable averages null', () => {
    const s = pageStats({ open: 3, in_progress: '2', waiting_parts: null, overdue: 1, completed_today: 0, total_cost: '1500.5', avg_days_open: null })
    expect(s).toEqual({ open: 3, inProgress: 2, awaitParts: 0, overdue: 1, completedToday: 0, totalCost: 1500.5, avgDaysOpen: null })
  })
})

describe('formatting and breakdowns', () => {
  it('compact money', () => {
    expect(compactMoney(null, 'SAR')).toBe('N/A')
    expect(compactMoney(12345, 'SAR')).toBe('SAR 12.3k')
    expect(compactMoney(2_500_000)).toBe('2.50M')
    expect(compactMoney(42, 'AED')).toBe('AED 42')
  })
  it('breakdown entries sorted desc and tolerant', () => {
    expect(breakdownEntries([{ label: 'A', n: 1 }, { label: 'B', n: '5' }])).toEqual([['B', 5], ['A', 1]])
    expect(breakdownEntries(null)).toEqual([])
  })
})

describe('overdue and days open', () => {
  it('only open cards past target are overdue', () => {
    expect(isOverdue({ status: 'In Progress', target_completion: '2026-09-20' }, NOW)).toBe(true)
    expect(isOverdue({ status: 'Completed', target_completion: '2026-09-20' }, NOW)).toBe(false)
    expect(isOverdue({ status: 'New' }, NOW)).toBe(false)
    expect(isOverdue({ status: 'New', target_completion: '2026-10-20' }, new Date(NOW))).toBe(false)
  })
  it('days open is null without an opened date', () => {
    expect(daysOpen({}, NOW)).toBeNull()
    expect(daysOpen({ opened_at: '2026-09-20T12:00:00Z' }, NOW)).toBe(7)
    expect(daysOpen({ opened_at: '2026-09-20T12:00:00Z', completed_at: '2026-09-22T12:00:00Z' }, NOW)).toBe(2)
  })
})

describe('paging, selection, filters', () => {
  it('total pages never below 1', () => {
    expect(totalPages(0, 20)).toBe(1); expect(totalPages(41, 20)).toBe(3)
  })
  it('selection survives server paging', () => {
    expect(selectionFromIds([1, 'b'])).toEqual({ 1: true, b: true })
    const prev = new Set([1, 2, 9])
    const next = mergeSelection(prev, { 2: true, 3: true }, [1, 2, 3])
    expect([...next].sort()).toEqual([2, 3, 9])
  })
  it('counts active filters and exposes the sort whitelist', () => {
    expect(activeFilterCount({})).toBe(0)
    expect(activeFilterCount({ search: ' x ', status: 'New', from: '2026-01-01' })).toBe(3)
    expect(SORT_FIELDS.map((f) => f.key)).toContain('opened_at')
  })
})
