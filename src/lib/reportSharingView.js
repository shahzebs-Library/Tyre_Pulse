/**
 * reportSharingView - pure shaping for the Report Sharing page
 * (src/pages/ReportSharing.jsx). No I/O, no clock reads: pass `now`.
 *
 * Works on rows enriched by reportSharingAnalytics.enrichShares (status,
 * views, boards, custom, daysSinceView, daysToExpiry). Every share is a
 * read-only public link that needs no login, so "channel" and "access" are
 * facts of the product, not stored per row. Nothing here is invented:
 * per-day view history, viewer identity, IP restriction, watermarking and
 * download control are not recorded, and the helpers say so.
 */

export const BOARD_TYPES = Object.freeze([
  { key: 'all', label: 'All report types' },
  { key: 'custom', label: 'Custom boards' },
  { key: 'fixed', label: 'Fixed report pages' },
])

export const EXPIRY_FILTERS = Object.freeze([
  { key: 'all', label: 'Any expiry' },
  { key: 'set', label: 'Has an expiry date' },
  { key: 'none', label: 'No expiry date' },
])

export const STATUS_TONE = Object.freeze({
  active: 'good', expiring: 'warn', stale: 'warn', expired: 'bad', revoked: 'muted',
})

export const STATUS_COLOR = Object.freeze({
  active: 'var(--cc-green)', expiring: 'var(--cc-amber)', stale: 'var(--cc-orange)',
  expired: 'var(--cc-red)', revoked: 'var(--cc-ink-3)',
})

/** Workshop TV shares are report_shares rows tagged with this page key. */
export const WORKSHOP_PAGE_KEY = 'workshop_live'

/**
 * Channel a share is opened on. Every share is a token link that needs no
 * login; what differs is the board behind it: a workshop live board, a custom
 * designed (one-screen) TV board, or fixed report pages on a public link.
 */
export const CHANNEL_META = Object.freeze({
  link: { label: 'Public link', color: 'var(--cc-blue)' },
  tv: { label: 'TV board', color: 'var(--cc-purple)' },
  workshop: { label: 'Workshop TV', color: 'var(--cc-orange)' },
})
export const CHANNELS = Object.freeze([
  { key: 'all', label: 'All channels' },
  ...Object.entries(CHANNEL_META).map(([key, m]) => ({ key, label: m.label })),
])
/** Every shared board is read only; there is no edit access level to grant. */
export const ACCESS_LEVELS = Object.freeze([
  { key: 'all', label: 'All access levels' },
  { key: 'view', label: 'View only' },
  { key: 'edit', label: 'Edit access' },
])

export function channelOf(row) {
  if (!row) return 'link'
  const pages = Array.isArray(row.pages) ? row.pages : []
  if (pages.includes(WORKSHOP_PAGE_KEY)) return 'workshop'
  if (row.custom) return 'tv'
  return 'link'
}

/** Live (not expired, not revoked) links per channel. */
export function channelCounts(rows) {
  const out = { link: 0, tv: 0, workshop: 0 }
  for (const r of Array.isArray(rows) ? rows : []) {
    if (r.status === 'expired' || r.status === 'revoked') continue
    out[channelOf(r)] += 1
  }
  return out
}

/** Donut segments: total views split by channel. Only channels with views. */
export function viewsByChannel(rows) {
  const totals = {}
  for (const r of Array.isArray(rows) ? rows : []) {
    if (r.views == null) continue
    const c = channelOf(r)
    totals[c] = (totals[c] || 0) + r.views
  }
  return Object.entries(totals)
    .filter(([, v]) => v > 0)
    .map(([k, v]) => ({ key: k, label: CHANNEL_META[k].label, count: v, color: CHANNEL_META[k].color }))
    .sort((a, b) => b.count - a.count)
}

/** Filter enriched rows by search, status, board type, channel, access and expiry. */
export function filterShareRows(rows, { search = '', status = 'all', type = 'all', expiry = 'all', channel = 'all', access = 'all', pageLabels = {} } = {}) {
  const q = String(search || '').trim().toLowerCase()
  return (Array.isArray(rows) ? rows : []).filter((r) => {
    if (access === 'edit') return false
    if (channel !== 'all' && channelOf(r) !== channel) return false
    if (status !== 'all' && r.status !== status) return false
    if (type === 'custom' && !r.custom) return false
    if (type === 'fixed' && r.custom) return false
    if (expiry === 'set' && !r.expires_at) return false
    if (expiry === 'none' && r.expires_at) return false
    if (!q) return true
    const pages = (Array.isArray(r.pages) ? r.pages : []).map((p) => pageLabels[p] || p)
    return [r.name, ...pages].join(' ').toLowerCase().includes(q)
  })
}

