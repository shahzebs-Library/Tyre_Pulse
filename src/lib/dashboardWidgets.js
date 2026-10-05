/**
 * dashboardWidgets - pure shaping for the Dashboard Builder widgets added for
 * the owner's builder mockup (open work orders, site pin board, utilisation
 * trend, workshop jobs stacked bar, progress bar, trend indicator, status
 * badge, heat map, timeline, note and image).
 *
 * No I/O and no clock reads: every time based helper takes an explicit `now`.
 * The fetchers live in src/components/dashboard/WidgetRenderer.jsx; this module
 * only turns their rows into render-ready shapes, and it never invents a value.
 * When a figure cannot be measured it comes back as null, and the widget says so.
 *
 * @module dashboardWidgets
 */
import { normalizeWoStatus, isClosedWoStatus } from './workOrderStatus'
import { safeImageSrc } from './safeUrl'

const pad2 = (n) => String(n).padStart(2, '0')
const isoDay = (d) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`
const finite = (v) => (v === null || v === undefined || v === '' ? null : (Number.isFinite(Number(v)) ? Number(v) : null))

// ── Work orders ────────────────────────────────────────────────────────────────
/**
 * Every raw spelling the database is known to store for a CLOSED work order,
 * derived from workOrderStatus.js so the server count and the client predicate
 * cannot disagree. Used as `status in (...)` for an exact head count: open =
 * total minus closed, which keeps NULL / blank statuses counted as open (the
 * same rule as isOpenWoStatus, and a `not in` filter would silently drop them).
 * @returns {string[]}
 */
export function closedWoStatusTokens() {
  const words = ['completed', 'complete', 'done', 'closed', 'finished', 'cancelled', 'canceled', 'void', 'voided']
  const out = new Set()
  for (const w of words) {
    if (!isClosedWoStatus(w)) continue
    out.add(w)
    out.add(w.toUpperCase())
    out.add(w.charAt(0).toUpperCase() + w.slice(1))
  }
  return [...out]
}

/**
 * Open work orders from two exact counts. Null when either count is unknown.
 * @returns {{ total:number|null, closed:number|null, open:number|null }}
 */
export function openWorkOrderCount(total, closed) {
  const t = finite(total)
  const c = finite(closed)
  if (t == null || c == null) return { total: t, closed: c, open: null }
  return { total: t, closed: c, open: Math.max(0, t - c) }
}

/**
 * The last `months` calendar months, oldest first, with ISO day bounds. The
 * current month runs to `now` (never into the future: work_orders carries
 * future-dated opened_at rows that must not count as this month's work).
 * @returns {Array<{key:string,label:string,from:string,to:string}>}
 */
export function recentMonths(now = new Date(), months = 6) {
  const out = []
  for (let i = months - 1; i >= 0; i--) {
    const start = new Date(now.getFullYear(), now.getMonth() - i, 1)
    const end = new Date(now.getFullYear(), now.getMonth() - i + 1, 0)
    const to = i === 0 ? now : end
    out.push({
      key: `${start.getFullYear()}-${pad2(start.getMonth() + 1)}`,
      label: start.toLocaleString('en-GB', { month: 'short', year: '2-digit' }),
      from: isoDay(start),
      to: isoDay(to),
    })
  }
  return out
}

/**
 * Stack per-month status counts into chart series. Statuses are folded through
 * normalizeWoStatus, ordered by total volume, and anything past `maxStatuses`
 * is grouped as "Other" so the legend stays readable. A month whose read failed
 * (`by_status` null) contributes null points, never zeros.
 * @param {Array<{label:string, by_status:Array<{label:string,n:number}>|null}>} months
 * @returns {{ labels:string[], series:Array<{status:string,data:(number|null)[]}>, total:number, measured:boolean }}
 */
export function stackWorkshopJobs(months = [], maxStatuses = 5) {
  const list = Array.isArray(months) ? months : []
  const perMonth = list.map((m) => {
    if (!Array.isArray(m?.by_status)) return null
    const map = {}
    for (const b of m.by_status) {
      const s = normalizeWoStatus(b?.label) || 'Unknown'
      map[s] = (map[s] || 0) + (finite(b?.n) || 0)
    }
    return map
  })
  const totals = {}
  for (const map of perMonth) {
    if (!map) continue
    for (const [s, n] of Object.entries(map)) totals[s] = (totals[s] || 0) + n
  }
  const ranked = Object.entries(totals).filter(([, n]) => n > 0).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
  const keep = ranked.slice(0, maxStatuses).map(([s]) => s)
  const hasOther = ranked.length > maxStatuses
  const statuses = hasOther ? [...keep, 'Other'] : keep
  const series = statuses.map((status) => ({
    status,
    data: perMonth.map((map) => {
      if (!map) return null
      if (status !== 'Other') return map[status] || 0
      return Object.entries(map).filter(([s]) => !keep.includes(s)).reduce((a, [, n]) => a + n, 0)
    }),
  }))
  const total = ranked.reduce((a, [, n]) => a + n, 0)
  return { labels: list.map((m) => m?.label || ''), series, total, measured: perMonth.some(Boolean) }
}

// ── Fleet utilisation ─────────────────────────────────────────────────────────
/**
 * Average utilisation per telematics capture date (asset_utilization is a
 * SNAPSHOT per capture, not a daily log, so the trend is by capture date only).
 * Rows without a utilisation figure are left out of the average, not read as 0.
 * @returns {Array<{date:string, avg:number, assets:number}>}
 */
export function utilisationTrend(rows = []) {
  const by = new Map()
  for (const r of Array.isArray(rows) ? rows : []) {
    const pct = finite(r?.utilization_pct)
    const date = r?.captured_at ? String(r.captured_at).slice(0, 10) : null
    if (pct == null || !date) continue
    const b = by.get(date) || { sum: 0, n: 0 }
    b.sum += pct
    b.n += 1
    by.set(date, b)
  }
  return [...by.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([date, b]) => ({ date, avg: Math.round((b.sum / b.n) * 10) / 10, assets: b.n }))
}

// ── Inspections ───────────────────────────────────────────────────────────────
const inspectionDone = (r) => !!(r?.completed_date || String(r?.status || '').trim().toLowerCase() === 'done')

/**
 * Inspections completed against those scheduled in the current calendar month.
 * pct is null when nothing is scheduled (no plan = nothing to measure against).
 * @returns {{ planned:number, done:number, pct:number|null, month:string }}
 */
export function inspectionProgress(rows = [], now = new Date()) {
  const key = `${now.getFullYear()}-${pad2(now.getMonth() + 1)}`
  let planned = 0
  let done = 0
  for (const r of Array.isArray(rows) ? rows : []) {
    if (!r?.scheduled_date || String(r.scheduled_date).slice(0, 7) !== key) continue
    planned += 1
    if (inspectionDone(r)) done += 1
  }
  return {
    planned,
    done,
    pct: planned > 0 ? Math.round((done / planned) * 1000) / 10 : null,
    month: now.toLocaleString('en-GB', { month: 'long', year: 'numeric' }),
  }
}

// ── Trend indicator ───────────────────────────────────────────────────────────
/**
 * Two equal back-to-back windows ending today: [prevFrom..prevTo] then
 * [from..to]. Both are bounded at today so future-dated rows never count.
 */
export function rollingWindows(now = new Date(), days = 30) {
  const to = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const from = new Date(to); from.setDate(from.getDate() - (days - 1))
  const prevTo = new Date(from); prevTo.setDate(prevTo.getDate() - 1)
  const prevFrom = new Date(prevTo); prevFrom.setDate(prevFrom.getDate() - (days - 1))
  return { from: isoDay(from), to: isoDay(to), prevFrom: isoDay(prevFrom), prevTo: isoDay(prevTo), days }
}

/**
 * Change between two periods. Direction and percentage are only given when the
 * previous period is measurable AND above zero: a change against nothing is not
 * a percentage, so the widget shows no arrow rather than a made-up one.
 * @returns {{ current:number|null, previous:number|null, delta:number|null, pct:number|null, direction:'up'|'down'|'flat'|null }}
 */
export function trendChange(current, previous) {
  const c = finite(current)
  const p = finite(previous)
  if (c == null) return { current: null, previous: p, delta: null, pct: null, direction: null }
  if (p == null) return { current: c, previous: null, delta: null, pct: null, direction: null }
  const delta = c - p
  if (p <= 0) return { current: c, previous: p, delta, pct: null, direction: null }
  const pct = Math.round((delta / p) * 1000) / 10
  return { current: c, previous: p, delta, pct, direction: delta > 0 ? 'up' : delta < 0 ? 'down' : 'flat' }
}

// ── Data freshness (status badge) ─────────────────────────────────────────────
export const FRESHNESS_FEEDS = Object.freeze([
  { table: 'work_orders', label: 'Job cards' },
  { table: 'parts_consumption', label: 'Expenses' },
  { table: 'tyre_records', label: 'Tyre records' },
  { table: 'inspections', label: 'Inspections' },
  { table: 'accidents', label: 'Accidents' },
])

const FRESH_DAYS = 2
const STALE_DAYS = 7
const RANK = { fresh: 0, stale: 1, old: 2 }

/**
 * Freshness per feed from its newest upload date (YYYY-MM-DD, null = unreadable).
 * fresh <= 2 days, stale <= 7 days, old beyond. Overall = the worst READ feed;
 * unknown when nothing could be read.
 * @param {Record<string,string|null>} latestByTable
 */
export function freshnessStatus(latestByTable = {}, now = new Date(), feeds = FRESHNESS_FEEDS) {
  const today = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate())
  const items = feeds.map((f) => {
    const latest = latestByTable?.[f.table] || null
    const m = latest && /^(\d{4})-(\d{2})-(\d{2})/.exec(String(latest))
    if (!m) return { ...f, latest: null, days: null, status: 'unknown' }
    const days = Math.max(0, Math.round((today - Date.UTC(+m[1], +m[2] - 1, +m[3])) / 86400000))
    const status = days <= FRESH_DAYS ? 'fresh' : days <= STALE_DAYS ? 'stale' : 'old'
    return { ...f, latest: `${m[1]}-${m[2]}-${m[3]}`, days, status }
  })
  const read = items.filter((i) => i.status !== 'unknown')
  const overall = read.length ? read.reduce((w, i) => (RANK[i.status] > RANK[w] ? i.status : w), 'fresh') : 'unknown'
  return { items, overall }
}

// ── Heat map ──────────────────────────────────────────────────────────────────
export const WEEKDAYS = Object.freeze(['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'])

/**
 * Site x weekday matrix of row counts, busiest sites first. Rows without a site
 * or a parseable date are skipped (counted in `skipped`, never guessed).
 * @returns {{ sites:string[], days:string[], cells:number[][], max:number, total:number, skipped:number }}
 */
export function heatmapSiteWeekday(rows = [], dateKey = 'inspection_date', limit = 8) {
  const bySite = new Map()
  let skipped = 0
  for (const r of Array.isArray(rows) ? rows : []) {
    const site = String(r?.site || '').trim()
    const m = r?.[dateKey] && /^(\d{4})-(\d{2})-(\d{2})/.exec(String(r[dateKey]))
    if (!site || !m) { skipped += 1; continue }
    const dow = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3])).getUTCDay()
    const arr = bySite.get(site) || [0, 0, 0, 0, 0, 0, 0]
    arr[dow] += 1
    bySite.set(site, arr)
  }
  const ranked = [...bySite.entries()]
    .map(([site, arr]) => ({ site, arr, sum: arr.reduce((a, n) => a + n, 0) }))
    .sort((a, b) => b.sum - a.sum || a.site.localeCompare(b.site))
    .slice(0, limit)
  const cells = ranked.map((r) => r.arr)
  const max = cells.reduce((m, arr) => Math.max(m, ...arr), 0)
  return {
    sites: ranked.map((r) => r.site),
    days: [...WEEKDAYS],
    cells,
    max,
    total: ranked.reduce((a, r) => a + r.sum, 0),
    skipped,
  }
}

// ── Timeline ──────────────────────────────────────────────────────────────────
/**
 * Merge recent work orders, accidents and inspections into one newest-first
 * feed keyed by when each record was entered (created_at), so the three
 * sources share one clock. Rows without a timestamp are dropped.
 */
export function mergeTimeline({ workOrders = [], accidents = [], inspections = [] } = {}, limit = 12) {
  const ev = []
  for (const w of workOrders || []) {
    if (!w?.created_at) continue
    ev.push({
      type: 'work_order', at: w.created_at,
      title: `Job card ${w.work_order_no || ''}`.trim(),
      sub: [w.asset_no, normalizeWoStatus(w.status)].filter(Boolean).join(' | '),
    })
  }
  for (const a of accidents || []) {
    if (!a?.created_at) continue
    ev.push({
      type: 'accident', at: a.created_at,
      title: `Accident ${a.reference_no || ''}`.trim(),
      sub: [a.asset_no, a.severity, a.site].filter(Boolean).join(' | '),
    })
  }
  for (const i of inspections || []) {
    if (!i?.created_at) continue
    ev.push({
      type: 'inspection', at: i.created_at,
      title: 'Inspection',
      sub: [i.asset_no, i.status, i.site].filter(Boolean).join(' | '),
    })
  }
  return ev
    .filter((e) => Number.isFinite(Date.parse(e.at)))
    .sort((a, b) => Date.parse(b.at) - Date.parse(a.at))
    .slice(0, limit)
}

// ── Text & media widgets (per-instance config) ────────────────────────────────
export const MAX_NOTE_LENGTH = 2000
export const MAX_IMAGE_URL = 2000
export const MAX_CAPTION = 120

/**
 * Sanitise the per-instance config a Note or Image widget carries in the layout.
 * Anything else carries no config (returns null). An image URL that is not a
 * safe image source is dropped, so a stored layout can never render a
 * javascript: or data:text/html URL.
 * @param {string} kind 'note' | 'image' | other
 * @param {*} raw
 * @returns {object|null}
 */
export function sanitizeWidgetConfig(kind, raw) {
  const c = raw && typeof raw === 'object' ? raw : {}
  if (kind === 'note') {
    return {
      title: String(c.title ?? '').trim().slice(0, MAX_CAPTION),
      text: String(c.text ?? '').slice(0, MAX_NOTE_LENGTH),
    }
  }
  if (kind === 'image') {
    const url = String(c.url ?? '').trim().slice(0, MAX_IMAGE_URL)
    return {
      url: safeImageSrc(url) ? url : '',
      caption: String(c.caption ?? '').trim().slice(0, MAX_CAPTION),
    }
  }
  return null
}
