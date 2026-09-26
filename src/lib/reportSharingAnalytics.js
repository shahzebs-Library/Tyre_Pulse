/**
 * reportSharingAnalytics - pure, unit-testable health analytics for public /
 * TV report share links (report_shares, V251). NO I/O, NO Supabase, NO clock:
 * every time-dependent function takes an injectable `now`.
 *
 * Reads only the columns reportShares.listReportShares() returns:
 *   id, name, token, pages, layout, rotate_seconds, refresh_seconds, active,
 *   expires_at, created_at, last_viewed_at, view_count
 *
 * Honesty rules:
 *  - listReportShares() returns ACTIVE rows only, so a revoked count cannot be
 *    measured from it. Pass `includesRevoked: true` only when the caller really
 *    read revoked rows; otherwise `revoked` is null (unknown), never 0.
 *  - A share with no numeric view_count contributes nothing to views; when no
 *    row carries a number, totalViews is null.
 *  - Averages with an empty denominator are null.
 */

export const DAY_MS = 86400000
export const STALE_DAYS = 30
export const EXPIRING_DAYS = 7

export const LINK_STATUSES = ['active', 'expiring', 'stale', 'expired', 'revoked']
export const STATUS_META = {
  active:   { label: 'Active',          tone: 'good' },
  expiring: { label: 'Expiring soon',   tone: 'warning' },
  stale:    { label: 'Not viewed 30d',  tone: 'warning' },
  expired:  { label: 'Expired',         tone: 'danger' },
  revoked:  { label: 'Revoked',         tone: 'quiet' },
}

const toTime = (v) => {
  if (v == null || v === '') return null
  const t = v instanceof Date ? v.getTime() : Date.parse(v)
  return Number.isFinite(t) ? t : null
}
const nowMs = (now) => {
  const t = toTime(now ?? new Date())
  return t == null ? Date.now() : t
}
const numOrNull = (v) => {
  if (v == null || v === '') return null
  const n = typeof v === 'number' ? v : Number(v)
  return Number.isFinite(n) ? n : null
}

/** Whole days from `from` to `to` (floored); null when either is unknown. */
export function daysBetween(from, to) {
  const a = toTime(from), b = toTime(to)
  if (a == null || b == null) return null
  return Math.floor((b - a) / DAY_MS)
}

function hasCustomBoards(layout) {
  return !!(layout && Array.isArray(layout.boards) && layout.boards.length > 0)
}

/** Rotating views a share carries: custom boards when designed, else fixed pages. */
export function boardCountOf(row) {
  if (hasCustomBoards(row?.layout)) return row.layout.boards.length
  return Array.isArray(row?.pages) ? row.pages.length : 0
}

/**
 * Classify one share. Precedence: revoked > expired > expiring > stale > active.
 * Stale = never viewed and created 30+ days ago, or last viewed 30+ days ago.
 */
export function linkStatus(row, { now, staleDays = STALE_DAYS, expiringDays = EXPIRING_DAYS } = {}) {
  const t = nowMs(now)
  if (row?.active === false) return 'revoked'
  const exp = toTime(row?.expires_at)
  if (exp != null && exp <= t) return 'expired'
  if (exp != null && exp - t <= expiringDays * DAY_MS) return 'expiring'
  const last = toTime(row?.last_viewed_at)
  const created = toTime(row?.created_at)
  const ref = last ?? created
  if (ref != null && t - ref >= staleDays * DAY_MS) return 'stale'
  return 'active'
}

/** Enrich rows with status + derived ages; never mutates the input. */
export function enrichShares(rows, opts = {}) {
  const t = nowMs(opts.now)
  return (Array.isArray(rows) ? rows : []).map((r) => {
    const status = linkStatus(r, { ...opts, now: t })
    const views = numOrNull(r?.view_count)
    const lastViewed = r?.last_viewed_at || null
    const exp = toTime(r?.expires_at)
    return {
      ...r,
      status,
      statusLabel: STATUS_META[status].label,
      views,
      boards: boardCountOf(r),
      custom: hasCustomBoards(r?.layout),
      daysSinceView: lastViewed ? daysBetween(lastViewed, t) : null,
      ageDays: daysBetween(r?.created_at, t),
      daysToExpiry: exp == null ? null : Math.ceil((exp - t) / DAY_MS),
    }
  })
}

