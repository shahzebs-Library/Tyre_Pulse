import { describe, it, expect } from 'vitest'
import {
  toFiniteNumber, resolutionHours, summariseRequests, byStatus, byCategory,
} from '../lib/serviceRequests'

describe('serviceRequests — toFiniteNumber', () => {
  it('parses numbers, numeric strings, and rejects junk', () => {
    expect(toFiniteNumber(42)).toBe(42)
    expect(toFiniteNumber('1,200')).toBe(1200)
    expect(toFiniteNumber('')).toBeNull()
    expect(toFiniteNumber(null)).toBeNull()
    expect(toFiniteNumber('abc')).toBeNull()
  })
})

describe('serviceRequests — resolutionHours', () => {
  it('returns null when either timestamp is missing', () => {
    expect(resolutionHours({ requested_at: '2026-01-01T00:00:00Z' })).toBeNull()
    expect(resolutionHours({ resolved_at: '2026-01-01T00:00:00Z' })).toBeNull()
    expect(resolutionHours({})).toBeNull()
    expect(resolutionHours(null)).toBeNull()
  })

  it('computes the hour interval between requested_at and resolved_at', () => {
    const req = { requested_at: '2026-01-01T00:00:00Z', resolved_at: '2026-01-01T06:00:00Z' }
    expect(resolutionHours(req)).toBe(6)
  })

  it('handles multi-day intervals', () => {
    const req = { requested_at: '2026-01-01T00:00:00Z', resolved_at: '2026-01-03T00:00:00Z' }
    expect(resolutionHours(req)).toBe(48)
  })

  it('returns null for negative intervals (resolved before requested) and invalid dates', () => {
    expect(resolutionHours({ requested_at: '2026-01-02T00:00:00Z', resolved_at: '2026-01-01T00:00:00Z' })).toBeNull()
    expect(resolutionHours({ requested_at: 'not-a-date', resolved_at: '2026-01-01T00:00:00Z' })).toBeNull()
  })
})

describe('serviceRequests — summariseRequests', () => {
  it('returns a zeroed summary for empty / non-array input', () => {
    expect(summariseRequests([])).toEqual({
      totalRequests: 0, openCount: 0, urgentOpenCount: 0, resolvedCount: 0, avgResolutionHours: null,
    })
    expect(summariseRequests()).toEqual({
      totalRequests: 0, openCount: 0, urgentOpenCount: 0, resolvedCount: 0, avgResolutionHours: null,
    })
  })

  it('counts totals, open, urgent-open, resolved and average resolution hours', () => {
    const rows = [
      { status: 'new', priority: 'urgent' },
      { status: 'in_progress', priority: 'high' },
      { status: 'triaged', priority: 'urgent' },
      { status: 'resolved', priority: 'medium', requested_at: '2026-01-01T00:00:00Z', resolved_at: '2026-01-01T10:00:00Z' },
      { status: 'closed', priority: 'low', requested_at: '2026-01-01T00:00:00Z', resolved_at: '2026-01-01T02:00:00Z' },
      { status: 'cancelled', priority: 'urgent' },
    ]
    const s = summariseRequests(rows)
    expect(s.totalRequests).toBe(6)
    // open = new, in_progress, triaged (cancelled/resolved/closed excluded)
    expect(s.openCount).toBe(3)
    // urgent open = new+urgent, triaged+urgent (cancelled+urgent excluded)
    expect(s.urgentOpenCount).toBe(2)
    // resolved = resolved + closed
    expect(s.resolvedCount).toBe(2)
    // avg of 10h and 2h
    expect(s.avgResolutionHours).toBe(6)
  })

  it('leaves avgResolutionHours null when no row has both timestamps', () => {
    const s = summariseRequests([{ status: 'new', priority: 'low' }, { status: 'triaged', priority: 'high' }])
    expect(s.avgResolutionHours).toBeNull()
    expect(s.openCount).toBe(2)
  })

  it('is case-insensitive on status and priority', () => {
    const s = summariseRequests([{ status: 'NEW', priority: 'URGENT' }, { status: 'Closed', priority: 'Low' }])
    expect(s.openCount).toBe(1)
    expect(s.urgentOpenCount).toBe(1)
    expect(s.resolvedCount).toBe(1)
  })
})

describe('serviceRequests — byStatus', () => {
  it('returns a per-status count and ignores blank statuses', () => {
    const rows = [
      { status: 'new' }, { status: 'new' }, { status: 'resolved' },
      { status: '' }, {}, { status: 'in_progress' },
    ]
    expect(byStatus(rows)).toEqual({ new: 2, resolved: 1, in_progress: 1 })
  })

  it('returns {} for empty / non-array input', () => {
    expect(byStatus([])).toEqual({})
    expect(byStatus()).toEqual({})
  })
})

describe('serviceRequests — byCategory', () => {
  it('returns categories sorted by count desc (alphabetical tiebreak)', () => {
    const rows = [
      { category: 'tyre' }, { category: 'tyre' }, { category: 'tyre' },
      { category: 'mechanical' }, { category: 'mechanical' },
      { category: 'electrical' }, { category: 'bodywork' },
      { category: '' }, {},
    ]
    expect(byCategory(rows)).toEqual([
      { category: 'tyre', count: 3 },
      { category: 'mechanical', count: 2 },
      { category: 'bodywork', count: 1 },
      { category: 'electrical', count: 1 },
    ])
  })

  it('returns [] for empty / non-array input', () => {
    expect(byCategory([])).toEqual([])
    expect(byCategory()).toEqual([])
  })
})
