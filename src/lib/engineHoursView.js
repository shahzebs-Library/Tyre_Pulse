/**
 * engineHoursView.js - pure view engine for the redesigned Engine Hours page
 * (/engine-hours). No I/O: every function takes its data and an explicit `now`.
 *
 * It sits ON TOP of engineHoursAnalytics.js (which owns the per-asset hours
 * maths: monotonic accumulation, average daily hours, meter-drop anomalies) and
 * pmSchedule.js (which owns "how far is this plan from its next due meter").
 * Nothing here re-derives those; it joins them with the fleet register and the
 * telematics snapshots and shapes them for the page.
 *
 * Honesty rules: a figure without a source is null (rendered N/A), never 0.
 * An asset with fewer than two readings has no measurable utilisation.
 */
import { assetUtilization, hoursAddedPerPeriod, detectAnomalies, toNum } from './engineHoursAnalytics'
import { resolveMeter, meterToDue, METER_DUE_SOON } from './pmSchedule'

/** Defaults for the per-device display settings on the Settings tab. */
export const DEFAULT_SETTINGS = Object.freeze({
  // Below this many run-hours per day an asset reads as low utilisation (the
  // existing engine's LOW_UTILISATION_HOURS_PER_DAY).
  lowHoursPerDay: 1,
  // Utilisation % = average daily run-hours / this basis.
  basisHoursPerDay: 24,
  // No reading for more than this many days = the reading is overdue.
  staleDays: 30,
  // Within this many hours of the next service = near service. Defaults to the
  // Preventive Maintenance module's own engine-hour due-soon window.
  serviceWindowHours: METER_DUE_SOON.engine_hours,
})

const clampNum = (v, min, max, dflt) => {
  const n = Number(v)
  if (!Number.isFinite(n)) return dflt
  return Math.min(max, Math.max(min, n))
}

/** Clamp a stored settings object to sane ranges, filling gaps with defaults. */
export function normalizeSettings(raw) {
  const s = raw && typeof raw === 'object' ? raw : {}
  return {
    lowHoursPerDay: clampNum(s.lowHoursPerDay, 0.1, 24, DEFAULT_SETTINGS.lowHoursPerDay),
    basisHoursPerDay: clampNum(s.basisHoursPerDay, 1, 24, DEFAULT_SETTINGS.basisHoursPerDay),
    staleDays: Math.round(clampNum(s.staleDays, 1, 365, DEFAULT_SETTINGS.staleDays)),
    serviceWindowHours: clampNum(s.serviceWindowHours, 1, 5000, DEFAULT_SETTINGS.serviceWindowHours),
  }
}

