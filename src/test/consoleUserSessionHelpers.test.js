/**
 * Pure helpers behind the console Users, Sessions and Support Sessions pages.
 * The data layer is mocked out: these assert only the arithmetic the tiles and
 * status badges are built from.
 */
import { describe, it, expect, vi } from 'vitest'

vi.mock('../lib/supabase', () => ({ supabase: {} }))
vi.mock('../lib/api/_client', () => ({ supabase: {}, unwrap: (r) => r?.data }))
vi.mock('../console/ConsoleAuthContext', () => ({ useConsoleAuth: () => ({}) }))

const { summarizeUsers, userStatus } = await import('../console/pages/ConsoleUsers.jsx')
const { recencyBuckets } = await import('../console/pages/ConsoleSessions.jsx')
const { sessionState } = await import('../console/pages/ConsoleSupportSessions.jsx')

describe('userStatus / summarizeUsers', () => {
  it('locked wins over approved, and unapproved is pending', () => {
    expect(userStatus({ approved: true, locked: true })).toBe('locked')
    expect(userStatus({ approved: true, locked: false })).toBe('approved')
    expect(userStatus({ approved: false, locked: false })).toBe('pending')
  })

  it('counts the whole list, not a page', () => {
    const rows = [
      { approved: true }, { approved: true, is_super_admin: true },
      { approved: false }, { approved: false, locked: true },
      { approved: true, web_access: false },
    ]
    expect(summarizeUsers(rows)).toEqual({
      total: 5, approved: 3, pending: 1, locked: 1, mobileOnly: 1, superAdmins: 1,
    })
  })

  it('an empty or missing list is all zeros', () => {
    expect(summarizeUsers([]).total).toBe(0)
    expect(summarizeUsers(null).total).toBe(0)
  })
})

describe('recencyBuckets', () => {
  const now = Date.parse('2026-09-24T12:00:00Z')
  const ago = (d) => new Date(now - d * 86400000).toISOString()

  it('places each user in exactly one bucket and never drops one', () => {
    const users = [
      { last_login_at: ago(0.5) }, { last_login_at: ago(3) }, { last_login_at: ago(20) },
      { last_login_at: ago(90) }, { last_login_at: null }, { last_login_at: 'not a date' },
    ]
    const b = Object.fromEntries(recencyBuckets(users, now).map((x) => [x.key, x.value]))
    expect(b).toEqual({ day: 1, week: 1, month: 1, older: 1, never: 2 })
  })
})

describe('sessionState', () => {
  const now = Date.parse('2026-09-24T12:00:00Z')

  it('an unended session past its expiry reads expired, not active', () => {
    expect(sessionState({ active: true, ended_at: null, expires_at: '2026-09-24T11:00:00Z' }, now)).toBe('expired')
  })

  it('an unended session before expiry is active', () => {
    expect(sessionState({ active: true, ended_at: null, expires_at: '2026-09-24T13:00:00Z' }, now)).toBe('active')
  })

  it('an ended or inactive session is ended', () => {
    expect(sessionState({ active: true, ended_at: '2026-09-24T10:00:00Z' }, now)).toBe('ended')
    expect(sessionState({ active: false }, now)).toBe('ended')
  })
})
