/**
 * fleetUtilizationView - pure view shaping for the redesigned Fleet Utilization
 * page (route /fleet-utilization). Builds on fleetUtilization.js (bands, idle,
 * summaries) and fleetUtilizationAnalytics.js (register join, site comparison,
 * coverage); it only adds what the mockup layout needs.
 *
 * `asset_utilization` is a telematics SNAPSHOT per asset per capture date, not a
 * daily series. So:
 *  - "Working hours" and "Idle hours" are totals over the loaded captures; a
 *    per-day figure is not measurable because the capture period length is not
 *    recorded, and nothing here pretends otherwise.
 *  - The trend groups assets by capture date. With one capture there is one
 *    column and `trendable` is false; days are never invented.
 *
 * Deterministic, no I/O. `now` is always passed in.
 */
import { num, secondsToHours, sum, mean } from './fleetUtilization'

/** What the snapshot says the asset was doing in its capture period. */
export const ACTIVITY = {
  working: { label: 'Working', tone: 'good', color: 'var(--cc-green)' },
  idle: { label: 'Idle', tone: 'warn', color: 'var(--cc-amber)' },
  inactive: { label: 'Inactive', tone: 'muted', color: 'var(--cc-ink-3)' },
  unknown: { label: 'Not reported', tone: 'muted', color: 'var(--cc-track)' },
}
export const ACTIVITY_KEYS = ['working', 'idle', 'inactive', 'unknown']

/**
 * Working when any working or driving time was recorded, idle when only idle
 * time was, inactive when the unit reported zero time, unknown when no time
 * field was reported at all.
 */
export function activityOf(row) {
  const w = num(row?.working_seconds)
  const d = num(row?.driving_seconds)
  const i = num(row?.idle_seconds)
  if (w == null && d == null && i == null) return 'unknown'
  if ((w || 0) > 0 || (d || 0) > 0) return 'working'
  if ((i || 0) > 0) return 'idle'
  return 'inactive'
}

export const PERIODS = [
  { key: 'all', label: 'All captures', days: null },
  { key: '30', label: 'Last 30 days', days: 30 },
  { key: '90', label: 'Last 90 days', days: 90 },
  { key: '365', label: 'Last 12 months', days: 365 },
]

const isoDay = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`

/**
 * Keep rows captured inside the period ending on `now` (local calendar days).
 * A row with no capture date is kept only for "All captures", since it cannot
 * be placed in any window.
 */
export function filterByPeriod(rows = [], periodKey = 'all', now = new Date()) {
  const p = PERIODS.find((x) => x.key === periodKey)
  if (!p || p.days == null) return rows
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate() - (p.days - 1))
  const from = isoDay(start)
  const to = isoDay(now)
  return rows.filter((r) => {
    const d = r.captured_at ? String(r.captured_at).slice(0, 10) : ''
    return d && d >= from && d <= to
  })
}

export function filterByActivity(rows = [], status = '') {
  if (!status) return rows
  return rows.filter((r) => activityOf(r) === status)
}

/** Five headline figures. `fleet` is the register (null when unreadable). */
export function utilizationKpis(rows = [], fleet = null) {
  const util = rows.map((r) => num(r.utilization_pct)).filter((n) => n != null)
  const hasDistance = rows.some((r) => num(r.distance_km) != null)
  const hasWorking = rows.some((r) => num(r.working_seconds) != null)
  const hasIdle = rows.some((r) => num(r.idle_seconds) != null)
  return {
    totalFleet: fleet ? fleet.length : null,
    tracked: rows.length,
    avgUtilization: util.length ? mean(util) : null,
    workingHours: hasWorking ? secondsToHours(sum(rows.map((r) => r.working_seconds))) : null,
    idleHours: hasIdle ? secondsToHours(sum(rows.map((r) => r.idle_seconds))) : null,
    distanceKm: hasDistance ? Math.round(sum(rows.map((r) => r.distance_km))) : null,
  }
}

/**
 * Asset counts by activity per capture date, oldest first. `trendable` is true
 * only with more than one dated capture. Rows without a capture date are
 * counted in `undated` and never assigned to a day.
 */
export function activityByCapture(rows = []) {
  const m = new Map()
  let undated = 0
  for (const r of rows) {
    const d = r.captured_at ? String(r.captured_at).slice(0, 10) : ''
    if (!d) { undated += 1; continue }
    const e = m.get(d) || { date: d, working: 0, idle: 0, inactive: 0, unknown: 0, total: 0 }
    e[activityOf(r)] += 1
    e.total += 1
    m.set(d, e)
  }
  const points = [...m.values()].sort((a, b) => a.date.localeCompare(b.date))
  return { points, trendable: points.length > 1, undated }
}

/** Snapshot split (all rows) for the single-capture case and the donut. */
export function activitySplit(rows = []) {
  const out = { working: 0, idle: 0, inactive: 0, unknown: 0 }
  for (const r of rows) out[activityOf(r)] += 1
  return ACTIVITY_KEYS.map((k) => ({ key: k, label: ACTIVITY[k].label, color: ACTIVITY[k].color, count: out[k] }))
}

/** Site bars (from siteComparison rows): measured sites first, highest utilization first. */
export function siteBars(sites = [], limit = 10) {
  return sites
    .filter((s) => s.avgUtilization != null)
    .map((s) => ({ site: s.site, pct: Math.round(s.avgUtilization * 10) / 10, assets: s.assets }))
    .sort((a, b) => b.pct - a.pct || a.site.localeCompare(b.site))
    .slice(0, limit)
}

/** Total recorded hours (working + idle) for a row, or null when neither is recorded. */
export function totalHours(row) {
  const w = num(row?.working_seconds)
  const i = num(row?.idle_seconds)
  if (w == null && i == null) return null
  return secondsToHours((w || 0) + (i || 0))
}

/** Unique sorted non-empty values of a field. */
export function optionsOf(rows = [], field, fallback) {
  return [...new Set(rows.map((r) => r[field] || fallback).filter(Boolean))].sort()
}
