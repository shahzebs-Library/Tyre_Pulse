/**
 * washAnalytics.js - pure, deterministic analytics for the Vehicle Washing
 * module. No I/O, no Date.now() reads except where a `now` is injected, so the
 * output is fully testable. Consumed by VehicleWashing.jsx for its reporting KPIs
 * and charts, and reused by the export path.
 *
 * A "wash record" row has (at least): wash_date (YYYY-MM-DD), asset_no,
 * wash_type, site, area, status.
 *
 * Cost / water / duration were removed per field feedback - the module now
 * reports on wash VOLUME (counts) only. All maths degrade honestly to zero on
 * empty / missing data - never NaN, never a fabricated figure.
 */

const MONTHS_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/** Normalise a row date to a YYYY-MM-DD string (first 10 chars), or ''. */
function dayOf(row) {
  const v = row && row.wash_date
  if (!v) return ''
  return String(v).slice(0, 10)
}

/**
 * Filter wash rows by an optional date range (inclusive on both ends),
 * site, area and wash type. Any filter left blank / 'All' is ignored.
 * Rows with a blank wash_date are excluded only when a date bound is set.
 *
 * @param {object[]} rows
 * @param {{from?:string,to?:string,site?:string,area?:string,type?:string}} [filters]
 * @returns {object[]}
 */
export function filterWashes(rows, filters = {}) {
  if (!Array.isArray(rows)) return []
  const { from, to, site, area, type } = filters || {}
  const hasFrom = from && String(from).trim() !== ''
  const hasTo = to && String(to).trim() !== ''
  const wantSite = site && site !== 'All' ? String(site) : null
  const wantArea = area && area !== 'All' ? String(area) : null
  const wantType = type && type !== 'All' ? String(type) : null

  return rows.filter((r) => {
    if (!r) return false
    const d = dayOf(r)
    if (hasFrom) {
      if (!d || d < String(from).slice(0, 10)) return false
    }
    if (hasTo) {
      if (!d || d > String(to).slice(0, 10)) return false
    }
    if (wantSite && String(r.site || '') !== wantSite) return false
    if (wantArea && String(r.area || '') !== wantArea) return false
    if (wantType && String(r.wash_type || '') !== wantType) return false
    return true
  })
}

/** Group rows by a string key, returning [{ key, count }] sorted by count desc. */
function groupBy(rows, keyName) {
  const map = new Map()
  for (const r of rows) {
    const raw = r && r[keyName]
    const key = raw == null || String(raw).trim() === '' ? 'Unspecified' : String(raw).trim()
    const cur = map.get(key) || { key, count: 0 }
    cur.count += 1
    map.set(key, cur)
  }
  return [...map.values()].sort((a, b) => b.count - a.count || a.key.localeCompare(b.key))
}

/**
 * Washes grouped by wash type: [{ key, count }] (count desc).
 */
export function byType(rows) {
  return groupBy(Array.isArray(rows) ? rows : [], 'wash_type')
}

/**
 * Washes grouped by site: [{ key, count }] (count desc).
 */
export function bySite(rows) {
  return groupBy(Array.isArray(rows) ? rows : [], 'site')
}

/**
 * 12-month trend ending at (and including) the month of `now`.
 * @returns {{ month:string, label:string, count:number }[]}
 */
export function monthlyTrend(rows, now = new Date()) {
  const anchor = now instanceof Date && !Number.isNaN(now.getTime()) ? now : new Date()
  const buckets = []
  const index = new Map()
  for (let i = 11; i >= 0; i--) {
    const d = new Date(anchor.getFullYear(), anchor.getMonth() - i, 1)
    const y = d.getFullYear()
    const m = d.getMonth()
    const key = `${y}-${String(m + 1).padStart(2, '0')}`
    const bucket = { month: key, label: `${MONTHS_SHORT[m]} ${String(y).slice(2)}`, count: 0 }
    buckets.push(bucket)
    index.set(key, bucket)
  }
  for (const r of Array.isArray(rows) ? rows : []) {
    const d = dayOf(r)
    if (d.length < 7) continue
    const key = d.slice(0, 7)
    const bucket = index.get(key)
    if (!bucket) continue
    bucket.count += 1
  }
  return buckets
}

/**
 * Headline KPIs over the given rows (optionally pre-filtered). Honest zeros on
 * empty input.
 *
 * @param {object[]} rows
 * @param {{from?:string,to?:string,site?:string,area?:string,type?:string}} [filters]
 *   When provided, rows are filtered first via filterWashes.
 * @param {Date} [now] anchor for the monthly trend.
 */
export function summarizeWashes(rows, filters = {}, now = new Date()) {
  const src = Array.isArray(rows) ? rows : []
  const data = filters && Object.keys(filters).length ? filterWashes(src, filters) : src

  const totalWashes = data.length
  const assets = new Set()
  for (const r of data) {
    const a = r && r.asset_no != null ? String(r.asset_no).trim() : ''
    if (a) assets.add(a)
  }

  return {
    totalWashes,
    distinctAssets: assets.size,
    byType: byType(data),
    bySite: bySite(data),
    monthlyTrend: monthlyTrend(data, now),
  }
}
