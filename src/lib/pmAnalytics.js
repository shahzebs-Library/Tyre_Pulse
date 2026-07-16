/**
 * pmAnalytics.js — pure (no I/O) analytics engine over Preventive Maintenance
 * plans (pm_programs rows) and service records (pm_service_records rows).
 *
 * Every function that depends on the clock takes an injected `now` — the module
 * never reads Date.now() itself, so results are fully deterministic and
 * unit-testable. Due-band logic is NOT reimplemented here: topOverdue reuses
 * pmAssetDueStatus from ./pmSchedule so the whole PM module shares ONE due
 * engine, and that in turn shares the ONE date engine in ./pmPrograms.
 *
 * A "plan" is a pm_programs row (see pmSchedule.js). A "record" is a
 * pm_service_records row:
 *   { pm_program_id, asset_no, service_date, total_cost, parts_cost,
 *     labour_cost, outcome, meter_reading, meter_type }
 *
 * HONEST BY DESIGN: every result degrades to null / 0 / [] when there is no
 * data. Nothing is fabricated, inferred, or back-filled.
 */

import { pmAssetDueStatus } from './pmSchedule'

const pad2 = (n) => String(n).padStart(2, '0')

/** Coerce a value to a finite number, or 0 when it is not usable. */
function num(value) {
  const n = Number(value)
  return Number.isFinite(n) ? n : 0
}

/** Parse a date-ish value to a Date, or null when unusable. */
function toDate(value) {
  if (value == null || value === '') return null
  const d = value instanceof Date ? value : new Date(value)
  return Number.isNaN(d.getTime()) ? null : d
}