/** Local calendar day 'YYYY-MM-DD' of a Date (never toISOString, which is UTC). */
export function localDay(now = new Date()) {
  const d = now instanceof Date && !Number.isNaN(now.getTime()) ? now : new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

const upper = (v) => (v == null ? '' : String(v).trim().toUpperCase())
const dayOf = (r) => String((r && (r.reading_date || r.created_at)) || '').slice(0, 10)

// ── Utilisation status ──────────────────────────────────────────────────────

export const UTIL_STATUS = {
  active: { label: 'Active', tone: 'good', color: '#16a34a' },
  low: { label: 'Low utilization', tone: 'warn', color: '#f59e0b' },
  idle: { label: 'Idle', tone: 'bad', color: '#ef4444' },
  no_data: { label: 'No data', tone: 'muted', color: '#94a3b8' },
}
export const UTIL_STATUS_KEYS = ['active', 'low', 'idle', 'no_data']

/**
 * Classify average daily run-hours. null (fewer than two readings, or no span)
 * is 'no_data'; a meter that did not move over its span is 'idle'.
 */
export function classifyUtilization(avgDailyHours, lowHoursPerDay = DEFAULT_SETTINGS.lowHoursPerDay) {
  if (avgDailyHours == null || !Number.isFinite(Number(avgDailyHours))) return 'no_data'
  const v = Number(avgDailyHours)
  if (v <= 0) return 'idle'
  if (v < lowHoursPerDay) return 'low'
  return 'active'
}

// ── Joins ───────────────────────────────────────────────────────────────────

/**
 * Index fleet rows by asset number. The same code can exist in more than one
 * country, so each key keeps every country's row; lookup prefers the reading's
 * own country and refuses to guess when several countries match.
 */
function indexByAsset(rows) {
  const map = new Map()
  for (const r of Array.isArray(rows) ? rows : []) {
    const k = upper(r?.asset_no)
    if (!k) continue
    if (!map.has(k)) map.set(k, [])
    map.get(k).push(r)
  }
  return map
}

function pick(index, assetNo, country) {
  const list = index.get(upper(assetNo)) || []
  if (!list.length) return null
  if (country) {
    const same = list.filter((r) => (r.country || '') === country)
    if (same.length === 1) return same[0]
    if (same.length > 1) return null
  }
  return list.length === 1 ? list[0] : null
}

/** Latest telematics snapshot per asset+country (by captured_at). */
function latestSnapshots(utilRows) {
  const best = new Map()
  for (const r of Array.isArray(utilRows) ? utilRows : []) {
    const k = upper(r?.asset_no)
    if (!k) continue
    const key = `${k}|${r.country || ''}`
    const prev = best.get(key)
    if (!prev || String(r.captured_at || '') > String(prev.captured_at || '')) best.set(key, r)
  }
  return [...best.values()]
}

/**
 * One row per asset for the readings table: the analytics engine's profile
 * joined with the fleet register (make, model, fleet number) and settings.
 *
 * @param {object[]} readings engine_hours_logs rows (already filtered)
 * @param {{ fleet?:object[], now?:Date, settings?:object }} [opts]
 */
export function assetProfiles(readings, { fleet = [], now = new Date(), settings = DEFAULT_SETTINGS } = {}) {
  const cfg = normalizeSettings(settings)
  const list = Array.isArray(readings) ? readings : []
  const fleetIndex = indexByAsset(fleet)
  const latestRow = new Map()
  for (const r of list) {
    const k = String(r?.asset_no || '').trim()
    if (!k) continue
    const prev = latestRow.get(k)
    if (!prev || dayOf(r) > dayOf(prev) || (dayOf(r) === dayOf(prev) && String(r.created_at || '') >= String(prev.created_at || ''))) latestRow.set(k, r)
  }

  return assetUtilization(list, now).map((p) => {
    const last = latestRow.get(p.asset_no) || {}
    const f = pick(fleetIndex, p.asset_no, last.country)
    const periods = hoursAddedPerPeriod(list, p.asset_no)
    const lastPeriod = periods[periods.length - 1] || null
    const status = classifyUtilization(p.avgDailyHours, cfg.lowHoursPerDay)
    const utilizationPct = p.avgDailyHours == null ? null
      : Math.round((p.avgDailyHours / cfg.basisHoursPerDay) * 1000) / 10
    return {
      asset_no: p.asset_no,
      country: last.country || f?.country || null,
      site: last.site || f?.site || null,
      fleet_number: f?.fleet_number || null,
      make: f?.make || null,
      model: f?.model || null,
      vehicle_type: f?.vehicle_type || null,
      inRegister: Boolean(f),
      currentHours: p.latestHours,
      lastReadingDate: p.latestDate || null,
      lastReadingDaysAgo: p.lastReadingDaysAgo,
      readingOverdue: p.lastReadingDaysAgo != null && p.lastReadingDaysAgo > cfg.staleDays,
      // Hours added since the previous reading (a meter drop reads as 0 added,
      // and is listed on the Anomalies tab instead).
      sincePrevious: lastPeriod ? Math.round(lastPeriod.added * 10) / 10 : null,
      sincePreviousDays: lastPeriod ? lastPeriod.days : null,
      avgDailyHours: p.avgDailyHours,
      utilizationPct,
      status,
      readings: p.readings,
      anomalies: p.anomalies,
      hoursAdded: p.hoursAdded,
    }
  })
}

/** Filter asset profiles by make, model, utilisation status and free text. */
export function filterProfiles(profiles, { make, model, status, search } = {}) {
  const q = search ? String(search).trim().toLowerCase() : ''
  return (Array.isArray(profiles) ? profiles : []).filter((p) => {
    if (make && (p.make || '') !== make) return false
    if (model && (p.model || '') !== model) return false
    if (status === 'overdue') { if (!p.readingOverdue) return false } else if (status && p.status !== status) return false
    if (q) {
      const hay = `${p.asset_no} ${p.fleet_number || ''} ${p.make || ''} ${p.model || ''} ${p.site || ''}`.toLowerCase()
      if (!hay.includes(q)) return false
    }
    return true
  })
}

/** Donut segments for the utilisation status card (every status, even at 0). */
export function utilizationSegments(profiles) {
  const counts = { active: 0, low: 0, idle: 0, no_data: 0 }
  for (const p of Array.isArray(profiles) ? profiles : []) counts[p.status] = (counts[p.status] || 0) + 1
  return UTIL_STATUS_KEYS.map((k) => ({ key: k, label: UTIL_STATUS[k].label, color: UTIL_STATUS[k].color, count: counts[k] }))
}

// ── Trends ──────────────────────────────────────────────────────────────────

/**
 * Daily run-hours for the `days` days ending today (local calendar). Hours are
 * the positive gain between an asset's consecutive readings, counted on the
 * day of the LATER reading; a gap spanning several days lands on the day it
 * was measured, it is never spread across days nobody read.
 * @returns {{ day:string, label:string, hours:number, readings:number }[]}
 */
export function dailyHoursTrend(readings, { days = 30, now = new Date() } = {}) {
  const n = Math.max(1, Math.min(366, Math.round(days)))
  const end = now instanceof Date && !Number.isNaN(now.getTime()) ? now : new Date()
  const buckets = []
  const index = new Map()
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(end.getFullYear(), end.getMonth(), end.getDate() - i)
    const day = localDay(d)
    const b = { day, label: `${d.getDate()} ${d.toLocaleString('en-US', { month: 'short' })}`, hours: 0, readings: 0 }
    buckets.push(b)
    index.set(day, b)
  }
  const list = Array.isArray(readings) ? readings : []
  for (const r of list) {
    const b = index.get(dayOf(r))
    if (b) b.readings += 1
  }
  const keys = [...new Set(list.map((r) => String(r?.asset_no || '').trim()).filter(Boolean))]
  for (const key of keys) {
    for (const p of hoursAddedPerPeriod(list, key)) {
      if (p.added <= 0) continue
      const b = index.get(dayOf(p.to))
      if (b) b.hours += p.added
    }
  }
  for (const b of buckets) b.hours = Math.round(b.hours * 10) / 10
  return buckets
}

