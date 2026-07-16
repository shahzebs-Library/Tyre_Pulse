/**
 * pmSchedule.js — pure due / advance / compliance engine for Preventive
 * Maintenance (no I/O). Derives the combined date + meter due band for a plan,
 * advances a schedule after a service, and rolls a list of plans up into a
 * compliance summary.
 *
 * DATE MATH is NOT reimplemented here — daysToDue / pmDueStatus / DUE_SOON_DAYS
 * are imported from ./pmPrograms so the whole module shares ONE date engine.
 *
 * A "plan" is a pm_programs row:
 *   { interval_type ('km'|'hours'|'days'|'months'), interval_value:number,
 *     last_done, next_due (date str), meter_source ('odometer'|'engine_hours'
 *     |'none'), meter_interval:number, last_done_meter, next_due_meter, status,
 *     asset_no, asset_category }
 *
 * Every function takes an injected `now` (or explicit meter readings) where time
 * matters — the module never reads Date.now() itself, so results are fully
 * deterministic and unit-testable. addTimeInterval mirrors Postgres calendar
 * math (date + make_interval) exactly, on the UTC calendar.
 */

import { daysToDue, pmDueStatus, DUE_SOON_DAYS } from './pmPrograms'

// Re-export so callers can share the one date-window constant.
export { daysToDue, pmDueStatus, DUE_SOON_DAYS }

// A meter axis is "due soon" within this many units of its next_due_meter.
export const METER_DUE_SOON = { odometer: 500, engine_hours: 25 }

// Worst-of band ranking: overdue beats due_soon beats scheduled beats none.
const BAND_RANK = { overdue: 3, due_soon: 2, scheduled: 1, none: 0 }

const pad2 = (n) => String(n).padStart(2, '0')

/** Extract UTC { y, m, d } (m is 0-based) from a date-ish value, or null. */
function utcParts(value) {
  if (value == null || value === '') return null
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(value))
  if (m) return { y: Number(m[1]), m: Number(m[2]) - 1, d: Number(m[3]) }
  const dt = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(dt.getTime())) return null
  return { y: dt.getUTCFullYear(), m: dt.getUTCMonth(), d: dt.getUTCDate() }
}

/**
 * Advance a date by a calendar interval, returning 'YYYY-MM-DD' or null.
 * Only 'days' and 'months' with a positive integer value advance (meter-based
 * intervals km / hours have no calendar meaning here). Mirrors Postgres
 *   date + make_interval(days => n)  /  make_interval(months => n)
 * EXACTLY: months keep the day-of-month and Postgres clamps an overflow
 * (Jan 31 + 1 month = Feb 28/29). The value is truncated to an integer.
 */
export function addTimeInterval(baseISO, intervalType, intervalValue) {
  const type = String(intervalType || '').toLowerCase().trim()
  if (type !== 'days' && type !== 'months') return null
  const n = Math.trunc(Number(intervalValue))
  if (!Number.isFinite(n) || n <= 0) return null
  const base = utcParts(baseISO)
  if (!base) return null

  if (type === 'days') {
    const dt = new Date(Date.UTC(base.y, base.m, base.d + n))
    return `${dt.getUTCFullYear()}-${pad2(dt.getUTCMonth() + 1)}-${pad2(dt.getUTCDate())}`
  }

  // months — keep day-of-month, clamp to the target month's last day.
  const total = base.m + n
  const ny = base.y + Math.floor(total / 12)
  const nm = ((total % 12) + 12) % 12
  const lastDay = new Date(Date.UTC(ny, nm + 1, 0)).getUTCDate()
  const nd = Math.min(base.d, lastDay)
  return `${ny}-${pad2(nm + 1)}-${pad2(nd)}`
}

/**
 * Resolve the meter axis of a plan to 'odometer' | 'engine_hours' | 'none'.
 * Prefers meter_source; falls back to the legacy interval_type convention
 * (km => odometer, hours => engine_hours) only when meter_source is none/absent.
 */
function meterAxis(plan) {
  const src = String(plan?.meter_source || '').toLowerCase().trim()
  if (src === 'odometer' || src === 'engine_hours') return src
  if (src === 'none' || !src) {
    const it = String(plan?.interval_type || '').toLowerCase().trim()
    if (it === 'km') return 'odometer'
    if (it === 'hours') return 'engine_hours'
  }
  return 'none'
}

/**
 * Resolve the current meter reading for a plan from the supplied per-asset
 * readings. odometer reads currentKm, engine_hours reads currentHours; the
 * legacy km / hours interval_type maps the same way when meter_source is none.
 * Returns { currentMeter:number|null, unit:'km'|'h'|'', source }.
 */
export function resolveMeter(plan, { currentKm, currentHours } = {}) {
  const source = meterAxis(plan)
  if (source === 'odometer') {
    const v = Number(currentKm)
    return { currentMeter: Number.isFinite(v) ? v : null, unit: 'km', source }
  }
  if (source === 'engine_hours') {
    const v = Number(currentHours)
    return { currentMeter: Number.isFinite(v) ? v : null, unit: 'h', source }
  }
  return { currentMeter: null, unit: '', source: 'none' }
}

/**
 * Meter units remaining until the plan's next_due_meter (next_due_meter minus
 * the current reading), or null when there is no meter axis, no current reading,
 * or no next_due_meter on file.
 */
export function meterToDue(plan, currentMeter) {
  if (meterAxis(plan) === 'none') return null
  const nd = Number(plan?.next_due_meter)
  if (!Number.isFinite(nd)) return null
  if (currentMeter == null || currentMeter === '') return null
  const cur = Number(currentMeter)
  if (!Number.isFinite(cur)) return null
  return nd - cur
}

