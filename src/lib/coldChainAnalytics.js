/**
 * coldChainAnalytics.js - pure, deterministic analytics for the Cold-Chain
 * Monitor module (/cold-chain). No I/O, no hidden clock reads (a `now` is
 * injected where needed), so every function is fully unit-testable.
 *
 * A cold-chain reading is a refrigerated-cargo temperature sample for an asset
 * (reefer unit) at a site, checked against a configured safe range
 * [min_threshold_c, max_threshold_c]. A reading is an EXCURSION when the
 * temperature falls outside that range (above the max or below the min) -
 * excursions are the spoilage / compliance risk this module surfaces.
 *
 * Breach classification (ok / warning / breach) is delegated to the existing
 * pure `src/lib/coldChain.js` so the breach rule lives in exactly one place.
 * This engine layers excursion direction (above / below), deviation magnitude,
 * duration of excursion episodes, compliance %, breakdowns and time trend on
 * top of it.
 *
 * Every metric degrades honestly to zero / [] / null on empty or missing data.
 * Nothing is ever fabricated: temperatures, deviations and durations come only
 * from real recorded values, and are omitted (not guessed) when not derivable.
 *
 * A reading row carries (at least): asset_no, site, temperature_c,
 * min_threshold_c, max_threshold_c, status, recorded_at, notes.
 */

import { classifyTemp, toFiniteNumber, COLD_CHAIN_STATUSES } from './coldChain.js'

const MONTHS_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/** Excursion direction relative to the safe range. */
export const EXCURSION_KINDS = ['in_range', 'above', 'below']

export const EXCURSION_KIND_META = {
  in_range: { label: 'In range', tone: 'green' },
  above: { label: 'Above max', tone: 'red' },
  below: { label: 'Below min', tone: 'sky' },
}

/** Millis in one minute - duration helper. */
const MIN_MS = 60000

/** Trim a value to a non-empty label, else the supplied fallback. */
function labelOf(raw, fallback = 'Unspecified') {
  if (raw == null) return fallback
  const s = String(raw).trim()
  return s === '' ? fallback : s
}

/** Parse recorded_at to epoch millis, or null when unusable. */
export function readingTime(row) {
  const v = row && row.recorded_at
  if (!v) return null
  const t = new Date(v).getTime()
  return Number.isFinite(t) ? t : null
}

/**
 * Resolve a reading's ok/warning/breach status: trust a stored, valid status,
 * otherwise re-classify live from temperature + thresholds.
 */
export function readingStatus(row) {
  if (row && COLD_CHAIN_STATUSES.includes(row.status)) return row.status
  return classifyTemp(row?.temperature_c, row?.min_threshold_c, row?.max_threshold_c)
}

/**
 * Excursion direction of a reading vs its safe range:
 *   'above'    - temperature above the configured max
 *   'below'    - temperature below the configured min
 *   'in_range' - within bounds (or no usable bound / temperature to judge)
 * Note: a near-limit "warning" reading is still physically in range, so it
 * reports 'in_range' here - direction describes only true excursions.
 */
export function excursionKind(row) {
  const t = toFiniteNumber(row?.temperature_c)
  const lo = toFiniteNumber(row?.min_threshold_c)
  const hi = toFiniteNumber(row?.max_threshold_c)
  if (t == null) return 'in_range'
  if (hi != null && t > hi) return 'above'
  if (lo != null && t < lo) return 'below'
  return 'in_range'
}

/**
 * Deviation magnitude (°C, always >= 0) by how far a reading sits outside its
 * safe range. Zero when in range or not derivable. Rounded to 1 decimal.
 */
export function deviationC(row) {
  const t = toFiniteNumber(row?.temperature_c)
  const lo = toFiniteNumber(row?.min_threshold_c)
  const hi = toFiniteNumber(row?.max_threshold_c)
  if (t == null) return 0
  if (hi != null && t > hi) return Math.round((t - hi) * 10) / 10
  if (lo != null && t < lo) return Math.round((lo - t) * 10) / 10
  return 0
}

