/**
 * fuelTheftAlertsView - pure view model for the redesigned Fuel Theft Alerts
 * page (/fuel-theft-alerts). Builds on fuelTheftAlertsAnalytics (loss per
 * currency, open/closed rules) and shapes the mockup's sections: headline
 * tiles, the daily variance trend, after-hours split, loss hotspots by
 * location, the investigation timeline and recommended next steps.
 *
 * The fuel_theft_alerts table records asset, driver, location, detected time,
 * drop / expected litres, price, loss, severity, status and resolution. It has
 * NO fuel card, geofence, coordinates, tank-level series, odometer series,
 * alert type or recovered amount, so those mockup values are not produced
 * here and the page labels them as not recorded.
 *
 * `now` is injected so ranges and ageing are deterministic. No I/O.
 */
import { toFiniteNumber } from './fuelTheftAlerts'
import { isOpenAlert } from './fuelTheftAlertsAnalytics'

const DAY = 24 * 3600 * 1000
const lower = (v) => (v == null ? '' : String(v).trim().toLowerCase())
const pad = (n) => String(n).padStart(2, '0')
const isoDay = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`

/** After-hours window used for the after-hours card (local time). */
export const AFTER_HOURS = { start: 22, end: 5 }

/**
 * Headline tiles. Recovered amount and suspected siphoning have no source
 * column, so they are null. False positive rate = dismissed share of the
 * alerts that reached a decision (dismissed, confirmed or resolved).
 */
export function fuelHeadline(rows = []) {
  const list = Array.isArray(rows) ? rows : []
  const count = (s) => list.filter((r) => lower(r?.status) === s).length
  const dismissed = count('dismissed')
  const decided = dismissed + count('confirmed') + count('resolved')
  return {
    total: list.length,
    active: count('open'),
    unresolved: list.filter(isOpenAlert).length,
    investigating: count('investigating'),
    confirmed: count('confirmed'),
    decided,
    falsePositivePct: decided ? Math.round((dismissed / decided) * 1000) / 10 : null,
    recovered: null,
    siphoning: null,
  }
}

/** Range bounds: explicit from/to (YYYY-MM-DD), else the 30 days ending `now`. */
export function rangeBounds(from = '', to = '', now = Date.now()) {
  const ref = new Date(now instanceof Date ? now.getTime() : Number(now))
  const end = to ? new Date(`${to}T00:00:00`) : new Date(ref.getFullYear(), ref.getMonth(), ref.getDate())
  const start = from ? new Date(`${from}T00:00:00`) : new Date(end.getTime() - 29 * DAY)
  return { start, end }
}

/**
 * Litres lost per day across the range (negative = fuel lost). Days with no
 * alert are 0 alerts; their litres value is null, never a measured 0.
 */
export function dailyVariance(rows = [], { from = '', to = '', now = Date.now() } = {}) {
  const { start, end } = rangeBounds(from, to, now)
  const days = []
  const index = new Map()
  for (let t = new Date(start); t <= end && days.length < 400; t = new Date(t.getFullYear(), t.getMonth(), t.getDate() + 1)) {
    const key = isoDay(t)
    index.set(key, days.length)
    days.push({ day: key, litres: null, count: 0 })
  }
  for (const r of Array.isArray(rows) ? rows : []) {
    const t = r?.detected_at ? new Date(r.detected_at) : null
    if (!t || Number.isNaN(t.getTime())) continue
    const i = index.get(isoDay(t))
    if (i == null) continue
    days[i].count += 1
    const drop = toFiniteNumber(r.drop_litres)
    if (drop != null) days[i].litres = (days[i].litres || 0) - drop
  }
  const measured = days.filter((d) => d.litres != null)
  return { days, measuredDays: measured.length, totalLitres: measured.length ? measured.reduce((a, d) => a + d.litres, 0) : null }
}

function severityBucket(r) {
  const s = lower(r?.severity)
  if (s === 'critical' || s === 'high') return 'high'
  if (s === 'medium') return 'medium'
  if (s === 'low') return 'low'
  return 'unrated'
}

export function isAfterHours(iso, win = AFTER_HOURS) {
  const t = iso ? new Date(iso) : null
  if (!t || Number.isNaN(t.getTime())) return null
  const h = t.getHours()
  return win.start > win.end ? (h >= win.start || h < win.end) : (h >= win.start && h < win.end)
}

/** Alerts detected inside the after-hours window, split by severity. */
export function afterHoursSplit(rows = [], win = AFTER_HOURS) {
  const out = { total: 0, timed: 0, high: 0, medium: 0, low: 0, unrated: 0 }
  for (const r of Array.isArray(rows) ? rows : []) {
    const a = isAfterHours(r?.detected_at, win)
    if (a == null) continue
    out.timed += 1
    if (!a) continue
    out.total += 1
    out[severityBucket(r)] += 1
  }
  return out
}

export function hotspotBand(count) {
  if (count >= 10) return 'high'
  if (count >= 4) return 'medium'
  return 'low'
}

/**
 * Alerts grouped by recorded location. Litres is null when no alert at that
 * location records a drop. `unlocated` counts alerts with no location.
 */
export function locationHotspots(rows = []) {
  const map = new Map()
  let unlocated = 0
  for (const r of Array.isArray(rows) ? rows : []) {
    const loc = String(r?.location || '').trim()
    if (!loc) { unlocated += 1; continue }
    const k = loc.toLowerCase()
    const e = map.get(k) || { location: loc, count: 0, open: 0, litres: null }
    e.count += 1
    if (isOpenAlert(r)) e.open += 1
    const drop = toFiniteNumber(r.drop_litres)
    if (drop != null) e.litres = (e.litres || 0) + drop
    map.set(k, e)
  }
  const list = [...map.values()].map((e) => ({ ...e, band: hotspotBand(e.count) }))
  return {
    byCount: [...list].sort((a, b) => b.count - a.count || a.location.localeCompare(b.location)),
    byLitres: list.filter((e) => e.litres != null).sort((a, b) => b.litres - a.litres),
    unlocated,
  }
}

/** Investigation timeline from the alert's own timestamps. */
export function alertTimeline(alert) {
  if (!alert) return []
  const out = []
  const push = (at, text, tone) => {
    const t = at ? Date.parse(at) : NaN
    if (Number.isFinite(t)) out.push({ at: new Date(t).toISOString(), t, text, tone })
  }
  const drop = toFiniteNumber(alert.drop_litres)
  push(alert.detected_at, drop != null ? `Fuel drop detected (-${drop.toLocaleString('en-US')} L)` : 'Fuel drop detected', 'bad')
  push(alert.created_at, 'Alert logged in Tyre Pulse', 'info')
  if (alert.updated_at && alert.updated_at !== alert.created_at) {
    const st = lower(alert.status)
    push(alert.updated_at, `Last updated${st ? `, status ${st}` : ''}`, st === 'resolved' || st === 'dismissed' ? 'good' : 'warn')
  }
  return out.sort((a, b) => a.t - b.t)
}

/** Next steps for an alert, from its severity and status. Guidance only. */
export function recommendedActions(alert) {
  if (!alert) return []
  const st = lower(alert.status)
  const sev = lower(alert.severity)
  if (st === 'resolved' || st === 'dismissed') {
    return [{ title: 'Review the outcome', sub: alert.resolution ? 'Resolution is recorded on the alert' : 'Record a resolution so the closure can be audited' }]
  }
  const out = [
    { title: 'Review site CCTV footage', sub: 'Check entry and exit around the detected time' },
    { title: 'Verify with the driver and site manager', sub: 'Confirm who had custody of the vehicle' },
    { title: 'Inspect the vehicle for tampering', sub: 'Check fuel tank, locks and sensors' },
    { title: 'Cross-check fuel transactions', sub: 'Match refuels against the drop' },
  ]
  if (sev === 'critical' || sev === 'high' || st === 'confirmed') {
    out.push({ title: 'Escalate to the security team', sub: 'If confirmed as theft, file a formal case' })
  }
  return out
}

const SEV_RANK = { unrated: 0, low: 1, medium: 2, high: 3 }

/**
 * Rows for the "Fuel Card Misuse" card. Alerts carry no fuel card, so repeat
 * loss is grouped by asset instead: alert count, litres lost (null when no
 * alert records a drop, never 0) and the worst severity band seen.
 */
export function cardMisuseRows(rows = [], limit = 5) {
  const map = new Map()
  for (const r of Array.isArray(rows) ? rows : []) {
    const asset = String(r?.asset_no || '').trim()
    if (!asset) continue
    const e = map.get(asset) || { asset_no: asset, alerts: 0, litres: null, band: 'unrated' }
    e.alerts += 1
    const drop = toFiniteNumber(r.drop_litres)
    if (drop != null) e.litres = (e.litres || 0) + drop
    const b = severityBucket(r)
    if (SEV_RANK[b] > SEV_RANK[e.band]) e.band = b
    map.set(asset, e)
  }
  return [...map.values()]
    .sort((a, b) => b.alerts - a.alerts || (b.litres ?? -1) - (a.litres ?? -1) || a.asset_no.localeCompare(b.asset_no))
    .slice(0, limit)
}

/** Distinct recorded locations, for the hotspot site filter. */
export function locationOptions(rows = []) {
  const seen = new Map()
  for (const r of Array.isArray(rows) ? rows : []) {
    const loc = String(r?.location || '').trim()
    if (loc && !seen.has(loc.toLowerCase())) seen.set(loc.toLowerCase(), loc)
  }
  return [...seen.values()].sort((a, b) => a.localeCompare(b))
}
