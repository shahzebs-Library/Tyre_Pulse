/**
 * securityCenter.js — data layer + pure helpers for the Security Center page.
 *
 * Data wrappers (thin Supabase queries, throw on error like notifications.js):
 *   - fetchLoginHistory        -> LOGIN/LOGOUT rows from audit_log_v2 + profile name
 *   - fetchRecentSecurityEvents -> DELETE / EXPORT / bulk actions, last 30 days
 *   - getSessionInfo           -> current Supabase session (sign-in time, expiry, provider)
 *
 * Pure helpers (unit-tested in src/test/securityCenter.test.js):
 *   - summarizeLogins   -> per-user last login, 14-day counts, anomaly flags
 *   - getPasswordPolicy -> truthful descriptor of the enforced password policy
 *
 * Auditing note: LOGIN/LOGOUT rows are written by src/lib/auditLogger.js
 * (audit.login()/audit.logout()), wired into AuthContext signIn/signOut.
 * History accrues from the moment that wiring is deployed.
 */

import { supabase } from './supabase'

// ── Constants ─────────────────────────────────────────────────────────────────

/**
 * Idle-timeout used by AuthContext (src/contexts/AuthContext.jsx IDLE_MS).
 * AuthContext keeps this constant private (in-memory activity ref inside the
 * provider), so we mirror the value here. If AuthContext ever changes its
 * timeout, update this mirror.
 */
export const IDLE_TIMEOUT_MS = 30 * 60 * 1000

/** Default page size for login history. */
export const LOGIN_HISTORY_LIMIT = 200

/** Security events look-back window (days). */
export const SECURITY_EVENT_WINDOW_DAYS = 30

/** Days covered by the login sparkline. */
export const SPARKLINE_DAYS = 14

/** Local business hours: logins outside [start, end) are flagged. */
export const BUSINESS_HOURS = { start: 6, end: 22 }

/** audit_log_v2 actions considered security-sensitive for the events feed. */
export const SECURITY_EVENT_ACTIONS = [
  'DELETE',
  'EXPORT',
  'BULK_DELETE',
  'BULK_UPDATE',
  'BULK_CREATE',
  'UPLOAD',
]

// ── Data wrappers ─────────────────────────────────────────────────────────────

/**
 * Login/logout history from audit_log_v2, newest first, with the actor's
 * profile name joined (same join pattern as AuditTrail.jsx).
 *
 * RLS is the real access boundary; the userId filter is a UX convenience:
 * pass the current user's id for non-admins, omit (or pass null) for admins
 * to see all users.
 *
 * @param {object}  [opts]
 * @param {string}  [opts.userId]   restrict to one user (non-admins: always self)
 * @param {number}  [opts.limit]
 * @param {string}  [opts.dateFrom] ISO date (yyyy-mm-dd) inclusive lower bound
 * @param {string}  [opts.dateTo]   ISO date (yyyy-mm-dd) inclusive upper bound
 * @param {object}  [opts.client]   injectable Supabase client (tests)
 */
export async function fetchLoginHistory({
  userId = null,
  limit = LOGIN_HISTORY_LIMIT,
  dateFrom = null,
  dateTo = null,
  client = supabase,
} = {}) {
  let q = client
    .from('audit_log_v2')
    .select('id, user_id, user_email, action, session_id, created_at, profiles(full_name, username)')
    .in('action', ['LOGIN', 'LOGOUT'])
    .order('created_at', { ascending: false })
    .limit(limit)

  if (userId)   q = q.eq('user_id', userId)
  if (dateFrom) q = q.gte('created_at', dateFrom)
  if (dateTo)   q = q.lte('created_at', dateTo + 'T23:59:59')

  const { data, error } = await q
  if (error) throw error
  return data || []
}

/**
 * Security-sensitive events (deletes, exports, bulk operations) from
 * audit_log_v2 over the last N days, newest first. Admin-only feed —
 * the page gates rendering; RLS remains the hard boundary.
 */
export async function fetchRecentSecurityEvents({
  days = SECURITY_EVENT_WINDOW_DAYS,
  limit = LOGIN_HISTORY_LIMIT,
  client = supabase,
} = {}) {
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString()
  const { data, error } = await client
    .from('audit_log_v2')
    .select('id, user_id, user_email, action, table_name, record_id, created_at, profiles(full_name, username)')
    .in('action', SECURITY_EVENT_ACTIONS)
    .gte('created_at', since)
    .order('created_at', { ascending: false })
    .limit(limit)
  if (error) throw error
  return data || []
}

/**
 * Current auth session details for the "My session" card.
 * Returns null when there is no active session.
 */
export async function getSessionInfo({ client = supabase } = {}) {
  const { data, error } = await client.auth.getSession()
  if (error) throw error
  const session = data?.session
  if (!session) return null
  return {
    userId:        session.user?.id ?? null,
    email:         session.user?.email ?? null,
    signedInAt:    session.user?.last_sign_in_at ?? null,
    // expires_at is unix seconds per supabase-js v2
    expiresAt:     session.expires_at ? new Date(session.expires_at * 1000).toISOString() : null,
    provider:      session.user?.app_metadata?.provider ?? 'email',
    idleTimeoutMs: IDLE_TIMEOUT_MS,
  }
}

