import { describe, it, expect } from 'vitest'
import {
  toFiniteNumber,
  isKeyExpired,
  maskKey,
  summariseKeys,
  summariseWebhooks,
  healthyWebhookRate,
} from '../lib/developerPortal'

// Fixed clock so every time-dependent assertion is deterministic.
const NOW = Date.parse('2026-07-12T00:00:00Z')
const PAST = '2026-01-01T00:00:00Z'
const FUTURE = '2027-01-01T00:00:00Z'

describe('developerPortal — toFiniteNumber', () => {
  it('parses numbers and numeric strings', () => {
    expect(toFiniteNumber(42)).toBe(42)
    expect(toFiniteNumber('1500')).toBe(1500)
    expect(toFiniteNumber('1,500')).toBe(1500)
  })

  it('returns null for empty / non-numeric input', () => {
    expect(toFiniteNumber('')).toBeNull()
    expect(toFiniteNumber(null)).toBeNull()
    expect(toFiniteNumber(undefined)).toBeNull()
    expect(toFiniteNumber('abc')).toBeNull()
  })
})

describe('developerPortal — isKeyExpired (injected nowMs)', () => {
  it('is true when expires_at is in the past', () => {
    expect(isKeyExpired({ expires_at: PAST }, NOW)).toBe(true)
  })

  it('is false when expires_at is in the future', () => {
    expect(isKeyExpired({ expires_at: FUTURE }, NOW)).toBe(false)
  })

  it('is false when there is no expiry and status is not expired', () => {
    expect(isKeyExpired({ status: 'active' }, NOW)).toBe(false)
  })

  it('is true when status is already expired regardless of date', () => {
    expect(isKeyExpired({ status: 'expired', expires_at: FUTURE }, NOW)).toBe(true)
  })

  it('is false for null/undefined key', () => {
    expect(isKeyExpired(null, NOW)).toBe(false)
    expect(isKeyExpired(undefined, NOW)).toBe(false)
  })
})

describe('developerPortal — maskKey', () => {
  it('appends a fixed dot run to the prefix', () => {
    expect(maskKey('tp_live_9f3c')).toBe('tp_live_9f3c••••••••')
  })

  it('handles empty / nullish prefixes safely', () => {
    expect(maskKey('')).toBe('••••••••')
    expect(maskKey(null)).toBe('••••••••')
    expect(maskKey(undefined)).toBe('••••••••')
  })
})

describe('developerPortal — summariseKeys', () => {
  const rows = [
    { status: 'active', environment: 'production', expires_at: FUTURE },
    { status: 'active', environment: 'sandbox', expires_at: null },
    { status: 'active', environment: 'production', expires_at: PAST }, // expired by date
    { status: 'revoked', environment: 'production' },
    { status: 'expired', environment: 'sandbox' },
  ]

  it('counts totals, active, revoked, expired, production', () => {
    const s = summariseKeys(rows, NOW)
    expect(s.totalKeys).toBe(5)
    expect(s.activeCount).toBe(2) // the two non-expired actives
    expect(s.revokedCount).toBe(1)
    expect(s.expiredCount).toBe(2) // past-dated active + status 'expired'
    expect(s.productionCount).toBe(3)
  })

  it('does not count a time-expired active as active', () => {
    const s = summariseKeys([{ status: 'active', expires_at: PAST }], NOW)
    expect(s.activeCount).toBe(0)
    expect(s.expiredCount).toBe(1)
  })

  it('returns zeros for empty / non-array input', () => {
    expect(summariseKeys([], NOW)).toEqual({
      totalKeys: 0, activeCount: 0, revokedCount: 0, expiredCount: 0, productionCount: 0,
    })
    expect(summariseKeys(null, NOW).totalKeys).toBe(0)
  })
})

describe('developerPortal — summariseWebhooks', () => {
  const rows = [
    { status: 'active', failure_count: 0 },
    { status: 'active', failure_count: 2 },
    { status: 'failing', failure_count: 11 },
    { status: 'paused', failure_count: null },
    { status: 'disabled' },
  ]

  it('counts totals, active, failing and sums failures', () => {
    const s = summariseWebhooks(rows)
    expect(s.totalEndpoints).toBe(5)
    expect(s.activeCount).toBe(2)
    expect(s.failingCount).toBe(1)
    expect(s.totalFailures).toBe(13)
  })

  it('returns zeros for empty / non-array input', () => {
    expect(summariseWebhooks([])).toEqual({
      totalEndpoints: 0, activeCount: 0, failingCount: 0, totalFailures: 0,
    })
    expect(summariseWebhooks(undefined).totalEndpoints).toBe(0)
  })
})

describe('developerPortal — healthyWebhookRate', () => {
  it('returns the percentage of active endpoints (0..100)', () => {
    const rows = [
      { status: 'active' }, { status: 'active' },
      { status: 'failing' }, { status: 'paused' },
    ]
    expect(healthyWebhookRate(rows)).toBe(50)
  })

  it('returns 100 when all endpoints are active', () => {
    expect(healthyWebhookRate([{ status: 'active' }, { status: 'active' }])).toBe(100)
  })

  it('returns 0 for empty / non-array input', () => {
    expect(healthyWebhookRate([])).toBe(0)
    expect(healthyWebhookRate(null)).toBe(0)
  })
})
