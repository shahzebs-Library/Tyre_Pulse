/**
 * reportCenterAnalytics - pure engine behind the Report Center delivery log.
 *
 * report_send_log rows are written by the scheduled-report edge function with
 * a free-text status. This folds that vocabulary into four buckets, derives the
 * delivery KPIs (a success rate is N/A until something has been sent or
 * failed; pending sends do not count as either), and filters the log.
 * No I/O; `now` is injectable.
 */

const DAY = 86400000

/** 'sent' | 'failed' | 'pending' | 'unknown' */
export function deliveryStatus(r) {
  const s = String(r?.status || '').trim().toLowerCase()
  if (s === 'sent' || s === 'success' || s === 'delivered' || s === 'ok') return 'sent'
  if (s === 'failed' || s === 'error' || s === 'bounced') return 'failed'
  if (s === 'pending' || s === 'queued' || s === 'sending') return 'pending'
  return 'unknown'
}

export const DELIVERY_STATUS_LABEL = {
  sent: 'Sent', failed: 'Failed', pending: 'Pending', unknown: 'Unknown',
}

export function recipientCount(r) {
  return Array.isArray(r?.recipients) ? r.recipients.length : null
}

function ts(v) {
  if (!v) return null
  const t = new Date(v).getTime()
  return Number.isFinite(t) ? t : null
}

export function summarizeDeliveryLog(rows, now = Date.now()) {
  const list = Array.isArray(rows) ? rows : []
  const counts = { sent: 0, failed: 0, pending: 0, unknown: 0 }
  const types = new Map()
  let recipients = 0
  let recipientRows = 0
  let lastSent = null
  let lastFailed = null
  let last7 = 0
  for (const r of list) {
    const st = deliveryStatus(r)
    counts[st] += 1
    const key = r?.report_type || 'unspecified'
    const e = types.get(key) || { key, total: 0, sent: 0, failed: 0 }
    e.total += 1
    if (st === 'sent') e.sent += 1
    if (st === 'failed') e.failed += 1
    types.set(key, e)
    const n = recipientCount(r)
    if (n != null) { recipients += n; recipientRows += 1 }
    const t = ts(r?.sent_at)
    if (t != null) {
      if (st === 'sent' && (lastSent == null || t > lastSent)) lastSent = t
      if (st === 'failed' && (lastFailed == null || t > lastFailed)) lastFailed = t
      if (t <= now && t >= now - 7 * DAY) last7 += 1
    }
  }
  const decided = counts.sent + counts.failed
  return {
    total: list.length,
    counts,
    successRate: decided ? Math.round((counts.sent / decided) * 1000) / 10 : null,
    recipients: recipientRows ? recipients : null,
    lastSent: lastSent == null ? null : new Date(lastSent).toISOString(),
    lastFailed: lastFailed == null ? null : new Date(lastFailed).toISOString(),
    last7,
    byType: [...types.values()].sort((a, b) => b.total - a.total || a.key.localeCompare(b.key)),
  }
}

export function filterDeliveryLog(rows, f = {}) {
  const list = Array.isArray(rows) ? rows : []
  const q = String(f.search || '').trim().toLowerCase()
  return list.filter(r => {
    if (f.status && deliveryStatus(r) !== f.status) return false
    if (f.type && (r.report_type || 'unspecified') !== f.type) return false
    if (q) {
      const hay = `${r.schedule_name || ''} ${r.report_type || ''} ${(Array.isArray(r.recipients) ? r.recipients.join(' ') : '')}`.toLowerCase()
      if (!hay.includes(q)) return false
    }
    return true
  })
}