/**
 * Portfolio KPIs.
 * @param {object[]} rows
 * @param {{now?:any, includesRevoked?:boolean}} opts
 */
export function summarizeShares(rows, opts = {}) {
  const list = enrichShares(rows, opts)
  const count = (s) => list.filter((r) => r.status === s).length
  const live = list.filter((r) => r.status !== 'revoked' && r.status !== 'expired')
  const numericViews = list.map((r) => r.views).filter((v) => v != null)
  const totalViews = numericViews.length ? numericViews.reduce((a, b) => a + b, 0) : null
  const liveViews = live.map((r) => r.views).filter((v) => v != null)
  return {
    total: list.length,
    live: live.length,
    active: count('active'),
    expiring: count('expiring'),
    stale: count('stale'),
    expired: count('expired'),
    revoked: opts.includesRevoked ? count('revoked') : null,
    totalViews,
    neverViewed: list.filter((r) => r.status !== 'revoked' && !r.last_viewed_at && (r.views == null || r.views === 0)).length,
    avgViewsPerLiveLink: liveViews.length ? liveViews.reduce((a, b) => a + b, 0) / liveViews.length : null,
    boards: list.reduce((s, r) => s + r.boards, 0),
    customDesigned: list.filter((r) => r.custom).length,
    noExpiry: live.filter((r) => !r.expires_at).length,
  }
}

/** Filter enriched rows by status (or 'all') and free-text search on name/pages. */
export function filterShares(enriched, { status = 'all', search = '' } = {}) {
  const q = String(search || '').trim().toLowerCase()
  return (Array.isArray(enriched) ? enriched : []).filter((r) => {
    if (status && status !== 'all' && r.status !== status) return false
    if (!q) return true
    const hay = [r.name, ...(Array.isArray(r.pages) ? r.pages : [])].join(' ').toLowerCase()
    return hay.includes(q)
  })
}

/** Plain-English attention items, most urgent first. Empty when nothing needs attention. */
export function shareFindings(summary) {
  if (!summary || !summary.total) return []
  const out = []
  if (summary.expired) out.push({ tone: 'danger', text: `${summary.expired} link${summary.expired === 1 ? ' has' : 's have'} expired and no longer open. Revoke or recreate them.` })
  if (summary.expiring) out.push({ tone: 'warning', text: `${summary.expiring} link${summary.expiring === 1 ? '' : 's'} expire within ${EXPIRING_DAYS} days.` })
  if (summary.stale) out.push({ tone: 'warning', text: `${summary.stale} link${summary.stale === 1 ? ' has' : 's have'} not been viewed in ${STALE_DAYS} days. Consider revoking unused links.` })
  if (summary.noExpiry) out.push({ tone: 'info', text: `${summary.noExpiry} live link${summary.noExpiry === 1 ? ' has' : 's have'} no expiry date set.` })
  return out
}

export const EXPORT_COLUMNS = [
  { key: 'name', header: 'Name' },
  { key: 'statusLabel', header: 'Status' },
  { key: 'views', header: 'Views' },
  { key: 'lastViewed', header: 'Last viewed' },
  { key: 'boards', header: 'Boards' },
  { key: 'kind', header: 'Board type' },
  { key: 'rotate', header: 'Rotate (s)' },
  { key: 'refresh', header: 'Refresh (s)' },
  { key: 'expires', header: 'Expires' },
  { key: 'created', header: 'Created' },
]

const day = (v) => {
  const t = toTime(v)
  return t == null ? null : new Date(t).toISOString().slice(0, 10)
}

/** Rows shaped for Excel/PDF export. The token is never exported. */
export function exportRows(enriched) {
  return (Array.isArray(enriched) ? enriched : []).map((r) => ({
    name: r.name || 'Shared report',
    statusLabel: r.statusLabel,
    views: r.views == null ? 'N/A' : r.views,
    lastViewed: day(r.last_viewed_at) || 'Never',
    boards: r.boards,
    kind: r.custom ? 'Custom' : 'Fixed pages',
    rotate: numOrNull(r.rotate_seconds) ?? 'N/A',
    refresh: numOrNull(r.refresh_seconds) ?? 'N/A',
    expires: day(r.expires_at) || 'No expiry',
    created: day(r.created_at) || 'N/A',
  }))
}
