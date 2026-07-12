import { describe, it, expect } from 'vitest'
import {
  summarizeRenewal, RENEWAL_STATUSES, RENEWAL_PRIORITIES,
} from '../lib/fleetRenewal'

describe('fleetRenewal - summarizeRenewal', () => {
  it('returns a zeroed summary for an empty list', () => {
    const s = summarizeRenewal([])
    expect(s.total).toBe(0)
    expect(s.totalEstCost).toBe(0)
    expect(s.highPriority).toBe(0)
    expect(s.planned).toBe(0)
    expect(s.open).toBe(0)
    for (const st of RENEWAL_STATUSES) expect(s.byStatus[st]).toBe(0)
    for (const p of RENEWAL_PRIORITIES) expect(s.byPriority[p]).toBe(0)
  })

  it('tolerates non-array input', () => {
    const s = summarizeRenewal(null)
    expect(s.total).toBe(0)
    expect(s.totalEstCost).toBe(0)
    expect(s.byStatus.planned).toBe(0)
  })

  it('counts plans by status', () => {
    const rows = [
      { status: 'planned' }, { status: 'planned' }, { status: 'approved' },
      { status: 'deferred' }, { status: 'completed' }, { status: 'unknown' }, {},
    ]
    const s = summarizeRenewal(rows)
    expect(s.total).toBe(7)
    expect(s.byStatus.planned).toBe(2)
    expect(s.byStatus.approved).toBe(1)
    expect(s.byStatus.deferred).toBe(1)
    expect(s.byStatus.completed).toBe(1)
    // unknown + {} are ignored by status buckets
    expect(s.planned).toBe(2)
  })

  it('counts plans by priority and reports high-priority count', () => {
    const rows = [
      { priority: 'high' }, { priority: 'high' }, { priority: 'medium' },
      { priority: 'low' }, { priority: 'nope' }, {},
    ]
    const s = summarizeRenewal(rows)
    expect(s.byPriority.high).toBe(2)
    expect(s.byPriority.medium).toBe(1)
    expect(s.byPriority.low).toBe(1)
    expect(s.highPriority).toBe(2)
  })

  it('sums estimated cost across rows, coercing strings and ignoring junk', () => {
    const rows = [
      { est_cost: 10000 }, { est_cost: '5000.50' }, { est_cost: null },
      { est_cost: 'abc' }, {},
    ]
    const s = summarizeRenewal(rows)
    expect(s.totalEstCost).toBeCloseTo(15000.5, 2)
  })

  it('computes open as planned + approved + deferred (not completed)', () => {
    const rows = [
      { status: 'planned' }, { status: 'approved' }, { status: 'deferred' },
      { status: 'completed' }, { status: 'completed' },
    ]
    const s = summarizeRenewal(rows)
    expect(s.open).toBe(3)
    expect(s.byStatus.completed).toBe(2)
  })
})
