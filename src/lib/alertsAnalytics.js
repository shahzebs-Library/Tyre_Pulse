/**
 * alertsAnalytics.js - pure analytics over the live alert list (no I/O).
 *
 * DETECTION lives in `alertEngine.js` (it reads the database and applies the
 * rules). This module only READS the list that engine returns and turns it into
 * the operational picture the /alerts page needs: open alerts per severity, how
 * long the underlying condition has been going on, the dismissal rate, and where
 * (site) and what (type) the alerts are. It never re-derives a rule.
 *
 * HONESTY NOTES
 * - Severity always goes through `normalizeSeverity` from severity.js, the one
 *   ladder the app uses. An alert whose severity cannot be read is counted as
 *   "Unrated", never quietly folded into Info.
 * - AGE is the age of the CONDITION, not of the alert row. The engine stamps
 *   every alert with the moment of the scan, so `createdAt` says nothing about
 *   how long a problem has existed. Age is therefore derived only where the
 *   source record carries a real date: a corrective action's due date, an
 *   inspection's scheduled date, a vehicle's last activity. Stock, budget, CPK,
 *   risk and data-quality alerts have no such date and read N/A (null), never 0.
 * - "Acknowledged" means dismissed. Dismissals are kept in this browser only, so
 *   the rate describes this device, and the page says so.
 * - Every rate is null when its denominator is zero.
 *
 * Time-dependent functions take an injectable `now`.
 */
import { normalizeSeverity, SEVERITY, SEVERITY_LEVELS_ALL, severityRank } from './severity'

const MS_PER_DAY = 86400000

/** Label used when a severity cannot be read. */
export const UNRATED = 'Unrated'

/** Severity tiles shown on the page, worst first. */
export const SEVERITY_ORDER = [...SEVERITY_LEVELS_ALL, UNRATED]

/** Age thresholds offered by the "older than" control, in days. */
export const AGE_THRESHOLDS = [3, 7, 14, 30, 60]

/** Default "older than" threshold. */
export const DEFAULT_AGE_THRESHOLD = 7

/** Label for alerts that name no site. */
export const NO_SITE = 'No site recorded'

function toMs(v) {
  if (v == null || v === '') return null
  if (v instanceof Date) return Number.isFinite(v.getTime()) ? v.getTime() : null
  if (typeof v === 'number') return Number.isFinite(v) ? v : null
  const s = String(v)
  const t = new Date(s.length === 10 ? `${s}T00:00:00Z` : s).getTime()
  return Number.isFinite(t) ? t : null
}

function nowMs(now) {
  const t = toMs(now ?? new Date())
  return t == null ? Date.now() : t
}

function pct(part, whole) {
  if (!whole) return null
  return Math.round((part / whole) * 1000) / 10
}

/** Canonical severity of an alert, or UNRATED. */
export function alertSeverity(alert) {
  return normalizeSeverity(alert?.severity, null) || UNRATED
}

/** Site an alert concerns, or null when the source record names none. */
export function alertSite(alert) {
  const s = alert?.data?.site ?? alert?.site ?? null
  if (s == null) return null
  const t = String(s).trim()
  return t ? t : null
}

/**
 * The date the underlying condition started, or null when the source record
 * carries none. Only real dates on the source row are used.
 */
export function alertSinceDate(alert) {
  const d = alert?.data || {}
  const candidate = d.due_date ?? d.scheduled_date ?? d.lastSeen ?? null
  return toMs(candidate) == null ? null : candidate
}

/** Whole days the condition has existed, or null when there is no source date. */
export function alertAgeDays(alert, now) {
  const since = toMs(alertSinceDate(alert))
  if (since == null) return null
  const days = Math.floor((nowMs(now) - since) / MS_PER_DAY)
  return days < 0 ? 0 : days
}

/**
 * Flatten alerts into table rows.
 * @param {object[]} alerts
 * @param {Set<string>} dismissed ids dismissed on this device
 * @param {{now?:Date|string, typeLabels?:object}} opts
 */
export function buildAlertRows(alerts, dismissed = new Set(), { now, typeLabels = {} } = {}) {
  const set = dismissed instanceof Set ? dismissed : new Set(dismissed || [])
  return (Array.isArray(alerts) ? alerts : []).filter(Boolean).map((a) => {
    const severity = alertSeverity(a)
    return {
      id: a.id,
      type: a.type ?? null,
      typeLabel: typeLabels[a.type] || a.type || 'Other',
      severity,
      rank: severity === UNRATED ? -1 : severityRank(severity),
      title: a.title ?? '',
      message: a.message ?? '',
      site: alertSite(a),
      since: alertSinceDate(a),
      ageDays: alertAgeDays(a, now),
      link: a.link ?? null,
      dismissed: set.has(a.id),
    }
  })
}

