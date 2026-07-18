/**
 * engineHoursAnalytics.js - pure, deterministic analytics for the Engine Hours
 * Tracker module (/engine-hours). No I/O; every function is fully injectable
 * (an optional `now` Date drives all "recency" logic) so the output is testable
 * and reproducible.
 *
 * Engine hours are point-in-time hour-meter readings logged per asset over time
 * for non-odometer assets (generators, plant, pumps). This engine turns that
 * ledger into utilisation intelligence:
 *   - per-asset run-hours ACCUMULATED (delta between consecutive readings,
 *     monotonic-guarded so a meter reset/replacement never inflates the figure),
 *   - average daily run-hours over each asset's logged span,
 *   - idle / low-utilisation detection,
 *   - data-quality anomalies (a reading BELOW the previous one is surfaced,
 *     never silently dropped).
 *
 * Every metric degrades honestly: empty / missing / non-numeric data yields
 * null (not-computable) or zero - never NaN, never a fabricated value.
 *
 * A "reading" row has (at least): asset_no, engine_hours (numeric),
 * reading_date (YYYY-MM-DD) with created_at as a tie-breaker, and optional site.
 */

const MONTHS_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/** An asset averaging fewer than this many run-hours/day is flagged low-utilisation. */
export const LOW_UTILISATION_HOURS_PER_DAY = 1
/** No reading within this many days => the asset's meter data is considered stale. */
export const STALE_READING_DAYS = 30
const MS_PER_DAY = 86400000

/** Coerce a value to a finite number, or null when it isn't numeric. */
export function toNum(v) {
  if (v === null || v === undefined || v === '') return null
  const n = typeof v === 'number' ? v : parseFloat(String(v).replace(/[^0-9.\-]/g, ''))
  return Number.isFinite(n) ? n : null
}

/** Round to one decimal place (null-safe). */
function round1(n) {
  return n == null || !Number.isFinite(n) ? null : Math.round(n * 10) / 10
}

/** Non-empty trimmed asset key, or ''. */
function assetKey(r) {
  const a = r && r.asset_no != null ? String(r.asset_no).trim() : ''
  return a
}

/** Comparable timestamp for a reading (reading_date -> created_at). Higher = newer. */
function readingRank(r) {
  const raw = (r && (r.reading_date || r.created_at)) || null
  if (!raw) return -Infinity
  const t = new Date(raw).getTime()
  return Number.isNaN(t) ? -Infinity : t
}

/** YYYY-MM-DD day of a reading (reading_date preferred), or ''. */
function dayOf(r) {
  const v = (r && (r.reading_date || r.created_at)) || ''
  return v ? String(v).slice(0, 10) : ''
}

/** Whole-day difference between two YYYY-MM-DD strings (later - earlier), or null. */
function daysBetween(earlier, later) {
  if (!earlier || !later) return null
  const a = new Date(String(earlier).slice(0, 10)).getTime()
  const b = new Date(String(later).slice(0, 10)).getTime()
  if (Number.isNaN(a) || Number.isNaN(b)) return null
  return Math.round((b - a) / MS_PER_DAY)
}

function anchorDate(now) {
  return now instanceof Date && !Number.isNaN(now.getTime()) ? now : new Date()
}

/**
 * Filter readings by an optional asset, site, inclusive date range and free-text
 * search (asset / site / source / notes). Blank / 'All' filters are ignored.
 * Rows with a blank reading_date are excluded only when a date bound is set.
 *
 * @param {object[]} rows
 * @param {{asset?:string,site?:string,from?:string,to?:string,search?:string}} [filters]
 * @returns {object[]}
 */
export function filterEngineHours(rows, filters = {}) {
  if (!Array.isArray(rows)) return []
  const { asset, site, from, to, search } = filters || {}
  const wantAsset = asset && asset !== 'All' ? String(asset) : null
  const wantSite = site && site !== 'All' ? String(site) : null
  const hasFrom = from && String(from).trim() !== ''
  const hasTo = to && String(to).trim() !== ''
  const q = search ? String(search).trim().toLowerCase() : ''

  return rows.filter((r) => {
    if (!r) return false
    if (wantAsset && String(r.asset_no || '') !== wantAsset) return false
    if (wantSite && String(r.site || '') !== wantSite) return false
    const d = dayOf(r)
    if (hasFrom && (!d || d < String(from).slice(0, 10))) return false
    if (hasTo && (!d || d > String(to).slice(0, 10))) return false
    if (q) {
      const hay = `${r.asset_no || ''} ${r.site || ''} ${r.source || ''} ${r.notes || ''}`.toLowerCase()
      if (!hay.includes(q)) return false
    }
    return true
  })
}

