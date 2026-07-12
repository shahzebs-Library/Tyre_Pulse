import { describe, it, expect } from 'vitest'
import {
  toFiniteNumber,
  isOpen,
  isClosed,
  isOverdue,
  daysOverdue,
  rankScore,
  prioritise,
  summariseActions,
  byCategory,
  bySeverity,
  SEVERITY_WEIGHT,
} from '../lib/actionCenter'

// Fixed "now" for deterministic time-based assertions: 2026-06-15T00:00:00Z.
const NOW = Date.UTC(2026, 5, 15)
const day = (n) => new Date(NOW + n * 86_400_000).toISOString().slice(0, 10)

describe('actionCenter — toFiniteNumber', () => {
  it('parses numbers and strips noise; null for non-numeric/blank', () => {
    expect(toFiniteNumber(42)).toBe(42)
    expect(toFiniteNumber('12.5')).toBe(12.5)
    expect(toFiniteNumber('SAR 1,200')).toBe(1200)
    expect(toFiniteNumber('')).toBeNull()
    expect(toFiniteNumber(null)).toBeNull()
    expect(toFiniteNumber('abc')).toBeNull()
  })
})

describe('actionCenter — status predicates', () => {
  it('classifies open vs closed statuses', () => {
    expect(isOpen({ status: 'open' })).toBe(true)
    expect(isOpen({ status: 'in_progress' })).toBe(true)
    expect(isOpen({ status: 'ACKNOWLEDGED' })).toBe(true) // case-insensitive
    expect(isOpen({ status: 'resolved' })).toBe(false)
    expect(isClosed({ status: 'resolved' })).toBe(true)
    expect(isClosed({ status: 'dismissed' })).toBe(true)
    expect(isClosed({ status: 'open' })).toBe(false)
  })
})

describe('actionCenter — isOverdue', () => {
  it('is true for an open item with a past due date', () => {
    expect(isOverdue({ status: 'open', due_date: day(-3) }, NOW)).toBe(true)
  })
  it('is false for a future or today due date', () => {
    expect(isOverdue({ status: 'open', due_date: day(5) }, NOW)).toBe(false)
    expect(isOverdue({ status: 'open', due_date: day(0) }, NOW)).toBe(false)
  })
  it('is never overdue when closed, even with a past due date', () => {
    expect(isOverdue({ status: 'resolved', due_date: day(-10) }, NOW)).toBe(false)
    expect(isOverdue({ status: 'dismissed', due_date: day(-10) }, NOW)).toBe(false)
  })
  it('is false when there is no due date', () => {
    expect(isOverdue({ status: 'open' }, NOW)).toBe(false)
    expect(isOverdue({ status: 'open', due_date: null }, NOW)).toBe(false)
  })
})

describe('actionCenter — daysOverdue', () => {
  it('counts whole days late, 0 when not overdue', () => {
    expect(daysOverdue({ status: 'open', due_date: day(-4) }, NOW)).toBe(4)
    expect(daysOverdue({ status: 'open', due_date: day(2) }, NOW)).toBe(0)
    expect(daysOverdue({ status: 'resolved', due_date: day(-4) }, NOW)).toBe(0)
  })
})

describe('actionCenter — rankScore', () => {
  it('weights severity as the dominant signal', () => {
    const crit = rankScore({ severity: 'critical', status: 'open' }, NOW)
    const low = rankScore({ severity: 'low', status: 'open' }, NOW)
    expect(crit).toBeGreaterThan(low)
    expect(crit).toBe(SEVERITY_WEIGHT.critical)
  })
  it('adds clamped, non-negative priority_score', () => {
    const base = rankScore({ severity: 'medium', status: 'open' }, NOW)
    const withP = rankScore({ severity: 'medium', status: 'open', priority_score: 30 }, NOW)
    expect(withP).toBe(base + 30)
    // priority clamps to 100
    const clamped = rankScore({ severity: 'medium', status: 'open', priority_score: 999 }, NOW)
    expect(clamped).toBe(base + 100)
  })
  it('boosts overdue items above otherwise-equal on-time items', () => {
    const overdue = rankScore({ severity: 'high', status: 'open', due_date: day(-5) }, NOW)
    const onTime = rankScore({ severity: 'high', status: 'open', due_date: day(5) }, NOW)
    expect(overdue).toBeGreaterThan(onTime)
  })
  it('sinks closed items far below any open item via the penalty', () => {
    const closed = rankScore({ severity: 'critical', status: 'resolved' }, NOW)
    const openInfo = rankScore({ severity: 'info', status: 'open' }, NOW)
    expect(closed).toBeLessThan(openInfo)
    expect(closed).toBeLessThan(0)
  })
})

