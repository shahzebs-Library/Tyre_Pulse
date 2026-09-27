/**
 * hoursOfServiceAnalytics - pure engine behind the Hours of Service page
 * (/hours-of-service). Builds on the per-driver-day HOS roll-up that already
 * lives in `src/lib/hosLogs.js` (driverDaySummary / summariseHos, the one home
 * of the 11 h driving and 14 h on-duty limits) and adds what the page needs on
 * top: a date window, filtering, a per-driver scorecard, a duty-status mix and
 * an honest compliance rate.
 *
 * No I/O, no React, no Date.now(): every time-dependent function takes `now`
 * so the page and the tests classify against the same instant.
 *
 * Honesty rules:
 *   - a rate with no denominator is null (rendered N/A), never 0 or 100;
 *   - a log with no parseable date is excluded from a bounded window (it cannot
 *     be proven to fall inside it) but kept for "All time".
 */
import {
  driverDaySummary, summariseHos, toFiniteNumber,
  DAILY_DRIVE_LIMIT_MIN, DAILY_DUTY_LIMIT_MIN,
} from './hosLogs'

export { DAILY_DRIVE_LIMIT_MIN, DAILY_DUTY_LIMIT_MIN }

export const DUTY_STATUSES = ['driving', 'on_duty', 'sleeper', 'off_duty']

export const DUTY_LABELS = {
  off_duty: 'Off duty',
  sleeper: 'Sleeper berth',
  driving: 'Driving',
  on_duty: 'On duty (not driving)',
}

/** Window presets offered by the page, in days. `all` = unbounded. */
export const WINDOW_OPTIONS = [
  { value: '7', label: 'Last 7 days' },
  { value: '30', label: 'Last 30 days' },
  { value: '90', label: 'Last 90 days' },
  { value: 'all', label: 'All time' },
]

const DAY_MS = 86_400_000

function toMs(v) {
  if (v instanceof Date) return v.getTime()
  if (typeof v === 'number') return Number.isFinite(v) ? v : null
  if (!v) return null
  const t = Date.parse(String(v))
  return Number.isFinite(t) ? t : null
}

/** Event time of a log: log_date, then start_time, then created_at. */
export function logTimeMs(r) {
  return toMs(r?.log_date) ?? toMs(r?.start_time) ?? toMs(r?.created_at)
}

/** Lower bound (epoch ms) for a window preset, or null for "all". */
export function windowStartMs(windowValue, now) {
  const days = Number(windowValue)
  const ref = toMs(now)
  if (!Number.isFinite(days) || days <= 0 || ref == null) return null
  return ref - days * DAY_MS
}

/**
 * Filter HOS logs. All criteria optional.
 * @param {Array} rows
 * @param {{ driver?:string, duty?:string, violationsOnly?:boolean,
 *           search?:string, window?:string, now?:number|Date }} f
 */
export function filterHosLogs(rows, f = {}) {
  const list = Array.isArray(rows) ? rows : []
  const q = String(f.search || '').trim().toLowerCase()
  const start = windowStartMs(f.window, f.now)
  return list.filter((r) => {
    if (!r) return false
    if (f.driver && r.driver_name !== f.driver) return false
    if (f.duty && r.duty_status !== f.duty) return false
    if (f.violationsOnly && r.violation !== true) return false
    if (start != null) {
      const t = logTimeMs(r)
      if (t == null || t < start) return false
    }
    if (q) {
      const hay = [r.driver_name, r.asset_no, r.location, r.remarks, r.violation_type, r.notes]
        .filter(Boolean).join(' ').toLowerCase()
      if (!hay.includes(q)) return false
    }
    return true
  })
}

/** Minutes of each duty status across the logs, with share of the total. */
export function dutyMix(rows) {
  const totals = { driving: 0, on_duty: 0, sleeper: 0, off_duty: 0 }
  for (const r of Array.isArray(rows) ? rows : []) {
    const s = String(r?.duty_status || '').toLowerCase()
    const m = toFiniteNumber(r?.duration_min)
    if (!(s in totals) || m == null || m <= 0) continue
    totals[s] += m
  }
  const sum = Object.values(totals).reduce((a, b) => a + b, 0)
  return DUTY_STATUSES.map((status) => ({
    status,
    label: DUTY_LABELS[status],
    minutes: totals[status],
    share: sum > 0 ? totals[status] / sum : null,
  }))
}