/** Counts per severity, always carrying every level (0 is a real count here). */
export function countBySeverity(rows) {
  const out = Object.fromEntries(SEVERITY_ORDER.map((s) => [s, 0]))
  for (const r of rows || []) out[r.severity] = (out[r.severity] || 0) + 1
  return out
}

function groupCount(rows, key, emptyLabel) {
  const m = new Map()
  for (const r of rows || []) {
    const k = r[key] ?? emptyLabel
    m.set(k, (m.get(k) || 0) + 1)
  }
  return [...m.entries()]
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count || String(a.name).localeCompare(String(b.name)))
}

/** Open alerts per site, most first. Alerts without a site are one honest bucket. */
export function bySite(rows) {
  return groupCount(rows, 'site', NO_SITE)
}

/** Open alerts per type, most first. */
export function byType(rows) {
  return groupCount(rows, 'typeLabel', 'Other')
}

/**
 * Headline KPIs. Severity, age, site and type figures cover OPEN alerts only;
 * the acknowledged rate covers every alert the scan returned.
 */
export function summarizeAlerts(rows, { olderThanDays = DEFAULT_AGE_THRESHOLD } = {}) {
  const all = Array.isArray(rows) ? rows : []
  const open = all.filter((r) => !r.dismissed)
  const acknowledged = all.length - open.length
  const aged = open.filter((r) => r.ageDays != null)
  const olderThan = aged.filter((r) => r.ageDays >= olderThanDays).length
  const oldest = aged.length ? Math.max(...aged.map((r) => r.ageDays)) : null
  const severity = countBySeverity(open)
  const urgent = (severity[SEVERITY.CRITICAL] || 0) + (severity[SEVERITY.HIGH] || 0)
  return {
    total: all.length,
    open: open.length,
    acknowledged,
    ackRate: pct(acknowledged, all.length),
    bySeverity: severity,
    urgent,
    olderThanDays,
    olderThan: aged.length ? olderThan : null,
    agedKnown: aged.length,
    ageCoverage: pct(aged.length, open.length),
    oldestDays: oldest,
    sitesAffected: new Set(open.map((r) => r.site).filter(Boolean)).size,
    bySite: bySite(open),
    byType: byType(open),
  }
}

/**
 * Filter rows.
 * status: 'open' | 'dismissed' | 'all'; severity/type/site: value or 'all';
 * minAgeDays: only alerts with a KNOWN age at or above this (null = no filter).
 */
export function filterAlertRows(rows, {
  status = 'open', severity = 'all', type = 'all', site = 'all', search = '', minAgeDays = null,
} = {}) {
  const q = String(search || '').trim().toLowerCase()
  return (rows || []).filter((r) => {
    if (status === 'open' && r.dismissed) return false
    if (status === 'dismissed' && !r.dismissed) return false
    if (severity !== 'all' && r.severity !== severity) return false
    if (type !== 'all' && r.type !== type) return false
    if (site !== 'all' && (r.site ?? NO_SITE) !== site) return false
    if (minAgeDays != null && (r.ageDays == null || r.ageDays < minAgeDays)) return false
    if (!q) return true
    return [r.title, r.message, r.typeLabel, r.site, r.severity]
      .some((v) => String(v || '').toLowerCase().includes(q))
  })
}

/** Worst first, then oldest condition first, then title. */
export function sortAlertRows(rows) {
  return [...(rows || [])].sort((a, b) => (
    b.rank - a.rank
    || (b.ageDays ?? -1) - (a.ageDays ?? -1)
    || String(a.title).localeCompare(String(b.title))
  ))
}

export const ALERT_EXPORT_COLS = ['severity', 'type', 'title', 'message', 'site', 'since', 'age', 'status']
export const ALERT_EXPORT_HEADERS = ['Severity', 'Type', 'Alert', 'Detail', 'Site', 'Condition since', 'Age (days)', 'Status']

/** Export-ready rows; unknown values read N/A. */
export function alertExportRows(rows) {
  return (rows || []).map((r) => ({
    severity: r.severity,
    type: r.typeLabel,
    title: r.title,
    message: r.message,
    site: r.site ?? 'N/A',
    since: r.since ? String(r.since).slice(0, 10) : 'N/A',
    age: r.ageDays == null ? 'N/A' : r.ageDays,
    status: r.dismissed ? 'Dismissed' : 'Open',
  }))
}
