/**
 * platformIncidents.js - pure engine for platform incident management
 * (/console/incidents). No I/O: every function takes rows and an explicit `now`
 * so the maths is deterministic and testable.
 *
 * HONESTY RULE: anything that cannot be measured is null, never 0. An MTTR with
 * no resolved incident is "not measurable", not "instant"; an open incident has
 * no duration. Zero is only returned when it is a real count.
 *
 * The status machine MIRRORS public.incident_status_allowed() in
 * supabase/migrations/20260924115000_platform_incidents.sql - change both.
 */

export const SEVERITIES = ['sev1', 'sev2', 'sev3', 'sev4']
export const STATUSES = ['investigating', 'identified', 'monitoring', 'resolved']

export const SEVERITY_LABEL = {
  sev1: 'SEV1 Critical',
  sev2: 'SEV2 Major',
  sev3: 'SEV3 Minor',
  sev4: 'SEV4 Low',
}

export const SEVERITY_HELP = {
  sev1: 'Platform down or data at risk for every customer.',
  sev2: 'A core module is broken or badly degraded.',
  sev3: 'A feature is impaired, a workaround exists.',
  sev4: 'Cosmetic or low impact.',
}

/**
 * Where an incident came from. MIRRORS the platform_incidents_source_type_check
 * CHECK (supabase/migrations/20260924119000_sentry_incident_signal.sql) - change
 * both. 'sentry' incidents are opened automatically by a trigger when a new
 * fatal Sentry issue is logged (system_config.sentry_auto_incidents).
 */
export const SOURCE_TYPES = ['system_log', 'trust_alert', 'security_scan', 'crash', 'manual', 'sentry']

export const SOURCE_LABEL = {
  system_log: 'System log',
  trust_alert: 'Trust alert',
  security_scan: 'Security scan',
  crash: 'Crash',
  manual: 'Manual',
  sentry: 'Sentry (automatic)',
}

export function sourceLabel(sourceType) {
  if (!sourceType) return 'Manual'
  return SOURCE_LABEL[sourceType] || String(sourceType).replace(/_/g, ' ')
}

/** True when the incident was opened by the system rather than a person. */
export const isAutomatic = (i) => !!i && i.source_type === 'sentry' && !i.created_by

export const STATUS_LABEL = {
  investigating: 'Investigating',
  identified: 'Identified',
  monitoring: 'Monitoring',
  resolved: 'Resolved',
}

/** Allowed moves out of each status (the same status is always allowed: a progress note). */
export const NEXT_STATUS = {
  investigating: ['identified', 'monitoring', 'resolved'],
  identified: ['investigating', 'monitoring', 'resolved'],
  monitoring: ['investigating', 'identified', 'resolved'],
  resolved: ['investigating'],
}

export function canTransition(from, to) {
  if (!STATUSES.includes(from) || !STATUSES.includes(to)) return false
  return from === to || NEXT_STATUS[from].includes(to)
}

/** The statuses a new update may carry, current status first. */
export function allowedNext(from) {
  if (!STATUSES.includes(from)) return []
  return [from, ...NEXT_STATUS[from]]
}

export const isOpen = (i) => !!i && i.status !== 'resolved'

function toMs(v) {
  if (v === null || v === undefined || v === '') return null
  const t = v instanceof Date ? v.getTime() : Date.parse(v)
  return Number.isFinite(t) ? t : null
}

/** Minutes from a to b, or null when either end is missing or b precedes a. */
export function durationMinutes(a, b) {
  const s = toMs(a)
  const e = toMs(b)
  if (s === null || e === null || e < s) return null
  return (e - s) / 60000
}

function mean(values) {
  const v = values.filter((x) => x !== null && Number.isFinite(x))
  if (!v.length) return null
  return v.reduce((s, x) => s + x, 0) / v.length
}

function inWindow(i, sinceMs) {
  if (sinceMs === null) return true
  const t = toMs(i?.started_at)
  return t !== null && t >= sinceMs
}

