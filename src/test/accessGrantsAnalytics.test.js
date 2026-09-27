import { describe, it, expect } from 'vitest'
import {
  displayName, initials, filterUsers, roleOptions, grantState, grantSummary,
  directorySummary, grantExportRows, GRANT_EXPORT_COLS, GRANT_EXPORT_HEADERS,
} from '../lib/accessGrantsAnalytics'

const NOW = new Date('2026-09-27T00:00:00Z').getTime()
const day = (d) => new Date(NOW + d * 86400000).toISOString()
const users = [
  { id: 'a', full_name: 'Ali Khan', email: 'ali@x.com', role: 'Manager' },
  { id: 'b', username: 'sara', role: 'Inspector', is_super_admin: true },
  { id: 'c', email: 'c@x.com' },
]

describe('directory', () => {
  it('names and initials', () => {
    expect(displayName(users[0])).toBe('Ali Khan')
    expect(displayName({})).toBe('Unnamed user')
    expect(initials(users[1])).toBe('SA')
  })
  it('filters by role and search', () => {
    expect(filterUsers(users, { role: 'Manager' })).toHaveLength(1)
    expect(filterUsers(users, { search: 'x.com' })).toHaveLength(2)
    expect(filterUsers(users, { search: 'sara' })).toHaveLength(1)
    expect(roleOptions(users)).toEqual(['Inspector', 'Manager'])
    expect(directorySummary(users)).toEqual({ users: 3, superAdmins: 1, roles: 2 })
  })
})

describe('grants', () => {
  const grants = [
    { id: 1, effect: 'grant', module_key: 'fleet', expires_at: null },
    { id: 2, effect: 'revoke', module_key: 'stock', expires_at: day(10) },
    { id: 3, effect: 'grant', module_key: 'ai', expires_at: day(-1) },
    { id: 4, effect: 'grant', module_key: 'tyres', expires_at: day(90), note: 'cover' },
  ]
  it('classifies grant state', () => {
    expect(grantState(grants[0], NOW)).toBe('permanent')
    expect(grantState(grants[1], NOW)).toBe('expiring')
    expect(grantState(grants[2], NOW)).toBe('expired')
    expect(grantState(grants[3], NOW)).toBe('active')
  })
  it('summarises live overrides and excludes expired', () => {
    expect(grantSummary(grants, NOW)).toEqual({ total: 4, liveGrants: 2, liveRevokes: 1, expired: 1, expiring: 1, soonDays: 30 })
  })
  it('export rows align with headers', () => {
    const out = grantExportRows(grants, { user: users[0], moduleLabel: { fleet: 'Fleet' }, now: NOW, fmt: () => 'D' })
    expect(Object.keys(out[0])).toEqual(GRANT_EXPORT_COLS)
    expect(GRANT_EXPORT_HEADERS).toHaveLength(GRANT_EXPORT_COLS.length)
    expect(out[0]).toMatchObject({ user: 'Ali Khan', effect: 'Grant', module: 'Fleet', expires: 'No expiry', state: 'No expiry' })
    expect(out[1].effect).toBe('Revoke')
    expect(out[2].state).toBe('Expired')
  })
})
