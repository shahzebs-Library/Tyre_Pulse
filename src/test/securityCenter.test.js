import { describe, it, expect, vi, beforeEach } from 'vitest'

// Shared, hoisted Supabase mock: chainable, thenable query builder that records
// the table queried and the modifiers applied, and resolves to a configurable
// { data, error }. Mirrors src/test/notifications.test.js, plus in()/eq()/
// gte()/lte() and auth.getSession().
const h = vi.hoisted(() => {
  const state = { result: { data: [], error: null }, last: null, session: { data: { session: null }, error: null } }
  function from(table) {
    const calls = { order: [], limit: [], in: [], eq: [], gte: [], lte: [] }
    const b = {
      _table: table,
      _calls: calls,
      select(cols) { calls.select = cols; return b },
      in(col, vals) { calls.in.push([col, vals]); return b },
      eq(col, val) { calls.eq.push([col, val]); return b },
      gte(col, val) { calls.gte.push([col, val]); return b },
      lte(col, val) { calls.lte.push([col, val]); return b },
      order(col, opts) { calls.order.push([col, opts]); return b },
      limit(n) { calls.limit.push(n); return b },
      then(onF, onR) { return Promise.resolve(state.result).then(onF, onR) },
    }
    state.last = b
    return b
  }
  const auth = { getSession: () => Promise.resolve(state.session) }
  return { state, supabase: { from, auth } }
})

vi.mock('../lib/supabase', () => ({ supabase: h.supabase }))

const {
  fetchLoginHistory,
  fetchRecentSecurityEvents,
  getSessionInfo,
  summarizeLogins,
  getPasswordPolicy,
  IDLE_TIMEOUT_MS,
  SPARKLINE_DAYS,
  SECURITY_EVENT_ACTIONS,
  LOGIN_HISTORY_LIMIT,
} = await import('../lib/securityCenter')

beforeEach(() => {
  h.state.result = { data: [], error: null }
  h.state.session = { data: { session: null }, error: null }
  h.state.last = null
})

// Fixture helpers ─────────────────────────────────────────────────────────────
const NOW = new Date('2026-07-07T12:00:00') // local noon, a Tuesday