// ── Pure helpers ──────────────────────────────────────────────────────────────

function localDayKey(date) {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

function displayName(row) {
  return row?.profiles?.full_name || row?.profiles?.username || row?.user_email || row?.user_id || 'Unknown'
}

/**
 * Pure summary over LOGIN/LOGOUT audit rows.
 *
 * @param {Array<object>} rows  audit_log_v2 rows (any order); fields used:
 *                              user_id, user_email, action, session_id,
 *                              created_at, profiles.full_name/username
 * @param {object}  [opts]
 * @param {Date}    [opts.now]           reference "today" for the sparkline
 * @param {number}  [opts.days]          sparkline window (default 14)
 * @param {object}  [opts.businessHours] { start, end } local hours
 * @returns {{
 *   perUser: Array<{ userId, name, email, lastLogin, lastLogout, loginCount }>,
 *   byDay:   Array<{ key: string, count: number }>,  // oldest → newest, `days` entries
 *   flags:   Array<{ type: 'shared_session'|'after_hours', ... }>,
 *   totalLogins: number
 * }}
 */
export function summarizeLogins(rows, {
  now = new Date(),
  days = SPARKLINE_DAYS,
  businessHours = BUSINESS_HOURS,
} = {}) {
  const list = Array.isArray(rows) ? rows : []

  // Per-user aggregation
  const byUser = new Map()
  // Session id → set of user ids (shared-session detection)
  const bySession = new Map()
  // Day key → login count
  const dayCounts = new Map()
  const afterHours = []
  let totalLogins = 0

  for (const row of list) {
    if (!row || (row.action !== 'LOGIN' && row.action !== 'LOGOUT')) continue
    const ts = row.created_at ? new Date(row.created_at) : null
    const validTs = ts && !Number.isNaN(ts.getTime())
    const uid = row.user_id || row.user_email || 'unknown'

    let u = byUser.get(uid)
    if (!u) {
      u = { userId: uid, name: displayName(row), email: row.user_email ?? null, lastLogin: null, lastLogout: null, loginCount: 0 }
      byUser.set(uid, u)
    }

    if (row.action === 'LOGIN') {
      totalLogins += 1
      u.loginCount += 1
      if (validTs) {
        if (!u.lastLogin || ts > new Date(u.lastLogin)) u.lastLogin = row.created_at
        dayCounts.set(localDayKey(ts), (dayCounts.get(localDayKey(ts)) || 0) + 1)
        const hour = ts.getHours()
        if (hour < businessHours.start || hour >= businessHours.end) {
          afterHours.push({ userId: uid, name: u.name, at: row.created_at, hour })
        }
      }
      if (row.session_id) {
        if (!bySession.has(row.session_id)) bySession.set(row.session_id, new Set())
        bySession.get(row.session_id).add(uid)
      }
    } else if (validTs) {
      if (!u.lastLogout || ts > new Date(u.lastLogout)) u.lastLogout = row.created_at
    }
  }

  // Sparkline: fixed window of `days` entries, oldest → newest, zero-filled.
  const byDay = []
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() - i)
    const key = localDayKey(d)
    byDay.push({ key, count: dayCounts.get(key) || 0 })
  }

  const flags = []
  for (const [sessionId, users] of bySession) {
    if (users.size > 1) {
      flags.push({ type: 'shared_session', sessionId, users: [...users] })
    }
  }
  for (const ev of afterHours) {
    flags.push({ type: 'after_hours', ...ev })
  }

  // Sort per-user by most recent login first (nulls last)
  const perUser = [...byUser.values()].sort((a, b) => {
    if (!a.lastLogin && !b.lastLogin) return 0
    if (!a.lastLogin) return 1
    if (!b.lastLogin) return -1
    return new Date(b.lastLogin) - new Date(a.lastLogin)
  })

  return { perUser, byDay, flags, totalLogins }
}

/**
 * Truthful descriptor of the password policy actually enforced today.
 *
 * Enforced: Supabase Auth's default 6-character minimum, mirrored client-side
 * in Login.jsx (signup), Settings.jsx (change password) and ResetPassword.jsx.
 * NOT enforced: complexity (uppercase/number/symbol), rotation, or breach
 * checks — the Login page strength meter is advisory only.
 */
export function getPasswordPolicy() {
  return {
    minLength: 6,
    enforced: [
      { rule: 'Minimum 6 characters', source: 'Supabase Auth default, mirrored in signup / change-password / reset forms' },
    ],
    notEnforced: [
      { rule: 'Complexity (uppercase, number, symbol)', note: 'Strength meter on signup is advisory only' },
      { rule: 'Password rotation / expiry' },
      { rule: 'Breached-password (HIBP) check' },
    ],
    recommendation:
      'Raise the minimum length and enable leaked-password protection in the Supabase Auth dashboard, then mirror the new rules in the client forms.',
  }
}