/**
 * Derive the meter due band as of the given reading:
 *   'none'      no meter axis / no reading / no next_due_meter.
 *   'overdue'   remaining < 0.
 *   'due_soon'  remaining within 0..METER_DUE_SOON[source] inclusive.
 *   'scheduled' further out than the due-soon window.
 */
export function meterDueStatus(plan, currentMeter) {
  const remaining = meterToDue(plan, currentMeter)
  if (remaining == null) return 'none'
  if (remaining < 0) return 'overdue'
  const threshold = METER_DUE_SOON[meterAxis(plan)] ?? 0
  if (remaining <= threshold) return 'due_soon'
  return 'scheduled'
}

/**
 * Combined date + meter due status for a plan as of `now`, with the current
 * meter reading resolved from the supplied per-asset readings. The overall
 * `band` is the worst of the two axes (overdue > due_soon > scheduled > none).
 */
export function pmAssetDueStatus(plan, { now, currentKm, currentHours } = {}) {
  const resolved = resolveMeter(plan, { currentKm, currentHours })
  const dateBand = pmDueStatus(plan, now)
  const meterBand = meterDueStatus(plan, resolved.currentMeter)
  const band = BAND_RANK[dateBand] >= BAND_RANK[meterBand] ? dateBand : meterBand
  return {
    band,
    dateBand,
    meterBand,
    daysToDue: daysToDue(plan, now),
    meterRemaining: meterToDue(plan, resolved.currentMeter),
    unit: resolved.unit,
  }
}

/**
 * Advance a schedule after a service. Mirrors the SQL RPC exactly:
 *   next_due       = addTimeInterval(service_date, interval_type, interval_value)
 *                    when interval_type is days/months and interval_value > 0,
 *                    else the plan's existing next_due (unchanged).
 *   next_due_meter = meter_reading + meter_interval when the plan has a meter
 *                    axis (meter_source != 'none'), a positive meter_interval,
 *                    and a supplied meter_reading; else the existing value.
 */
export function advanceSchedule(plan, { service_date, meter_reading } = {}) {
  const computed = addTimeInterval(service_date, plan?.interval_type, plan?.interval_value)
  const next_due = computed != null ? computed : (plan?.next_due ?? null)

  const source = String(plan?.meter_source || '').toLowerCase().trim()
  const interval = Number(plan?.meter_interval)
  let next_due_meter = plan?.next_due_meter ?? null
  if (source !== 'none' && source !== '' && Number.isFinite(interval) && interval > 0 && meter_reading != null) {
    const reading = Number(meter_reading)
    if (Number.isFinite(reading)) next_due_meter = reading + interval
  }

  return { next_due, next_due_meter }
}

/**
 * Roll a list of plans up into a compliance summary. Only ACTIVE plans count
 * toward overdue / dueSoon / compliance / buckets / byCategory / dueList — a
 * paused or completed plan is never "due".
 *
 * Returns { total, active, overdue, dueSoon, compliantPct, buckets:{d30,d60,d90},
 * byCategory:[{category,count}], dueList }. compliantPct = round of
 * (active minus overdue) / active * 100, or null when there are no active plans
 * (honest — no denominator, no percentage). Buckets count active plans due
 * within 30 / 60 / 90 days OR flagged due (soon / overdue) on their meter axis.
 * dueList carries the active overdue + due_soon plans, worst-first.
 */
export function summarizePmCompliance(rows = [], { now, kmByAsset = {}, hoursByAsset = {} } = {}) {
  const list = Array.isArray(rows) ? rows : []
  const buckets = { d30: 0, d60: 0, d90: 0 }
  const byCategoryMap = new Map()
  const dueList = []
  let active = 0
  let overdue = 0
  let dueSoon = 0

  for (const p of list) {
    if (p?.status !== 'active') continue
    active += 1

    const asset = p?.asset_no
    const st = pmAssetDueStatus(p, {
      now,
      currentKm: kmByAsset[asset],
      currentHours: hoursByAsset[asset],
    })

    if (st.band === 'overdue') overdue += 1
    else if (st.band === 'due_soon') dueSoon += 1

    const dueByMeter = st.meterBand === 'due_soon' || st.meterBand === 'overdue'
    const withinDate = (n) => st.daysToDue != null && st.daysToDue <= n
    if (withinDate(30) || dueByMeter) buckets.d30 += 1
    if (withinDate(60) || dueByMeter) buckets.d60 += 1
    if (withinDate(90) || dueByMeter) buckets.d90 += 1

    const cat = p?.asset_category || 'other'
    byCategoryMap.set(cat, (byCategoryMap.get(cat) || 0) + 1)

    if (st.band === 'overdue' || st.band === 'due_soon') {
      dueList.push({ ...p, ...st })
    }
  }

  dueList.sort((a, b) => {
    const rankDiff = (BAND_RANK[b.band] || 0) - (BAND_RANK[a.band] || 0)
    if (rankDiff !== 0) return rankDiff
    const da = a.daysToDue == null ? Infinity : a.daysToDue
    const db = b.daysToDue == null ? Infinity : b.daysToDue
    if (da !== db) return da - db
    const ma = a.meterRemaining == null ? Infinity : a.meterRemaining
    const mb = b.meterRemaining == null ? Infinity : b.meterRemaining
    return ma - mb
  })

  const byCategory = [...byCategoryMap.entries()]
    .map(([category, count]) => ({ category, count }))
    .sort((a, b) => b.count - a.count || String(a.category).localeCompare(String(b.category)))

  const compliantPct = active === 0 ? null : Math.round(((active - overdue) / active) * 100)

  return {
    total: list.length,
    active,
    overdue,
    dueSoon,
    compliantPct,
    buckets,
    byCategory,
    dueList,
  }
}
