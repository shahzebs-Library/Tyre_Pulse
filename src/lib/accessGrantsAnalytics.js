/**
 * Access grants analytics: pure presentation engine for the Per-User Grants
 * manager (AccessGrantsManager, inside the console Access Control hub).
 *
 * It only DESCRIBES grants for display, filtering and export. It never decides
 * access: enforcement stays with the server (user_access_grants RLS + the
 * resolver) and AuthContext. No I/O; the clock is injected.
 *
 * An expired grant no longer applies (every reader ignores expired rows), so it
 * is labelled Expired rather than counted as a live override.
 */

const DAY_MS = 86400000

export function displayName(u) {
  return u?.full_name || u?.username || u?.email || 'Unnamed user'
}

export function initials(u) {
  return displayName(u).slice(0, 2).toUpperCase()
}

/** Filter the user directory by role and name/email/username search. */
export function filterUsers(users = [], { search = '', role = 'all' } = {}) {
  const q = String(search || '').trim().toLowerCase()
  return (Array.isArray(users) ? users : []).filter((u) => {
    if (role !== 'all' && u.role !== role) return false
    if (!q) return true
    return (
      displayName(u).toLowerCase().includes(q) ||
      String(u.email || '').toLowerCase().includes(q) ||
      String(u.username || '').toLowerCase().includes(q)
    )
  })
}

export function roleOptions(users = []) {
  const set = new Set()
  for (const u of Array.isArray(users) ? users : []) if (u?.role) set.add(u.role)
  return Array.from(set).sort()
}

function epoch(v) {
  if (!v) return null
  const t = new Date(v).getTime()
  return Number.isFinite(t) ? t : null
}

/** 'expired' | 'expiring' (within soonDays) | 'active' | 'permanent'. */
export function grantState(g, now = Date.now(), soonDays = 30) {
  const exp = epoch(g?.expires_at)
  if (exp == null) return 'permanent'
  if (exp < now) return 'expired'
  if (exp - now <= soonDays * DAY_MS) return 'expiring'
  return 'active'
}

export const GRANT_STATE_LABEL = { permanent: 'No expiry', active: 'Active', expiring: 'Expiring soon', expired: 'Expired' }

/** Summary of one user's grants for the KPI strip. */
export function grantSummary(grants = [], now = Date.now(), soonDays = 30) {
  const list = Array.isArray(grants) ? grants : []
  let grantsN = 0; let revokes = 0; let expired = 0; let expiring = 0
  for (const g of list) {
    const st = grantState(g, now, soonDays)
    if (st === 'expired') { expired += 1; continue }
    if (st === 'expiring') expiring += 1
    if (g.effect === 'revoke') revokes += 1
    else grantsN += 1
  }
  return { total: list.length, liveGrants: grantsN, liveRevokes: revokes, expired, expiring, soonDays }
}

/** Directory summary: users, super admins, distinct roles. */
export function directorySummary(users = []) {
  const list = Array.isArray(users) ? users : []
  return {
    users: list.length,
    superAdmins: list.filter((u) => u?.is_super_admin === true).length,
    roles: roleOptions(list).length,
  }
}

export const GRANT_EXPORT_COLS = ['user', 'effect', 'module', 'capability', 'state', 'expires', 'granted', 'note']
export const GRANT_EXPORT_HEADERS = ['User', 'Effect', 'Module', 'Capability', 'State', 'Expires', 'Granted', 'Note']

export function grantExportRows(grants = [], { user, moduleLabel = {}, now = Date.now(), fmt = (v) => (v ? String(v) : 'N/A') } = {}) {
  return (Array.isArray(grants) ? grants : []).map((g) => ({
    user: displayName(user),
    effect: g.effect === 'revoke' ? 'Revoke' : 'Grant',
    module: moduleLabel[g.module_key] || g.module_key || '',
    capability: g.capability || 'view',
    state: GRANT_STATE_LABEL[grantState(g, now)],
    expires: g.expires_at ? fmt(g.expires_at) : 'No expiry',
    granted: fmt(g.created_at),
    note: g.note || '',
  }))
}
