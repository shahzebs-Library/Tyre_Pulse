/**
 * consoleOverview.js - readers + pure shapers behind the console Control
 * Center Overview and its top bar (critical count, quick-action impact).
 *
 * Every reader returns NULL for a number it could not read, never 0: on this
 * page a zero says "all clear" and an unreadable count says no such thing.
 * Nothing here writes; writes go through the existing services
 * (systemConfig.saveSystemConfigValues, backups, securityAudit).
 */
import { supabase } from './_client'
import { listSystemLogs } from './systemLogs'

const DAY = 86400000

/** A head-only exact count, or null when it could not be read. */
export async function countOrNull(build) {
  try {
    const { count, error } = await build()
    if (error) return null
    return typeof count === 'number' ? count : null
  } catch { return null }
}

/** Local midnight today as ISO. */
export function startOfToday(now = Date.now()) {
  const d = new Date(now)
  d.setHours(0, 0, 0, 0)
  return d.toISOString()
}

/**
 * Percentage change from prev to cur. Null when either side is unknown or the
 * previous period is zero (a change from nothing has no honest percentage).
 */
export function pctChange(cur, prev) {
  if (typeof cur !== 'number' || typeof prev !== 'number') return null
  if (!Number.isFinite(cur) || !Number.isFinite(prev) || prev === 0) return null
  return Math.round(((cur - prev) / prev) * 100)
}

/**
 * Group unresolved log rows by message so the same fault repeated 40 times
 * reads as one issue with a count. Worst severity wins; newest first within
 * the same severity.
 */
export function groupErrors(rows = [], limit = 8) {
  const rank = { critical: 0, error: 1, warning: 2, info: 3 }
  const by = new Map()
  for (const r of Array.isArray(rows) ? rows : []) {
    const msg = String(r?.message || 'No message recorded').trim().slice(0, 160)
    const g = by.get(msg) || { message: msg, count: 0, severity: r?.severity || 'info', module: r?.module_id || r?.source || null, latest: null }
    g.count += 1
    if ((rank[r?.severity] ?? 9) < (rank[g.severity] ?? 9)) g.severity = r.severity
    if (!g.latest || String(r?.created_at || '') > g.latest) g.latest = r?.created_at || g.latest
    if (!g.module) g.module = r?.module_id || r?.source || null
    by.set(msg, g)
  }
  return [...by.values()]
    .sort((a, b) => (rank[a.severity] ?? 9) - (rank[b.severity] ?? 9) || b.count - a.count || String(b.latest).localeCompare(String(a.latest)))
    .slice(0, limit)
}

/** Count rows per severity. Unknown severities fold into 'info'. */
export function severityCounts(rows = []) {
  const out = { critical: 0, error: 0, warning: 0, info: 0 }
  for (const r of Array.isArray(rows) ? rows : []) {
    const s = Object.prototype.hasOwnProperty.call(out, r?.severity) ? r.severity : 'info'
    out[s] += 1
  }
  return out
}

/**
 * Turn the attention items + security posture + Flutter app versions into one
 * ranked action queue: critical, high, medium, low. Each item keeps the page
 * that clears it. Pure.
 */
export function buildActionQueue({ attention, posture, mobile } = {}) {
  const items = []
  for (const a of Array.isArray(attention) ? attention : []) {
    items.push({
      key: `att:${a.key}`,
      level: a.tone === 'danger' ? 'critical' : a.tone === 'warning' ? 'high' : 'low',
      title: a.text,
      detail: null,
      to: a.to,
      action: 'Open',
    })
  }
  const checks = posture?.checks || []
  for (const c of checks) {
    if (c.status !== 'fail' && c.status !== 'warn') continue
    const level = c.severity === 'critical' ? 'critical' : c.severity === 'high' ? 'high' : c.severity === 'medium' ? 'medium' : 'low'
    items.push({
      key: `sec:${c.id}`,
      level,
      title: `Security finding: ${c.title}`,
      detail: c.explain || (c.count != null ? `${c.count} affected` : null),
      to: '/console/security-audit',
      action: 'Review',
    })
  }
  if (mobile && mobile.configOk !== false) {
    if (!mobile.minVersion) {
      items.push({ key: 'mobile:min', level: 'low', title: 'No minimum Flutter app version is set', detail: 'Phones on any old Flutter build can still sign in.', to: '/console/mobile-app', action: 'Open' })
    }
    if (!mobile.latestVersion) {
      items.push({ key: 'mobile:latest', level: 'low', title: 'The newest released Flutter app version is not recorded', detail: 'Record it after each Flutter release so the minimum can be checked against it.', to: '/console/mobile-app', action: 'Open' })
    }
  }
  const rank = { critical: 0, high: 1, medium: 2, low: 3 }
  return items.sort((a, b) => rank[a.level] - rank[b.level])
}