/** KPI tile values from the share summary. Unknowns are null, never 0. */
export function shareKpis(summary, rows = []) {
  const s = summary || {}
  const list = Array.isArray(rows) ? rows : []
  return {
    live: s.live ?? null,
    totalViews: s.totalViews ?? null,
    boards: s.boards ?? null,
    customDesigned: s.customDesigned ?? null,
    expiring: s.expiring ?? null,
    expired: s.expired ?? null,
    stale: s.stale ?? null,
    noExpiry: s.noExpiry ?? null,
    viewedLinks: list.filter((r) => r.views != null && r.views > 0).length,
  }
}

const toTime = (v) => {
  if (v == null || v === '') return null
  const t = v instanceof Date ? v.getTime() : Date.parse(v)
  return Number.isFinite(t) ? t : null
}

export function dayLabel(v) {
  const t = toTime(v)
  if (t == null) return null
  return new Date(t).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC' })
}

/** Expiry cell: date plus days left, or "Never". */
export function expiryText(row) {
  if (!row?.expires_at) return { text: 'Never', sub: 'No expiry date', tone: 'muted' }
  const d = row.daysToExpiry
  const text = dayLabel(row.expires_at) || 'N/A'
  if (d == null) return { text, sub: null, tone: 'muted' }
  if (d <= 0) return { text, sub: 'Expired', tone: 'bad' }
  return { text, sub: `${d} day${d === 1 ? '' : 's'} left`, tone: d <= 7 ? 'bad' : 'muted' }
}

/** "just now" / "18 min ago" / "3 h ago" / "4 days ago"; null when unknown. */
export function relativeAgo(iso, now) {
  const t = toTime(iso)
  const n = toTime(now)
  if (t == null || n == null) return null
  const s = Math.max(0, Math.round((n - t) / 1000))
  if (s < 60) return 'just now'
  const m = Math.round(s / 60)
  if (m < 60) return `${m} min ago`
  const h = Math.round(m / 60)
  if (h < 48) return `${h} h ago`
  const d = Math.round(h / 24)
  return `${d} day${d === 1 ? '' : 's'} ago`
}

/** Most viewed links for the access chart; links without a view count are left out. */
export function viewsByLink(rows, limit = 8) {
  return (Array.isArray(rows) ? rows : [])
    .filter((r) => r.views != null)
    .map((r) => ({ id: r.id, label: r.name || 'Shared report', views: r.views }))
    .sort((a, b) => b.views - a.views)
    .slice(0, limit)
}

/** Donut segments: total views split by link status. Only statuses with views. */
export function viewsByStatus(rows, statusMeta = {}) {
  const totals = {}
  for (const r of Array.isArray(rows) ? rows : []) {
    if (r.views == null) continue
    totals[r.status] = (totals[r.status] || 0) + r.views
  }
  return Object.entries(totals)
    .filter(([, v]) => v > 0)
    .map(([k, v]) => ({ key: k, label: statusMeta[k]?.label || k, count: v, color: STATUS_COLOR[k] || 'var(--cc-blue)' }))
    .sort((a, b) => b.count - a.count)
}

/** Readable list of what a share rotates through. */
export function boardList(row, pageLabels = {}) {
  if (!row) return []
  if (row.custom && Array.isArray(row.layout?.boards)) {
    return row.layout.boards.map((b, i) => b?.title || b?.name || `Custom board ${i + 1}`)
  }
  return (Array.isArray(row.pages) ? row.pages : []).map((p) => pageLabels[p] || p)
}

/** Detail rows for the selected-share side panel. */
export function shareDetail(row, { now, pageLabels = {} } = {}) {
  if (!row) return null
  const exp = expiryText(row)
  const rotate = row.rotate_seconds == null ? 'N/A' : `${row.rotate_seconds} s per board`
  const refresh = row.refresh_seconds == null ? 'N/A' : `${Math.round(Number(row.refresh_seconds) / 60)} min`
  return {
    title: row.name || 'Shared report',
    subtitle: row.custom
      ? `${row.boards} custom board${row.boards === 1 ? '' : 's'}`
      : `${row.boards} report page${row.boards === 1 ? '' : 's'}`,
    boards: boardList(row, pageLabels),
    created: dayLabel(row.created_at) || 'N/A',
    expires: row.expires_at ? `${exp.text}${exp.sub ? ` (${exp.sub})` : ''}` : 'Never',
    views: row.views == null ? 'N/A' : row.views,
    lastViewed: row.last_viewed_at ? (relativeAgo(row.last_viewed_at, now) || dayLabel(row.last_viewed_at)) : 'Never viewed',
    timing: `${rotate}, data refresh every ${refresh}`,
  }
}