function sinceMsFor(days, now) {
  if (days === null || days === undefined) return null
  return toMs(now) - days * 86400000
}

/** Mean time to acknowledge, minutes. null when nothing was acknowledged. */
export function mtta(incidents = [], { days = null, now = new Date() } = {}) {
  const since = sinceMsFor(days, now)
  return mean(incidents.filter((i) => inWindow(i, since)).map((i) => durationMinutes(i.started_at, i.acknowledged_at)))
}

/** Mean time to resolve, minutes. Open incidents are excluded, never counted as 0. */
export function mttr(incidents = [], { days = null, now = new Date() } = {}) {
  const since = sinceMsFor(days, now)
  return mean(incidents
    .filter((i) => inWindow(i, since) && i.status === 'resolved')
    .map((i) => durationMinutes(i.started_at, i.resolved_at)))
}

export function openBySeverity(incidents = []) {
  const out = { sev1: 0, sev2: 0, sev3: 0, sev4: 0 }
  for (const i of incidents) if (isOpen(i) && out[i.severity] !== undefined) out[i.severity] += 1
  return out
}

export function countSince(incidents = [], days = 90, now = new Date()) {
  const since = sinceMsFor(days, now)
  return incidents.filter((i) => inWindow(i, since)).length
}

/**
 * Current platform status from the open incidents:
 *   any open sev1       -> outage
 *   any open sev2/sev3  -> degraded
 *   otherwise           -> operational (an open sev4 is noted, not escalated)
 */
export function platformStatus(incidents = []) {
  const open = openBySeverity(incidents)
  const openTotal = open.sev1 + open.sev2 + open.sev3 + open.sev4
  if (open.sev1 > 0) {
    return { level: 'outage', label: 'Major outage', open: openTotal, detail: `${open.sev1} critical incident${open.sev1 === 1 ? '' : 's'} open.` }
  }
  if (open.sev2 + open.sev3 > 0) {
    const n = open.sev2 + open.sev3
    return { level: 'degraded', label: 'Degraded performance', open: openTotal, detail: `${n} incident${n === 1 ? '' : 's'} affecting service.` }
  }
  return {
    level: 'operational',
    label: 'All systems operational',
    open: openTotal,
    detail: open.sev4 ? `${open.sev4} low-impact incident${open.sev4 === 1 ? '' : 's'} being tracked.` : 'No open incidents.',
  }
}

function weekStart(ms) {
  const d = new Date(ms)
  d.setUTCHours(0, 0, 0, 0)
  const dow = (d.getUTCDay() + 6) % 7 // Monday = 0
  d.setUTCDate(d.getUTCDate() - dow)
  return d.getTime()
}

/** Incidents started per ISO week (Monday, UTC), zero-filled, oldest first. */
export function weeklyCounts(incidents = [], weeks = 12, now = new Date()) {
  const last = weekStart(toMs(now))
  const starts = []
  for (let k = weeks - 1; k >= 0; k -= 1) starts.push(last - k * 7 * 86400000)
  const values = starts.map(() => 0)
  for (const i of incidents) {
    const t = toMs(i?.started_at)
    if (t === null) continue
    const idx = starts.indexOf(weekStart(t))
    if (idx >= 0) values[idx] += 1
  }
  const labels = starts.map((s) => {
    const d = new Date(s)
    return `${String(d.getUTCDate()).padStart(2, '0')} ${d.toLocaleString('en-GB', { month: 'short', timeZone: 'UTC' })}`
  })
  return { labels, values }
}

/**
 * The update timeline, oldest first, each entry carrying whether it changed the
 * status and the minutes since the previous entry (null for the first).
 */