/** True when the reading is an excursion (outside the range = a breach). */
export function isExcursion(row) {
  return readingStatus(row) === 'breach'
}

/**
 * Filter readings by asset, site, status, free-text search and an inclusive
 * date range (on recorded_at). Any filter left blank / 'all' / 'All' is ignored.
 *
 * @param {object[]} rows
 * @param {{asset?:string, site?:string, status?:string, search?:string,
 *          from?:string, to?:string}} [filters]
 */
export function filterReadings(rows, filters = {}) {
  if (!Array.isArray(rows)) return []
  const { asset, site, status, search, from, to } = filters || {}
  const wantAsset = asset && asset !== 'all' && asset !== 'All' ? String(asset) : null
  const wantSite = site && site !== 'all' && site !== 'All' ? String(site) : null
  const wantStatus = status && status !== 'all' && status !== 'All' ? String(status) : null
  const q = search && String(search).trim() !== '' ? String(search).trim().toLowerCase() : null
  const fromMs = from ? new Date(from).getTime() : null
  const toMs = to ? new Date(to).getTime() : null
  const hasFrom = Number.isFinite(fromMs)
  const hasTo = Number.isFinite(toMs)

  return rows.filter((r) => {
    if (!r) return false
    if (wantAsset && String(r.asset_no || '') !== wantAsset) return false
    if (wantSite && String(r.site || '') !== wantSite) return false
    if (wantStatus && readingStatus(r) !== wantStatus) return false
    if (hasFrom || hasTo) {
      const t = readingTime(r)
      if (t == null) return false
      if (hasFrom && t < fromMs) return false
      // `to` is treated as end-of-day inclusive when a bare date is supplied.
      if (hasTo) {
        const bareDate = /^\d{4}-\d{2}-\d{2}$/.test(String(to))
        const end = bareDate ? toMs + 24 * 60 * MIN_MS - 1 : toMs
        if (t > end) return false
      }
    }
    if (q) {
      const hay = `${r.asset_no || ''} ${r.site || ''} ${r.notes || ''}`.toLowerCase()
      if (!hay.includes(q)) return false
    }
    return true
  })
}

/** Count readings by ok/warning/breach status. */
export function statusCounts(rows) {
  const counts = { ok: 0, warning: 0, breach: 0 }
  for (const r of Array.isArray(rows) ? rows : []) counts[readingStatus(r)] += 1
  return counts
}

/**
 * Excursion distribution: how readings split across in-range vs above-max vs
 * below-min. Drives the excursion-distribution chart.
 * @returns {{ in_range:number, above:number, below:number }}
 */
export function excursionDistribution(rows) {
  const out = { in_range: 0, above: 0, below: 0 }
  for (const r of Array.isArray(rows) ? rows : []) out[excursionKind(r)] += 1
  return out
}

/**
 * Compliance rate = share of readings physically within the safe range
 * (ok + warning, i.e. NOT a breach). Null when there are no readings.
 * @returns {number|null} 0..100 (one decimal) or null
 */
export function compliancePct(rows) {
  const list = Array.isArray(rows) ? rows : []
  if (!list.length) return null
  const breaches = list.reduce((n, r) => n + (isExcursion(r) ? 1 : 0), 0)
  return Math.round(((list.length - breaches) / list.length) * 1000) / 10
}

/**
 * Per-asset breakdown, worst compliance first. Each entry:
 *   { key, total, breaches, warnings, compliancePct, maxDeviation,
 *     lastTempC, lastAt, site }
 */
export function byAsset(rows) {
  return groupReadings(Array.isArray(rows) ? rows : [], 'asset_no')
}

/**
 * Per-site breakdown, worst compliance first (site stands in for "route" - the
 * cold_chain_logs schema has no route column). Same entry shape as byAsset.
 */
export function bySite(rows) {
  return groupReadings(Array.isArray(rows) ? rows : [], 'site')
}

