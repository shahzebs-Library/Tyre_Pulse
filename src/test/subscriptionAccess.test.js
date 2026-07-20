import { describe, it, expect } from 'vitest'
import { subscriptionAccess, SUBSCRIPTION_STATES } from '../lib/subscriptionAccess'

/** Build an overview payload with a given nested subscription status. */
const ov = (status) => ({
  subscription: { plan_code: 'starter', status, billing_interval: 'monthly' },
  plan: { code: 'starter', features: {} },
  usage: { vehicles: 1 },
  limits: { vehicles: 100 },
})

/** Keys every result must carry, for shape-completeness checks. */
const SHAPE_KEYS = [
  'state',
  'canUseApp',
  'canWrite',
  'readOnly',
  'billingOnly',
  'blockSelfServiceBilling',
  'reason',
  'banner',
]

describe('SUBSCRIPTION_STATES', () => {
  it('lists exactly the six recognised lifecycle states', () => {
    expect(SUBSCRIPTION_STATES).toEqual([
      'trialing',
      'active',
      'past_due',
      'canceled',
      'expired',
      'suspended',
    ])
  })
  it('is frozen (immutable policy contract)', () => {
    expect(Object.isFrozen(SUBSCRIPTION_STATES)).toBe(true)
  })
})

describe('subscriptionAccess — shape', () => {
  it('returns the full public shape for every known state', () => {
    for (const s of SUBSCRIPTION_STATES) {
      const r = subscriptionAccess(ov(s))
      for (const k of SHAPE_KEYS) expect(r).toHaveProperty(k)
      expect(typeof r.reason).toBe('string')
      expect(r.reason.length).toBeGreaterThan(0)
    }
  })
  it('always reports a string state and boolean capability flags', () => {
    const r = subscriptionAccess(ov('active'))
    expect(typeof r.state).toBe('string')
    for (const k of ['canUseApp', 'canWrite', 'readOnly', 'billingOnly', 'blockSelfServiceBilling']) {
      expect(typeof r[k]).toBe('boolean')
    }
  })
})

describe('subscriptionAccess — trialing', () => {
  it('grants full access with no banner', () => {
    const r = subscriptionAccess(ov('trialing'))
    expect(r.state).toBe('trialing')
    expect(r.canUseApp).toBe(true)
    expect(r.canWrite).toBe(true)
    expect(r.readOnly).toBe(false)
    expect(r.billingOnly).toBe(false)
    expect(r.blockSelfServiceBilling).toBe(false)
    expect(r.banner).toBeNull()
  })
})

describe('subscriptionAccess — active', () => {
  it('grants full access with no banner', () => {
    const r = subscriptionAccess(ov('active'))
    expect(r.state).toBe('active')
    expect(r.canUseApp).toBe(true)
    expect(r.canWrite).toBe(true)
    expect(r.readOnly).toBe(false)
    expect(r.billingOnly).toBe(false)
    expect(r.banner).toBeNull()
  })
})

describe('subscriptionAccess — past_due (grace)', () => {
  it('keeps full app access but warns and blocks billing self-service', () => {
    const r = subscriptionAccess(ov('past_due'))
    expect(r.state).toBe('past_due')
    expect(r.canUseApp).toBe(true)
    expect(r.canWrite).toBe(true)
    expect(r.readOnly).toBe(false)
    expect(r.billingOnly).toBe(false)
    expect(r.blockSelfServiceBilling).toBe(true)
    expect(r.banner).not.toBeNull()
    expect(r.banner.tone).toBe('amber')
    expect(typeof r.banner.message).toBe('string')
  })
})

describe('subscriptionAccess — canceled (read-only retention)', () => {
  it('allows viewing but no writes', () => {
    const r = subscriptionAccess(ov('canceled'))
    expect(r.state).toBe('canceled')
    expect(r.canUseApp).toBe(true)
    expect(r.canWrite).toBe(false)
    expect(r.readOnly).toBe(true)
    expect(r.billingOnly).toBe(false)
    expect(r.banner.tone).toBe('gray')
  })
})