/**
 * Reduce readings to the single most recent per asset (reading_date then
 * created_at). Rows without an asset are ignored. Ordered by asset_no.
 * @param {object[]} rows
 * @returns {object[]}
 */
export function latestPerAsset(rows = []) {
  const byAsset = new Map()
  for (const r of Array.isArray(rows) ? rows : []) {
    const key = assetKey(r)
    if (!key) continue
    const existing = byAsset.get(key)
    if (!existing || readingRank(r) >= readingRank(existing)) byAsset.set(key, r)
  }
  return [...byAsset.values()].sort((a, b) => String(a.asset_no).localeCompare(String(b.asset_no)))
}

/**
 * Chronologically-ordered readings for one asset (oldest first), each with a
 * numeric `hours` and `day`. Non-numeric readings are excluded from the chain.
 */
function assetChain(rows, key) {
  return (Array.isArray(rows) ? rows : [])
    .filter((r) => assetKey(r) === key)
    .map((r) => ({ row: r, hours: toNum(r.engine_hours), day: dayOf(r), rank: readingRank(r) }))
    .filter((x) => x.hours !== null)
    .sort((a, b) => a.rank - b.rank)
}

/**
 * Per-consecutive-reading deltas for one asset's chain. `added` is the positive
 * (monotonic) hours gain; a negative delta is flagged `anomaly` and contributes
 * ZERO to accumulated hours (never silently dropped - it is returned here and by
 * detectAnomalies).
 *
 * @returns {{ from:object, to:object, delta:number, added:number, days:(number|null),
 *             anomaly:boolean }[]}
 */
export function hoursAddedPerPeriod(rows, key) {
  const chain = assetChain(rows, key)
  const out = []
  for (let i = 1; i < chain.length; i++) {
    const prev = chain[i - 1]
    const cur = chain[i]
    const delta = cur.hours - prev.hours
    out.push({
      from: prev.row,
      to: cur.row,
      delta,
      added: delta > 0 ? delta : 0,
      days: daysBetween(prev.day, cur.day),
      anomaly: delta < 0,
    })
  }
  return out
}

/**
 * Full utilisation profile per asset. `avgDailyHours` is accumulated hours over
 * the logged span (first -> last reading); null when the span is 0 days or a
 * single reading (not-computable, shown as N/A - never fabricated).
 *
 * @param {object[]} rows
 * @param {Date} [now] recency anchor (for lastReadingDaysAgo / stale / idle).
 * @returns {Array<{
 *   asset_no:string, readings:number, latestHours:(number|null), latestDate:string,
 *   firstDate:string, spanDays:(number|null), hoursAdded:number,
 *   avgDailyHours:(number|null), lastReadingDaysAgo:(number|null), stale:boolean,
 *   idle:boolean, anomalies:number
 * }>}
 */
