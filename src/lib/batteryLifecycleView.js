/**
 * batteryLifecycleView - pure view engine for the redesigned Battery Lifecycle
 * page (/batteries). It sits on top of `batteriesAnalytics.js` (enrichment,
 * warranty state, filters, KPI roll-up) and never re-derives what that module
 * already owns. It only shapes the enriched rows into the mockup blocks:
 * the KPI strip, the health distribution donut, the 12-month replacement
 * forecast, the lifecycle stage bars and the register rows.
 *
 * No I/O and no clock read: `nowMs` is always injected.
 *
 * HONEST DATA. The `batteries` table has no battery type and no state of
 * charge column, so neither is shown as a value here. A battery with no
 * recorded health is "Not measured" and is left out of the health donut (and
 * counted separately), never scored as 0%. A battery with no install date
 * cannot be forecast and is counted as such, never placed in a month.
 */
import { filterBatteries, statusLabel } from './batteriesAnalytics'

const DAY_MS = 86_400_000

/**
 * Replacement forecast rule (stated on screen). A battery in service is
 * forecast for replacement when it reaches EXPECTED_LIFE_MONTHS from its
 * install date. A battery marked "replace", or one already past that point,
 * is due now. Retired batteries are never forecast.
 */
export const EXPECTED_LIFE_MONTHS = 36
/** A battery within this many months of its expected life is on aging watch. */
export const AGING_WATCH_MONTHS = 6

export const FORECAST_RULE =
  `Forecast: a battery in service is due for replacement ${EXPECTED_LIFE_MONTHS} months after its install date. ` +
  'Batteries marked Replace, or already past that point, are due now. Batteries with no install date cannot be forecast.'

export const HEALTH_BANDS = Object.freeze([
  { key: 'excellent', label: 'Excellent (90% and above)', color: '#16a34a', min: 90 },
  { key: 'good', label: 'Good (70 to 89%)', color: '#84cc16', min: 70 },
  { key: 'fair', label: 'Fair (50 to 69%)', color: '#f59e0b', min: 50 },
  { key: 'poor', label: 'Poor (below 50%)', color: '#ef4444', min: -Infinity },
])

/** Register status wording and pill tone per stored status. */
export const STATUS_VIEW = Object.freeze({
  healthy: { label: 'Active', tone: 'good' },
  weak: { label: 'Weak', tone: 'warn' },
  replace: { label: 'Needs replacement', tone: 'orange' },
  retired: { label: 'Retired', tone: 'muted' },
})

const toDate = (v) => {
  if (!v) return null
  const d = v instanceof Date ? v : new Date(v)
  return Number.isNaN(d.getTime()) ? null : d
}

/** Age in years (one decimal) from install date to now, or null. */
export function ageYears(installDate, nowMs) {
  const d = toDate(installDate)
  if (!d) return null
  const days = (Number(nowMs) - d.getTime()) / DAY_MS
  if (!Number.isFinite(days) || days < 0) return 0
  return Math.round((days / 365.25) * 10) / 10
}

/** Age in whole months, or null. */
export function ageMonths(installDate, nowMs) {
  const d = toDate(installDate)
  if (!d) return null
  const now = new Date(Number(nowMs))
  const m = (now.getUTCFullYear() - d.getUTCFullYear()) * 12 + (now.getUTCMonth() - d.getUTCMonth())
    - (now.getUTCDate() < d.getUTCDate() ? 1 : 0)
  return Math.max(0, m)
}

/** Expected replacement date: install date + EXPECTED_LIFE_MONTHS, or null. */
export function replacementDate(installDate, lifeMonths = EXPECTED_LIFE_MONTHS) {
  const d = toDate(installDate)
  if (!d) return null
  const out = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()))
  const day = out.getUTCDate()
  out.setUTCMonth(out.getUTCMonth() + lifeMonths)
  if (out.getUTCDate() < day) out.setUTCDate(0)
  return out
}

const inService = (r) => r?.status !== 'retired'

/** True when an in-service battery is due for replacement now. */
export function isReplacementDue(r, nowMs) {
  if (!inService(r)) return false
  if (r.status === 'replace') return true
  const due = replacementDate(r.install_date)
  return due != null && due.getTime() <= Number(nowMs)
}

const underWarranty = (r) => inService(r) && (r._warranty?.key === 'active' || r._warranty?.key === 'soon')
const lowHealth = (r) => inService(r) && r._health != null && r._health < 50

/** The six KPI tiles. No trends: nothing stores an earlier snapshot. */
export function lifecycleKpis(enriched = [], nowMs) {
  const list = Array.isArray(enriched) ? enriched : []
  const measured = list.filter((r) => r._health != null)
  const avg = measured.length
    ? Math.round((measured.reduce((s, r) => s + r._health, 0) / measured.length) * 10) / 10
    : null
  return {
    total: list.length,
    active: list.filter(inService).length,
    underWarranty: list.filter(underWarranty).length,
    lowHealth: list.filter(lowHealth).length,
    replacementsDue: list.filter((r) => isReplacementDue(r, nowMs)).length,
    avgHealth: avg,
    measured: measured.length,
  }
}