describe('actionCenter — prioritise', () => {
  it('sorts worst/most-urgent first without mutating the input', () => {
    const rows = [
      { id: 'a', severity: 'low', status: 'open' },
      { id: 'b', severity: 'critical', status: 'open' },
      { id: 'c', severity: 'medium', status: 'open', due_date: day(-10) },
      { id: 'd', severity: 'high', status: 'resolved' },
    ]
    const snapshot = rows.map((r) => r.id)
    const out = prioritise(rows, NOW)
    expect(out[0].id).toBe('b') // critical open
    expect(out[out.length - 1].id).toBe('d') // resolved sinks last
    expect(out.map((r) => r.id)).not.toEqual(snapshot) // reordered
    expect(rows.map((r) => r.id)).toEqual(snapshot) // original untouched
  })
  it('is deterministic and stable for equal scores (tiebreak by due date)', () => {
    const rows = [
      { id: 'later', severity: 'high', status: 'open', due_date: day(9), created_at: '2026-01-01' },
      { id: 'sooner', severity: 'high', status: 'open', due_date: day(2), created_at: '2026-01-02' },
    ]
    const out = prioritise(rows, NOW)
    expect(out.map((r) => r.id)).toEqual(['sooner', 'later'])
  })
  it('returns [] for empty / non-array input', () => {
    expect(prioritise([], NOW)).toEqual([])
    expect(prioritise(undefined, NOW)).toEqual([])
    expect(prioritise(null, NOW)).toEqual([])
  })
})

describe('actionCenter — summariseActions', () => {
  const rows = [
    { severity: 'critical', status: 'open', due_date: day(-2) },   // open, critical, overdue
    { severity: 'high', status: 'in_progress', due_date: day(3) }, // open
    { severity: 'medium', status: 'acknowledged', due_date: day(-1) }, // open, overdue
    { severity: 'low', status: 'resolved' },                        // resolved
    { severity: 'info', status: 'dismissed' },                      // closed, not resolved
  ]
  it('computes the KPI header counts', () => {
    const s = summariseActions(rows, NOW)
    expect(s.totalItems).toBe(5)
    expect(s.openCount).toBe(3)
    expect(s.criticalOpenCount).toBe(1)
    expect(s.overdueCount).toBe(2)
    expect(s.resolvedCount).toBe(1)
    expect(s.resolutionRate).toBe(20) // 1 / 5
  })
  it('handles empty input with a 0% resolution rate', () => {
    const s = summariseActions([], NOW)
    expect(s).toEqual({
      totalItems: 0, openCount: 0, criticalOpenCount: 0,
      overdueCount: 0, resolvedCount: 0, resolutionRate: 0,
    })
  })
})

describe('actionCenter — byCategory', () => {
  it('groups with open/total counts sorted by open desc, defaulting blank to other', () => {
    const rows = [
      { category: 'safety', status: 'open' },
      { category: 'safety', status: 'open' },
      { category: 'safety', status: 'resolved' },
      { category: 'cost', status: 'open' },
      { category: null, status: 'open' }, // -> other
    ]
    const out = byCategory(rows)
    expect(out[0]).toEqual({ category: 'safety', open: 2, total: 3 })
    const cost = out.find((c) => c.category === 'cost')
    const other = out.find((c) => c.category === 'other')
    expect(cost).toEqual({ category: 'cost', open: 1, total: 1 })
    expect(other).toEqual({ category: 'other', open: 1, total: 1 })
  })
})

describe('actionCenter — bySeverity', () => {
  it('always returns all five buckets with correct counts', () => {
    const rows = [
      { severity: 'critical' }, { severity: 'critical' },
      { severity: 'high' }, { severity: 'medium' },
      { severity: 'bogus' }, {},
    ]
    expect(bySeverity(rows)).toEqual({ info: 0, low: 0, medium: 1, high: 1, critical: 2 })
  })
  it('returns a zeroed scale for empty input', () => {
    expect(bySeverity([])).toEqual({ info: 0, low: 0, medium: 0, high: 0, critical: 0 })
  })
})
