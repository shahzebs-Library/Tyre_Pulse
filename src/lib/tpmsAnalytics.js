/**
 * TPMS analytics engine — higher-level pressure intelligence.
 *
 * Zero I/O, framework-free and fully unit-testable. This layer sits ABOVE the
 * primitive banding in `./tpms` (classifyPressure / deviationPct) and turns a
 * set of already-normalized readings into fleet-grade KPIs: pressure
 * compliance, under-inflation risk (the key safety + CPK driver), worst
 * offenders, a compliance trend over time, and per-site / per-position
 * breakdowns.
 *
 * Input shape — a "reading" is the normalized object the /tpms page produces:
 *   {
 *     pressure: number|null,   // observed pressure (bar)
 *     target:   number,        // placard / target pressure (bar)
 *     band:     'optimal'|'under'|'over'|'critical'|'unknown'  (optional; recomputed if absent)
 *     site, position, asset_no, serial, temperature, date, ...
 *   }
 * Every function is null-safe: a non-array, empty, or partially-populated input
 * yields honest zeros / empty arrays — never a throw, never a fabricated value.
 */

import {
  classifyPressure,
  DEFAULT_TARGET_PRESSURE,
  DEFAULT_TOLERANCE_PCT,
} from './tpms'

/** Bands that count as an inflation alert (all three are actionable). */
export const ALERT_BANDS = ['under', 'over', 'critical']

/** Under-target bands — the safety + wear + fuel-cost driver. */
export const UNDER_BANDS = ['under', 'critical']

/** Worst-first severity ranking used to sort offenders and alerts. */
export const BAND_SEVERITY = { critical: 0, under: 1, over: 2, optimal: 3, unknown: 4 }

/** Human labels for each band (ASCII only). */
export const BAND_LABELS = {
  optimal: 'Optimal',
  under: 'Under',
  over: 'Over',
  critical: 'Critical',
  unknown: 'Unknown',
}

const EMPTY_BANDS = () => ({ optimal: 0, under: 0, over: 0, critical: 0, unknown: 0 })

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

