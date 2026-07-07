/**
 * notifications.js (web)
 * Pure helpers + thin Supabase wrappers for the in-app Notification Center.
 *
 * Pure helpers (unit-tested in src/test/notifications.test.js):
 *   - severityRank / sortBySeverity
 *   - normalizeSeverity
 *   - filterUnread / countUnread
 *   - groupByDay
 *   - alertRowToNotification
 *
 * Wrappers (used by useRealtimeAlerts / NotificationCenter):
 *   - fetchLatestAlerts   -> latest rows from public.alerts, newest first
 *   - markNotificationRead -> mark_notification_read RPC (per-user notifications table)
 */

import { supabase } from './supabase'

// ── Severity ─────────────────────────────────────────────────────────────────

/** Display severity ranking - lower is more severe. Mirrors Alerts.jsx SEV_SORT_ORDER. */
export const SEVERITY_ORDER = { Critical: 0, High: 1, Medium: 2, Low: 3 }

/** Rank a display severity ('Critical' | 'High' | 'Medium' | 'Low'). Unknown -> Low. */
export function severityRank(severity) {
  const rank = SEVERITY_ORDER[severity]
  return rank === undefined ? SEVERITY_ORDER.Low : rank
}

/** Map raw DB severity values (lowercase enum) to display severity. */
const DB_SEVERITY_MAP = {
  critical: 'Critical',
  high:     'High',
  medium:   'Medium',
  low:      'Low',
  info:     'Low',
}

/** Normalize a raw alerts.severity value to a display severity. Unknown -> Medium. */
export function normalizeSeverity(raw) {
  return DB_SEVERITY_MAP[String(raw || '').toLowerCase()] || 'Medium'
}

/** Stable sort: most severe first, then newest first. Does not mutate input. */
export function sortBySeverity(notifications) {
  return [...(notifications || [])].sort((a, b) => {
    const sev = severityRank(a.severity) - severityRank(b.severity)
    if (sev !== 0) return sev
    return new Date(b.timestamp) - new Date(a.timestamp)
  })
}

// ── Unread ───────────────────────────────────────────────────────────────────

/** Notifications not yet marked read. */
export function filterUnread(notifications) {
  return (notifications || []).filter(n => !n.read)
}

/** Count of unread notifications. */
export function countUnread(notifications) {
  return filterUnread(notifications).length
}

// ── Day grouping ─────────────────────────────────────────────────────────────

function localDayKey(date) {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

/**
 * Group notifications by local calendar day, newest day first.
 * Returns [{ key: 'YYYY-MM-DD', label: 'Today'|'Yesterday'|localized date, items: [...] }].
 * Items inside each group keep newest-first order. Invalid timestamps group under 'Earlier'.
 */
export function groupByDay(notifications, now = new Date()) {
  const todayKey = localDayKey(now)
  const yesterdayKey = localDayKey(new Date(now.getTime() - 24 * 60 * 60 * 1000))

  const groups = new Map()
  const sorted = [...(notifications || [])]
    .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp))

  for (const n of sorted) {
    const ts = new Date(n.timestamp)
    const valid = !Number.isNaN(ts.getTime())
    const key = valid ? localDayKey(ts) : 'earlier'
    if (!groups.has(key)) {
      const label = !valid ? 'Earlier'
        : key === todayKey ? 'Today'
        : key === yesterdayKey ? 'Yesterday'
        : ts.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })
      groups.set(key, { key, label, items: [] })
    }
    groups.get(key).items.push(n)
  }
  return Array.from(groups.values())
}

// ── Alert row mapping ────────────────────────────────────────────────────────

/** Human titles for known alerts.alert_type values. */
const ALERT_TYPE_TITLES = {
  tyre_risk:      'Tyre Risk',
  low_tread:      'Low Tread',
  pressure:       'Pressure Alert',
  inspection_due: 'Inspection Due',
}

function humanizeType(type) {
  if (!type) return 'Fleet Alert'
  return ALERT_TYPE_TITLES[type]
    || String(type).replace(/[_-]+/g, ' ').replace(/\b\w/g, c => c.toUpperCase())
}

/**
 * Map a public.alerts row to the notification shape used by the feed.
 * Only uses columns proven in existing queries:
 * id, asset_no, alert_type, severity, message, created_at, resolved, is_active.
 */
export function alertRowToNotification(row) {
  const assetNo = row.asset_no || null
  const title = humanizeType(row.alert_type) + (assetNo ? ` - ${assetNo}` : '')
  return {
    id:        `alert-${row.id}`,
    type:      row.alert_type || 'alert',
    title,
    message:   row.message || '',
    severity:  normalizeSeverity(row.severity),
    assetNo,
    timestamp: row.created_at || new Date().toISOString(),
    read:      false,
  }
}

// ── Supabase wrappers ────────────────────────────────────────────────────────

export const ALERT_FEED_LIMIT = 20

/**
 * Fetch the latest alerts (newest first) mapped to notification shape.
 * Throws on Supabase error so callers can surface an error state.
 */
export async function fetchLatestAlerts({ client = supabase, limit = ALERT_FEED_LIMIT } = {}) {
  const { data, error } = await client
    .from('alerts')
    .select('id,asset_no,alert_type,severity,message,created_at,resolved,is_active')
    .order('created_at', { ascending: false })
    .limit(limit)
  if (error) throw error
  return (data || []).map(alertRowToNotification)
}

/**
 * Persist read state for a per-user notifications-table row.
 * Same mechanism DailyOps/useRealtimeAlerts use: mark_notification_read RPC (V19).
 * Fire-and-forget safe: returns the RPC promise; errors resolve, never throw.
 */
export function markNotificationRead(id, { client = supabase } = {}) {
  return client.rpc('mark_notification_read', { p_id: id }).then(
    res => res,
    err => ({ data: null, error: err }),
  )
}