function loginRow({ user = 'u1', email = 'a@x.com', name = 'Alice', action = 'LOGIN', at, session = 's1' } = {}) {
  return {
    id: Math.random().toString(36).slice(2),
    user_id: user,
    user_email: email,
    action,
    session_id: session,
    created_at: at,
    profiles: { full_name: name, username: name.toLowerCase() },
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// summarizeLogins — per-user aggregation
// ─────────────────────────────────────────────────────────────────────────────
describe('summarizeLogins per-user aggregation', () => {
  it('computes last login, last logout and login count per user', () => {
    const rows = [
      loginRow({ user: 'u1', at: '2026-07-06T09:00:00' }),
      loginRow({ user: 'u1', at: '2026-07-07T08:00:00' }),
      loginRow({ user: 'u1', action: 'LOGOUT', at: '2026-07-07T10:00:00' }),
      loginRow({ user: 'u2', name: 'Bob', email: 'b@x.com', at: '2026-07-05T09:00:00', session: 's2' }),
    ]
    const s = summarizeLogins(rows, { now: NOW })
    expect(s.totalLogins).toBe(3)
    const alice = s.perUser.find(u => u.userId === 'u1')
    expect(alice.loginCount).toBe(2)
    expect(alice.lastLogin).toBe('2026-07-07T08:00:00')
    expect(alice.lastLogout).toBe('2026-07-07T10:00:00')
    const bob = s.perUser.find(u => u.userId === 'u2')
    expect(bob.loginCount).toBe(1)
    expect(bob.lastLogout).toBeNull()
  })

  it('sorts users by most recent login first', () => {
    const rows = [
      loginRow({ user: 'u1', at: '2026-07-01T09:00:00' }),
      loginRow({ user: 'u2', name: 'Bob', at: '2026-07-07T09:00:00', session: 's2' }),
    ]
    const s = summarizeLogins(rows, { now: NOW })
    expect(s.perUser.map(u => u.userId)).toEqual(['u2', 'u1'])
  })

  it('handles empty / non-array input', () => {
    expect(summarizeLogins([]).perUser).toEqual([])
    expect(summarizeLogins(null).totalLogins).toBe(0)
    expect(summarizeLogins(undefined).byDay).toHaveLength(SPARKLINE_DAYS)
  })

  it('ignores rows with other actions', () => {
    const s = summarizeLogins([loginRow({ action: 'DELETE', at: '2026-07-07T09:00:00' })], { now: NOW })
    expect(s.totalLogins).toBe(0)
    expect(s.perUser).toEqual([])
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// summarizeLogins — 14-day sparkline
// ─────────────────────────────────────────────────────────────────────────────
describe('summarizeLogins byDay sparkline', () => {
  it('returns exactly SPARKLINE_DAYS zero-filled entries, oldest first', () => {
    const s = summarizeLogins([], { now: NOW })
    expect(s.byDay).toHaveLength(SPARKLINE_DAYS)
    expect(s.byDay[SPARKLINE_DAYS - 1].key).toBe('2026-07-07')
    expect(s.byDay[0].key).toBe('2026-06-24')
    expect(s.byDay.every(d => d.count === 0)).toBe(true)
  })

  it('counts logins on the right local day and excludes out-of-window logins', () => {
    const rows = [
      loginRow({ at: '2026-07-07T08:00:00' }),
      loginRow({ at: '2026-07-07T18:00:00' }),
      loginRow({ at: '2026-07-01T09:00:00' }),
      loginRow({ at: '2026-01-01T09:00:00' }), // outside window — counted in totals, not in byDay
      loginRow({ action: 'LOGOUT', at: '2026-07-07T19:00:00' }), // logouts never counted
    ]
    const s = summarizeLogins(rows, { now: NOW })
    const today = s.byDay.find(d => d.key === '2026-07-07')
    expect(today.count).toBe(2)
    expect(s.byDay.find(d => d.key === '2026-07-01').count).toBe(1)
    expect(s.byDay.reduce((sum, d) => sum + d.count, 0)).toBe(3)
    expect(s.totalLogins).toBe(4)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// summarizeLogins — anomaly flags
// ─────────────────────────────────────────────────────────────────────────────
describe('summarizeLogins flags', () => {
  it('flags a session id used by multiple users', () => {
    const rows = [
      loginRow({ user: 'u1', at: '2026-07-07T09:00:00', session: 'shared' }),
      loginRow({ user: 'u2', name: 'Bob', at: '2026-07-07T10:00:00', session: 'shared' }),
    ]
    const s = summarizeLogins(rows, { now: NOW })
    const flag = s.flags.find(f => f.type === 'shared_session')
    expect(flag).toBeTruthy()
    expect(flag.sessionId).toBe('shared')
    expect(flag.users.sort()).toEqual(['u1', 'u2'])
  })

  it('does not flag the same user re-using their session id', () => {
    const rows = [
      loginRow({ user: 'u1', at: '2026-07-06T09:00:00', session: 's1' }),
      loginRow({ user: 'u1', at: '2026-07-07T09:00:00', session: 's1' }),
    ]
    const s = summarizeLogins(rows, { now: NOW })
    expect(s.flags.filter(f => f.type === 'shared_session')).toEqual([])
  })

  it('flags logins outside 06:00-22:00 local, boundaries exclusive/inclusive', () => {
    const rows = [
      loginRow({ at: '2026-07-07T05:59:00' }), // before 06 → flagged
      loginRow({ at: '2026-07-07T06:00:00' }), // 06:00 → ok
      loginRow({ at: '2026-07-07T21:59:00' }), // ok
      loginRow({ at: '2026-07-07T22:00:00' }), // 22:00 → flagged
      loginRow({ at: '2026-07-07T02:00:00' }), // flagged
    ]
    const s = summarizeLogins(rows, { now: NOW })
    const flagged = s.flags.filter(f => f.type === 'after_hours')
    expect(flagged).toHaveLength(3)
    expect(flagged.map(f => f.hour).sort((a, b) => a - b)).toEqual([2, 5, 22])
  })

  it('respects custom business hours', () => {
    const s = summarizeLogins(
      [loginRow({ at: '2026-07-07T07:00:00' })],
      { now: NOW, businessHours: { start: 8, end: 18 } },
    )
    expect(s.flags.some(f => f.type === 'after_hours')).toBe(true)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// getPasswordPolicy — truthful static descriptor
// ─────────────────────────────────────────────────────────────────────────────
describe('getPasswordPolicy', () => {
  it('describes only the 6-char Supabase default as enforced', () => {
    const p = getPasswordPolicy()
    expect(p.minLength).toBe(6)
    expect(p.enforced).toHaveLength(1)
    expect(p.enforced[0].rule).toMatch(/6 characters/i)
    expect(p.notEnforced.length).toBeGreaterThan(0)
    expect(p.recommendation).toBeTruthy()
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// fetchLoginHistory / fetchRecentSecurityEvents — query shape
// ─────────────────────────────────────────────────────────────────────────────
describe('fetchLoginHistory', () => {
  it('queries audit_log_v2 for LOGIN/LOGOUT with the profiles join, newest first', async () => {
    h.state.result = { data: [loginRow({ at: '2026-07-07T08:00:00' })], error: null }
    const rows = await fetchLoginHistory()
    const q = h.state.last
    expect(q._table).toBe('audit_log_v2')
    expect(q._calls.select).toContain('profiles(full_name, username)')
    expect(q._calls.in).toEqual([['action', ['LOGIN', 'LOGOUT']]])
    expect(q._calls.order).toEqual([['created_at', { ascending: false }]])
    expect(q._calls.limit).toEqual([LOGIN_HISTORY_LIMIT])
    expect(q._calls.eq).toEqual([]) // no user filter by default
    expect(rows).toHaveLength(1)
  })

  it('applies userId and date-range filters', async () => {
    await fetchLoginHistory({ userId: 'u9', dateFrom: '2026-07-01', dateTo: '2026-07-07', limit: 50 })
    const q = h.state.last
    expect(q._calls.eq).toEqual([['user_id', 'u9']])
    expect(q._calls.gte).toEqual([['created_at', '2026-07-01']])
    expect(q._calls.lte).toEqual([['created_at', '2026-07-07T23:59:59']])
    expect(q._calls.limit).toEqual([50])
  })

  it('throws on query error and returns [] for null data', async () => {
    h.state.result = { data: null, error: new Error('boom') }
    await expect(fetchLoginHistory()).rejects.toThrow('boom')
    h.state.result = { data: null, error: null }
    expect(await fetchLoginHistory()).toEqual([])
  })
})

describe('fetchRecentSecurityEvents', () => {
  it('queries the sensitive actions within the look-back window', async () => {
    await fetchRecentSecurityEvents({ days: 30 })
    const q = h.state.last
    expect(q._table).toBe('audit_log_v2')
    expect(q._calls.in).toEqual([['action', SECURITY_EVENT_ACTIONS]])
    expect(q._calls.gte).toHaveLength(1)
    const since = new Date(q._calls.gte[0][1])
    const expectedMs = Date.now() - 30 * 24 * 60 * 60 * 1000
    expect(Math.abs(since.getTime() - expectedMs)).toBeLessThan(10_000)
    expect(q._calls.order).toEqual([['created_at', { ascending: false }]])
  })

  it('throws on error', async () => {
    h.state.result = { data: null, error: new Error('denied') }
    await expect(fetchRecentSecurityEvents()).rejects.toThrow('denied')
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// getSessionInfo
// ─────────────────────────────────────────────────────────────────────────────
describe('getSessionInfo', () => {
  it('returns null when there is no session', async () => {
    expect(await getSessionInfo()).toBeNull()
  })

  it('maps the Supabase session into the card shape', async () => {
    const expiresSec = Math.floor(Date.parse('2026-07-07T13:00:00Z') / 1000)
    h.state.session = {
      data: {
        session: {
          expires_at: expiresSec,
          user: {
            id: 'u1',
            email: 'a@x.com',
            last_sign_in_at: '2026-07-07T08:00:00Z',
            app_metadata: { provider: 'email' },
          },
        },
      },
      error: null,
    }
    const info = await getSessionInfo()
    expect(info.userId).toBe('u1')
    expect(info.email).toBe('a@x.com')
    expect(info.signedInAt).toBe('2026-07-07T08:00:00Z')
    expect(new Date(info.expiresAt).getTime()).toBe(expiresSec * 1000)
    expect(info.provider).toBe('email')
    expect(info.idleTimeoutMs).toBe(IDLE_TIMEOUT_MS)
    expect(IDLE_TIMEOUT_MS).toBe(30 * 60 * 1000) // must mirror AuthContext IDLE_MS
  })

  it('throws when getSession errors', async () => {
    h.state.session = { data: null, error: new Error('auth down') }
    await expect(getSessionInfo()).rejects.toThrow('auth down')
  })
})
