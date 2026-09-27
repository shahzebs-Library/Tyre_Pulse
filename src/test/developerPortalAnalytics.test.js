import { describe, it, expect } from 'vitest'
import {
  keyStatus, keyRows, hookRows, filterKeyRows, filterHookRows, keyInsights, hookInsights,
} from '../lib/developerPortalAnalytics'

const NOW = Date.parse('2026-09-27T00:00:00Z')
const keys = [
  { id: 1, key_name: 'ERP', status: 'active', expires_at: '2026-10-10', last_used_at: '2026-09-20' },
  { id: 2, key_name: 'Old', status: 'active', expires_at: '2026-01-01' },
  { id: 3, key_name: 'BI', status: 'active', expires_at: null, last_used_at: null },
  { id: 4, key_name: 'Gone', status: 'revoked' },
  { id: 5, key_name: 'Stale', status: 'active', last_used_at: '2026-01-01' },
]

describe('keys', () => {
  it('effective status honours expiry', () => {
    expect(keyStatus(keys[1], NOW)).toBe('expired')
    expect(keyRows(keys, NOW).map((r) => r._status)).toEqual(['active', 'expired', 'active', 'revoked', 'active'])
  })
  it('filters', () => {
    const rows = keyRows(keys, NOW)
    expect(filterKeyRows(rows, { status: 'expired' })).toHaveLength(1)
    expect(filterKeyRows(rows, { query: 'erp' })).toHaveLength(1)
  })
  it('insights over live keys only', () => {
    expect(keyInsights(keys, NOW)).toMatchObject({ live: 3, expiringSoon: 1, neverUsed: 1, stale: 1, noExpiry: 2 })
    expect(keyInsights(keys, NOW).usedRate).toBeCloseTo(2 / 3)
    expect(keyInsights([], NOW).usedRate).toBeNull()
  })
})

describe('webhooks', () => {
  const hooks = [
    { endpoint_name: 'A', status: 'Active', failure_count: 0, secret_set: true, url: 'https://a' },
    { endpoint_name: 'B', status: 'failing', failure_count: '7', secret_set: false },
  ]
  it('normalises and filters', () => {
    const rows = hookRows(hooks)
    expect(rows[1]._failures).toBe(7)
    expect(filterHookRows(rows, { status: 'active' })).toHaveLength(1)
    expect(filterHookRows(rows, { query: 'https://a' })).toHaveLength(1)
  })
  it('insights with honest empty rate', () => {
    expect(hookInsights(hooks)).toMatchObject({ total: 2, withoutSecret: 1, withFailures: 1, healthRate: 0.5, worst: { name: 'B', failures: 7 } })
    expect(hookInsights([])).toMatchObject({ healthRate: null, worst: null })
  })
})