/** Health donut segments over measured batteries; `notMeasured` reported apart. */
export function healthDistribution(enriched = []) {
  const list = Array.isArray(enriched) ? enriched : []
  const counts = Object.fromEntries(HEALTH_BANDS.map((b) => [b.key, 0]))
  let notMeasured = 0
  let sum = 0
  let n = 0
  for (const r of list) {
    if (r._health == null) { notMeasured += 1; continue }
    const band = HEALTH_BANDS.find((b) => r._health >= b.min)
    counts[band.key] += 1
    sum += r._health
    n += 1
  }
  return {
    segments: HEALTH_BANDS.map((b) => ({ key: b.key, label: b.label, color: b.color, count: counts[b.key] })),
    measured: n,
    notMeasured,
    avg: n ? Math.round(sum / n) : null,
  }
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/**
 * Replacement forecast for the next `months` months starting with the current
 * month, per FORECAST_RULE. Returns { buckets, dueNow, unforecastable, total }.
 */
export function replacementForecast(enriched = [], nowMs, months = 12) {
  const now = new Date(Number(nowMs))
  const y0 = now.getUTCFullYear()
  const m0 = now.getUTCMonth()
  const buckets = Array.from({ length: months }, (_, i) => {
    const y = y0 + Math.floor((m0 + i) / 12)
    const m = (m0 + i) % 12
    return { key: `${y}-${String(m + 1).padStart(2, '0')}`, label: MONTHS[m], year: y, count: 0 }
  })
  let dueNow = 0
  let unforecastable = 0
  for (const r of Array.isArray(enriched) ? enriched : []) {
    if (!inService(r)) continue
    if (isReplacementDue(r, nowMs)) { dueNow += 1; continue }
    const due = replacementDate(r.install_date)
    if (!due) { unforecastable += 1; continue }
    const idx = (due.getUTCFullYear() - y0) * 12 + (due.getUTCMonth() - m0)
    if (idx >= 0 && idx < months) buckets[idx].count += 1
  }
  return { buckets, dueNow, unforecastable, total: buckets.reduce((s, b) => s + b.count, 0) }
}

/**
 * Lifecycle stage bars. Stages overlap on purpose (a battery can be in service
 * and under warranty at once), so shares are of the whole register.
 */
export function lifecycleStages(enriched = [], nowMs) {
  const list = Array.isArray(enriched) ? enriched : []
  const total = list.length
  const aging = (r) => {
    if (!inService(r) || isReplacementDue(r, nowMs)) return false
    if (r.status === 'weak') return true
    const age = ageMonths(r.install_date, nowMs)
    return age != null && age >= EXPECTED_LIFE_MONTHS - AGING_WATCH_MONTHS
  }
  const stages = [
    { key: 'in_service', label: 'In service', color: 'var(--cc-green)', tone: 't-green', count: list.filter(inService).length },
    { key: 'aging', label: 'Aging (watch)', color: 'var(--cc-amber)', tone: 't-amber', count: list.filter(aging).length },
    { key: 'due', label: 'Replacement due', color: 'var(--cc-orange)', tone: 't-red', count: list.filter((r) => isReplacementDue(r, nowMs)).length },
    { key: 'warranty', label: 'Under warranty', color: 'var(--cc-blue)', tone: 't-blue', count: list.filter(underWarranty).length },
    { key: 'retired', label: 'Out of service', color: 'var(--cc-ink-3)', tone: 'muted', count: list.filter((r) => !inService(r)).length },
  ]
  return stages.map((s) => ({ ...s, pct: total ? Math.round((s.count / total) * 100) : null }))
}

export const STAGE_RULE =
  `In service: not retired. Aging (watch): marked Weak, or within ${AGING_WATCH_MONTHS} months of the ${EXPECTED_LIFE_MONTHS} month expected life. ` +
  'Replacement due: marked Replace or past expected life. Under warranty: in service with warranty time left. Out of service: retired. A battery can sit in more than one stage.'

/** Unique sorted site names. */
export function siteOptions(rows = []) {
  return [...new Set((Array.isArray(rows) ? rows : []).map((r) => r?.site).filter(Boolean))].sort()
}

/** Register filter: the shared filterBatteries plus a site match. */
export function filterRegister(enriched = [], f = {}) {
  const base = filterBatteries(enriched, f)
  return f.site ? base.filter((r) => r.site === f.site) : base
}

/** Warranty cell text: "Valid (1.2 yrs)", "Expired", "Not recorded". */
export function warrantyText(w) {
  if (!w || w.key === 'unknown') return { text: 'Not recorded', tone: 'muted' }
  if (w.key === 'expired') return { text: 'Expired', tone: 'bad' }
  const yrs = Math.round((w.daysLeft / 365.25) * 10) / 10
  const span = yrs >= 1 ? `${yrs} yrs` : `${Math.max(0, w.daysLeft)} days`
  return { text: `Valid (${span})`, tone: w.key === 'soon' ? 'warn' : 'good' }
}

/** Health pill tone by band. */
export function healthTone(pct) {
  if (pct == null) return 'muted'
  if (pct >= 70) return 'good'
  if (pct >= 50) return 'warn'
  return 'bad'
}

export function statusView(status) {
  return STATUS_VIEW[status] || { label: statusLabel(status), tone: 'muted' }
}