/**
 * Per-driver scorecard over the same driver-day roll-up the compliance table
 * uses. complianceRate is null when the driver has no dated driver-days.
 */
export function driverScorecard(rows) {
  const list = Array.isArray(rows) ? rows : []
  const days = driverDaySummary(list)
  const byDriver = new Map()
  for (const d of days) {
    const g = byDriver.get(d.driver_name) || {
      driver_name: d.driver_name, days: 0, breachDays: 0, drivingMin: 0, maxDrivingMin: 0,
    }
    g.days += 1
    if (d.overHours) g.breachDays += 1
    g.drivingMin += d.drivingMin
    if (d.drivingMin > g.maxDrivingMin) g.maxDrivingMin = d.drivingMin
    byDriver.set(d.driver_name, g)
  }
  const violations = new Map()
  const lastSeen = new Map()
  for (const r of list) {
    const name = r?.driver_name ? String(r.driver_name).trim() : ''
    if (!name) continue
    if (r.violation === true) violations.set(name, (violations.get(name) || 0) + 1)
    const t = logTimeMs(r)
    if (t != null && (lastSeen.get(name) == null || t > lastSeen.get(name))) lastSeen.set(name, t)
  }
  return [...byDriver.values()].map((g) => ({
    ...g,
    drivingHours: Math.round((g.drivingMin / 60) * 10) / 10,
    avgDailyDrivingMin: g.days > 0 ? Math.round(g.drivingMin / g.days) : null,
    complianceRate: g.days > 0 ? Math.round(((g.days - g.breachDays) / g.days) * 1000) / 10 : null,
    violations: violations.get(g.driver_name) || 0,
    lastLogMs: lastSeen.get(g.driver_name) ?? null,
  })).sort((a, b) => b.breachDays - a.breachDays || b.violations - a.violations
    || b.drivingMin - a.drivingMin || a.driver_name.localeCompare(b.driver_name))
}

/** Driver-day compliance rows, worst first, with limit headroom (can go negative). */
export function complianceRows(rows) {
  return driverDaySummary(Array.isArray(rows) ? rows : [])
    .map((d) => ({
      ...d,
      driveHeadroomMin: DAILY_DRIVE_LIMIT_MIN - d.drivingMin,
      dutyHeadroomMin: DAILY_DUTY_LIMIT_MIN - d.onDutyMin,
    }))
    .sort((a, b) => Number(b.overHours) - Number(a.overHours)
      || b.drivingMin - a.drivingMin
      || String(b.log_date).localeCompare(String(a.log_date)))
}

/** KPI block for the page header strip. */
export function hosKpis(rows) {
  const list = Array.isArray(rows) ? rows : []
  const s = summariseHos(list)
  const days = driverDaySummary(list)
  const breachDays = days.filter((d) => d.overHours).length
  const withDuration = list.filter((r) => {
    const m = toFiniteNumber(r?.duration_min)
    return m != null && m > 0
  }).length
  return {
    totalLogs: s.totalLogs,
    distinctDrivers: s.distinctDrivers,
    drivingHours: s.drivingHours,
    violationsCount: s.violationsCount,
    driverDays: days.length,
    breachDays,
    complianceRate: days.length > 0
      ? Math.round(((days.length - breachDays) / days.length) * 1000) / 10
      : null,
    // Share of logs that carry a usable duration: the evidence behind every hour figure.
    durationCoverage: list.length > 0 ? Math.round((withDuration / list.length) * 1000) / 10 : null,
  }
}

/** Minutes -> "Hh MMm"; null/non-finite -> 'N/A'. Negative shows a minus sign. */
export function fmtHoursMinutes(min) {
  if (min == null || !Number.isFinite(Number(min))) return 'N/A'
  const n = Number(min)
  const sign = n < 0 ? '-' : ''
  const abs = Math.abs(n)
  const h = Math.floor(abs / 60)
  const m = Math.round(abs % 60)
  return `${sign}${h}h ${String(m).padStart(2, '0')}m`
}