export function shapeTimeline(incident) {
  const ups = [...(incident?.updates || [])]
    .filter((u) => toMs(u?.created_at) !== null)
    .sort((a, b) => toMs(a.created_at) - toMs(b.created_at))
  let prevStatus = null
  let prevAt = null
  return ups.map((u) => {
    const entry = {
      ...u,
      statusChanged: prevStatus !== null && u.status !== prevStatus,
      opened: prevStatus === null,
      sincePrevMin: prevAt === null ? null : durationMinutes(prevAt, u.created_at),
    }
    prevStatus = u.status
    prevAt = u.created_at
    return entry
  })
}

/** "N/A", "45m", "3h 20m", "2d 4h". */
export function formatDuration(minutes) {
  if (minutes === null || minutes === undefined || !Number.isFinite(minutes)) return 'N/A'
  const m = Math.round(minutes)
  if (m < 60) return `${m}m`
  const h = Math.floor(m / 60)
  if (h < 48) return `${h}h ${m % 60}m`
  return `${Math.floor(h / 24)}d ${h % 24}h`
}

/** Sort: open first, then by severity, then newest. */
export function sortIncidents(incidents = []) {
  return [...incidents].sort((a, b) => {
    if (isOpen(a) !== isOpen(b)) return isOpen(a) ? -1 : 1
    const s = SEVERITIES.indexOf(a.severity) - SEVERITIES.indexOf(b.severity)
    if (s) return s
    return (toMs(b.started_at) || 0) - (toMs(a.started_at) || 0)
  })
}

/** Prefill for the open-incident form from a signal row. */
export function draftFromSignal(kind, row = {}) {
  if (kind === 'system_log') {
    const critical = String(row.severity || '').toLowerCase() === 'critical'
    return {
      title: String(row.message || 'Platform error').slice(0, 200),
      severity: critical ? 'sev2' : 'sev3',
      impact: row.module_id ? `Errors reported from ${row.module_id}.` : '',
      affected_modules: row.module_id ? [row.module_id] : [],
      source_type: 'system_log',
      source_ref: row.id ? String(row.id) : null,
    }
  }
  if (kind === 'trust_alert') {
    const high = ['critical', 'high'].includes(String(row.severity || '').toLowerCase())
    return {
      title: String(row.message || `Data trust alert: ${row.ref_key || row.source || ''}`).slice(0, 200),
      severity: high ? 'sev2' : 'sev3',
      impact: row.country ? `Data trust issue in ${row.country}.` : 'Data trust issue.',
      affected_modules: row.source ? [String(row.source)] : [],
      source_type: 'trust_alert',
      source_ref: row.id !== undefined && row.id !== null ? String(row.id) : null,
    }
  }
  return { title: '', severity: 'sev3', impact: '', affected_modules: [], source_type: 'manual', source_ref: null }
}

export const EXPORT_COLUMNS = ['title', 'severity', 'status', 'started_at', 'acknowledged_at', 'resolved_at',
  'time_to_ack', 'time_to_resolve', 'commander', 'affected', 'impact', 'updates']
export const EXPORT_HEADERS = ['Title', 'Severity', 'Status', 'Started', 'Acknowledged', 'Resolved',
  'Time to acknowledge', 'Time to resolve', 'Commander', 'Affected modules', 'Impact', 'Updates']

export function exportRows(incidents = []) {
  return sortIncidents(incidents).map((i) => ({
    title: i.title,
    severity: SEVERITY_LABEL[i.severity] || i.severity,
    status: STATUS_LABEL[i.status] || i.status,
    started_at: i.started_at || 'N/A',
    acknowledged_at: i.acknowledged_at || 'N/A',
    resolved_at: i.resolved_at || 'N/A',
    time_to_ack: formatDuration(durationMinutes(i.started_at, i.acknowledged_at)),
    time_to_resolve: i.status === 'resolved' ? formatDuration(durationMinutes(i.started_at, i.resolved_at)) : 'N/A',
    commander: i.commander_name || 'N/A',
    affected: (i.affected_modules || []).join(', ') || 'N/A',
    impact: i.impact || 'N/A',
    updates: (i.updates || []).length,
  }))
}
