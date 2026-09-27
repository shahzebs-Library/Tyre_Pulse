import { describe, it, expect } from 'vitest'
import {
  actorName, isTruncated, filterLoginRows, filterEventRows, loginKpis, eventBreakdown,
} from '../lib/securityCenterAnalytics'
import { summarizeLogins } from '../lib/securityCenter'

const NOW = new Date('2026-09-27T12:00:00')
const rows = [
  { id: 1, user_id: 'u1', action: 'LOGIN', session_id: 's1', created_at: '2026-09-27T09:00:00', profiles: { full_name: 'Ali' } },
  { id: 2, user_id: 'u2', action: 'LOGIN', session_id: 's1', created_at: '2026-09-26T23:30:00', user_email: 'b@x.com' },
  { id: 3, user_id: 'u1', action: 'LOGOUT', created_at: '2026-09-27T10:00:00', profiles: { full_name: 'Ali' } },
]

describe('login helpers', () => {
  it('actor name falls back to email then Unknown', () => {
    expect(actorName(rows[0])).toBe('Ali')
    expect(actorName(rows[1])).toBe('b@x.com')
    expect(actorName({})).toBe('Unknown')
  })
  it('truncation only when the feed is full', () => {
    expect(isTruncated(new Array(200), 200)).toBe(true)
    expect(isTruncated(new Array(3), 200)).toBe(false)
  })
  it('filters by text and action', () => {
    expect(filterLoginRows(rows, 'ali')).toHaveLength(2)
    expect(filterLoginRows(rows, '', { action: 'LOGOUT' })).toHaveLength(1)
  })
  it('KPIs from rows + summary', () => {
    const k = loginKpis(rows, summarizeLogins(rows, { now: NOW }), { now: NOW })
    expect(k).toMatchObject({ logins: 2, logouts: 1, users: 2, sharedSessions: 1, afterHours: 1, loginsLast24h: 2 })
    expect(k.lastLogin).toBe('2026-09-27T09:00:00')
    expect(loginKpis([], { flags: [] }, { now: NOW }).lastLogin).toBeNull()
  })
})

describe('events', () => {
  const events = [
    { action: 'DELETE', table_name: 'tyre_records', profiles: { full_name: 'Ali' } },
    { action: 'BULK_DELETE', table_name: 'x', profiles: { full_name: 'Ali' } },
    { action: 'EXPORT', table_name: 'accidents', user_email: 'b@x.com' },
  ]
  it('breaks down by action and actor', () => {
    const b = eventBreakdown(events)
    expect(b).toMatchObject({ total: 3, deletes: 2, exports: 1, bulk: 1, topActor: { name: 'Ali', count: 2 } })
    expect(eventBreakdown([]).topActor).toBeNull()
  })
  it('filters', () => {
    expect(filterEventRows(events, { query: 'accidents' })).toHaveLength(1)
    expect(filterEventRows(events, { action: 'DELETE' })).toHaveLength(1)
  })
})
