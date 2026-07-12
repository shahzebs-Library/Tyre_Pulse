import { describe, it, expect } from 'vitest'
import {
  toFiniteNumber,
  certDaysRemaining,
  certStatus,
  parseDomains,
  summariseSso,
  byProtocol,
  CERT_EXPIRY_WARN_DAYS,
} from '../lib/ssoConfig.js'

// Fixed reference clock so every time-relative assertion is deterministic.
const NOW = new Date('2026-07-12T00:00:00.000Z').getTime()
const DAY = 24 * 60 * 60 * 1000
const dateInDays = (n) => new Date(NOW + n * DAY).toISOString().slice(0, 10)

describe('ssoConfig — toFiniteNumber', () => {
  it('parses numbers and numeric strings', () => {
    expect(toFiniteNumber(42)).toBe(42)
    expect(toFiniteNumber('30')).toBe(30)
    expect(toFiniteNumber('-5')).toBe(-5)
  })
  it('returns null for blank/nullish/non-numeric', () => {
    expect(toFiniteNumber('')).toBeNull()
    expect(toFiniteNumber(null)).toBeNull()
    expect(toFiniteNumber(undefined)).toBeNull()
    expect(toFiniteNumber('abc')).toBeNull()
  })
})

describe('ssoConfig — certDaysRemaining', () => {
  it('returns null when there is no cert expiry', () => {
    expect(certDaysRemaining({}, NOW)).toBeNull()
    expect(certDaysRemaining({ cert_expiry: null }, NOW)).toBeNull()
  })
  it('returns null for an unparseable date', () => {
    expect(certDaysRemaining({ cert_expiry: 'not-a-date' }, NOW)).toBeNull()
  })
  it('returns null when nowMs is not numeric', () => {
    expect(certDaysRemaining({ cert_expiry: dateInDays(10) }, 'nope')).toBeNull()
  })
  it('is positive for a future cert', () => {
    expect(certDaysRemaining({ cert_expiry: dateInDays(45) }, NOW)).toBe(45)
  })
  it('is negative for an expired cert', () => {
    expect(certDaysRemaining({ cert_expiry: dateInDays(-3) }, NOW)).toBe(-3)
  })
  it('is 0 on the expiry day', () => {
    expect(certDaysRemaining({ cert_expiry: dateInDays(0) }, NOW)).toBe(0)
  })
})

describe('ssoConfig — certStatus (all branches)', () => {
  it('unknown when no cert', () => {
    expect(certStatus({}, NOW)).toBe('unknown')
  })
  it('expired when in the past', () => {
    expect(certStatus({ cert_expiry: dateInDays(-1) }, NOW)).toBe('expired')
  })
  it('expiring_soon at the boundary (<= 30 days)', () => {
    expect(certStatus({ cert_expiry: dateInDays(CERT_EXPIRY_WARN_DAYS) }, NOW)).toBe('expiring_soon')
    expect(certStatus({ cert_expiry: dateInDays(1) }, NOW)).toBe('expiring_soon')
    expect(certStatus({ cert_expiry: dateInDays(0) }, NOW)).toBe('expiring_soon')
  })
  it('valid when beyond the warning window', () => {
    expect(certStatus({ cert_expiry: dateInDays(CERT_EXPIRY_WARN_DAYS + 1) }, NOW)).toBe('valid')
    expect(certStatus({ cert_expiry: dateInDays(365) }, NOW)).toBe('valid')
  })
})

describe('ssoConfig — parseDomains', () => {
  it('splits on commas and whitespace, trims and lowercases', () => {
    expect(parseDomains({ domains: 'Acme.com,  corp.acme.com' })).toEqual(['acme.com', 'corp.acme.com'])
    expect(parseDomains({ domains: 'a.com b.com\tc.com' })).toEqual(['a.com', 'b.com', 'c.com'])
    expect(parseDomains({ domains: 'x.com; y.com' })).toEqual(['x.com', 'y.com'])
  })
  it('drops empty fragments and deduplicates', () => {
    expect(parseDomains({ domains: 'a.com, , a.com,  b.com' })).toEqual(['a.com', 'b.com'])
  })
  it('returns [] for missing/blank domains', () => {
    expect(parseDomains({})).toEqual([])
    expect(parseDomains({ domains: null })).toEqual([])
    expect(parseDomains({ domains: '   ' })).toEqual([])
  })
})

describe('ssoConfig — summariseSso', () => {
  const rows = [
    { status: 'active', enforce_sso: true, jit_provisioning: true, cert_expiry: dateInDays(400) },
    { status: 'active', enforce_sso: false, jit_provisioning: false, cert_expiry: dateInDays(10) },   // expiring soon
    { status: 'draft', enforce_sso: 'true', jit_provisioning: 'true', cert_expiry: dateInDays(-2) },  // expired
    { status: 'disabled', enforce_sso: false, jit_provisioning: false },                              // no cert
  ]
  it('counts totals, active, enforced, expiring, and jit', () => {
    const s = summariseSso(rows, NOW)
    expect(s.totalConnections).toBe(4)
    expect(s.activeCount).toBe(2)
    expect(s.enforcedCount).toBe(2)          // boolean true + string 'true'
    expect(s.jitEnabledCount).toBe(2)
    expect(s.expiringCertCount).toBe(2)      // expired + expiring soon
  })
  it('returns zeroed summary for empty/invalid input', () => {
    const s = summariseSso([], NOW)
    expect(s).toEqual({ totalConnections: 0, activeCount: 0, enforcedCount: 0, expiringCertCount: 0, jitEnabledCount: 0 })
    expect(summariseSso(null, NOW).totalConnections).toBe(0)
  })
})

describe('ssoConfig — byProtocol', () => {
  it('counts by protocol sorted by count descending', () => {
    const rows = [
      { protocol: 'saml' }, { protocol: 'saml' }, { protocol: 'oidc' },
      { protocol: 'saml' }, { protocol: 'oauth2' }, { protocol: 'oidc' },
    ]
    expect(byProtocol(rows)).toEqual([
      { protocol: 'saml', count: 3 },
      { protocol: 'oidc', count: 2 },
      { protocol: 'oauth2', count: 1 },
    ])
  })
  it('groups missing protocol under "unknown" and normalises case', () => {
    const rows = [{ protocol: 'SAML' }, { protocol: null }, {}]
    const result = byProtocol(rows)
    expect(result).toContainEqual({ protocol: 'saml', count: 1 })
    expect(result.find((r) => r.protocol === 'unknown').count).toBe(2)
  })
  it('returns [] for empty/invalid input', () => {
    expect(byProtocol([])).toEqual([])
    expect(byProtocol(null)).toEqual([])
  })
})
