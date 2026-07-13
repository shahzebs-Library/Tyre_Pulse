import { describe, it, expect } from 'vitest'
import {
  toEpochMs,
  isActiveDelegation,
  isUpcomingDelegation,
  isExpiredDelegation,
  activeDelegatorsFor,
  summariseDelegations,
  delegationStatus,
} from '../lib/approvalDelegations'

// Fixed injected "now" so every test is deterministic (no Date.now()).
const NOW = Date.UTC(2026, 6, 13, 12, 0, 0) // 2026-07-13T12:00:00Z
const iso = (ms) => new Date(ms).toISOString()
const HOUR = 3600 * 1000
const DAY = 24 * HOUR

describe('approvalDelegations — toEpochMs', () => {
  it('parses ISO strings, numbers, and rejects junk', () => {
    expect(toEpochMs(iso(NOW))).toBe(NOW)
    expect(toEpochMs(NOW)).toBe(NOW)
    expect(toEpochMs(null)).toBeNull()
    expect(toEpochMs('')).toBeNull()
    expect(toEpochMs('not-a-date')).toBeNull()
  })
})

describe('approvalDelegations — isActiveDelegation window edges', () => {
  it('open-ended (no start, no end) active row is active', () => {
    expect(isActiveDelegation({ active: true }, NOW)).toBe(true)
  })

  it('active === false is never active', () => {
    expect(isActiveDelegation({ active: false, starts_at: null, ends_at: null }, NOW)).toBe(false)
  })

  it('non-boolean active is treated strictly as inactive', () => {
    expect(isActiveDelegation({ active: 'true' }, NOW)).toBe(false)
    expect(isActiveDelegation({ active: 1 }, NOW)).toBe(false)
  })

  it('is active exactly at the start boundary (starts_at === now)', () => {
    expect(isActiveDelegation({ active: true, starts_at: iso(NOW) }, NOW)).toBe(true)
  })

  it('is active exactly at the end boundary (ends_at === now)', () => {
    expect(isActiveDelegation({ active: true, ends_at: iso(NOW) }, NOW)).toBe(true)
  })

  it('is inactive one ms before start and one ms after end', () => {
    expect(isActiveDelegation({ active: true, starts_at: iso(NOW + 1) }, NOW)).toBe(false)
    expect(isActiveDelegation({ active: true, ends_at: iso(NOW - 1) }, NOW)).toBe(false)
  })

  it('is active well inside a bounded window', () => {
    const d = { active: true, starts_at: iso(NOW - DAY), ends_at: iso(NOW + DAY) }
    expect(isActiveDelegation(d, NOW)).toBe(true)
  })

  it('null / bad row and bad now are inactive', () => {
    expect(isActiveDelegation(null, NOW)).toBe(false)
    expect(isActiveDelegation({ active: true }, NaN)).toBe(false)
  })
})

describe('approvalDelegations — upcoming / expired', () => {
  it('upcoming: active with a future start and no/future end', () => {
    expect(isUpcomingDelegation({ active: true, starts_at: iso(NOW + DAY) }, NOW)).toBe(true)
    // future start but already-past end is NOT upcoming
    expect(
      isUpcomingDelegation({ active: true, starts_at: iso(NOW + DAY), ends_at: iso(NOW - HOUR) }, NOW),
    ).toBe(false)
  })

  it('upcoming is false for currently-active and for inactive rows', () => {
    expect(isUpcomingDelegation({ active: true }, NOW)).toBe(false)
    expect(isUpcomingDelegation({ active: false, starts_at: iso(NOW + DAY) }, NOW)).toBe(false)
  })

  it('expired: end bound in the past', () => {
    expect(isExpiredDelegation({ active: true, ends_at: iso(NOW - HOUR) }, NOW)).toBe(true)
  })

  it('expired: manually deactivated with no future window', () => {
    expect(isExpiredDelegation({ active: false, starts_at: iso(NOW - DAY) }, NOW)).toBe(true)
  })

  it('not expired: active open-ended', () => {
    expect(isExpiredDelegation({ active: true }, NOW)).toBe(false)
  })
})