function groupReadings(rows, keyName) {
  const map = new Map()
  for (const r of rows) {
    const key = labelOf(r && r[keyName])
    let g = map.get(key)
    if (!g) {
      g = { key, total: 0, breaches: 0, warnings: 0, maxDeviation: 0, lastTempC: null, lastAt: null, site: '' }
      map.set(key, g)
    }
    g.total += 1
    const st = readingStatus(r)
    if (st === 'breach') g.breaches += 1
    else if (st === 'warning') g.warnings += 1
    const dev = deviationC(r)
    if (dev > g.maxDeviation) g.maxDeviation = dev
    const t = readingTime(r)
    if (t != null && (g.lastAt == null || t > g.lastAt)) {
      g.lastAt = t
      const temp = toFiniteNumber(r?.temperature_c)
      g.lastTempC = temp
    }
    if (keyName !== 'site' && !g.site) g.site = labelOf(r && r.site, '')
  }
  const out = [...map.values()].map((g) => ({
    ...g,
    compliancePct: g.total ? Math.round(((g.total - g.breaches) / g.total) * 1000) / 10 : null,
  }))
  // Worst first: most breaches, then lowest compliance, then name.
  out.sort((a, b) =>
    b.breaches - a.breaches ||
    (a.compliancePct ?? 100) - (b.compliancePct ?? 100) ||
    a.key.localeCompare(b.key),
  )
  return out
}

/** Top-N worst assets (most breaches). */
export function worstAssets(rows, n = 5) {
  return byAsset(rows).filter((a) => a.breaches > 0).slice(0, Math.max(0, n))
}

/** Top-N worst sites/routes (most breaches). */
export function worstSites(rows, n = 5) {
  return bySite(rows).filter((s) => s.breaches > 0).slice(0, Math.max(0, n))
}

/**
 * Excursion episodes per asset. Readings for an asset are sorted by time; a
 * maximal run of consecutive breach readings is one episode. Duration is
 * derived only from real timestamps:
 *   - if the reading immediately AFTER the run is back in range, the episode
 *     ran from its first breach to that recovery reading (recovered:true).
 *   - otherwise it spans first-to-last breach reading and is still open
 *     (recovered:false); a single-reading unrecovered run has null duration
 *     (no second timestamp to measure from - never guessed).
 *
 * Only readings with a usable timestamp participate.
 *
 * @returns {{ asset_no:string, site:string, startAt:string, endAt:string,
 *   readingCount:number, durationMin:number|null, recovered:boolean,
 *   peakDeviation:number, kind:'above'|'below'|'mixed' }[]} newest episode first
 */
export function excursionEpisodes(rows) {
  const byUnit = new Map()
  for (const r of Array.isArray(rows) ? rows : []) {
    const t = readingTime(r)
    if (t == null) continue
    const key = labelOf(r && r.asset_no)
    if (!byUnit.has(key)) byUnit.set(key, [])
    byUnit.get(key).push({ ...r, _t: t })
  }

  const episodes = []
  for (const [asset_no, list] of byUnit) {
    list.sort((a, b) => a._t - b._t)
    let i = 0
    while (i < list.length) {
      if (readingStatus(list[i]) !== 'breach') { i += 1; continue }
      let j = i
      while (j + 1 < list.length && readingStatus(list[j + 1]) === 'breach') j += 1
      const run = list.slice(i, j + 1)
      const recovery = j + 1 < list.length ? list[j + 1] : null
      const startAt = run[0]._t
      const endAt = recovery ? recovery._t : run[run.length - 1]._t
      const recovered = !!recovery
      let durationMin = null
      if (recovered || run.length > 1) durationMin = Math.round((endAt - startAt) / MIN_MS)
      let peakDeviation = 0
      let sawAbove = false
      let sawBelow = false
      for (const r of run) {
        const dev = deviationC(r)
        if (dev > peakDeviation) peakDeviation = dev
        const k = excursionKind(r)
        if (k === 'above') sawAbove = true
        else if (k === 'below') sawBelow = true
      }
      episodes.push({
        asset_no,
        site: labelOf(run[0].site, ''),
        startAt: new Date(startAt).toISOString(),
        endAt: new Date(endAt).toISOString(),
        readingCount: run.length,
        durationMin,
        recovered,
        peakDeviation,
        kind: sawAbove && sawBelow ? 'mixed' : sawAbove ? 'above' : sawBelow ? 'below' : 'above',
      })
      i = j + 1
    }
  }
  episodes.sort((a, b) => new Date(b.startAt).getTime() - new Date(a.startAt).getTime())
  return episodes
}

