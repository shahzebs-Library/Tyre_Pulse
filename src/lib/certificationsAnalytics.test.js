import { describe, it, expect } from 'vitest'
import {
  daysToExpiry, certStatus, statusTone, enrichCertifications, sortBySoonestExpiry,
  renewalPipeline, breakdownByType, breakdownByHolder, buildCertAnalytics,
  EXPIRING_SOON_DAYS, PIPELINE_MONTHS, CERT_STATUSES, SUBJECT_TYPES,
} from './certificationsAnalytics'

// Fixed reference clock so every assertion is deterministic.
const NOW = new Date('2026-07-18T00:00:00Z').getTime()

// A small realistic fixture set (real-shaped rows, never fabricated at runtime).
const ROWS = [
  { id: 'a', subject_type: 'driver', subject_name: 'A. Driver', cert_type: 'HGV Licence', expiry_date: '2027-07-18', status: 'valid' }, // valid (far)
  { id: 'b', subject_type: 'driver', subject_name: 'B. Driver', cert_type: 'HGV Licence', expiry_date: '2026-08-01', status: 'valid' }, // expiring (14d)
  { id: 'c', subject_type: 'vehicle', subject_name: 'Truck 42', cert_type: 'Roadworthiness', expiry_date: '2026-07-10', status: 'valid' }, // expired (-8d)
  { id: 'd', subject_type: 'technician', subject_name: 'C. Tech', cert_type: 'ADR', expiry_date: null, status: 'valid' }, // valid (no expiry)
  { id: 'e', subject_type: 'site', subject_name: 'Depot 1', cert_type: 'Permit', expiry_date: '2026-07-25', status: 'revoked' }, // revoked (sticky)
  { id: 'f', subject_type: 'driver', subject_name: 'B. Driver', cert_type: 'ADR', expiry_date: '2026-07-18', status: 'valid' }, // expiring (today, 0d)
]

describe('constants', () => {
  it('exposes tunable thresholds and vocab', () => {
    expect(EXPIRING_SOON_DAYS).toBe(30)
    expect(PIPELINE_MONTHS).toBe(12)
    expect(CERT_STATUSES).toEqual(['valid', 'expiring', 'expired', 'revoked'])
    expect(SUBJECT_TYPES).toEqual(['driver', 'vehicle', 'technician', 'site'])
  })
})

describe('daysToExpiry', () => {
  it('returns whole calendar days, negative when past, null when no/invalid date', () => {
    expect(daysToExpiry({ expiry_date: '2026-07-18' }, NOW)).toBe(0)
    expect(daysToExpiry({ expiry_date: '2026-08-01' }, NOW)).toBe(14)
    expect(daysToExpiry({ expiry_date: '2026-07-10' }, NOW)).toBe(-8)
    expect(daysToExpiry({ expiry_date: null }, NOW)).toBeNull()
    expect(daysToExpiry({ expiry_date: 'not-a-date' }, NOW)).toBeNull()
    expect(daysToExpiry({ expiry_date: '2026-07-18' }, 'bad-now')).toBeNull()
  })
})

describe('certStatus', () => {
  it('bands valid / expiring / expired and keeps revoked sticky', () => {
    expect(certStatus({ expiry_date: '2027-07-18' }, NOW)).toBe('valid')
    expect(certStatus({ expiry_date: '2026-08-01' }, NOW)).toBe('expiring') // 14d
    expect(certStatus({ expiry_date: '2026-07-18' }, NOW)).toBe('expiring') // 0d
    expect(certStatus({ expiry_date: '2026-07-10' }, NOW)).toBe('expired')
    expect(certStatus({ expiry_date: null }, NOW)).toBe('valid')
    expect(certStatus({ expiry_date: '2026-07-10', status: 'revoked' }, NOW)).toBe('revoked')
  })

  it('honours a custom expiringSoonDays threshold', () => {
    // 60d out: default(30) -> valid; threshold 90 -> expiring.
    const c = { expiry_date: '2026-09-16' }
    expect(certStatus(c, NOW)).toBe('valid')
    expect(certStatus(c, NOW, { expiringSoonDays: 90 })).toBe('expiring')
  })
})

describe('statusTone', () => {
  it('maps bands to traffic-light tones', () => {
    expect(statusTone('expired')).toBe('bad')
    expect(statusTone('expiring')).toBe('warn')
    expect(statusTone('revoked')).toBe('muted')
    expect(statusTone('valid')).toBe('good')
  })
})

describe('enrichCertifications', () => {
  it('adds _status and _days without dropping fields; [] on bad input', () => {
    const out = enrichCertifications(ROWS, NOW)
    expect(out).toHaveLength(ROWS.length)
    expect(out[0]).toMatchObject({ id: 'a', _status: 'valid' })
    expect(out[2]).toMatchObject({ id: 'c', _status: 'expired', _days: -8 })
    expect(enrichCertifications(null, NOW)).toEqual([])
  })
})