/**
 * Telematics working / idle / driving time for the assets in view, from each
 * asset's latest snapshot. Null hours when no snapshot carries that figure.
 */
export function telematicsSummary(utilRows, assetNos) {
  const want = assetNos ? new Set([...assetNos].map(upper)) : null
  const snaps = latestSnapshots(utilRows).filter((r) => !want || want.has(upper(r.asset_no)))
  const sum = (field) => {
    const vals = snaps.map((r) => toNum(r[field])).filter((v) => v != null)
    return vals.length ? Math.round((vals.reduce((s, v) => s + v, 0) / 3600) * 10) / 10 : null
  }
  const dates = snaps.map((r) => String(r.captured_at || '').slice(0, 10)).filter(Boolean).sort()
  return {
    assets: snaps.length,
    workingHours: sum('working_seconds'),
    idleHours: sum('idle_seconds'),
    drivingHours: sum('driving_seconds'),
    from: dates[0] || null,
    to: dates[dates.length - 1] || null,
  }
}

// ── Anomalies ───────────────────────────────────────────────────────────────

/**
 * Meter jumps: consecutive readings that imply more run-hours than a day holds
 * (more than 24 h per elapsed day, or more than 24 h between two readings on
 * the same day). A keying error or a meter swap, never real running.
 */