/**
 * Daily temperature trend (ascending by day). Each bucket:
 *   { day:'YYYY-MM-DD', label:'DD Mon', avg, min, max, count, breaches }
 * avg/min/max are over readings with a numeric temperature; null when a bucket
 * has none. Only days that actually have readings appear (no fabricated gaps).
 */
export function temperatureTrend(rows) {
  const map = new Map()
  for (const r of Array.isArray(rows) ? rows : []) {
    const t = readingTime(r)
    if (t == null) continue
    const day = new Date(t).toISOString().slice(0, 10)
    let b = map.get(day)
    if (!b) { b = { day, sum: 0, n: 0, min: null, max: null, count: 0, breaches: 0 }; map.set(day, b) }
    b.count += 1
    if (isExcursion(r)) b.breaches += 1
    const temp = toFiniteNumber(r?.temperature_c)
    if (temp != null) {
      b.sum += temp
      b.n += 1
      b.min = b.min == null ? temp : Math.min(b.min, temp)
      b.max = b.max == null ? temp : Math.max(b.max, temp)
    }
  }
  return [...map.values()]
    .sort((a, b) => a.day.localeCompare(b.day))
    .map((b) => {
      const [y, m, d] = b.day.split('-')
      return {
        day: b.day,
        label: `${Number(d)} ${MONTHS_SHORT[Number(m) - 1] || ''}`.trim(),
        avg: b.n ? Math.round((b.sum / b.n) * 10) / 10 : null,
        min: b.min,
        max: b.max,
        count: b.count,
        breaches: b.breaches,
      }
    })
}

/**
 * Headline KPIs + chart-ready aggregates over the given rows (optionally
 * pre-filtered). Honest zeros / nulls on empty input; never NaN.
 *
 * @param {object[]} rows
 * @param {object} [filters] when provided, rows are filtered first.
 * @returns summary object consumed by the page.
 */
export function summarizeColdChainAnalytics(rows, filters = {}) {
  const src = Array.isArray(rows) ? rows : []
  const data = filters && Object.keys(filters).length ? filterReadings(src, filters) : src

  const counts = statusCounts(data)
  const assets = new Set()
  const sites = new Set()
  let devSum = 0
  let devCount = 0
  let maxDeviation = 0
  for (const r of data) {
    const a = labelOf(r && r.asset_no, '')
    if (a) assets.add(a)
    const s = labelOf(r && r.site, '')
    if (s) sites.add(s)
    if (isExcursion(r)) {
      const dev = deviationC(r)
      devSum += dev
      devCount += 1
      if (dev > maxDeviation) maxDeviation = dev
    }
  }

  const assetBreakdown = byAsset(data)
  const episodes = excursionEpisodes(data)
  const recovered = episodes.filter((e) => e.recovered)
  const durationMins = recovered.map((e) => e.durationMin).filter((m) => m != null)

  return {
    total: data.length,
    ok: counts.ok,
    warning: counts.warning,
    breach: counts.breach,
    breaches: counts.breach,
    warnings: counts.warning,
    assetsMonitored: assets.size,
    sitesMonitored: sites.size,
    compliancePct: compliancePct(data),
    avgDeviation: devCount ? Math.round((devSum / devCount) * 10) / 10 : 0,
    maxDeviation,
    excursionEpisodes: episodes.length,
    openEpisodes: episodes.filter((e) => !e.recovered).length,
    avgExcursionMin: durationMins.length
      ? Math.round(durationMins.reduce((a, b) => a + b, 0) / durationMins.length)
      : null,
    worstAsset: assetBreakdown.find((a) => a.breaches > 0) || null,
    distribution: excursionDistribution(data),
    byAsset: assetBreakdown,
    bySite: bySite(data),
    trend: temperatureTrend(data),
    episodes,
  }
}
