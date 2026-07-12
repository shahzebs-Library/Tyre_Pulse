import { describe, it, expect } from 'vitest'
import {
  toFiniteNumber,
  isValidEmail,
  portalAdoptionRate,
  summariseAccounts,
  byTier,
  needsAttention,
} from '../lib/customerPortal'

// Representative account set reused across several suites.
const SAMPLE = [
  { company_name: 'Alpha', status: 'active', tier: 'enterprise', portal_enabled: true, assets_linked: 40, open_requests: 2 },
  { company_name: 'Beta', status: 'onboarding', tier: 'standard', portal_enabled: false, assets_linked: 5, open_requests: 7 },
  { company_name: 'Gamma', status: 'active', tier: 'premium', portal_enabled: true, assets_linked: 12, open_requests: 0 },
  { company_name: 'Delta', status: 'suspended', tier: 'standard', portal_enabled: false, assets_linked: 8, open_requests: 9 },
  { company_name: 'Epsilon', status: 'churned', tier: 'enterprise', portal_enabled: false, assets_linked: 0, open_requests: 0 },
]

describe('customerPortal - toFiniteNumber', () => {
  it('parses numeric strings and strips units', () => {
    expect(toFiniteNumber('42')).toBe(42)
    expect(toFiniteNumber('1,024')).toBe(1024)
    expect(toFiniteNumber(17)).toBe(17)
  })

  it('returns null for empty/non-numeric/nullish input', () => {
    expect(toFiniteNumber('')).toBeNull()
    expect(toFiniteNumber(null)).toBeNull()
    expect(toFiniteNumber(undefined)).toBeNull()
    expect(toFiniteNumber('abc')).toBeNull()
  })

  it('preserves negatives', () => {
    expect(toFiniteNumber('-3')).toBe(-3)
  })
})

describe('customerPortal - isValidEmail', () => {
  it('accepts well-formed addresses', () => {
    expect(isValidEmail('ops@customer.com')).toBe(true)
    expect(isValidEmail('sara.ahmed@fleet.co.uk')).toBe(true)
  })

  it('rejects malformed addresses', () => {
    expect(isValidEmail('no-at-sign')).toBe(false)
    expect(isValidEmail('missing@domain')).toBe(false)
    expect(isValidEmail('two@@at.com')).toBe(false)
    expect(isValidEmail('spaces in@x.com')).toBe(false)
    expect(isValidEmail('@nolocal.com')).toBe(false)
  })

  it('trims surrounding whitespace before validating', () => {
    expect(isValidEmail('  ops@customer.com  ')).toBe(true)
  })

  it('rejects non-string and empty input', () => {
    expect(isValidEmail(null)).toBe(false)
    expect(isValidEmail(undefined)).toBe(false)
    expect(isValidEmail(123)).toBe(false)
    expect(isValidEmail('')).toBe(false)
  })
})

describe('customerPortal - portalAdoptionRate', () => {
  it('computes the percentage of portal-enabled accounts', () => {
    // 2 of 5 enabled → 40%
    expect(portalAdoptionRate(SAMPLE)).toBe(40)
  })

  it('returns 0 for an empty set', () => {
    expect(portalAdoptionRate([])).toBe(0)
    expect(portalAdoptionRate(null)).toBe(0)
  })

  it('returns 100 when every account is enabled', () => {
    expect(portalAdoptionRate([{ portal_enabled: true }, { portal_enabled: true }])).toBe(100)
  })

  it('treats loose truthy values as enabled', () => {
    expect(portalAdoptionRate([{ portal_enabled: 'true' }, { portal_enabled: false }])).toBe(50)
  })
})

describe('customerPortal - summariseAccounts', () => {
  it('rolls up counts and sums correctly', () => {
    const s = summariseAccounts(SAMPLE)
    expect(s.totalAccounts).toBe(5)
    expect(s.activeCount).toBe(2)
    expect(s.portalEnabledCount).toBe(2)
    expect(s.onboardingCount).toBe(1)
    expect(s.totalLinkedAssets).toBe(65)
    expect(s.totalOpenRequests).toBe(18)
  })

  it('returns a zeroed summary for an empty/invalid set', () => {
    const s = summariseAccounts([])
    expect(s).toEqual({
      totalAccounts: 0, activeCount: 0, portalEnabledCount: 0,
      onboardingCount: 0, totalLinkedAssets: 0, totalOpenRequests: 0,
    })
    expect(summariseAccounts(null).totalAccounts).toBe(0)
  })

  it('ignores non-numeric counters without throwing', () => {
    const s = summariseAccounts([{ status: 'active', assets_linked: 'n/a', open_requests: null }])
    expect(s.totalLinkedAssets).toBe(0)
    expect(s.totalOpenRequests).toBe(0)
    expect(s.activeCount).toBe(1)
  })
})

describe('customerPortal - byTier', () => {
  it('groups by tier sorted by count descending', () => {
    const t = byTier(SAMPLE)
    // standard=2, enterprise=2, premium=1 → standard/enterprise tie broken alphabetically
    expect(t.map((x) => x.tier)).toEqual(['enterprise', 'standard', 'premium'])
    expect(t[0]).toEqual({ tier: 'enterprise', count: 2, linkedAssets: 40 })
    expect(t.find((x) => x.tier === 'standard')).toEqual({ tier: 'standard', count: 2, linkedAssets: 13 })
  })

  it('buckets tier-less accounts under "unspecified"', () => {
    const t = byTier([{ company_name: 'X' }, { company_name: 'Y', tier: '' }])
    expect(t).toEqual([{ tier: 'unspecified', count: 2, linkedAssets: 0 }])
  })

  it('returns an empty array for no rows', () => {
    expect(byTier([])).toEqual([])
  })
})

describe('customerPortal - needsAttention', () => {
  it('flags suspended, onboarding, or >5 open-request accounts', () => {
    const a = needsAttention(SAMPLE)
    const names = a.map((r) => r.company_name)
    expect(names).toContain('Beta')   // onboarding
    expect(names).toContain('Delta')  // suspended + 9 open
    expect(names).not.toContain('Alpha') // active, 2 open
    expect(names).not.toContain('Gamma')
  })

  it('sorts by open_requests descending', () => {
    const a = needsAttention(SAMPLE)
    // Delta (9) before Beta (7)
    expect(a[0].company_name).toBe('Delta')
    expect(a[1].company_name).toBe('Beta')
  })

  it('excludes healthy active accounts with few requests', () => {
    const a = needsAttention([{ company_name: 'Healthy', status: 'active', open_requests: 1 }])
    expect(a).toEqual([])
  })

  it('returns an empty array for no rows', () => {
    expect(needsAttention([])).toEqual([])
    expect(needsAttention(null)).toEqual([])
  })
})
