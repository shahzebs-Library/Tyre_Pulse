import { describe, it, expect } from 'vitest'
import {
  toFiniteNumber, daysUntilExpiry, expiryStatus, summariseTraining, byCategory,
} from '../lib/driverTraining'

// Fixed, explicit clock: 2026-06-15T12:00:00Z. Every time-dependent assertion
// injects this so the suite is fully deterministic.
const NOW = Date.UTC(2026, 5, 15, 12, 0, 0)

describe('driverTraining — toFiniteNumber', () => {
  it('parses numbers, numeric strings, and rejects junk', () => {
    expect(toFiniteNumber(42)).toBe(42)
    expect(toFiniteNumber('1,200')).toBe(1200)
    expect(toFiniteNumber('')).toBeNull()
    expect(toFiniteNumber(null)).toBeNull()
    expect(toFiniteNumber('abc')).toBeNull()
  })
})

describe('driverTraining — daysUntilExpiry', () => {
  it('returns null when there is no expiry_date', () => {
    expect(daysUntilExpiry({}, NOW)).toBeNull()
    expect(daysUntilExpiry({ expiry_date: null }, NOW)).toBeNull()
    expect(daysUntilExpiry({ expiry_date: 'not-a-date' }, NOW)).toBeNull()
  })

  it('returns a positive day count for a future expiry', () => {
    expect(daysUntilExpiry({ expiry_date: '2026-06-25' }, NOW)).toBe(10)
  })

  it('returns a negative day count for a past expiry', () => {
    expect(daysUntilExpiry({ expiry_date: '2026-06-05' }, NOW)).toBe(-10)
  })

  it('returns 0 when expiry is today', () => {
    expect(daysUntilExpiry({ expiry_date: '2026-06-15' }, NOW)).toBe(0)
  })
})

describe('driverTraining — expiryStatus', () => {
  it('is "unknown" without a valid expiry_date', () => {
    expect(expiryStatus({}, NOW)).toBe('unknown')
  })

  it('is "expired" when the date is in the past', () => {
    expect(expiryStatus({ expiry_date: '2026-06-14' }, NOW)).toBe('expired')
  })

  it('is "expiring_soon" within 30 days (boundary inclusive)', () => {
    expect(expiryStatus({ expiry_date: '2026-06-15' }, NOW)).toBe('expiring_soon') // today
    expect(expiryStatus({ expiry_date: '2026-07-15' }, NOW)).toBe('expiring_soon') // 30 days
  })

  it('is "valid" beyond 30 days', () => {
    expect(expiryStatus({ expiry_date: '2026-07-16' }, NOW)).toBe('valid') // 31 days
  })
})

describe('driverTraining — summariseTraining', () => {
  it('returns zeroes for empty / non-array input', () => {
    const zero = {
      totalRecords: 0, distinctDrivers: 0, passCount: 0,
      expiredCount: 0, expiringSoonCount: 0, totalCost: 0,
    }
    expect(summariseTraining([], NOW)).toEqual(zero)
    expect(summariseTraining(undefined, NOW)).toEqual(zero)
  })

  it('aggregates records, drivers, passes, expiry buckets and cost', () => {
    const rows = [
      { driver_name: 'Ahmed', result: 'pass', expiry_date: '2026-06-01', cost: 100 }, // expired
      { driver_name: 'ahmed', result: 'fail', expiry_date: '2026-06-20', cost: '50' }, // soon (dup driver)
      { driver_name: 'Bilal', result: 'pass', expiry_date: '2027-01-01', cost: 200 }, // valid
      { driver_name: 'Chen', result: 'pending', cost: null },                          // unknown expiry
    ]
    const s = summariseTraining(rows, NOW)
    expect(s.totalRecords).toBe(4)
    expect(s.distinctDrivers).toBe(3) // Ahmed/ahmed collapse
    expect(s.passCount).toBe(2)
    expect(s.expiredCount).toBe(1)
    expect(s.expiringSoonCount).toBe(1)
    expect(s.totalCost).toBe(350)
  })
})

describe('driverTraining — byCategory', () => {
  it('counts categories sorted by count descending, ignoring blanks', () => {
    const rows = [
      { category: 'defensive' },
      { category: 'defensive' },
      { category: 'hazmat' },
      { category: '' },
      { category: null },
    ]
    expect(byCategory(rows)).toEqual([
      { category: 'defensive', count: 2 },
      { category: 'hazmat', count: 1 },
    ])
  })

  it('returns [] for empty / non-array input', () => {
    expect(byCategory([])).toEqual([])
    expect(byCategory()).toEqual([])
  })
})