describe('sortBySoonestExpiry', () => {
  it('orders expired-first then soonest, no-expiry last, non-mutating', () => {
    const input = [...ROWS]
    const sorted = sortBySoonestExpiry(input, NOW)
    expect(sorted.map((r) => r.id)).toEqual(['c', 'f', 'e', 'b', 'a', 'd'])
    // 'd' has no expiry -> last; 'e' revoked still sorts by its raw date (25th, 7d)
    expect(input.map((r) => r.id)).toEqual(['a', 'b', 'c', 'd', 'e', 'f']) // original untouched
  })
})

describe('renewalPipeline', () => {
  it('buckets upcoming expiries by month with an overdue leader; revoked excluded', () => {
    const p = renewalPipeline(ROWS, NOW)
    expect(p.horizon).toBe(12)
    expect(p.months).toHaveLength(12)
    expect(p.overdue).toBe(1) // Truck 42 (id c)
    const jul = p.months[0]
    expect(jul.key).toBe('2026-07')
    expect(jul.count).toBe(1) // only id f (today); id e revoked excluded; id c overdue
    expect(jul.soon).toBe(1)
    const aug = p.months[1]
    expect(aug.key).toBe('2026-08')
    expect(aug.count).toBe(1) // id b
  })

  it('respects a custom horizon', () => {
    const p = renewalPipeline(ROWS, NOW, { months: 3 })
    expect(p.months).toHaveLength(3)
  })

  it('degrades to empty months when now is unusable', () => {
    const p = renewalPipeline(ROWS, 'bad-now')
    expect(p.months).toEqual([])
    expect(p.overdue).toBe(0)
  })
})

describe('breakdownByType', () => {
  it('groups by cert_type with per-band counts, sorted by count desc', () => {
    const t = breakdownByType(ROWS, NOW)
    const hgv = t.find((g) => g.type === 'HGV Licence')
    expect(hgv).toMatchObject({ count: 2, valid: 1, expiring: 1 })
    const adr = t.find((g) => g.type === 'ADR')
    expect(adr.count).toBe(2) // id d (valid, no expiry) + id f (expiring)
    // HGV & ADR both have 2 -> tie broken alphabetically (ADR before HGV)
    expect(t[0].type).toBe('ADR')
  })

  it('collapses blank cert_type to Unspecified', () => {
    const t = breakdownByType([{ subject_name: 'x' }], NOW)
    expect(t[0].type).toBe('Unspecified')
  })
})

describe('breakdownByHolder', () => {
  it('ranks holders by lapsing certs then total', () => {
    const h = breakdownByHolder(ROWS, NOW)
    // B. Driver has two rows (one expiring 14d, one expiring today) -> top
    expect(h[0].holder).toBe('B. Driver')
    expect(h[0]).toMatchObject({ count: 2, expiring: 2, expired: 0 })
    const truck = h.find((g) => g.holder === 'Truck 42')
    expect(truck).toMatchObject({ expired: 1 })
  })
})

describe('buildCertAnalytics', () => {
  it('rolls up KPIs, bands, breakdowns and pipeline over real rows', () => {
    const a = buildCertAnalytics(ROWS, NOW)
    expect(a.total).toBe(6)
    expect(a.active).toBe(5) // minus 1 revoked
    expect(a.byStatus).toEqual({ valid: 2, expiring: 2, expired: 1, revoked: 1 })
    expect(a.bySubjectType).toMatchObject({ driver: 3, vehicle: 1, technician: 1, site: 1 })
    expect(a.expiringSoonCount).toBe(2)
    expect(a.expiredCount).toBe(1)
    expect(a.revokedCount).toBe(1)
    // valid % over all 6; compliance % over active 5
    expect(a.validPct).toBe(Math.round((2 / 6) * 1000) / 10)
    expect(a.compliancePct).toBe(Math.round((2 / 5) * 1000) / 10)
    // next expiry = soonest non-negative, non-revoked -> id f (0d today)
    expect(a.nextExpiry.cert.id).toBe('f')
    expect(a.nextExpiry.days).toBe(0)
    // status distribution covers all 4 bands
    expect(a.statusDistribution.map((s) => s.status)).toEqual(CERT_STATUSES)
    expect(a.statusDistribution.find((s) => s.status === 'expiring').count).toBe(2)
    // expiring list is soonest-first
    expect(a.expiringSoon.map((r) => r.id)).toEqual(['f', 'b'])
    expect(a.pipeline.overdue).toBe(1)
    expect(a.byType.length).toBeGreaterThan(0)
    expect(a.byHolder[0].holder).toBe('B. Driver')
  })

  it('returns honest zeros / null for an empty set', () => {
    const a = buildCertAnalytics([], NOW)
    expect(a.total).toBe(0)
    expect(a.active).toBe(0)
    expect(a.validPct).toBeNull()
    expect(a.compliancePct).toBeNull()
    expect(a.nextExpiry).toBeNull()
    expect(a.expiringSoon).toEqual([])
    expect(a.byType).toEqual([])
    expect(a.byHolder).toEqual([])
    expect(a.byStatus).toEqual({ valid: 0, expiring: 0, expired: 0, revoked: 0 })
  })

  it('degrades gracefully on non-array input', () => {
    const a = buildCertAnalytics(null, NOW)
    expect(a.total).toBe(0)
    expect(a.nextExpiry).toBeNull()
  })
})