export function assetUtilization(rows, now = new Date()) {
  const list = Array.isArray(rows) ? rows : []
  const anchor = anchorDate(now)
  const keys = [...new Set(list.map(assetKey).filter(Boolean))].sort((a, b) => a.localeCompare(b))

  return keys.map((key) => {
    const chain = assetChain(list, key)
    const readingsForAsset = list.filter((r) => assetKey(r) === key)
    const periods = hoursAddedPerPeriod(list, key)
    const hoursAdded = periods.reduce((s, p) => s + p.added, 0)
    const anomalies = periods.filter((p) => p.anomaly).length

    const first = chain[0] || null
    const last = chain[chain.length - 1] || null
    const firstDate = first ? first.day : ''
    const latestDate = last ? last.day : ''
    const latestHours = last ? last.hours : null
    const spanDays = chain.length >= 2 ? daysBetween(firstDate, latestDate) : (chain.length === 1 ? 0 : null)
    const avgDailyHours = spanDays && spanDays > 0 ? round1(hoursAdded / spanDays) : null

    let lastReadingDaysAgo = null
    if (latestDate) {
      const d = daysBetween(latestDate, anchor.toISOString().slice(0, 10))
      lastReadingDaysAgo = d == null ? null : Math.max(0, d)
    }
    const stale = lastReadingDaysAgo != null && lastReadingDaysAgo > STALE_READING_DAYS
    const idle = avgDailyHours != null && avgDailyHours < LOW_UTILISATION_HOURS_PER_DAY

    return {
      asset_no: key,
      readings: readingsForAsset.length,
      latestHours,
      latestDate,
      firstDate,
      spanDays,
      hoursAdded: round1(hoursAdded) ?? 0,
      avgDailyHours,
      lastReadingDaysAgo,
      stale,
      idle,
      anomalies,
    }
  })
}

/**
 * Every data-quality anomaly across all assets: a reading whose engine-hours is
 * BELOW the previous chronological reading for the same asset (meter rollback,
 * reset, replacement, or a keying error). Surfaced, never dropped.
 *
 * @returns {Array<{ id:*, asset_no:string, reading_date:string, engine_hours:number,
 *   prevHours:number, prevDate:string, drop:number }>}
 */
export function detectAnomalies(rows) {
  const list = Array.isArray(rows) ? rows : []
  const keys = [...new Set(list.map(assetKey).filter(Boolean))]
  const out = []
  for (const key of keys) {
    for (const p of hoursAddedPerPeriod(list, key)) {
      if (!p.anomaly) continue
      out.push({
        id: p.to && p.to.id != null ? p.to.id : `${key}:${dayOf(p.to)}`,
        asset_no: key,
        reading_date: dayOf(p.to),
        engine_hours: toNum(p.to.engine_hours),
        prevHours: toNum(p.from.engine_hours),
        prevDate: dayOf(p.from),
        drop: round1(Math.abs(p.delta)),
      })
    }
  }
  return out.sort((a, b) => String(b.reading_date).localeCompare(String(a.reading_date)))
}

/** Set of row ids that are the "to" side of an anomaly (for table badges). */
export function anomalyRowIds(rows) {
  return new Set(detectAnomalies(rows).map((a) => a.id))
}

/**
 * Utilisation ranked by asset for a bar chart: [{ asset, hoursAdded,
 * avgDailyHours }] sorted by hoursAdded desc, capped at `limit`.
 */
export function utilizationByAsset(rows, now = new Date(), limit = 12) {
  return assetUtilization(rows, now)
    .map((a) => ({ asset: a.asset_no, hoursAdded: a.hoursAdded, avgDailyHours: a.avgDailyHours }))
    .sort((a, b) => b.hoursAdded - a.hoursAdded || a.asset.localeCompare(b.asset))
    .slice(0, Math.max(0, limit))
}

/**
 * Accumulated run-hours grouped by site for a bar/doughnut chart:
 * [{ key, hoursAdded, assets }] sorted by hoursAdded desc. Hours are attributed
 * to the site of the LATER reading in each pair; blank sites -> 'Unspecified'.
 */
export function utilizationBySite(rows, now = new Date()) {
  const list = Array.isArray(rows) ? rows : []
  const keys = [...new Set(list.map(assetKey).filter(Boolean))]
  const map = new Map()
  for (const key of keys) {
    const bySiteForAsset = new Map()
    for (const p of hoursAddedPerPeriod(list, key)) {
      if (p.added <= 0) continue
      const raw = p.to && p.to.site
      const site = raw == null || String(raw).trim() === '' ? 'Unspecified' : String(raw).trim()
      bySiteForAsset.set(site, (bySiteForAsset.get(site) || 0) + p.added)
    }
    for (const [site, hrs] of bySiteForAsset) {
      const cur = map.get(site) || { key: site, hoursAdded: 0, assets: 0 }
      cur.hoursAdded += hrs
      cur.assets += 1
      map.set(site, cur)
    }
  }
  return [...map.values()]
    .map((e) => ({ ...e, hoursAdded: round1(e.hoursAdded) ?? 0 }))
    .sort((a, b) => b.hoursAdded - a.hoursAdded || a.key.localeCompare(b.key))
}

