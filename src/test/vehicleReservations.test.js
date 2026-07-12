import { describe, it, expect } from 'vitest'
import {
  toFiniteNumber, durationHours, overlaps, findConflicts, summariseReservations,
} from '../lib/vehicleReservations'

const iso = (s) => new Date(s).toISOString()

describe('vehicleReservations — toFiniteNumber', () => {
  it('parses numbers and numeric strings, rejects junk', () => {
    expect(toFiniteNumber(120)).toBe(120)
    expect(toFiniteNumber('120')).toBe(120)
    expect(toFiniteNumber('1,250 km')).toBe(1250)
    expect(toFiniteNumber('')).toBeNull()
    expect(toFiniteNumber(null)).toBeNull()
    expect(toFiniteNumber('abc')).toBeNull()
  })
})

describe('vehicleReservations — durationHours', () => {
  it('returns hours between start_at and end_at', () => {
    expect(durationHours({ start_at: iso('2026-07-01T08:00:00Z'), end_at: iso('2026-07-01T12:00:00Z') })).toBe(4)
  })

  it('returns null when a bound is missing or invalid', () => {
    expect(durationHours({ start_at: iso('2026-07-01T08:00:00Z') })).toBeNull()
    expect(durationHours({ start_at: 'nonsense', end_at: iso('2026-07-01T12:00:00Z') })).toBeNull()
    expect(durationHours({})).toBeNull()
  })

  it('returns null for a non-positive window', () => {
    expect(durationHours({ start_at: iso('2026-07-01T12:00:00Z'), end_at: iso('2026-07-01T08:00:00Z') })).toBeNull()
    expect(durationHours({ start_at: iso('2026-07-01T12:00:00Z'), end_at: iso('2026-07-01T12:00:00Z') })).toBeNull()
  })
})

describe('vehicleReservations — overlaps', () => {
  const base = (over) => ({
    asset_no: 'POOL-1',
    start_at: iso('2026-07-01T08:00:00Z'),
    end_at: iso('2026-07-01T12:00:00Z'),
    ...over,
  })

  it('true for same asset with overlapping windows', () => {
    const a = base({})
    const b = base({ start_at: iso('2026-07-01T10:00:00Z'), end_at: iso('2026-07-01T14:00:00Z') })
    expect(overlaps(a, b)).toBe(true)
    expect(overlaps(b, a)).toBe(true)
  })

  it('false for different assets even when windows overlap', () => {
    const a = base({})
    const b = base({ asset_no: 'POOL-2', start_at: iso('2026-07-01T10:00:00Z'), end_at: iso('2026-07-01T14:00:00Z') })
    expect(overlaps(a, b)).toBe(false)
  })

  it('false for back-to-back (half-open) windows that only touch', () => {
    const a = base({})
    const b = base({ start_at: iso('2026-07-01T12:00:00Z'), end_at: iso('2026-07-01T16:00:00Z') })
    expect(overlaps(a, b)).toBe(false)
  })

  it('false when a window is missing or degenerate', () => {
    const a = base({})
    expect(overlaps(a, base({ end_at: null }))).toBe(false)
    expect(overlaps(a, base({ asset_no: '' }))).toBe(false)
    expect(overlaps(null, a)).toBe(false)
  })
})

describe('vehicleReservations — findConflicts', () => {
  it('reports each conflicting pair once and ignores cancelled bookings', () => {
    const rows = [
      { id: 1, asset_no: 'POOL-1', status: 'approved', start_at: iso('2026-07-01T08:00:00Z'), end_at: iso('2026-07-01T12:00:00Z') },
      { id: 2, asset_no: 'POOL-1', status: 'out', start_at: iso('2026-07-01T10:00:00Z'), end_at: iso('2026-07-01T14:00:00Z') },
      { id: 3, asset_no: 'POOL-1', status: 'cancelled', start_at: iso('2026-07-01T09:00:00Z'), end_at: iso('2026-07-01T11:00:00Z') },
      { id: 4, asset_no: 'POOL-2', status: 'approved', start_at: iso('2026-07-01T08:00:00Z'), end_at: iso('2026-07-01T12:00:00Z') },
    ]
    const conflicts = findConflicts(rows)
    expect(conflicts).toHaveLength(1)
    expect([conflicts[0].a.id, conflicts[0].b.id].sort()).toEqual([1, 2])
  })

  it('returns [] for empty / non-array input', () => {
    expect(findConflicts([])).toEqual([])
    expect(findConflicts()).toEqual([])
    expect(findConflicts(null)).toEqual([])
  })
})

describe('vehicleReservations — summariseReservations', () => {
  const NOW = Date.parse('2026-07-01T00:00:00Z')
  const rows = [
    { id: 1, asset_no: 'POOL-1', status: 'out', start_at: iso('2026-06-30T08:00:00Z'), end_at: iso('2026-06-30T18:00:00Z') },
    { id: 2, asset_no: 'POOL-1', status: 'approved', start_at: iso('2026-07-05T08:00:00Z'), end_at: iso('2026-07-05T12:00:00Z') },
    { id: 3, asset_no: 'POOL-2', status: 'requested', start_at: iso('2026-07-10T08:00:00Z'), end_at: iso('2026-07-10T12:00:00Z') },
    { id: 4, asset_no: 'POOL-2', status: 'requested', start_at: iso('2026-06-20T08:00:00Z'), end_at: iso('2026-06-20T12:00:00Z') },
    { id: 5, asset_no: 'POOL-2', status: 'requested', start_at: iso('2026-07-10T10:00:00Z'), end_at: iso('2026-07-10T14:00:00Z') },
  ]

  it('counts totals, currently-out, upcoming, distinct assets and conflicts', () => {
    const s = summariseReservations(rows, NOW)
    expect(s.totalReservations).toBe(5)
    expect(s.activeOutCount).toBe(1)
    // upcoming: approved/requested with future start_at → ids 2, 3, 5 (id 4 is past)
    expect(s.upcomingCount).toBe(3)
    expect(s.distinctAssets).toBe(2)
    // conflict: ids 3 & 5 (same asset POOL-2, overlapping 10:00–12:00 window)
    expect(s.conflictCount).toBe(1)
  })

  it('returns zeroes for empty / non-array input', () => {
    expect(summariseReservations([], NOW)).toEqual({
      totalReservations: 0, activeOutCount: 0, upcomingCount: 0, distinctAssets: 0, conflictCount: 0,
    })
    expect(summariseReservations()).toEqual({
      totalReservations: 0, activeOutCount: 0, upcomingCount: 0, distinctAssets: 0, conflictCount: 0,
    })
  })

  it('is deterministic for a given nowMs regardless of wall-clock', () => {
    const past = summariseReservations(rows, Date.parse('2026-08-01T00:00:00Z'))
    expect(past.upcomingCount).toBe(0)
  })
})
