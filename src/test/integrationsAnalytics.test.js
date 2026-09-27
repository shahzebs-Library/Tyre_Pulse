import { describe, it, expect } from 'vitest'
import {
  apiKeyStatus, daysToExpiry, daysSinceUse, summarizeApiKeys, filterApiKeys,
  webhookHealth, summarizeWebhooks, filterWebhooks,
  summarizeDeliveries, filterDeliveries, eventTypeBreakdown, fmtRate,
} from '../lib/integrationsAnalytics'

const NOW = new Date('2026-09-26T12:00:00Z')
const day = (n) => new Date(NOW.getTime() + n * 86400000).toISOString()

describe('API keys', () => {
  const keys = [
    { id: 1, name: 'ERP', key_prefix: 'tp_abc', active: true, expires_at: day(10), last_used_at: day(-1), scopes: ['read'] },
    { id: 2, name: 'Old', key_prefix: 'tp_old', active: true, expires_at: day(-2), last_used_at: null },
    { id: 3, name: 'Gone', key_prefix: 'tp_x', active: false },
    { id: 4, name: 'Idle', key_prefix: 'tp_idle', active: true, expires_at: null, last_used_at: null },
    { id: 5, name: 'Stale', key_prefix: 'tp_st', active: true, last_used_at: day(-200) },
  ]
  it('classifies status with an injected now', () => {
    expect(keys.map((k) => apiKeyStatus(k, NOW))).toEqual(['active', 'expired', 'revoked', 'active', 'active'])
  })
  it('days to expiry is null when a key never expires', () => {
    expect(daysToExpiry(keys[3], NOW)).toBeNull()
    expect(daysToExpiry(keys[0], NOW)).toBe(10)
    expect(daysSinceUse(keys[3], NOW)).toBeNull()
  })
  it('summarises', () => {
    expect(summarizeApiKeys(keys, NOW)).toEqual({ total: 5, active: 3, expired: 1, revoked: 1, expiringSoon: 1, neverUsed: 1, stale: 1 })
  })
  it('filters by status and search', () => {
    expect(filterApiKeys(keys, { status: 'revoked' }, NOW).map((k) => k.id)).toEqual([3])
    expect(filterApiKeys(keys, { search: 'TP_OLD' }, NOW).map((k) => k.id)).toEqual([2])
    expect(filterApiKeys(keys, { search: 'read' }, NOW).map((k) => k.id)).toEqual([1])
  })
  it('handles empty input', () => {
    expect(summarizeApiKeys(null, NOW).total).toBe(0)
  })
})

describe('webhooks', () => {
  const hooks = [
    { id: 'a', name: 'A', url: 'https://a.io', active: true, consecutive_failures: 0, event_types: null },
    { id: 'b', name: 'B', url: 'https://b.io', active: true, consecutive_failures: 3, event_types: ['tyre.installed'] },
    { id: 'c', name: 'C', url: 'https://c.io', active: false, disabled_reason: 'Too many failures', event_types: ['accident.reported'] },
    { id: 'd', name: 'D', url: 'https://d.io', active: false },
  ]
  it('derives health', () => {
    expect(hooks.map(webhookHealth)).toEqual(['healthy', 'failing', 'disabled', 'inactive'])
  })
  it('summarises', () => {
    const s = summarizeWebhooks(hooks)
    expect(s).toMatchObject({ total: 4, healthy: 1, failing: 1, disabled: 1, inactive: 1, active: 2, allEvents: 2, subscribedEvents: 2 })
  })
  it('filters', () => {
    expect(filterWebhooks(hooks, { health: 'failing' }).map((h) => h.id)).toEqual(['b'])
    expect(filterWebhooks(hooks, { search: 'accident' }).map((h) => h.id)).toEqual(['c'])
  })
})

describe('deliveries', () => {
  const rows = [
    { id: 1, status: 'delivered', attempts: 1, response_status: 200, event_type: 'tyre.installed', subscription_id: 'a' },
    { id: 2, status: 'failed', attempts: 5, response_status: 500, event_type: 'tyre.installed', subscription_id: 'b', last_error: 'timeout' },
    { id: 3, status: 'pending', attempts: 0, event_type: 'accident.reported', subscription_id: 'a' },
  ]
  it('summarises the loaded page with honest rates', () => {
    const s = summarizeDeliveries(rows)
    expect(s).toMatchObject({ scope: 'page', loaded: 3, delivered: 1, failed: 1, pending: 1, httpErrors: 1, successRate: 50 })
    expect(s.avgAttempts).toBe(2)
  })
  it('success rate is null when nothing finished', () => {
    expect(summarizeDeliveries([{ status: 'pending' }]).successRate).toBeNull()
    expect(summarizeDeliveries([]).avgAttempts).toBeNull()
    expect(fmtRate(null)).toBe('N/A')
  })
  it('filters by status and webhook name', () => {
    const names = { a: 'ERP hook', b: 'Other' }
    expect(filterDeliveries(rows, { status: 'failed' }, (id) => names[id]).map((d) => d.id)).toEqual([2])
    expect(filterDeliveries(rows, { search: 'erp' }, (id) => names[id]).map((d) => d.id)).toEqual([1, 3])
    expect(filterDeliveries(rows, { search: 'timeout' }, (id) => names[id]).map((d) => d.id)).toEqual([2])
  })
  it('breaks down event types', () => {
    expect(eventTypeBreakdown(rows)).toEqual([{ event: 'tyre.installed', count: 2 }, { event: 'accident.reported', count: 1 }])
  })
})