export function detectJumps(readings, { maxPerDay = 24 } = {}) {
  const list = Array.isArray(readings) ? readings : []
  const keys = [...new Set(list.map((r) => String(r?.asset_no || '').trim()).filter(Boolean))]
  const out = []
  for (const key of keys) {
    for (const p of hoursAddedPerPeriod(list, key)) {
      if (p.added <= 0) continue
      const days = p.days == null ? null : Math.max(p.days, 0)
      const limit = maxPerDay * Math.max(days ?? 0, 1)
      if (days == null || p.added <= limit) continue
      out.push({
        id: p.to && p.to.id != null ? `jump:${p.to.id}` : `jump:${key}:${dayOf(p.to)}`,
        type: 'jump',
        asset_no: key,
        reading_date: dayOf(p.to),
        engine_hours: toNum(p.to.engine_hours),
        prevHours: toNum(p.from.engine_hours),
        prevDate: dayOf(p.from),
        change: Math.round(p.added * 10) / 10,
        perDay: Math.round((p.added / Math.max(days, 1)) * 10) / 10,
      })
    }
  }
  return out
}

/** Meter drops (existing engine) and jumps in one list, newest first. */
export function allAnomalies(readings) {
  const drops = detectAnomalies(readings).map((a) => ({ ...a, type: 'drop', change: a.drop == null ? null : -a.drop, perDay: null }))
  return [...drops, ...detectJumps(readings)]
    .sort((a, b) => String(b.reading_date).localeCompare(String(a.reading_date)))
}

// ── Service thresholds ──────────────────────────────────────────────────────

/** Latest numeric reading per asset+country, plus an asset-only fallback. */
export function latestHoursIndex(readings) {
  const byKey = new Map()
  for (const r of Array.isArray(readings) ? readings : []) {
    const h = toNum(r?.engine_hours)
    const a = upper(r?.asset_no)
    if (h == null || !a) continue
    const key = `${a}|${r.country || ''}`
    const prev = byKey.get(key)
    const rank = `${dayOf(r)}|${r.created_at || ''}`
    if (!prev || rank >= prev.rank) byKey.set(key, { hours: h, day: dayOf(r), rank, country: r.country || '' })
  }
  return byKey
}

function hoursFor(index, assetNo, country) {
  const a = upper(assetNo)
  if (country && index.has(`${a}|${country}`)) return index.get(`${a}|${country}`)
  const matches = [...index.entries()].filter(([k]) => k.startsWith(`${a}|`))
  return matches.length === 1 ? matches[0][1] : null
}

export const THRESHOLD_STATUS = {
  exceeded: { label: 'Exceeded', tone: 'bad' },
  near: { label: 'Near service', tone: 'warn' },
  ok: { label: 'On track', tone: 'good' },
  unknown: { label: 'Not measurable', tone: 'muted' },
}

/**
 * Active maintenance plans measured in engine hours, each with the asset's
 * latest reading, the hours left to its next due meter and a status. A plan
 * with no reading or no next due meter is 'unknown', never on track.
 */
export function serviceThresholds(plans, readings, { settings = DEFAULT_SETTINGS } = {}) {
  const cfg = normalizeSettings(settings)
  const index = latestHoursIndex(readings)
  return (Array.isArray(plans) ? plans : [])
    .filter((p) => p && String(p.status || 'active').toLowerCase() === 'active')
    .filter((p) => resolveMeter(p).source === 'engine_hours')
    .map((p) => {
      const latest = p.asset_no ? hoursFor(index, p.asset_no, p.country) : null
      const current = latest ? latest.hours : null
      const remaining = meterToDue(p, current)
      let status = 'unknown'
      let reason = null
      if (!p.asset_no) reason = 'Plan covers an asset type, not one asset'
      else if (current == null) reason = 'No engine-hour reading for this asset'
      else if (remaining == null) reason = 'No next due hours on the plan'
      else status = remaining < 0 ? 'exceeded' : remaining <= cfg.serviceWindowHours ? 'near' : 'ok'
      return {
        id: p.id,
        name: p.name || 'Unnamed plan',
        asset_no: p.asset_no || null,
        asset_type: p.asset_type || null,
        site: p.site || null,
        interval: toNum(p.meter_interval),
        lastDoneHours: toNum(p.last_done_meter),
        nextDueHours: toNum(p.next_due_meter),
        currentHours: current,
        lastReadingDate: latest ? latest.day : null,
        remaining: remaining == null ? null : Math.round(remaining * 10) / 10,
        status,
        reason,
        priority: p.priority || null,
      }
    })
    .sort((a, b) => {
      const rank = { exceeded: 0, near: 1, ok: 2, unknown: 3 }
      return rank[a.status] - rank[b.status] || (a.remaining ?? Infinity) - (b.remaining ?? Infinity)
    })
}

