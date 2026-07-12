import { describe, it, expect } from 'vitest'
import {
  docStatus, daysToExpiry, summarizeDriverDocuments, EXPIRING_SOON_DAYS,
} from '../lib/driverDocuments'

// Fixed reference clock so tests are deterministic.
const NOW = new Date('2026-07-12T00:00:00Z').getTime()

describe('driverDocuments — docStatus', () => {
  it('marks a document with no expiry date as valid', () => {
    expect(docStatus({ expiry_date: null }, NOW)).toBe('valid')
    expect(docStatus({}, NOW)).toBe('valid')
  })

  it('marks a document expiring far in the future as valid', () => {
    expect(docStatus({ expiry_date: '2027-07-12' }, NOW)).toBe('valid')
  })

  it('marks a document within the expiring-soon window as expiring', () => {
    // 60-day window: exactly on the boundary is still expiring.
    expect(docStatus({ expiry_date: '2026-09-10' }, NOW)).toBe('expiring') // ~60d
    expect(docStatus({ expiry_date: '2026-07-20' }, NOW)).toBe('expiring') // 8d
    expect(docStatus({ expiry_date: '2026-07-12' }, NOW)).toBe('expiring') // today (0d)
  })

  it('marks a past expiry date as expired', () => {
    expect(docStatus({ expiry_date: '2026-07-11' }, NOW)).toBe('expired')
    expect(docStatus({ expiry_date: '2020-01-01' }, NOW)).toBe('expired')
  })

  it('ignores a stored status and derives purely from the expiry date', () => {
    // A row stored as 'valid' but already lapsed is reported expired.
    expect(docStatus({ status: 'valid', expiry_date: '2026-07-11' }, NOW)).toBe('expired')
  })

  it('accepts a Date instance for now', () => {
    expect(docStatus({ expiry_date: '2026-07-11' }, new Date(NOW))).toBe('expired')
  })
})

describe('driverDocuments — daysToExpiry', () => {
  it('returns whole days until expiry, negative when past, null when absent', () => {
    expect(daysToExpiry({ expiry_date: '2026-07-22' }, NOW)).toBe(10)
    expect(daysToExpiry({ expiry_date: '2026-07-02' }, NOW)).toBe(-10)
    expect(daysToExpiry({ expiry_date: '2026-07-12' }, NOW)).toBe(0)
    expect(daysToExpiry({}, NOW)).toBeNull()
  })

  it('uses a 60-day expiring window', () => {
    expect(EXPIRING_SOON_DAYS).toBe(60)
  })
})

describe('driverDocuments — summarizeDriverDocuments', () => {
  const rows = [
    { id: '1', driver_name: 'Alice',   doc_type: 'license', expiry_date: '2027-07-12' }, // valid
    { id: '2', driver_name: 'Bob',     doc_type: 'medical', expiry_date: '2026-07-20' }, // expiring (8d)
    { id: '3', driver_name: 'Carol',   doc_type: 'permit',  expiry_date: '2026-06-01' }, // expired
    { id: '4', driver_name: 'Alice',   doc_type: 'visa',    expiry_date: '2026-08-01' }, // expiring (20d)
    { id: '5', driver_name: 'Dan',     doc_type: 'other',   expiry_date: null },         // valid (no date)
    { id: '6', driver_name: ' bob ',   doc_type: 'license', expiry_date: '2025-01-01' }, // expired
  ]

  it('counts by derived status', () => {
    const s = summarizeDriverDocuments(rows, NOW)
    expect(s.total).toBe(6)
    expect(s.byStatus).toEqual({ valid: 2, expiring: 2, expired: 2 })
  })

  it('counts distinct drivers case-insensitively and trimmed', () => {
    const s = summarizeDriverDocuments(rows, NOW)
    // Alice, Bob (=" bob "), Carol, Dan
    expect(s.drivers).toBe(4)
  })

  it('lists expiring + expired rows sorted soonest-first', () => {
    const s = summarizeDriverDocuments(rows, NOW)
    // expired id6 (-557d), expired id3 (-41d), expiring id2 (8d), expiring id4 (20d)
    expect(s.expiringSoon.map((r) => r.id)).toEqual(['6', '3', '2', '4'])
    expect(s.expiringSoon.every((r) => r.status === 'expiring' || r.status === 'expired')).toBe(true)
    expect(s.expiringSoon[0].daysToExpiry).toBeLessThan(0)
  })

  it('lists only expired rows (soonest-first) in `expired`', () => {
    const s = summarizeDriverDocuments(rows, NOW)
    expect(s.expired.map((r) => r.id)).toEqual(['6', '3'])
    expect(s.expired.every((r) => r.status === 'expired')).toBe(true)
  })

  it('handles empty / non-array input safely', () => {
    const s = summarizeDriverDocuments([], NOW)
    expect(s.total).toBe(0)
    expect(s.expiringSoon).toEqual([])
    expect(s.expired).toEqual([])
    expect(s.drivers).toBe(0)
    const s2 = summarizeDriverDocuments(null, NOW)
    expect(s2.total).toBe(0)
  })
})
