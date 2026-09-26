/**
 * Broadcast (team message) analytics - pure helpers (no I/O, deterministic).
 *
 * Works over `broadcast_messages` rows as returned by src/lib/api/broadcast.js
 * (`title, body, title_ar, body_ar, target_roles, target_countries,
 * target_sites, send_push, status, recipient_count, push_count, sent_at,
 * created_at`).
 *
 * HONESTY: the table records how many people a message was ADDRESSED to and
 * how many pushes were QUEUED. It records no read receipts and no delivery
 * confirmation, so nothing here claims a message was read or delivered.
 * A rate whose denominator is zero is null, never 0.
 *
 * Time-dependent functions take an injectable `now`.
 */

export const BROADCAST_PERIODS = [
  { value: 'all', label: 'All time', days: null },
  { value: '7', label: 'Last 7 days', days: 7 },
  { value: '30', label: 'Last 30 days', days: 30 },
  { value: '90', label: 'Last 90 days', days: 90 },
]

const MS_PER_DAY = 86400000

function toMs(v) {
  if (v == null || v === '') return null
  const t = v instanceof Date ? v.getTime() : new Date(v).getTime()
  return Number.isFinite(t) ? t : null
}

function num(v) {
  if (v == null || v === '') return 0
  const n = Number(v)
  return Number.isFinite(n) ? n : 0
}

function list(v) {
  return Array.isArray(v) ? v.filter(Boolean) : []
}

/** The moment a message went out (sent_at, else created_at), as ms or null. */
export function broadcastTime(m) {
  return toMs(m?.sent_at) ?? toMs(m?.created_at)
}

/** True when the audience was narrowed in any way (otherwise "Everyone"). */
export function isTargeted(m) {
  return list(m?.target_roles).length > 0 || list(m?.target_countries).length > 0 || list(m?.target_sites).length > 0
}

/** True when both Arabic fields were supplied. */
export function hasArabic(m) {
  return !!(String(m?.title_ar || '').trim() && String(m?.body_ar || '').trim())
}

/** Filter the sent-message history. */
export function filterBroadcasts(items, {
  search = '', period = 'all', audience = 'all', push = 'all', now = Date.now(), labelFn = null,
} = {}) {
  const q = String(search || '').trim().toLowerCase()
  const days = BROADCAST_PERIODS.find((p) => p.value === String(period))?.days ?? null
  const nowMs = toMs(now)
  const from = days != null && nowMs != null ? nowMs - days * MS_PER_DAY : null
  return (Array.isArray(items) ? items : []).filter((m) => {
    if (from != null) {
      const t = broadcastTime(m)
      if (t == null || t < from) return false
    }
    if (audience === 'everyone' && isTargeted(m)) return false
    if (audience === 'targeted' && !isTargeted(m)) return false
    if (push === 'push' && num(m?.push_count) === 0) return false
    if (push === 'nopush' && num(m?.push_count) > 0) return false
    if (q) {
      const aud = typeof labelFn === 'function' ? labelFn(m) : ''
      const hay = `${m?.title || ''} ${m?.body || ''} ${m?.title_ar || ''} ${m?.body_ar || ''} ${aud}`.toLowerCase()
      if (!hay.includes(q)) return false
    }
    return true
  })
}

/** Headline KPIs over a (possibly filtered) set of messages. */
export function broadcastKpis(items, now = Date.now()) {
  const rows = Array.isArray(items) ? items : []
  const nowMs = toMs(now)
  let recipients = 0
  let pushes = 0
  let pushRequested = 0
  let arabic = 0
  let targeted = 0
  let last30 = 0
  let lastSent = null
  for (const m of rows) {
    recipients += num(m?.recipient_count)
    pushes += num(m?.push_count)
    if (m?.send_push) pushRequested += 1
    if (hasArabic(m)) arabic += 1
    if (isTargeted(m)) targeted += 1
    const t = broadcastTime(m)
    if (t != null && nowMs != null && t >= nowMs - 30 * MS_PER_DAY && t <= nowMs) last30 += 1
    if (t != null && (lastSent == null || t > lastSent)) lastSent = t
  }
  return {
    messages: rows.length,
    recipients,
    pushes,
    avgRecipients: rows.length ? Math.round((recipients / rows.length) * 10) / 10 : null,
    phoneReachPct: recipients > 0 ? Math.round((pushes / recipients) * 1000) / 10 : null,
    pushRequested,
    arabic,
    arabicPct: rows.length ? Math.round((arabic / rows.length) * 1000) / 10 : null,
    targeted,
    everyone: rows.length - targeted,
    last30Days: last30,
    lastSentAt: lastSent == null ? null : new Date(lastSent).toISOString(),
    daysSinceLast: lastSent == null || nowMs == null ? null : Math.max(0, Math.floor((nowMs - lastSent) / MS_PER_DAY)),
  }
}

/** Count of messages per status value (unknown status is "Unrecorded"). */
export function statusBreakdown(items) {
  const map = new Map()
  for (const m of Array.isArray(items) ? items : []) {
    const k = String(m?.status || '').trim() || 'Unrecorded'
    map.set(k, (map.get(k) || 0) + 1)
  }
  return [...map.entries()].map(([status, count]) => ({ status, count }))
    .sort((a, b) => b.count - a.count || a.status.localeCompare(b.status))
}

/** How often each role / country / site was targeted. */
export function targetBreakdown(items, field = 'target_roles') {
  const map = new Map()
  for (const m of Array.isArray(items) ? items : []) {
    for (const v of list(m?.[field])) map.set(v, (map.get(v) || 0) + 1)
  }
  return [...map.entries()].map(([value, count]) => ({ value, count }))
    .sort((a, b) => b.count - a.count || a.value.localeCompare(b.value))
}

/** Messages + recipients per calendar month (UTC) over the last `months` months. */
export function monthlyVolume(items, now = Date.now(), months = 6) {
  const nowMs = toMs(now)
  if (nowMs == null) return []
  const d = new Date(nowMs)
  const buckets = []
  for (let i = months - 1; i >= 0; i -= 1) {
    const y = d.getUTCFullYear()
    const mo = d.getUTCMonth() - i
    const start = new Date(Date.UTC(y, mo, 1))
    const key = `${start.getUTCFullYear()}-${String(start.getUTCMonth() + 1).padStart(2, '0')}`
    buckets.push({ key, messages: 0, recipients: 0, pushes: 0 })
  }
  const index = new Map(buckets.map((b) => [b.key, b]))
  for (const m of Array.isArray(items) ? items : []) {
    const t = broadcastTime(m)
    if (t == null) continue
    const dt = new Date(t)
    const key = `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, '0')}`
    const b = index.get(key)
    if (!b) continue
    b.messages += 1
    b.recipients += num(m?.recipient_count)
    b.pushes += num(m?.push_count)
  }
  return buckets
}

/** Export-ready rows. `labelFn` renders the audience (injected, keeps this pure). */
export function broadcastExportRows(items, labelFn = null) {
  return (Array.isArray(items) ? items : []).map((m) => {
    const t = broadcastTime(m)
    return {
      sent: t == null ? 'N/A' : new Date(t).toISOString().slice(0, 16).replace('T', ' '),
      title: m?.title || 'N/A',
      body: m?.body || 'N/A',
      audience: typeof labelFn === 'function' ? labelFn(m) : (isTargeted(m) ? 'Targeted' : 'Everyone'),
      recipients: num(m?.recipient_count),
      pushes: num(m?.push_count),
      arabic: hasArabic(m) ? 'Yes' : 'No',
      status: m?.status || 'N/A',
    }
  })
}