/** UTC 'YYYY-MM' month key for a date-ish value, or null. */
function monthKey(value) {
  const d = toDate(value)
  if (!d) return null
  return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}`
}

/**
 * The last N UTC month keys ending at (and including) the month of `now`,
 * oldest first. Returns [] when `now` is unusable or months is not positive.
 */
function lastMonths(now, months) {
  const ref = toDate(now)
  const n = Math.trunc(Number(months))
  if (!ref || !Number.isFinite(n) || n <= 0) return []
  const out = []
  let y = ref.getUTCFullYear()
  let m = ref.getUTCMonth() // 0-based
  for (let i = 0; i < n; i += 1) {
    out.push(`${y}-${pad2(m + 1)}`)
    m -= 1
    if (m < 0) {
      m = 11
      y -= 1
    }
  }
  return out.reverse()
}

const asArray = (v) => (Array.isArray(v) ? v : [])

/**
 * Total service cost + service count per asset_no, descending by total.
 * Cost is total_cost coerced to a number (0 when missing). Records with no
 * asset_no are skipped. Ties break by asset_no for a stable order.
 */
export function costByAsset(records = []) {
  const map = new Map()
  for (const r of asArray(records)) {
    const asset = r?.asset_no
    if (asset == null || asset === '') continue
    const cur = map.get(asset) || { asset_no: asset, total: 0, services: 0 }
    cur.total += num(r?.total_cost)
    cur.services += 1
    map.set(asset, cur)
  }
  return [...map.values()].sort(
    (a, b) => b.total - a.total || String(a.asset_no).localeCompare(String(b.asset_no)),
  )
}

/**
 * Total service cost per plan asset_category, descending by total. Records are
 * joined to their plan via pm_program_id; a record whose plan is unknown (or
 * whose plan has no asset_category) falls back to the 'other' category.
 */
export function costByCategory(plans = [], records = []) {
  const catByPlan = new Map()
  for (const p of asArray(plans)) {
    if (p?.id != null) catByPlan.set(p.id, p?.asset_category || 'other')
  }
  const map = new Map()
  for (const r of asArray(records)) {
    const cat = catByPlan.get(r?.pm_program_id) || 'other'
    map.set(cat, (map.get(cat) || 0) + num(r?.total_cost))
  }
  return [...map.entries()]
    .map(([category, total]) => ({ category, total }))
    .sort((a, b) => b.total - a.total || String(a.category).localeCompare(String(b.category)))
}

/**
 * Service cost + count bucketed by service month over the last N months
 * (default 12), zero-filled and oldest first. Records outside the window or
 * with an unusable service_date are ignored.
 */
export function monthlyServiceCost(records = [], { now, months = 12 } = {}) {
  const keys = lastMonths(now, months)
  const totals = new Map(keys.map((k) => [k, { month: k, total: 0, count: 0 }]))
  for (const r of asArray(records)) {
    const key = monthKey(r?.service_date)
    const bucket = key && totals.get(key)
    if (!bucket) continue
    bucket.total += num(r?.total_cost)
    bucket.count += 1
  }
  return keys.map((k) => totals.get(k))
}

/**
 * Mean days between consecutive services per asset_no. avgDays is the average
 * gap (whole-day precision, rounded) across sorted service_date values, or null
 * when the asset has fewer than 2 usable dates. Returns one row per asset that
 * has at least one usable service_date, ascending-nothing (sorted by asset_no).
 */
export function meanIntervalBetweenServices(records = []) {
  const byAsset = new Map()
  for (const r of asArray(records)) {
    const asset = r?.asset_no
    if (asset == null || asset === '') continue
    const d = toDate(r?.service_date)
    if (!d) continue
    if (!byAsset.has(asset)) byAsset.set(asset, [])
    byAsset.get(asset).push(d.getTime())
  }
  const MS = 24 * 3600 * 1000
  const out = []
  for (const [asset_no, times] of byAsset.entries()) {
    times.sort((a, b) => a - b)
    const services = times.length
    let avgDays = null
    if (services >= 2) {
      let sum = 0
      for (let i = 1; i < services; i += 1) sum += times[i] - times[i - 1]
      avgDays = Math.round(sum / (services - 1) / MS)
    }
    out.push({ asset_no, avgDays, services })
  }
  return out.sort((a, b) => String(a.asset_no).localeCompare(String(b.asset_no)))
}

const OUTCOMES = ['completed', 'partial', 'deferred', 'failed']

/**
 * Count of records by outcome over the known outcome vocabulary
 * (completed / partial / deferred / failed), in that fixed order. Records with
 * an unknown / missing outcome are not counted (honest — we do not invent a
 * bucket). Always returns all four rows, zero-filled.
 */
export function outcomeBreakdown(records = []) {
  const counts = new Map(OUTCOMES.map((o) => [o, 0]))
  for (const r of asArray(records)) {
    const o = String(r?.outcome || '').toLowerCase().trim()
    if (counts.has(o)) counts.set(o, counts.get(o) + 1)
  }
  return OUTCOMES.map((outcome) => ({ outcome, count: counts.get(outcome) }))
}

/**
 * Compliance trend by service month over the last N months (default 12),
 * zero-filled and oldest first. completed = records whose outcome is
 * 'completed'; total = all records in the month; pct = completed / total * 100
 * rounded, or null when the month has no records (no denominator, no
 * percentage).
 */
export function complianceTrend(records = [], { now, months = 12 } = {}) {
  const keys = lastMonths(now, months)
  const buckets = new Map(keys.map((k) => [k, { month: k, completed: 0, total: 0 }]))
  for (const r of asArray(records)) {
    const key = monthKey(r?.service_date)
    const bucket = key && buckets.get(key)
    if (!bucket) continue
    bucket.total += 1
    if (String(r?.outcome || '').toLowerCase().trim() === 'completed') bucket.completed += 1
  }
  return keys.map((k) => {
    const b = buckets.get(k)
    const pct = b.total === 0 ? null : Math.round((b.completed / b.total) * 100)
    return { month: b.month, completed: b.completed, total: b.total, pct }
  })
}

/**
 * Plans whose combined due band is 'overdue' as of `now`, worst-first, limited.
 * Reuses pmAssetDueStatus (the ONE due engine) with per-asset current meter
 * readings from kmByAsset / hoursByAsset. Worst-first = most days overdue
 * (most negative daysToDue), then most meter units overdue. Each returned row
 * carries the plan plus its derived due status fields.
 */
export function topOverdue(
  plans = [],
  { now, kmByAsset = {}, hoursByAsset = {} } = {},
  limit = 10,
) {
  const rows = []
  for (const p of asArray(plans)) {
    const asset = p?.asset_no
    const st = pmAssetDueStatus(p, {
      now,
      currentKm: kmByAsset[asset],
      currentHours: hoursByAsset[asset],
    })
    if (st.band === 'overdue') rows.push({ ...p, ...st })
  }
  rows.sort((a, b) => {
    const da = a.daysToDue == null ? Infinity : a.daysToDue
    const db = b.daysToDue == null ? Infinity : b.daysToDue
    if (da !== db) return da - db // most negative (most overdue) first
    const ma = a.meterRemaining == null ? Infinity : a.meterRemaining
    const mb = b.meterRemaining == null ? Infinity : b.meterRemaining
    return ma - mb
  })
  const n = Math.trunc(Number(limit))
  const cap = Number.isFinite(n) && n >= 0 ? n : rows.length
  return rows.slice(0, cap)
}

/**
 * Compact executive summary combining plans + records. All fields are honest:
 *   totalServiceCost   sum of total_cost across records (0 when none).
 *   servicesCount      number of records.
 *   activePlans        plans with status 'active'.
 *   overdueCount       count of overdue plans (via topOverdue, uncapped).
 *   avgCostPerService  totalServiceCost / servicesCount, or null when 0 records.
 */
export function pmSummary(plans = [], records = [], ctx = {}) {
  const recs = asArray(records)
  const totalServiceCost = recs.reduce((s, r) => s + num(r?.total_cost), 0)
  const servicesCount = recs.length
  const activePlans = asArray(plans).filter((p) => p?.status === 'active').length
  const overdueCount = topOverdue(plans, ctx, Infinity).length
  const avgCostPerService = servicesCount === 0 ? null : totalServiceCost / servicesCount
  return {
    totalServiceCost,
    servicesCount,
    activePlans,
    overdueCount,
    avgCostPerService,
  }
}
