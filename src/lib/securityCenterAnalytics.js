/**
 * securityCenterAnalytics - pure view logic for the Security Center page
 * (/security-center, also hosted as a console tab). Builds on the domain
 * helpers in securityCenter.js (summarizeLogins, the bounded reads). No I/O;
 * `now` is injected.
 *
 * Honesty rules:
 *   - The login and event feeds are BOUNDED reads (newest N rows). When a feed
 *     returns exactly its limit, older rows exist that were not read, and every
 *     figure says "in the latest N" rather than claiming a total.
 *   - Rates over an empty set are null (N/A).
 */

/** Display name for an audit row (joined profile first, then email). */
export function actorName(row) {
  return row?.profiles?.full_name || row?.profiles?.username || row?.user_email || 'Unknown'
}

/** True when a bounded feed came back full, i.e. older rows were not read. */
export function isTruncated(rows, limit) {
  return Array.isArray(rows) && Number.isFinite(limit) && limit > 0 && rows.length >= limit
}

/** Free-text search over login rows: actor name, email, action. */
export function filterLoginRows(rows, query = '', { action = '' } = {}) {
  const q = String(query || '').trim().toLowerCase()
  return (Array.isArray(rows) ? rows : []).filter((r) => {
    if (action && r.action !== action) return false
    if (!q) return true
    return actorName(r).toLowerCase().includes(q)
      || String(r.user_email || '').toLowerCase().includes(q)
      || String(r.action || '').toLowerCase().includes(q)
  })
}

/** Free-text + action filter over security events. */
export function filterEventRows(rows, { query = '', action = '' } = {}) {
  const q = String(query || '').trim().toLowerCase()
  return (Array.isArray(rows) ? rows : []).filter((r) => {
    if (action && r.action !== action) return false
    if (!q) return true
    return actorName(r).toLowerCase().includes(q)
      || String(r.user_email || '').toLowerCase().includes(q)
      || String(r.table_name || '').toLowerCase().includes(q)
      || String(r.record_id || '').toLowerCase().includes(q)
  })
}

/**
 * Login KPIs from the loaded rows plus the summarizeLogins() output.
 *   logins / logouts   counts in the loaded rows
 *   users              distinct people who signed in
 *   afterHours         after-hours sign-ins flagged by the summary
 *   sharedSessions     sessions used by more than one user
 *   loginsLast24h      sign-ins in the 24 hours before `now`
 *   lastLogin          newest sign-in timestamp (null when none)
 */
export function loginKpis(rows, summary, { now = new Date() } = {}) {
  const list = Array.isArray(rows) ? rows : []
  const logins = list.filter((r) => r.action === 'LOGIN')
  const since = now.getTime() - 24 * 60 * 60 * 1000
  let lastLogin = null
  let last24 = 0
  const users = new Set()
  for (const r of logins) {
    users.add(r.user_id || r.user_email || 'unknown')
    const t = r.created_at ? new Date(r.created_at).getTime() : NaN
    if (Number.isFinite(t)) {
      if (t >= since) last24 += 1
      if (!lastLogin || t > new Date(lastLogin).getTime()) lastLogin = r.created_at
    }
  }
  const flags = Array.isArray(summary?.flags) ? summary.flags : []
  return {
    logins: logins.length,
    logouts: list.filter((r) => r.action === 'LOGOUT').length,
    users: users.size,
    afterHours: flags.filter((f) => f.type === 'after_hours').length,
    sharedSessions: flags.filter((f) => f.type === 'shared_session').length,
    loginsLast24h: last24,
    lastLogin,
  }
}

/**
 * Security event breakdown: counts per action (desc) and the grouped totals
 * the tiles show. `topActor` is the person with the most sensitive actions.
 */
export function eventBreakdown(events) {
  const list = Array.isArray(events) ? events : []
  const byAction = new Map()
  const byActor = new Map()
  for (const e of list) {
    const a = e.action || 'UNKNOWN'
    byAction.set(a, (byAction.get(a) || 0) + 1)
    const who = actorName(e)
    byActor.set(who, (byActor.get(who) || 0) + 1)
  }
  const count = (pred) => list.filter((e) => pred(String(e.action || ''))).length
  let topActor = null
  for (const [name, n] of byActor) if (!topActor || n > topActor.count) topActor = { name, count: n }
  return {
    total: list.length,
    deletes: count((a) => a === 'DELETE' || a === 'BULK_DELETE'),
    exports: count((a) => a === 'EXPORT'),
    bulk: count((a) => a.startsWith('BULK_')),
    uploads: count((a) => a === 'UPLOAD'),
    byAction: [...byAction.entries()].map(([action, n]) => ({ action, count: n }))
      .sort((x, y) => y.count - x.count || x.action.localeCompare(y.action)),
    topActor,
  }
}