/** Counts for the service KPIs. Null when no plan is measured in engine hours. */
export function thresholdCounts(rows) {
  const list = Array.isArray(rows) ? rows : []
  if (!list.length) return { plans: 0, near: null, exceeded: null, unknown: 0 }
  return {
    plans: list.length,
    near: list.filter((r) => r.status === 'near').length,
    exceeded: list.filter((r) => r.status === 'exceeded').length,
    unknown: list.filter((r) => r.status === 'unknown').length,
  }
}

// ── KPIs ────────────────────────────────────────────────────────────────────

/** Readings dated today (local calendar). */
export function readingsToday(readings, now = new Date()) {
  const today = localDay(now)
  return (Array.isArray(readings) ? readings : []).filter((r) => dayOf(r) === today).length
}

/**
 * The five headline figures. `thresholds` null means the plans could not be
 * read, which is different from "no plan uses engine hours" (plans: 0).
 */
export function buildKpis({ profiles, readings, thresholds, now = new Date() }) {
  const list = Array.isArray(profiles) ? profiles : []
  const counts = thresholds ? thresholdCounts(thresholds) : null
  return {
    assetsWithMeters: list.length,
    readingsToday: readingsToday(readings, now),
    overdueReadings: list.filter((p) => p.readingOverdue).length,
    nearService: counts ? counts.near : null,
    exceeded: counts ? counts.exceeded : null,
    plans: counts ? counts.plans : null,
  }
}

// ── Export ──────────────────────────────────────────────────────────────────

export const ASSET_EXPORT_COLS = ['asset_no', 'fleet_number', 'make', 'model', 'site', 'current_hours', 'last_reading', 'since_previous', 'avg_daily_hours', 'utilization_pct', 'status', 'reading_overdue']
export const ASSET_EXPORT_HEADERS = ['Asset', 'Fleet no', 'Make', 'Model', 'Site', 'Current hours', 'Last reading', 'Hours since previous', 'Daily avg hours', 'Utilization %', 'Status', 'Reading overdue']

export function assetExportRow(p) {
  const v = (x) => (x == null || x === '' ? 'N/A' : x)
  return {
    asset_no: v(p.asset_no),
    fleet_number: v(p.fleet_number),
    make: v(p.make),
    model: v(p.model),
    site: v(p.site),
    current_hours: v(p.currentHours),
    last_reading: v(p.lastReadingDate),
    since_previous: v(p.sincePrevious),
    avg_daily_hours: v(p.avgDailyHours),
    utilization_pct: v(p.utilizationPct),
    status: UTIL_STATUS[p.status]?.label || 'N/A',
    reading_overdue: p.readingOverdue ? 'Yes' : 'No',
  }
}

export const THRESHOLD_EXPORT_COLS = ['name', 'asset_no', 'current_hours', 'next_due_hours', 'remaining', 'status']
export const THRESHOLD_EXPORT_HEADERS = ['Plan', 'Asset', 'Current hours', 'Next due hours', 'Hours remaining', 'Status']

export function thresholdExportRow(t) {
  const v = (x) => (x == null || x === '' ? 'N/A' : x)
  return {
    name: v(t.name),
    asset_no: v(t.asset_no || t.asset_type),
    current_hours: v(t.currentHours),
    next_due_hours: v(t.nextDueHours),
    remaining: v(t.remaining),
    status: THRESHOLD_STATUS[t.status]?.label || 'N/A',
  }
}