function toNum(v) {
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

/** Resolve the target for a reading (explicit target wins, else fleet default). */
function targetOf(r, fallback = DEFAULT_TARGET_PRESSURE) {
  const t = toNum(r?.target ?? r?.target_pressure)
  return t != null && t > 0 ? t : fallback
}

/** Observed pressure from either the normalized or raw field. */
function pressureOf(r) {
  return toNum(r?.pressure ?? r?.pressure_reading)
}

/**
 * Band for a reading. Uses the pre-computed `band` when it is a known value,
 * otherwise classifies from pressure vs target (so the engine works on both the
 * page's normalized rows and raw rows).
 */
export function bandOf(r, tolerancePct = DEFAULT_TOLERANCE_PCT) {
  const b = r?.band
  if (b && Object.prototype.hasOwnProperty.call(BAND_SEVERITY, b)) return b
  return classifyPressure(pressureOf(r), targetOf(r), tolerancePct)
}

/**
 * Signed deviation from target as a percentage. Negative = under-inflated,
 * positive = over-inflated. null when pressure or target is invalid.
 */
export function signedDeviationPct(r) {
  const p = pressureOf(r)
  const t = targetOf(r)
  if (p == null || p <= 0 || !Number.isFinite(t) || t <= 0) return null
  return ((p - t) / t) * 100
}

/** true when the reading falls in an actionable (under/over/critical) band. */
export function isAlert(r, tolerancePct) {
  return ALERT_BANDS.includes(bandOf(r, tolerancePct))
}

function asArray(rows) {
  return Array.isArray(rows) ? rows : []
}

function round(n, dp = 1) {
  if (n == null || !Number.isFinite(n)) return null
  const f = 10 ** dp
  return Math.round(n * f) / f
}

/**
 * Core KPI roll-up over a set of readings.
 *
 * @param {Array<object>} rows
 * @param {{tolerancePct?:number, target?:number}} [opts]
 * @returns {{
 *   total:number, assessed:number,
 *   bands:{optimal:number,under:number,over:number,critical:number,unknown:number},
 *   alerts:number, underInflated:number, overInflated:number, critical:number,
 *   compliancePct:number, underInflatedPct:number,
 *   avgPressure:number|null, avgTarget:number|null,
 *   avgAbsDeviationPct:number|null, avgUnderDeviationPct:number|null
 * }}
 */
export function computeKpis(rows, opts = {}) {
  const tolerancePct = Number.isFinite(Number(opts.tolerancePct))
    ? Number(opts.tolerancePct) : DEFAULT_TOLERANCE_PCT
  const list = asArray(rows)
  const bands = EMPTY_BANDS()

  let pSum = 0, pN = 0
  let tSum = 0, tN = 0
  let devSum = 0, devN = 0
  let underDevSum = 0, underDevN = 0

  for (const r of list) {
    const band = bandOf(r, tolerancePct)
    bands[band] += 1

    const p = pressureOf(r)
    if (p != null && p > 0) { pSum += p; pN += 1 }
    const t = targetOf(r)
    if (Number.isFinite(t) && t > 0) { tSum += t; tN += 1 }

    const dev = signedDeviationPct(r)
    if (dev != null) {
      devSum += Math.abs(dev); devN += 1
      if (band === 'under' || band === 'critical') { underDevSum += Math.abs(dev); underDevN += 1 }
    }
  }

  const total = list.length
  const assessed = total - bands.unknown
  const underInflated = bands.under + bands.critical
  const overInflated = bands.over
  const alerts = underInflated + overInflated

  return {
    total,
    assessed,
    bands,
    alerts,
    underInflated,
    overInflated,
    critical: bands.critical,
    compliancePct: assessed > 0 ? round((bands.optimal / assessed) * 100) : 0,
    underInflatedPct: assessed > 0 ? round((underInflated / assessed) * 100) : 0,
    avgPressure: pN > 0 ? round(pSum / pN, 2) : null,
    avgTarget: tN > 0 ? round(tSum / tN, 2) : null,
    avgAbsDeviationPct: devN > 0 ? round(devSum / devN) : null,
    avgUnderDeviationPct: underDevN > 0 ? round(underDevSum / underDevN) : null,
  }
}

/**
 * Band distribution ready for a chart. Ordered optimal -> under -> over ->
 * critical -> unknown; `unknown` omitted when there are none.
 */
export function bandDistribution(rows, opts = {}) {
  const k = computeKpis(rows, opts)
  const order = ['optimal', 'under', 'over', 'critical', 'unknown']
  return order
    .filter(b => b !== 'unknown' || k.bands.unknown > 0)
    .map(b => ({
      band: b,
      label: BAND_LABELS[b],
      count: k.bands[b],
      pct: k.total > 0 ? round((k.bands[b] / k.total) * 100) : 0,
    }))
}

/**
 * Worst offenders — readings furthest from safe, worst first. Critical then
 * under then over, and within a band by the largest absolute deviation. Each
 * row is enriched with band / signedDeviationPct / absDeviationPct.
 *
 * @param {Array<object>} rows
 * @param {{limit?:number, tolerancePct?:number, underOnly?:boolean}} [opts]
 */
export function worstOffenders(rows, opts = {}) {
  const { limit = 10, tolerancePct, underOnly = false } = opts
  const enriched = asArray(rows)
    .map(r => {
      const band = bandOf(r, tolerancePct)
      const dev = signedDeviationPct(r)
      return { ...r, band, signedDeviationPct: dev, absDeviationPct: dev == null ? null : Math.abs(dev) }
    })
    .filter(r => {
      if (underOnly) return r.band === 'under' || r.band === 'critical'
      return ALERT_BANDS.includes(r.band)
    })
    .sort((a, b) => {
      const s = (BAND_SEVERITY[a.band] ?? 9) - (BAND_SEVERITY[b.band] ?? 9)
      if (s !== 0) return s
      return (b.absDeviationPct ?? -1) - (a.absDeviationPct ?? -1)
    })
  return limit > 0 ? enriched.slice(0, limit) : enriched
}

function monthKey(dateVal) {
  if (!dateVal) return null
  const s = String(dateVal)
  // Fast path for ISO-ish strings (YYYY-MM-...).
  const m = s.match(/^(\d{4})-(\d{2})/)
  if (m) return `${m[1]}-${m[2]}`
  const d = new Date(s)
  if (Number.isNaN(d.getTime())) return null
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`
}

function monthLabel(key) {
  const [y, mm] = key.split('-')
  const idx = Number(mm) - 1
  return `${MONTHS[idx] ?? mm} ${String(y).slice(2)}`
}

/**
 * Compliance trend over time (monthly). Only readings carrying a parseable date
 * are bucketed; returns the last `months` buckets that actually have data,
 * ascending. Empty when no dated readings exist.
 *
 * @param {Array<object>} rows
 * @param {{months?:number, tolerancePct?:number}} [opts]
 * @returns {Array<{key:string,label:string,total:number,optimal:number,under:number,over:number,critical:number,compliancePct:number,avgPressure:number|null}>}
 */
export function complianceTrend(rows, opts = {}) {
  const { months = 6, tolerancePct } = opts
  const map = new Map()
  for (const r of asArray(rows)) {
    const key = monthKey(r?.date ?? r?.recorded_at ?? r?.issue_date)
    if (!key) continue
    if (!map.has(key)) map.set(key, { ...EMPTY_BANDS(), total: 0, pSum: 0, pN: 0 })
    const e = map.get(key)
    const band = bandOf(r, tolerancePct)
    e.total += 1
    e[band] += 1
    const p = pressureOf(r)
    if (p != null && p > 0) { e.pSum += p; e.pN += 1 }
  }
  const rowsOut = Array.from(map.entries())
    .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
    .map(([key, e]) => {
      const assessed = e.total - e.unknown
      return {
        key,
        label: monthLabel(key),
        total: e.total,
        optimal: e.optimal,
        under: e.under,
        over: e.over,
        critical: e.critical,
        compliancePct: assessed > 0 ? round((e.optimal / assessed) * 100) : 0,
        avgPressure: e.pN > 0 ? round(e.pSum / e.pN, 2) : null,
      }
    })
  return months > 0 ? rowsOut.slice(-months) : rowsOut
}

/**
 * Group readings by a key (site / position) into a compliance breakdown.
 * Internal; use `siteCompliance` / `positionBreakdown`.
 */
function groupBreakdown(rows, keyName, getKey, opts = {}) {
  const { tolerancePct } = opts
  const map = new Map()
  for (const r of asArray(rows)) {
    const k = getKey(r) || 'Unspecified'
    if (!map.has(k)) map.set(k, { ...EMPTY_BANDS(), total: 0 })
    const e = map.get(k)
    const band = bandOf(r, tolerancePct)
    e.total += 1
    e[band] += 1
  }
  return Array.from(map.entries()).map(([name, e]) => {
    const assessed = e.total - e.unknown
    const alerts = e.under + e.over + e.critical
    return {
      [keyName]: name,
      total: e.total,
      optimal: e.optimal,
      under: e.under,
      over: e.over,
      critical: e.critical,
      alerts,
      underInflated: e.under + e.critical,
      compliancePct: assessed > 0 ? round((e.optimal / assessed) * 100) : 0,
    }
  })
}

/**
 * Per-site compliance, worst first (most alerts, then lowest compliance). Good
 * for surfacing the depots that need attention.
 */
export function siteCompliance(rows, opts = {}) {
  return groupBreakdown(rows, 'site', r => r?.site, opts)
    .sort((a, b) => b.alerts - a.alerts || a.compliancePct - b.compliancePct || b.total - a.total)
}

/**
 * Per-position compliance, worst first. Steer positions under-inflated are the
 * highest safety concern, so alerts drive the ordering.
 */
export function positionBreakdown(rows, opts = {}) {
  return groupBreakdown(rows, 'position', r => r?.position ?? r?.tyre_position, opts)
    .sort((a, b) => b.alerts - a.alerts || b.total - a.total)
}

/**
 * Honest under-inflation insight bundle for a headline callout. Every field is
 * grounded in the data; when nothing is under-inflated the counts are zero and
 * `worstSite` is null (no fabricated narrative).
 *
 * @param {Array<object>} rows
 * @param {{tolerancePct?:number}} [opts]
 */
export function underInflationInsights(rows, opts = {}) {
  const k = computeKpis(rows, opts)
  const sites = siteCompliance(rows, opts).filter(s => s.underInflated > 0)
  const worst = sites.slice().sort((a, b) => b.underInflated - a.underInflated)[0] || null
  return {
    underInflatedCount: k.underInflated,
    criticalCount: k.critical,
    underInflatedPct: k.underInflatedPct,
    avgUnderDeviationPct: k.avgUnderDeviationPct,
    sitesAffected: sites.length,
    worstSite: worst ? { site: worst.site, underInflated: worst.underInflated } : null,
  }
}

export { DEFAULT_TARGET_PRESSURE, DEFAULT_TOLERANCE_PCT }
