import { describe, it, expect } from 'vitest'
import {
  certStatus, daysToExpiry, summarizeCertifications, EXPIRING_SOON_DAYS,
} from '../lib/certifications'

// Fixed reference clock so tests are deterministic.
const NOW = new Date('2026-07-12T00:00:00Z').getTime()

describe('certifications — certStatus', () => {
  it('marks a certification with no expiry date as valid', () => {
    expect(certStatus({ expiry_date: null }, NOW)).toBe('valid')
    expect(certStatus({}, NOW)).toBe('valid')
  })

  it('marks a certification expiring far in the future as valid', () => {
    expect(certStatus({ expiry_date: '2027-07-12' }, NOW)).toBe('valid')
  })

  it('marks a certification within the expiring-soon window as expiring', () => {
    // 60-day window: exactly on the boundary is still expiring.
    expect(certStatus({ expiry_date: '2026-09-10' }, NOW)).toBe('expiring') // ~60d
    expect(certStatus({ expiry_date: '2026-07-20' }, NOW)).toBe('expiring') // 8d
    expect(certStatus({ expiry_date: '2026-07-12' }, NOW)).toBe('expiring') // today (0d)
  })

  it('marks a past expiry date as expired', () => {
    expect(certStatus({ expiry_date: '2026-07-11' }, NOW)).toBe('expired')
    expect(certStatus({ expiry_date: '2020-01-01' }, NOW)).toBe('expired')
  })

  it('keeps an explicitly revoked certification revoked regardless of dates', () => {
    expect(certStatus({ status: 'revoked', expiry_date: '2030-01-01' }, NOW)).toBe('revoked')
    expect(certStatus({ status: 'revoked' }, NOW)).toBe('revoked')
  })

  it('accepts a Date instance for now', () => {
    expect(certStatus({ expiry_date: '2026-07-11' }, new Date(NOW))).toBe('expired')
  })
})

describe('certifications — daysToExpiry', () => {
  it('returns whole days until expiry, negative when past, null when absent', () => {
    expect(daysToExpiry({ expiry_date: '2026-07-22' }, NOW)).toBe(10)
    expect(daysToExpiry({ expiry_date: '2026-07-02' }, NOW)).toBe(-10)
    expect(daysToExpiry({ expiry_date: '2026-07-12' }, NOW)).toBe(0)
    expect(daysToExpiry({}, NOW)).toBeNull()
  })
})

describe('certifications — summarizeCertifications', () => {
  const rows = [
    { id: '1', subject_type: 'driver', expiry_date: '2027-07-12' },              // valid
    { id: '2', subject_type: 'driver', expiry_date: '2026-07-20' },              // expiring (8d)
    { id: '3', subject_type: 'vehicle', expiry_date: '2026-06-01' },             // expired
    { id: '4', subject_type: 'technician', status: 'revoked', expiry_date: '2030-01-01' }, // revoked
    { id: '5', subject_type: 'site', expiry_date: null },                        // valid (no date)
    { id: '6', subject_type: 'vehicle', expiry_date: '2026-08-01' },             // expiring (20d)
  ]

  it('counts by derived status', () => {
    const s = summarizeCertifications(rows, NOW)
    expect(s.total).toBe(6)
    expect(s.byStatus).toEqual({ valid: 2, expiring: 2, expired: 1, revoked: 1 })
  })

  it('counts by subject type', () => {
    const s = summarizeCertifications(rows, NOW)
    expect(s.bySubjectType).toEqual({ driver: 2, vehicle: 2, technician: 1, site: 1 })
  })

  it('lists expiring + expired rows sorted soonest-first', () => {
    const s = summarizeCertifications(rows, NOW)
    // expired (id 3, -41d), expiring id2 (8d), expiring id6 (20d)
    expect(s.expiringSoon.map((r) => r.id)).toEqual(['3', '2', '6'])
    expect(s.expiringSoon.every((r) => r.status === 'expiring' || r.status === 'expired')).toBe(true)
    expect(s.expiringSoon[0].daysToExpiry).toBeLessThan(0)
  })

  it('handles empty / non-array input safely', () => {
    const s = summarizeCertifications([], NOW)
    expect(s.total).toBe(0)
    expect(s.expiringSoon).toEqual([])
    const s2 = summarizeCertifications(null, NOW)
    expect(s2.total).toBe(0)
  })

  it('uses a 60-day expiring window', () => {
    expect(EXPIRING_SOON_DAYS).toBe(60)
  })
})