/** Active users from profiles.last_login_at: today, 7 days, 30 days. */
export async function loadActiveUsers(now = Date.now()) {
  const since = (ms) => new Date(now - ms).toISOString()
  const q = (iso) => countOrNull(() => supabase.from('profiles').select('id', { count: 'exact', head: true }).gte('last_login_at', iso))
  const [today, d7, d30] = await Promise.all([q(startOfToday(now)), q(since(7 * DAY)), q(since(30 * DAY))])
  return { today, d7, d30 }
}

/**
 * Records written: rows the audit trail recorded in the last 7 days against
 * the 7 days before. audit_log_v2 captures inserts and updates on the audited
 * business tables, so this is a write-activity measure, not a table size.
 */
export async function loadRecordsWritten(now = Date.now()) {
  const a = new Date(now - 7 * DAY).toISOString()
  const b = new Date(now - 14 * DAY).toISOString()
  const [cur, prev] = await Promise.all([
    countOrNull(() => supabase.from('audit_log_v2').select('id', { count: 'exact', head: true }).gte('created_at', a)),
    countOrNull(() => supabase.from('audit_log_v2').select('id', { count: 'exact', head: true }).gte('created_at', b).lt('created_at', a)),
  ])
  return { cur, prev, change: pctChange(cur, prev) }
}

/** Unresolved critical + error log rows in the last 7 days (top bar button). */
export async function loadCriticalCount(now = Date.now()) {
  const since = new Date(now - 7 * DAY).toISOString()
  return countOrNull(() => supabase.from('system_logs').select('id', { count: 'exact', head: true })
    .eq('severity', 'critical').eq('resolved', false).gte('created_at', since))
}

/** Unresolved log rows in the last 7 days, for the errors panel. Throws on failure. */
export async function loadRecentErrors(now = Date.now()) {
  const since = new Date(now - 7 * DAY).toISOString()
  return listSystemLogs({ resolved: false, since, limit: 500 })
}

/**
 * Who maintenance mode would affect: approved, unlocked accounts that are not
 * super admins or Admins (those pass the gate), people signed in today, and
 * registered phones.
 */
export async function loadMaintenanceImpact(now = Date.now()) {
  const [blocked, today, phones] = await Promise.all([
    countOrNull(() => supabase.from('profiles').select('id', { count: 'exact', head: true })
      .eq('approved', true).eq('locked', false).neq('role', 'Admin').or('is_super_admin.is.null,is_super_admin.eq.false')),
    countOrNull(() => supabase.from('profiles').select('id', { count: 'exact', head: true }).gte('last_login_at', startOfToday(now))),
    countOrNull(() => supabase.from('user_devices').select('id', { count: 'exact', head: true }).eq('revoked', false)),
  ])
  return { blocked, today, phones }
}

/** Recent console actions, newest first. Throws on failure. */
export async function loadRecentAdminActivity(limit = 12) {
  const { data, error } = await supabase
    .from('console_sessions')
    .select('id, admin_id, action, target_type, created_at')
    .order('created_at', { ascending: false })
    .limit(limit)
  if (error) throw error
  const rows = data || []
  const ids = [...new Set(rows.map((r) => r.admin_id).filter(Boolean))]
  let names = {}
  if (ids.length) {
    const { data: ps } = await supabase.from('profiles').select('id, full_name, username').in('id', ids.slice(0, 500)).limit(500)
    names = Object.fromEntries((ps || []).map((p) => [p.id, p.full_name || p.username || null]))
  }
  return rows.map((r) => ({ ...r, admin_name: names[r.admin_id] || null }))
}