/**
 * 12-month trend of run-hours ADDED, ending at (and including) the month of
 * `now`. Hours are bucketed by the month of the LATER reading in each pair.
 * @returns {{ month:string, label:string, hoursAdded:number, readings:number }[]}
 */
export function monthlyHoursTrend(rows, now = new Date()) {
  const anchor = anchorDate(now)
  const buckets = []
  const index = new Map()
  for (let i = 11; i >= 0; i--) {
    const d = new Date(anchor.getFullYear(), anchor.getMonth() - i, 1)
    const y = d.getFullYear()
    const m = d.getMonth()
    const key = `${y}-${String(m + 1).padStart(2, '0')}`
    const bucket = { month: key, label: `${MONTHS_SHORT[m]} ${String(y).slice(2)}`, hoursAdded: 0, readings: 0 }
    buckets.push(bucket)
    index.set(key, bucket)
  }

  const list = Array.isArray(rows) ? rows : []
  // Readings per month (raw count).
  for (const r of list) {
    const d = dayOf(r)
    if (d.length < 7) continue
    const b = index.get(d.slice(0, 7))
    if (b) b.readings += 1
  }
  // Hours added per month (positive deltas, bucketed by the later reading).
  const keys = [...new Set(list.map(assetKey).filter(Boolean))]
  for (const key of keys) {
    for (const p of hoursAddedPerPeriod(list, key)) {
      if (p.added <= 0) continue
      const d = dayOf(p.to)
      if (d.length < 7) continue
      const b = index.get(d.slice(0, 7))
      if (b) b.hoursAdded += p.added
    }
  }
  for (const b of buckets) b.hoursAdded = round1(b.hoursAdded) ?? 0
  return buckets
}

/**
 * Headline fleet KPIs over the given readings (optionally pre-filtered).
 * Honest nulls (N/A) where a metric is not computable; honest zeros otherwise.
 *
 * @param {object[]} rows
 * @param {{asset?:string,site?:string,from?:string,to?:string,search?:string}} [filters]
 *   When provided, rows are filtered first via filterEngineHours.
 * @param {Date} [now] recency / trend anchor.
 * @returns {{
 *   totalReadings:number, assetsTracked:number, totalHoursAdded:number,
 *   avgDailyHours:(number|null), maxHours:(number|null),
 *   mostUtilized:(object|null), leastUtilized:(object|null),
 *   anomalies:number, idleAssets:number, staleAssets:number,
 *   assets:object[]
 * }}
 */
export function summarizeEngineHours(rows, filters = {}, now = new Date()) {
  const src = Array.isArray(rows) ? rows : []
  const data = filters && Object.keys(filters).length ? filterEngineHours(src, filters) : src
  const assets = assetUtilization(data, now)

  const totalHoursAdded = round1(assets.reduce((s, a) => s + (a.hoursAdded || 0), 0)) ?? 0
  const latestHoursVals = assets.map((a) => a.latestHours).filter((n) => n != null)
  const maxHours = latestHoursVals.length ? Math.max(...latestHoursVals) : null

  const withDaily = assets.filter((a) => a.avgDailyHours != null)
  const avgDailyHours = withDaily.length
    ? round1(withDaily.reduce((s, a) => s + a.avgDailyHours, 0) / withDaily.length)
    : null

  let mostUtilized = null
  let leastUtilized = null
  if (withDaily.length) {
    const sorted = [...withDaily].sort((a, b) => b.avgDailyHours - a.avgDailyHours || a.asset_no.localeCompare(b.asset_no))
    mostUtilized = sorted[0]
    leastUtilized = sorted[sorted.length - 1]
  }

  return {
    totalReadings: data.length,
    assetsTracked: assets.length,
    totalHoursAdded,
    avgDailyHours,
    maxHours,
    mostUtilized,
    leastUtilized,
    anomalies: assets.reduce((s, a) => s + a.anomalies, 0),
    idleAssets: assets.filter((a) => a.idle).length,
    staleAssets: assets.filter((a) => a.stale).length,
    assets,
  }
}