describe('approvalDelegations — activeDelegatorsFor entity scoping', () => {
  const rows = [
    { delegate_id: 'U', delegator_id: 'BOSS_A', entity_type: null, active: true }, // all types
    { delegate_id: 'U', delegator_id: 'BOSS_B', entity_type: 'purchase_order', active: true },
    { delegate_id: 'U', delegator_id: 'BOSS_C', entity_type: 'accident', active: true },
    { delegate_id: 'U', delegator_id: 'BOSS_D', entity_type: null, active: false }, // inactive
    { delegate_id: 'OTHER', delegator_id: 'BOSS_E', entity_type: null, active: true }, // not me
    { delegate_id: 'U', delegator_id: 'BOSS_A', entity_type: null, active: true }, // dup delegator
  ]

  it('no entityType → every active delegator I am delegate for (distinct)', () => {
    const got = activeDelegatorsFor('U', rows, NOW).sort()
    expect(got).toEqual(['BOSS_A', 'BOSS_B', 'BOSS_C'])
  })

  it('entityType filters to null-scope + matching-scope delegations', () => {
    const got = activeDelegatorsFor('U', rows, NOW, 'purchase_order').sort()
    expect(got).toEqual(['BOSS_A', 'BOSS_B'])
  })

  it('entityType with no specific match still includes all-types delegators', () => {
    expect(activeDelegatorsFor('U', rows, NOW, 'invoice')).toEqual(['BOSS_A'])
  })

  it('excludes inactive delegations and other delegates; empty for unknown user', () => {
    expect(activeDelegatorsFor('U', rows, NOW)).not.toContain('BOSS_D')
    expect(activeDelegatorsFor('U', rows, NOW)).not.toContain('BOSS_E')
    expect(activeDelegatorsFor('', rows, NOW)).toEqual([])
    expect(activeDelegatorsFor('NOBODY', rows, NOW)).toEqual([])
  })
})

describe('approvalDelegations — summariseDelegations', () => {
  const rows = [
    { delegator_id: 'A', delegate_id: 'X', active: true }, // active (open-ended)
    { delegator_id: 'A', delegate_id: 'Y', active: true, starts_at: iso(NOW + DAY) }, // upcoming
    { delegator_id: 'B', delegate_id: 'X', active: true, ends_at: iso(NOW - HOUR) }, // expired
    { delegator_id: 'B', delegate_id: 'Z', active: false, starts_at: iso(NOW - DAY) }, // expired (off)
  ]

  it('counts totals, buckets and distinct parties', () => {
    const s = summariseDelegations(rows, NOW)
    expect(s.total).toBe(4)
    expect(s.activeCount).toBe(1)
    expect(s.upcomingCount).toBe(1)
    expect(s.expiredCount).toBe(2)
    expect(s.distinctDelegators).toBe(2) // A, B
    expect(s.distinctDelegates).toBe(3) // X, Y, Z
  })

  it('handles empty / non-array input', () => {
    expect(summariseDelegations([], NOW)).toMatchObject({
      total: 0, activeCount: 0, upcomingCount: 0, expiredCount: 0,
      distinctDelegators: 0, distinctDelegates: 0,
    })
    expect(summariseDelegations(null, NOW).total).toBe(0)
  })
})

describe('approvalDelegations — delegationStatus', () => {
  it('classifies each lifecycle state', () => {
    expect(delegationStatus({ active: true }, NOW)).toBe('active')
    expect(delegationStatus({ active: true, starts_at: iso(NOW + DAY) }, NOW)).toBe('upcoming')
    expect(delegationStatus({ active: true, ends_at: iso(NOW - HOUR) }, NOW)).toBe('expired')
    expect(delegationStatus({ active: false }, NOW)).toBe('expired')
  })
})
