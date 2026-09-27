/**
 * scheduledReportsAnalytics - pure helpers behind the Scheduled Reports page:
 * schedule filtering, the KPI strip, delivery-history shaping and export rows.
 * No I/O; anything time-relative takes an explicit `now` (epoch ms or Date).
 *
 * HONEST NULLS: a delivery success rate with no deliveries is null (N/A), not
 * 0% (which reads as "every report failed") or 100%.
 */

const ms = (now) => (now instanceof Date ? now.getTime() : Number(now))

/** Frequency / status / name filter over schedules. */
export function filterSchedules(schedules = [], { search = '', frequency = 'all', status = 'all', typeLabelFor = null } = {}) {
  const q = String(search || '').trim().toLowerCase()
  return schedules.filter((s) => {
    if (frequency !== 'all' && s.frequency !== frequency) return false
    if (status === 'active' && !s.active) return false
    if (status === 'inactive' && s.active) return false
    if (q) {
      const hay = [s.name, s.report_type, typeLabelFor ? typeLabelFor(s.report_type) : null, ...(s.recipients || [])]
        .map((v) => String(v ?? '').toLowerCase())
      if (!hay.some((v) => v.includes(q))) return false
    }
    return true
  })
}

/** Recipient count for a report_send_log row (recipients stored as a jsonb array). */
export function recipientCountOf(row) {
  const r = row?.recipients
  return Array.isArray(r) ? r.length : 0
}

/** Trim an internal delivery error to a short, admin-safe reason. */
export function shortReason(text, max = 120) {
  const s = String(text || '').replace(/\s+/g, ' ').trim()
  if (!s) return ''
  return s.length > max ? `${s.slice(0, max - 3)}...` : s
}

/** Split + validate a newline-separated recipient list. */
export function validateEmails(raw = '') {
  const lines = String(raw).split('\n').map((l) => l.trim()).filter(Boolean)
  const re = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
  return { emails: lines, invalid: lines.filter((e) => !re.test(e)) }
}

/** Soonest upcoming next_run_at among ACTIVE schedules; null when none is scheduled. */
export function nextScheduledRun(schedules = []) {
  let best = null
  for (const s of schedules) {
    if (!s.active || !s.next_run_at) continue
    const t = new Date(s.next_run_at).getTime()
    if (!Number.isFinite(t)) continue
    if (best === null || t < best.t) best = { t, schedule: s }
  }
  return best ? { at: new Date(best.t).toISOString(), name: best.schedule.name || null } : null
}

/**
 * Relative label for a next run: 'due' | 'today' | 'tomorrow' | 'later',
 * plus the parsed Date. Null for a blank or unparseable timestamp.
 */
export function nextRunBucket(nextRunAt, now) {
  if (!nextRunAt) return null
  const d = new Date(nextRunAt)
  if (Number.isNaN(d.getTime())) return null
  const diff = d.getTime() - ms(now)
  if (diff < 0) return { bucket: 'due', date: d }
  if (diff < 24 * 3600_000) return { bucket: 'today', date: d }
  if (diff < 48 * 3600_000) return { bucket: 'tomorrow', date: d }
  return { bucket: 'later', date: d }
}

/** KPI strip over schedules + the delivery summary. */
export function scheduleKpis(schedules = [], runs = []) {
  const active = schedules.filter((s) => s.active).length
  const sent = runs.filter((r) => r.status === 'sent').length
  const failed = runs.filter((r) => r.status && r.status !== 'sent').length
  const total = sent + failed
  // A schedule whose MOST RECENT delivery failed is "failing".
  const latest = new Map()
  for (const r of runs) {
    if (!r.schedule_id) continue
    const cur = latest.get(r.schedule_id)
    if (!cur || String(r.sent_at) > String(cur.sent_at)) latest.set(r.schedule_id, r)
  }
  const failing = [...latest.values()].filter((r) => r.status !== 'sent').length
  const recipients = new Set()
  for (const s of schedules) if (s.active) for (const e of s.recipients || []) recipients.add(String(e).toLowerCase())
  return {
    total: schedules.length,
    active,
    paused: schedules.length - active,
    deliveries: total,
    sent,
    failed,
    successRate: total ? Math.round((sent / total) * 1000) / 10 : null,
    failingSchedules: failing,
    uniqueRecipients: recipients.size,
    nextRun: nextScheduledRun(schedules),
  }
}

/** Count of schedules per report type, most common first. */
export function typeBreakdown(schedules = [], labelFor = (t) => t) {
  const map = new Map()
  for (const s of schedules) map.set(s.report_type, (map.get(s.report_type) || 0) + 1)
  return [...map.entries()].map(([type, count]) => ({ type, label: labelFor(type), count }))
    .sort((a, b) => b.count - a.count || String(a.label).localeCompare(String(b.label)))
}

/** Flat delivery rows (history table + export). */
export function deliveryRows(runs = []) {
  return runs.map((r) => ({
    id: r.id,
    schedule: r.schedule_name || 'Unnamed schedule',
    sent_at: r.sent_at || null,
    status: r.status === 'sent' ? 'Sent' : r.status ? 'Failed' : 'Unknown',
    recipients: recipientCountOf(r),
    reason: r.status === 'sent' ? 'N/A' : (shortReason(r.error) || 'No reason recorded'),
    raw: r,
  }))
}

/** Flat schedule rows for Excel/PDF export. */
export function scheduleExportRows(schedules = [], { typeLabelFor = (t) => t, health = new Map() } = {}) {
  return schedules.map((s) => {
    const h = health.get?.(s.id)
    return {
      name: s.name || 'Unnamed schedule',
      type: typeLabelFor(s.report_type),
      frequency: s.frequency || 'N/A',
      status: s.active ? 'Active' : 'Paused',
      formats: (s.output_formats || []).join(', ') || 'N/A',
      recipients: (s.recipients || []).length,
      next_run: s.active && s.next_run_at ? s.next_run_at : 'N/A',
      last_sent: s.last_sent_at || 'Never',
      last_delivery: h ? (h.lastStatus === 'sent' ? 'Sent' : 'Failed') : 'No deliveries',
    }
  })
}

export const SCHEDULE_EXPORT_KEYS = ['name', 'type', 'frequency', 'status', 'formats', 'recipients', 'next_run', 'last_sent', 'last_delivery']
export const SCHEDULE_EXPORT_HEADERS = ['Schedule', 'Report Type', 'Frequency', 'Status', 'Formats', 'Recipients', 'Next Run', 'Last Sent', 'Last Delivery']
