/**
 * Command Center engine: pure shaping for the dashboard's home screen.
 *
 * Every function takes rows the service already read and returns what a card
 * renders. Nothing here fetches. A value that cannot be measured comes back as
 * null so the card can say "N/A" instead of printing a flattering zero.
 */
import { bandFor } from './tyreRunningLife'
import { pmAssetDueStatus } from './pmSchedule'

const num = (v) => {
  if (v === null || v === undefined || v === '') return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}
const pct = (part, whole) => (whole > 0 ? Math.round((part / whole) * 1000) / 10 : null)
const DAY = 86_400_000

/** "Good morning" / "Good afternoon" / "Good evening" from the local hour. */
export function greeting(now = new Date()) {
  const h = now.getHours()
  if (h < 12) return 'Good morning'
  if (h < 17) return 'Good afternoon'
  return 'Good evening'
}

/** "10m ago", "2h ago", "3d ago"; null when the timestamp cannot be read. */
export function timeAgo(value, now = Date.now()) {
  const t = new Date(value).getTime()
  if (!Number.isFinite(t)) return null
  const mins = Math.max(0, Math.round((now - t) / 60_000))
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.round(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  const days = Math.round(hrs / 24)
  if (days < 30) return `${days}d ago`
  return `${Math.round(days / 30)}mo ago`
}

/**
 * Change over the last 30 days for a count that only grows by adding rows:
 * how many of today's rows existed 30 days ago versus now. null when nothing
 * existed then, because a percentage over zero is not a trend.
 */
export function growthPct(rows, now = Date.now(), predicate = () => true) {
  const cutoff = now - 30 * DAY
  const current = rows.filter(predicate).length
  const before = rows.filter((r) => predicate(r) && new Date(r.created_at).getTime() < cutoff).length
  if (!before) return null
  return Math.round(((current - before) / before) * 1000) / 10
}

/** Fleet register totals, the country split for the map, and data completeness. */
export function fleetStats(rows = [], now = Date.now()) {
  const isActive = (r) => String(r.status || '').toLowerCase() === 'active'
  const missingSpecs = (r) => !r.make || !r.model
  const noPolicy = (r) => !num(r.expected_km_per_tyre) && !num(r.min_days_between_changes)
  const complete = (r) => r.make && r.model && r.site && r.vehicle_type
  const byCountry = {}
  const sites = new Set()
  for (const r of rows) {
    const c = r.country || 'Unassigned'
    byCountry[c] ||= { country: c, total: 0, active: 0, inactive: 0 }
    byCountry[c].total += 1
    if (isActive(r)) byCountry[c].active += 1
    else byCountry[c].inactive += 1
    if (r.site) sites.add(String(r.site).trim().toUpperCase())
  }
  return {
    total: rows.length,
    active: rows.filter(isActive).length,
    inactive: rows.filter((r) => !isActive(r)).length,
    missingSpecs: rows.filter(missingSpecs).length,
    noPolicy: rows.filter(noPolicy).length,
    sites: sites.size,
    countries: Object.keys(byCountry).filter((c) => c !== 'Unassigned').length,
    byCountry: Object.values(byCountry).sort((a, b) => b.total - a.total),
    completenessPct: pct(rows.filter(complete).length, rows.length),
    trend: {
      total: growthPct(rows, now),
      active: growthPct(rows, now, isActive),
    },
  }
}

/** Tyre health bands, in the order the donut draws them. */
export const TYRE_HEALTH = [
  { key: 'good', label: 'Good', band: 'healthy', color: '#22c55e' },
  { key: 'monitor', label: 'Monitor', band: 'mid-life', color: '#facc15' },
  { key: 'replace', label: 'Replace Soon', band: 'due-soon', color: '#f97316' },
  { key: 'critical', label: 'Critical', band: 'overdue', color: '#ef4444' },
]

/**
 * Health of every fitted tyre, from the same running-life judgement the Tyre
 * Lifecycle page uses. Tyres whose life cannot be measured are counted as
 * `unmeasured` and left out of the percentages.
 */
export function tyreHealth(rows = []) {
  const counts = Object.fromEntries(TYRE_HEALTH.map((b) => [b.key, 0]))
  let unmeasured = 0
  for (const r of rows) {
    const band = bandFor(r)
    const hit = TYRE_HEALTH.find((b) => b.band === band)
    if (hit) counts[hit.key] += 1
    else unmeasured += 1
  }
  const measured = TYRE_HEALTH.reduce((s, b) => s + counts[b.key], 0)
  return {
    measured,
    unmeasured,
    goodPct: pct(counts.good, measured),
    bands: TYRE_HEALTH.map((b) => ({ ...b, count: counts[b.key], pct: pct(counts[b.key], measured) })),
  }
}

const CLOSED = /^(closed|resolved|done|completed|cancelled|rejected)$/i
const CRITICAL = /^(critical|high)$/i
const MAINT = /maint|service|repair|workshop|pm|tyre/i

/** Open action items, tagged into the card's four tabs. */
export function actionBuckets(items = []) {
  const open = items.filter((i) => !CLOSED.test(String(i.status || '')))
  const tag = (i) => ({
    ...i,
    tone: CRITICAL.test(String(i.severity || '')) ? 'critical'
      : MAINT.test(`${i.category || ''} ${i.source || ''}`) ? 'maintenance' : 'info',
  })
  const all = open.map(tag)
  return {
    all,
    critical: all.filter((i) => i.tone === 'critical'),
    maintenance: all.filter((i) => i.tone === 'maintenance'),
    info: all.filter((i) => i.tone === 'info'),
  }
}

/** Maintenance-due categories, matched on the plan's own name. */
export const MAINT_TYPES = [
  { key: 'inspection', label: 'Tyre Inspection', test: /inspect/i, color: '#ef4444' },
  { key: 'service', label: 'Scheduled Service', test: /service|pm\b|hour|oil|filter/i, color: '#f97316' },
  { key: 'replacement', label: 'Tyre Replacement', test: /replace|tyre change|tire change|fitment/i, color: '#facc15' },
  { key: 'regroove', label: 'Regrooving', test: /regroov/i, color: '#22c55e' },
  { key: 'general', label: 'General Maintenance', test: /.*/, color: '#22c55e' },
]

/**
 * Preventive plans that are overdue or due soon, by date or meter, grouped by
 * what the plan is for.
 */
export function maintenanceDue({ plans = [], kmByAsset = {}, hoursByAsset = {} } = {}, now = new Date()) {
  const due = plans.filter((p) => String(p.status || 'active').toLowerCase() === 'active')
    .filter((p) => {
      const { band } = pmAssetDueStatus(p, {
        now, currentKm: kmByAsset[p.asset_no], currentHours: hoursByAsset[p.asset_no],
      })
      return band === 'overdue' || band === 'due_soon'
    })
  const groups = MAINT_TYPES.map((t) => ({ ...t, count: 0 }))
  for (const p of due) {
    const text = `${p.name || ''} ${p.service_type || ''} ${p.category || ''}`
    const g = groups.find((x) => x.test.test(text))
    g.count += 1
  }
  const max = Math.max(1, ...groups.map((g) => g.count))
  return { total: due.length, groups: groups.map((g) => ({ ...g, ratio: g.count / max })) }
}

/** Work orders opened in each window, for the Today / This week / This month tabs. */
export function workshopWindows(now = new Date()) {
  const d = new Date(now)
  const start = new Date(d.getFullYear(), d.getMonth(), d.getDate())
  const week = new Date(start); week.setDate(start.getDate() - start.getDay())
  const month = new Date(d.getFullYear(), d.getMonth(), 1)
  return { today: start.toISOString(), week: week.toISOString(), month: month.toISOString() }
}

/** A work order's status reduced to the two pills the card shows. */
export function workStatus(status) {
  const s = String(status || '').toLowerCase()
  if (/complete|closed|done/.test(s)) return { label: 'Completed', tone: 'good' }
  if (/cancel/.test(s)) return { label: 'Cancelled', tone: 'muted' }
  if (/wait|part|hold/.test(s)) return { label: 'Waiting', tone: 'warn' }
  if (/progress|assigned|quality/.test(s)) return { label: 'In Progress', tone: 'info' }
  return { label: 'Open', tone: 'info' }
}

/**
 * Average utilisation per month from telematics snapshots, oldest first,
 * limited to the last `months` months that have readings.
 */
export function utilizationByMonth(rows = [], months = 6) {
  const byMonth = {}
  for (const r of rows) {
    const u = num(r.utilization_pct)
    const m = String(r.captured_at || r.created_at || '').slice(0, 7)
    if (u == null || !/^\d{4}-\d{2}$/.test(m)) continue
    byMonth[m] ||= { month: m, sum: 0, n: 0 }
    byMonth[m].sum += u; byMonth[m].n += 1
  }
  const series = Object.values(byMonth).sort((a, b) => a.month.localeCompare(b.month)).slice(-months)
    .map((m) => ({ month: m.month, value: Math.round((m.sum / m.n) * 10) / 10 }))
  const all = rows.map((r) => num(r.utilization_pct)).filter((v) => v != null)
  return { series, average: all.length ? Math.round((all.reduce((a, b) => a + b, 0) / all.length) * 10) / 10 : null }
}

/** Short month label: "2026-03" -> "Mar". */
export function monthLabel(ym) {
  const [y, m] = String(ym).split('-').map(Number)
  if (!y || !m) return String(ym)
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleString('en-US', { month: 'short', timeZone: 'UTC' })
}

/** Change between two amounts as a percentage, null when there is no base. */
export function changePct(current, previous) {
  const c = num(current); const p = num(previous)
  if (c == null || !p) return null
  return Math.round(((c - p) / p) * 1000) / 10
}

/** Country centroids for the fleet map (longitude, latitude). */
export const COUNTRY_POINTS = {
  KSA: [45.1, 24.0], 'Saudi Arabia': [45.1, 24.0],
  UAE: [54.4, 24.2], 'United Arab Emirates': [54.4, 24.2],
  Egypt: [30.8, 26.8], Qatar: [51.2, 25.3], Oman: [57.5, 21.5], Kuwait: [47.6, 29.3],
  Bahrain: [50.6, 26.1], Jordan: [36.2, 31.0], Pakistan: [69.3, 30.4], India: [78.9, 21.0],
}

/** Compact money: 482310 -> "482.3K". */
export function compact(v) {
  const n = num(v)
  if (n == null) return 'N/A'
  const a = Math.abs(n)
  if (a >= 1e6) return `${(n / 1e6).toFixed(1)}M`
  if (a >= 1e3) return `${(n / 1e3).toFixed(1)}K`
  return String(Math.round(n))
}
