/**
 * accidentCaseTimelineAnalytics - pure engine behind the accident case
 * timeline page (src/pages/AccidentCaseTimeline.jsx, /accidents/:id/timeline).
 *
 * The feed itself is composed by src/lib/caseTimelineFeed.js (which table backs
 * which entry). This module only summarises, filters and flattens that feed for
 * the KPI strip, the search boxes and the exports, so the page carries no
 * inline arithmetic. No I/O; the clock is injected.
 *
 * Honesty rules:
 *  - a figure with nothing to measure is null (rendered N/A), never 0 made up;
 *  - "case age" runs to the last recorded entry, never to an invented close;
 *  - notification status labels come from deliveryStatusLabel, so a row is never
 *    reported as "Delivered n/n" unless per-recipient delivery was recorded.
 */
import {
  FILTERS, durationLabel, recipientsLabel, deliveryStatusLabel, channelLabel,
} from './caseTimelineFeed'

const CATEGORY_LABEL = Object.fromEntries(FILTERS.map((f) => [f.key, f.label]))
export const STATUS_LABEL = { completed: 'Completed', in_progress: 'In transit', pending: 'Pending' }

const ts = (v) => {
  const t = v ? new Date(v).getTime() : NaN
  return Number.isFinite(t) ? t : null
}
const lower = (v) => String(v ?? '').toLowerCase()

/** Category label for an entry key ('actions' -> 'Actions'), or 'Not set'. */
export const categoryLabel = (key) => CATEGORY_LABEL[key] || 'Not set'

/** Notifications newest first; rows with no time sort last. */
export function sortNotifications(rows = []) {
  return [...(rows || [])].sort((a, b) => (ts(b?.occurred_at) ?? -Infinity) - (ts(a?.occurred_at) ?? -Infinity))
}

/**
 * KPI figures for the strip above the tabs.
 * @param {{entries?:object[], notifications?:object[], participants?:object[]}} feed
 * @param {number} [now] epoch ms, injected
 */
export function summarizeTimeline(feed = {}, now = Date.now()) {
  const entries = feed.entries || []
  const notifications = feed.notifications || []
  const participants = feed.participants || []

  const byStatus = { completed: 0, in_progress: 0, pending: 0 }
  const byCategory = {}
  let slaMet = 0
  let slaEntries = 0
  for (const e of entries) {
    if (byStatus[e?.status] != null) byStatus[e.status] += 1
    const cat = e?.category || 'other'
    byCategory[cat] = (byCategory[cat] || 0) + 1
    if (cat === 'sla') {
      slaEntries += 1
      if (e.slaMet) slaMet += 1
    }
  }

  const times = entries.map((e) => ts(e?.at)).filter((t) => t != null)
  const first = times.length ? Math.min(...times) : null
  const last = times.length ? Math.max(...times) : null
  const lastNotification = notifications.map((n) => ts(n?.occurred_at)).filter((t) => t != null)
  const lastActivity = [last, ...lastNotification].filter((t) => t != null && t <= now + 60000)
  const lastAt = lastActivity.length ? Math.max(...lastActivity) : null

  return {
    entries: entries.length,
    completed: byStatus.completed,
    inProgress: byStatus.in_progress,
    pending: byStatus.pending,
    byCategory,
    slaEntries,
    slaMet,
    // Share of SLA entries recorded as met; null when the case has none.
    slaMetPct: slaEntries > 0 ? Math.round((slaMet / slaEntries) * 1000) / 10 : null,
    notifications: notifications.length,
    outbound: notifications.filter((n) => n?.direction === 'outbound').length,
    participants: participants.length,
    spanMs: first != null && last != null ? last - first : null,
    spanLabel: first != null && last != null && last > first ? durationLabel(last - first) : null,
    lastActivityAt: lastAt != null ? new Date(lastAt).toISOString() : null,
    sinceLastActivityLabel: lastAt != null ? durationLabel(now - lastAt) : null,
  }
}

/** Timeline entries filtered by category chip and free-text search. */
export function filterEntries(entries = [], { category = 'all', search = '' } = {}) {
  const q = lower(search).trim()
  return (entries || []).filter((e) => {
    if (category !== 'all' && e?.category !== category) return false
    if (!q) return true
    const hay = [e?.title, e?.subtitle, e?.detail, e?.actor, ...(e?.chips || [])].map(lower).join(' ')
    return hay.includes(q)
  })
}

/** Channels present in the notification log (for the channel filter). */
export function notificationChannels(rows = []) {
  return [...new Set((rows || []).map((n) => n?.channel).filter(Boolean))]
    .map((value) => ({ value, label: channelLabel(value) }))
    .sort((a, b) => a.label.localeCompare(b.label))
}

/** Notifications filtered by channel. */
export function filterNotifications(rows = [], { channel = 'all' } = {}) {
  return (rows || []).filter((n) => channel === 'all' || n?.channel === channel)
}

/** Flat rows for the Notifications table and its export. */
export function notificationRows(rows = [], groupCounts = null, now = Date.now()) {
  return (rows || []).map((n) => ({
    ...n,
    trigger: n?.subject || 'Not set',
    recipients: recipientsLabel(n, groupCounts).label,
    channelText: channelLabel(n?.channel),
    statusText: deliveryStatusLabel(n, now),
    occurredMs: ts(n?.occurred_at),
  }))
}

/** Flat rows for the timeline export. */
export function timelineExportRows(entries = [], fmt = (v) => v || 'N/A') {
  return (entries || []).map((e) => ({
    at: fmt(e?.at),
    category: categoryLabel(e?.category),
    title: e?.title || 'Not set',
    subtitle: e?.subtitle || '',
    detail: [e?.detail, ...(e?.chips || [])].filter(Boolean).join(' | '),
    actor: e?.actor || 'Not set',
    status: (STATUS_LABEL[e?.status] || 'Completed') + (e?.slaMet ? ' (SLA met)' : ''),
    elapsed: durationLabel(e?.durationMs) || 'First entry',
  }))
}

export const TIMELINE_EXPORT_COLS = ['at', 'category', 'title', 'subtitle', 'detail', 'actor', 'status', 'elapsed']
export const TIMELINE_EXPORT_HEADERS = ['When', 'Category', 'Event', 'Subtitle', 'Details', 'Actor', 'Status', 'Elapsed since previous']
