import { describe, it, expect } from 'vitest'
import {
  normalizeLimit, isUnlimited, utilisation, utilisationPct, remaining,
  canAdd, isAtLimit, planAllows, trialDaysLeft, usageRows,
  monthlyEquivalent, annualSavingPct,
} from '../lib/entitlements'

const overview = (over = {}) => ({
  subscription: { plan_code: 'starter', status: 'active', billing_interval: 'monthly', ...over.subscription },
  plan: { code: 'starter', currency: 'USD', price_monthly: 49, price_annual: 490, features: {}, ...over.plan },
  usage: { vehicles: 90, users: 5, api_keys: 1, ...over.usage },
  limits: { vehicles: 100, users: 10, api_keys: 2, storage_gb: 10, ...over.limits },
})

describe('normalizeLimit', () => {
  it('treats null/undefined/empty/garbage/negative as unlimited', () => {
    for (const v of [null, undefined, '', 'abc', -5, NaN]) expect(normalizeLimit(v)).toBe(null)
  })
  it('parses numeric strings and numbers', () => {
    expect(normalizeLimit('100')).toBe(100)
    expect(normalizeLimit(0)).toBe(0)
  })
})

describe('isUnlimited', () => {
  it('is true only for null-like limits', () => {
    expect(isUnlimited(null)).toBe(true)
    expect(isUnlimited(0)).toBe(false)
    expect(isUnlimited(50)).toBe(false)
  })
})

describe('utilisation', () => {
  it('is usage/limit', () => {
    expect(utilisation(50, 100)).toBe(0.5)
  })
  it('unlimited never fills', () => {
    expect(utilisation(9999, null)).toBe(0)
  })
  it('zero limit with usage is full', () => {
    expect(utilisation(1, 0)).toBe(1)
    expect(utilisation(0, 0)).toBe(0)
  })
  it('can exceed 1 when over cap', () => {
    expect(utilisation(150, 100)).toBe(1.5)
  })
  it('clamps pct to 100', () => {
    expect(utilisationPct(150, 100)).toBe(100)
    expect(utilisationPct(25, 100)).toBe(25)
  })
})

describe('remaining', () => {
  it('unlimited → Infinity', () => {
    expect(remaining(10, null)).toBe(Infinity)
  })
  it('never negative', () => {
    expect(remaining(150, 100)).toBe(0)
    expect(remaining(90, 100)).toBe(10)
  })
})

describe('canAdd / isAtLimit', () => {
  it('allows when under the cap', () => {
    expect(canAdd(overview(), 'vehicles', 1)).toBe(true)   // 90/100
    expect(isAtLimit(overview(), 'vehicles')).toBe(false)
  })
  it('blocks when adding would exceed', () => {
    expect(canAdd(overview({ usage: { vehicles: 100 } }), 'vehicles', 1)).toBe(false)
    expect(isAtLimit(overview({ usage: { vehicles: 100 } }), 'vehicles')).toBe(true)
  })
  it('blocks bulk that overshoots but allows exact fit', () => {
    const o = overview({ usage: { vehicles: 95 } })
    expect(canAdd(o, 'vehicles', 5)).toBe(true)
    expect(canAdd(o, 'vehicles', 6)).toBe(false)
  })
  it('unlimited resource always allows', () => {
    expect(canAdd(overview({ limits: { vehicles: null } }), 'vehicles', 9999)).toBe(true)
  })
  it('unknown resource fails open', () => {
    expect(canAdd(overview(), 'widgets', 1)).toBe(true)
  })
  it('null overview fails open', () => {
    expect(canAdd(null, 'vehicles', 1)).toBe(true)
  })
})

describe('planAllows', () => {
  it('true when feature entitled', () => {
    expect(planAllows(overview({ plan: { features: { ai_tools: true } } }), 'ai_tools')).toBe(true)
  })
  it('false when explicitly disabled', () => {
    expect(planAllows(overview({ plan: { features: { automation_platform: false } } }), 'automation_platform')).toBe(false)
  })
  it('fails open for unknown key or missing map', () => {
    expect(planAllows(overview({ plan: { features: {} } }), 'new_feature')).toBe(true)
    expect(planAllows({ plan: {} }, 'ai_tools')).toBe(true)
  })
})

describe('trialDaysLeft', () => {
  const now = new Date('2026-07-07T00:00:00Z').getTime()
  it('null when not trialing', () => {
    expect(trialDaysLeft(overview({ subscription: { status: 'active' } }), now)).toBe(null)
  })
  it('counts whole days remaining', () => {
    const o = overview({ subscription: { status: 'trialing', trial_ends_at: '2026-07-10T00:00:00Z' } })
    expect(trialDaysLeft(o, now)).toBe(3)
  })
  it('never negative for an expired trial', () => {
    const o = overview({ subscription: { status: 'trialing', trial_ends_at: '2026-07-01T00:00:00Z' } })
    expect(trialDaysLeft(o, now)).toBe(0)
  })
})

describe('usageRows', () => {
  it('returns a row per limited resource in canonical order with derived fields', () => {
    const rows = usageRows(overview())
    expect(rows.map((r) => r.resource)).toEqual(['vehicles', 'users', 'api_keys', 'storage_gb'])
    const vehicles = rows[0]
    expect(vehicles).toMatchObject({ usage: 90, limit: 100, unlimited: false, remaining: 10, pct: 90, atLimit: false })
  })
  it('marks unlimited storage correctly', () => {
    const rows = usageRows(overview({ limits: { storage_gb: null } }))
    const storage = rows.find((r) => r.resource === 'storage_gb')
    expect(storage.unlimited).toBe(true)
    expect(storage.pct).toBe(0)
  })
  it('flags at-limit resources', () => {
    const rows = usageRows(overview({ usage: { api_keys: 2 } }))
    expect(rows.find((r) => r.resource === 'api_keys').atLimit).toBe(true)
  })
})

describe('pricing helpers', () => {
  it('monthlyEquivalent divides annual by 12', () => {
    expect(monthlyEquivalent({ price_monthly: 49, price_annual: 490 }, 'annual')).toBeCloseTo(490 / 12)
    expect(monthlyEquivalent({ price_monthly: 49, price_annual: 490 }, 'monthly')).toBe(49)
  })
  it('annualSavingPct computes discount vs 12x monthly', () => {
    // 12*49 = 588; annual 490 → save ~17%
    expect(annualSavingPct({ price_monthly: 49, price_annual: 490 })).toBe(17)
  })
  it('annualSavingPct is 0 when no real saving or free', () => {
    expect(annualSavingPct({ price_monthly: 0, price_annual: 0 })).toBe(0)
    expect(annualSavingPct({ price_monthly: 10, price_annual: 120 })).toBe(0)
  })
})
