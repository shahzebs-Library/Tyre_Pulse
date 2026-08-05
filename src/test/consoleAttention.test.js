/**
 * The attention panel's honesty rules, pinned:
 *  - an unreadable count is UNKNOWN (says "could not check"), never a silent
 *    zero that reads as all-clear
 *  - a feed with no data says so instead of "stale since 1970"
 *  - all-clear genuinely produces an empty list
 */
import { describe, it, expect } from 'vitest'
import { buildAttention, daysSince, freshnessBand } from '../lib/consoleAttention'

const NOW = new Date('2026-08-05T12:00:00Z').getTime()
const daysAgo = (n) => new Date(NOW - n * 86400000).toISOString()

describe('freshness', () => {
  it('bands by days and treats a missing date as unknown, not epoch-stale', () => {
    expect(freshnessBand(daysSince(daysAgo(1), NOW))).toBe('fresh')
    expect(freshnessBand(daysSince(daysAgo(7), NOW))).toBe('aging')
    expect(freshnessBand(daysSince(daysAgo(20), NOW))).toBe('stale')
    expect(freshnessBand(daysSince(null, NOW))).toBe('unknown')
    expect(freshnessBand(daysSince('garbage', NOW))).toBe('unknown')
  })
})

describe('buildAttention', () => {
  it('is EMPTY when everything is genuinely fine', () => {
    const items = buildAttention({
      pendingUsers: 0, lockedUsers: 0, unresolvedErrors: 0, openTrustAlerts: 0,
      feeds: [{ label: 'KSA expenses', latest: daysAgo(1) }], now: NOW,
    })
    expect(items).toEqual([])
  })

  it('an unreadable error count says "could not check", never all-clear', () => {
    const items = buildAttention({ unresolvedErrors: null, now: NOW })
    expect(items).toHaveLength(1)
    expect(items[0].text).toMatch(/could not check/i)
  })

  it('surfaces pending users, errors, alerts and stale feeds with destinations', () => {
    const items = buildAttention({
      pendingUsers: 3, unresolvedErrors: 2, openTrustAlerts: 1,
      feeds: [{ label: 'UAE tyres', latest: daysAgo(15) }, { label: 'Egypt expenses', latest: null }],
      now: NOW,
    })
    const keys = items.map((i) => i.key)
    expect(keys).toContain('pending')
    expect(keys).toContain('errors')
    expect(keys).toContain('trust')
    expect(keys).toContain('feed:UAE tyres')
    expect(keys).toContain('feed:Egypt expenses')
    expect(items.every((i) => i.to.startsWith('/console'))).toBe(true)
    // severity order: the danger (errors) leads
    expect(items[0].key).toBe('errors')
    expect(items[0].tone).toBe('danger')
  })

  it('a fresh feed produces no item at all - the panel is for problems only', () => {
    const items = buildAttention({
      pendingUsers: 0, lockedUsers: 0, unresolvedErrors: 0, openTrustAlerts: 0,
      feeds: [{ label: 'KSA job cards', latest: daysAgo(0) }], now: NOW,
    })
    expect(items).toEqual([])
  })

  it('an OMITTED count is unknown, not all-clear (the engine is stricter than the caller)', () => {
    // Passing only feeds leaves the error count unknown - the engine must say
    // "could not check" rather than treat the omission as a zero.
    const items = buildAttention({ feeds: [{ label: 'KSA job cards', latest: daysAgo(0) }], now: NOW })
    expect(items).toHaveLength(1)
    expect(items[0].text).toMatch(/could not check/i)
  })
})
