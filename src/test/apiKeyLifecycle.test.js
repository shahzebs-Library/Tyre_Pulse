import { describe, it, expect } from 'vitest'
import {
  daysSince, daysUntil, keyStatus, keyFlags, decorateKeys, summarizeKeys, filterKeys,
  revokeReasonError, expiryError, extendedExpiry,
} from '../lib/apiKeyLifecycle'

const NOW = Date.parse('2026-09-24T12:00:00Z')
const ago = (d) => new Date(NOW - d * 86400000).toISOString()
const ahead = (d) => new Date(NOW + d * 86400000).toISOString()
const key = (o = {}) => ({ id: 'k', name: 'ERP sync', key_prefix: 'tp_abc1234', active: true, created_at: ago(5), last_used_at: ago(1), expires_at: ahead(200), scopes: ['read'], organisation_id: 'o1', ...o })

describe('apiKeyLifecycle', () => {
  it('computes days and treats unknown as null, never 0', () => {
    expect(daysSince(ago(10), NOW)).toBe(10)
    expect(daysSince(null, NOW)).toBeNull()
    expect(daysUntil(ahead(3), NOW)).toBe(3)
    expect(daysUntil('', NOW)).toBeNull()
  })

  it('status: revoked beats expired beats active', () => {
    expect(keyStatus(key(), NOW)).toBe('active')
    expect(keyStatus(key({ expires_at: ago(1) }), NOW)).toBe('expired')
    expect(keyStatus(key({ active: false, expires_at: ago(1) }), NOW)).toBe('revoked')
  })

  it('a healthy key has no flags', () => {
    expect(keyFlags(key(), { now: NOW })).toEqual([])
  })

  it('flags rotate after 90 days and stale after 30 idle days', () => {
    const f = keyFlags(key({ created_at: ago(120), last_used_at: ago(40) }), { now: NOW })
    expect(f).toContain('rotate')
    expect(f).toContain('stale')
  })

  it('a brand new never-used key is not stale; an old never-used one is', () => {
    expect(keyFlags(key({ created_at: ago(2), last_used_at: null }), { now: NOW })).not.toContain('stale')
    expect(keyFlags(key({ created_at: ago(31), last_used_at: null }), { now: NOW })).toContain('stale')
  })

  it('flags no expiry and expiring soon', () => {
    expect(keyFlags(key({ expires_at: null }), { now: NOW })).toContain('no_expiry')
    expect(keyFlags(key({ expires_at: ahead(5) }), { now: NOW })).toContain('expiring')
  })

  it('max age policy only applies when set and positive', () => {
    const old = key({ created_at: ago(50) })
    expect(keyFlags(old, { now: NOW, maxAgeDays: 30 })).toContain('over_policy')
    expect(keyFlags(old, { now: NOW, maxAgeDays: 0 })).not.toContain('over_policy')
    expect(keyFlags(old, { now: NOW, maxAgeDays: null })).not.toContain('over_policy')
  })

  it('revoked and expired keys get no rotation findings', () => {
    expect(keyFlags(key({ active: false, created_at: ago(400), expires_at: null }), { now: NOW })).toEqual([])
    expect(keyFlags(key({ expires_at: ago(1), created_at: ago(400) }), { now: NOW })).toEqual([])
  })

  it('summarizes and filters', () => {
    const d = decorateKeys([
      key({ id: 'a', requests_last_hour: 4 }),
      key({ id: 'b', created_at: ago(100), organisation_id: 'o2', organisation_name: 'Beta' }),
      key({ id: 'c', active: false }),
    ], { now: NOW })
    const s = summarizeKeys(d)
    expect(s).toMatchObject({ total: 3, active: 2, revoked: 1, needsAttention: 1, rotate: 1, orgs: 2, requestsLastHour: 4 })
    expect(filterKeys(d, { status: 'attention' }).map((k) => k.id)).toEqual(['b'])
    expect(filterKeys(d, { status: 'revoked' }).map((k) => k.id)).toEqual(['c'])
    expect(filterKeys(d, { search: 'beta' }).map((k) => k.id)).toEqual(['b'])
    expect(filterKeys(d, { org: 'o2' }).map((k) => k.id)).toEqual(['b'])
  })

  it('validates revoke reason and expiry like the server', () => {
    expect(revokeReasonError('')).toBeTruthy()
    expect(revokeReasonError('abc')).toBeTruthy()
    expect(revokeReasonError('leaked in repo')).toBeNull()
    expect(expiryError(ago(1), NOW)).toBeTruthy()
    expect(expiryError(ahead(6 * 365), NOW)).toBeTruthy()
    expect(expiryError(ahead(30), NOW)).toBeNull()
    expect(expiryError(null, NOW)).toBeNull()
  })

  it('extends from the later of now and the current expiry', () => {
    expect(extendedExpiry(ahead(10), 30, NOW)).toBe(ahead(40))
    expect(extendedExpiry(ago(10), 30, NOW)).toBe(ahead(30))
    expect(extendedExpiry(null, 90, NOW)).toBe(ahead(90))
  })
})
