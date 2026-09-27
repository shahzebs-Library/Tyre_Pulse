/**
 * serialTrackerAnalytics - pure view logic for the Serial Tracker page
 * (/serial-tracker). No I/O, no React; `now` is injectable everywhere a status
 * depends on the clock.
 *
 * Honesty rules this module enforces:
 *   - A tyre's price is the per-tyre purchase price recorded on its tyre records
 *     (`cost_per_tyre`). Every fitment row of one serial repeats that same
 *     purchase, so the rows are NOT summed (summing counts one tyre once per
 *     move). The latest priced row wins; no priced row = null, never 0.
 *   - Days in service is null when it cannot be measured (a single dated row
 *     with nothing after it), never a fabricated 0.
 *   - A serial that is not found carries a null price, not a zero.
 */

export const ACTIVE_WINDOW_MONTHS = 12

const MS_DAY = 24 * 60 * 60 * 1000

function toMs(v) {
  if (!v) return null
  const t = new Date(v).getTime()
  return Number.isFinite(t) ? t : null
}

function num(v) {
  if (v === null || v === undefined || v === '') return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

/** Per-tyre price on one record (`cost_per_tyre`, or the aliased `cost`). */
export function recordPrice(r) {
  if (!r) return null
  const n = num(r.cost_per_tyre ?? r.cost)
  return n != null && n > 0 ? n : null
}

/** The tyre's purchase price: the latest priced record's per-tyre price. */
export function serialPrice(records) {
  const list = Array.isArray(records) ? records : []
  for (let i = list.length - 1; i >= 0; i--) {
    const p = recordPrice(list[i])
    if (p != null) return p
  }
  return null
}

/** Cut-off date (ms) for "active": a record issued within the window. */
export function activeCutoff(now = new Date(), months = ACTIVE_WINDOW_MONTHS) {
  const d = new Date(now.getTime())
  d.setMonth(d.getMonth() - months)
  return d.getTime()
}

/**
 * Lifecycle stats for one serial. `records` are ordered oldest first (the
 * service orders by issue_date). Returns null for an empty list.
 */
export function serialStats(records, { now = new Date() } = {}) {
  const list = Array.isArray(records) ? records : []
  if (list.length === 0) return null
  const first = list[0]
  const last = list[list.length - 1]
  const assets = new Set(list.map((r) => r.asset_no).filter(Boolean))
  const sites = new Set(list.map((r) => r.site).filter(Boolean))

  const startMs = toMs(first.issue_date)
  let endMs = null
  for (const r of list) {
    for (const v of [r.issue_date, r.removal_date]) {
      const t = toMs(v)
      if (t != null && (endMs == null || t > endMs)) endMs = t
    }
  }
  const days = startMs != null && endMs != null && endMs > startMs
    ? Math.round((endMs - startMs) / MS_DAY)
    : null

  const lastIssued = toMs(last.issue_date)
  const active = lastIssued != null && lastIssued >= activeCutoff(now)
  const scrapped = list.some((r) => /scrap/i.test(String(r.status || '')))

  return {
    first,
    last,
    records: list.length,
    assets: assets.size,
    sites: sites.size,
    days,
    active,
    scrapped,
    price: serialPrice(list),
    pricedRecords: list.filter((r) => recordPrice(r) != null).length,
    brand: first.brand || last.brand || null,
    description: first.description || last.description || null,
    country: last.country || first.country || null,
  }
}

/** Group consecutive records by asset: the "transferred to" timeline. */
export function serialTimeline(records) {
  const list = Array.isArray(records) ? records : []
  const groups = []
  let current = null
  for (const r of list) {
    if (!current || current.asset !== r.asset_no) {
      current = { asset: r.asset_no || null, records: [] }
      groups.push(current)
    }
    current.records.push(r)
  }
  return groups
}

/** One bulk-lookup result row from the records a serial returned. */
export function summarizeBulkSerial(serial, records, { now = new Date() } = {}) {
  const list = Array.isArray(records) ? records : []
  if (list.length === 0) {
    return { serial, first_seen: null, last_asset: null, total_records: 0, cost: null, country: null, status: 'Not Found' }
  }
  const stats = serialStats(list, { now })
  return {
    serial,
    first_seen: stats.first.issue_date || null,
    last_asset: stats.last.asset_no || null,
    total_records: list.length,
    cost: stats.price,
    country: stats.country,
    status: stats.scrapped ? 'Scrapped' : stats.active ? 'Active' : 'Retired',
  }
}

export const BULK_STATUSES = ['Active', 'Retired', 'Scrapped', 'Not Found']

/** Chip counts for the bulk lookup. `found` excludes Not Found. */
export function bulkSummary(results) {
  const list = Array.isArray(results) ? results : []
  if (list.length === 0) return null
  const count = (s) => list.filter((r) => r.status === s).length
  return {
    total: list.length - count('Not Found'),
    active: count('Active'),
    retired: count('Retired'),
    scrapped: count('Scrapped'),
    notFound: count('Not Found'),
    priced: list.filter((r) => r.cost != null).length,
  }
}

/** Status chip + free-text filter over bulk results. */
export function filterBulkResults(results, { status = null, query = '' } = {}) {
  let rows = Array.isArray(results) ? results : []
  if (status) rows = rows.filter((r) => r.status === status)
  const q = String(query || '').trim().toLowerCase()
  if (q) {
    rows = rows.filter((r) =>
      String(r.serial || '').toLowerCase().includes(q)
      || String(r.last_asset || '').toLowerCase().includes(q)
      || String(r.status || '').toLowerCase().includes(q))
  }
  return rows
}

/** Free-text filter over the scrapped register. */
export function filterScrapList(list, query = '') {
  const rows = Array.isArray(list) ? list : []
  const q = String(query || '').trim().toLowerCase()
  if (!q) return rows
  return rows.filter((r) =>
    String(r.serial || '').toLowerCase().includes(q)
    || String(r.reason || '').toLowerCase().includes(q)
    || String(r.asset_no || '').toLowerCase().includes(q)
    || String(r.scrapped_by_name || '').toLowerCase().includes(q))
}

/**
 * KPI strip for the scrapped register.
 *   total          tyres marked as scrap
 *   withReason     marks that carry a reason
 *   unattributed   bulk-scrapped rows that saved no actor (marked === false)
 *   last30         scrapped within 30 days of `now`
 *   reasonRate     withReason / total, null when total is 0
 */
export function scrapRegisterSummary(list, { now = new Date() } = {}) {
  const rows = Array.isArray(list) ? list : []
  const since = now.getTime() - 30 * MS_DAY
  const withReason = rows.filter((r) => r.reason && String(r.reason).trim()).length
  return {
    total: rows.length,
    withReason,
    unattributed: rows.filter((r) => r.marked === false).length,
    last30: rows.filter((r) => { const t = toMs(r.created_at ?? r.scrapped_at); return t != null && t >= since }).length,
    reasonRate: rows.length > 0 ? withReason / rows.length : null,
  }
}