describe('subscriptionAccess — expired (billing only)', () => {
  it('blocks the app and writes, permitting only the billing/export surface', () => {
    const r = subscriptionAccess(ov('expired'))
    expect(r.state).toBe('expired')
    expect(r.canUseApp).toBe(false)
    expect(r.canWrite).toBe(false)
    expect(r.readOnly).toBe(true)
    expect(r.billingOnly).toBe(true)
    expect(r.banner.tone).toBe('red')
  })
})

describe('subscriptionAccess — suspended (blocked)', () => {
  it('blocks all access', () => {
    const r = subscriptionAccess(ov('suspended'))
    expect(r.state).toBe('suspended')
    expect(r.canUseApp).toBe(false)
    expect(r.canWrite).toBe(false)
    expect(r.readOnly).toBe(true)
    expect(r.billingOnly).toBe(false)
    expect(r.banner.tone).toBe('red')
  })
})

describe('subscriptionAccess — fail-open cases', () => {
  it('permits full access when overview is undefined (not loaded)', () => {
    const r = subscriptionAccess(undefined)
    expect(r.canUseApp).toBe(true)
    expect(r.canWrite).toBe(true)
    expect(r.readOnly).toBe(false)
    expect(r.billingOnly).toBe(false)
    expect(r.banner).toBeNull()
  })
  it('permits full access when overview is null', () => {
    const r = subscriptionAccess(null)
    expect(r.canUseApp).toBe(true)
    expect(r.canWrite).toBe(true)
  })
  it('permits full access when there is no subscription/status', () => {
    expect(subscriptionAccess({}).canWrite).toBe(true)
    expect(subscriptionAccess({ subscription: {} }).canWrite).toBe(true)
    expect(subscriptionAccess({ subscription: null }).canWrite).toBe(true)
  })
  it('permits full access for an unknown/garbage status', () => {
    for (const s of ['weird', 'ACTIVE_ISH', 'paused', '42']) {
      const r = subscriptionAccess(ov(s))
      expect(r.canWrite).toBe(true)
      expect(r.canUseApp).toBe(true)
      expect(r.state).toBe(s.trim().toLowerCase())
    }
  })
  it('permits full access for non-object input', () => {
    for (const v of ['active', 42, true, []]) {
      const r = subscriptionAccess(v)
      expect(r.canWrite).toBe(true)
    }
  })
})

describe('subscriptionAccess — status normalisation', () => {
  it('is case-insensitive and trims whitespace', () => {
    expect(subscriptionAccess(ov('  ACTIVE ')).state).toBe('active')
    expect(subscriptionAccess(ov('Past_Due')).state).toBe('past_due')
    expect(subscriptionAccess(ov('EXPIRED')).billingOnly).toBe(true)
  })
  it('reads a flattened { status } shape as well as nested', () => {
    const r = subscriptionAccess({ status: 'canceled' })
    expect(r.state).toBe('canceled')
    expect(r.readOnly).toBe(true)
  })
  it('treats an empty/whitespace status as not-loaded (fail open)', () => {
    expect(subscriptionAccess(ov('   ')).canWrite).toBe(true)
    expect(subscriptionAccess(ov('')).canWrite).toBe(true)
  })
})

describe('subscriptionAccess — invariants', () => {
  it('canUseApp=false implies no writes for every known state', () => {
    for (const s of SUBSCRIPTION_STATES) {
      const r = subscriptionAccess(ov(s))
      if (!r.canUseApp) expect(r.canWrite).toBe(false)
    }
  })
  it('readOnly and canWrite are never both true', () => {
    for (const s of [...SUBSCRIPTION_STATES, 'unknown', '']) {
      const r = subscriptionAccess(ov(s))
      expect(r.readOnly && r.canWrite).toBe(false)
    }
  })
  it('billingOnly is only ever set for expired', () => {
    for (const s of SUBSCRIPTION_STATES) {
      const r = subscriptionAccess(ov(s))
      expect(r.billingOnly).toBe(s === 'expired')
    }
  })
  it('does not mutate the input overview', () => {
    const input = ov('past_due')
    const snapshot = JSON.stringify(input)
    subscriptionAccess(input)
    expect(JSON.stringify(input)).toBe(snapshot)
  })
})
