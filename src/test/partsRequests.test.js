import { describe, it, expect } from 'vitest'
import {
  PARTS_STATUS, PARTS_STATUS_FLOW, normalizePartsStatus, isOpenParts,
  isTerminalParts, canAdvanceParts, nextPartsStatus, partAgeHours, summarizeParts,
} from '../lib/partsRequests'

const NOW = new Date('2026-07-20T12:00:00Z')

describe('partsRequests - status vocabulary + normalisation', () => {
  it('exposes the 6 canonical statuses', () => {
    expect(PARTS_STATUS).toEqual(['requested', 'approved', 'issued', 'fulfilled', 'rejected', 'cancelled'])
  })
  it('normalises case / whitespace and rejects unknowns', () => {
    expect(normalizePartsStatus('  Approved ')).toBe('approved')
    expect(normalizePartsStatus('ISSUED')).toBe('issued')
    expect(normalizePartsStatus('nope')).toBe('')
    expect(normalizePartsStatus(null)).toBe('')
  })
})

describe('partsRequests - status flow', () => {
  it('advances requested -> approved -> issued -> fulfilled', () => {
    expect(nextPartsStatus('requested')).toBe('approved')
    expect(nextPartsStatus('approved')).toBe('issued')
    expect(nextPartsStatus('issued')).toBe('fulfilled')
    expect(nextPartsStatus('fulfilled')).toBe(null)
  })
  it('allows reject / cancel from any open status but not from terminal', () => {
    expect(canAdvanceParts('requested', 'rejected')).toBe(true)
    expect(canAdvanceParts('approved', 'cancelled')).toBe(true)
    expect(canAdvanceParts('issued', 'rejected')).toBe(true)
    expect(canAdvanceParts('fulfilled', 'rejected')).toBe(false)
    expect(canAdvanceParts('rejected', 'approved')).toBe(false)
  })
  it('forbids skipping a step (requested -> issued)', () => {
    expect(canAdvanceParts('requested', 'issued')).toBe(false)
    expect(canAdvanceParts('requested', 'fulfilled')).toBe(false)
  })
  it('terminal statuses have no onward transitions', () => {
    expect(PARTS_STATUS_FLOW.fulfilled).toEqual([])
    expect(PARTS_STATUS_FLOW.rejected).toEqual([])
    expect(PARTS_STATUS_FLOW.cancelled).toEqual([])
    expect(isTerminalParts('fulfilled')).toBe(true)
    expect(isOpenParts('fulfilled')).toBe(false)
    expect(isOpenParts('requested')).toBe(true)
  })
})

describe('partsRequests - partAgeHours', () => {
  it('measures requested_at -> fulfilled_at when fulfilled', () => {
    const row = { requested_at: '2026-07-20T06:00:00Z', fulfilled_at: '2026-07-20T09:00:00Z' }
    expect(partAgeHours(row, NOW)).toBe(3)
  })
  it('measures requested_at -> now for an open request', () => {
    const row = { requested_at: '2026-07-20T10:00:00Z', fulfilled_at: null }
    expect(partAgeHours(row, NOW)).toBe(2)
  })
  it('is null with no requested_at and never negative', () => {
    expect(partAgeHours({ requested_at: null }, NOW)).toBe(null)
    expect(partAgeHours({ requested_at: '2026-07-20T15:00:00Z' }, NOW)).toBe(0)
  })
})

describe('partsRequests - summarizeParts', () => {
  const rows = [
    // open, overdue (needed_by past, not fulfilled)
    { status: 'requested', qty: 2, part_name: 'Brake pad set', requested_at: '2026-07-19T08:00:00Z', needed_by: '2026-07-20T06:00:00Z', fulfilled_at: null },
    // open, not overdue
    { status: 'approved', qty: 1, part_name: 'Oil filter', requested_at: '2026-07-20T09:00:00Z', needed_by: '2026-07-21T09:00:00Z', fulfilled_at: null },
    // fulfilled in 4h
    { status: 'fulfilled', qty: 3, part_name: 'Brake pad set', requested_at: '2026-07-18T08:00:00Z', needed_by: '2026-07-19T08:00:00Z', fulfilled_at: '2026-07-18T12:00:00Z' },
    // fulfilled in 6h
    { status: 'fulfilled', qty: 1, part_name: 'Oil filter', requested_at: '2026-07-17T08:00:00Z', needed_by: null, fulfilled_at: '2026-07-17T14:00:00Z' },
    // rejected with a past needed_by -> NOT counted as overdue
    { status: 'rejected', qty: 1, part_name: 'Wiper blade', requested_at: '2026-07-15T08:00:00Z', needed_by: '2026-07-16T08:00:00Z', fulfilled_at: null },
  ]

  it('buckets open / fulfilled / overdue correctly', () => {
    const s = summarizeParts(rows, { now: NOW })
    expect(s.total).toBe(5)
    expect(s.open).toBe(2)          // requested + approved
    expect(s.fulfilled).toBe(2)
    expect(s.overdue).toBe(1)       // only the open requested one; rejected excluded
  })

  it('counts byStatus over the full canonical vocabulary', () => {
    const s = summarizeParts(rows, { now: NOW })
    expect(s.byStatus.requested).toBe(1)
    expect(s.byStatus.approved).toBe(1)
    expect(s.byStatus.fulfilled).toBe(2)
    expect(s.byStatus.rejected).toBe(1)
    expect(s.byStatus.issued).toBe(0)
    expect(s.byStatus.cancelled).toBe(0)
  })

  it('averages fulfil time over fulfilled rows only ((4+6)/2 = 5)', () => {
    const s = summarizeParts(rows, { now: NOW })
    expect(s.avgFulfilOreHours).toBe(5)
  })

  it('rolls up byPart with count + qty, sorted by count desc', () => {
    const s = summarizeParts(rows, { now: NOW })
    const brake = s.byPart.find((p) => p.part === 'Brake pad set')
    const oil = s.byPart.find((p) => p.part === 'Oil filter')
    expect(brake).toEqual({ part: 'Brake pad set', count: 2, qty: 5 })
    expect(oil).toEqual({ part: 'Oil filter', count: 2, qty: 2 })
    // Wiper blade appears once
    expect(s.byPart.find((p) => p.part === 'Wiper blade').count).toBe(1)
  })

  it('avgFulfilOreHours is null when nothing has been fulfilled', () => {
    const s = summarizeParts(
      [{ status: 'requested', qty: 1, part_name: 'X', requested_at: '2026-07-20T10:00:00Z' }],
      { now: NOW },
    )
    expect(s.avgFulfilOreHours).toBe(null)
    expect(s.fulfilled).toBe(0)
  })

  it('degrades honestly on empty / non-array input', () => {
    const s = summarizeParts([], { now: NOW })
    expect(s).toEqual({
      total: 0, open: 0, fulfilled: 0, overdue: 0,
      byStatus: { requested: 0, approved: 0, issued: 0, fulfilled: 0, rejected: 0, cancelled: 0 },
      avgFulfilOreHours: null, byPart: [],
    })
    expect(summarizeParts(null).total).toBe(0)
  })
})
