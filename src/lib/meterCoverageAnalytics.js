/**
 * Meter coverage and data quality - pure, I/O-free, for Vehicle Meter Logs.
 *
 * Builds on what already exists and adds only what was missing: which vehicles
 * have NO reading at all, which have gone stale, how coverage splits by region,
 * site and vehicle type, and how the flagged/reviewed readings break down by
 * source. Mileage deltas and regression detection stay in odometerAnalytics
 * (detectAnomalies); this module only counts its output.
 *
 * Input `vehicles` are buildVehicleMeters() rows (kmLog / hoursLog = the latest
 * reading of each kind, supportsKm / supportsHours = which meters apply).
 * Honesty rules, tested:
 *  - A vehicle whose meters are not established is "not applicable", never
 *    counted as missing.
 *  - Duplicate register identities are excluded (their readings cannot be
 *    attributed to one machine).
 *  - An empty group has a null coverage rate, never 0%.
 */
import { STALE_DAYS, ANOMALY } from './odometerAnalytics'
import { meterSource } from './vehicleMeters'

const DAY_MS = 86400000
export const METER_STATES = Object.freeze(['fresh', 'stale', 'never', 'not_applicable'])
export const METER_STATE_LABEL = Object.freeze({
  fresh: 'Recent reading', stale: 'Stale', never: 'No reading', not_applicable: 'Meters not established',
})
export const NO_REGION = 'Region not set'
export const NO_SITE = 'Site not recorded'
export const NO_TYPE = 'Type not recorded'

const day = (v) => (v && /^\d{4}-\d{2}-\d{2}/.test(String(v)) ? String(v).slice(0, 10) : '')

function daysBetween(from, today) {
  const a = Date.parse(`${from}T00:00:00Z`), b = Date.parse(`${today}T00:00:00Z`)
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null
  return Math.max(0, Math.round((b - a) / DAY_MS))
}

/** One status row per (non-duplicate) vehicle. */
export function vehicleMeterStatus(vehicles = [], { today, staleDays = STALE_DAYS } = {}) {
  return vehicles.filter((v) => !v.duplicate).map((v) => {
    const kmDay = day(v.kmLog?.reading_date)
    const hDay = day(v.hoursLog?.reading_date)
    const last = [kmDay, hDay].filter(Boolean).sort().pop() || ''
    const applicable = Boolean(v.supportsKm || v.supportsHours)
    const missingKm = Boolean(v.supportsKm && !v.kmLog)
    const missingHours = Boolean(v.supportsHours && !v.hoursLog)
    const daysSince = last ? daysBetween(last, today) : null
    let state
    if (!last) state = applicable ? 'never' : 'not_applicable'
    else state = daysSince != null && daysSince > staleDays ? 'stale' : 'fresh'
    return {
      id: v.id,
      asset_no: v.asset_no,
      country: v.country || '',
      region: v.region || '',
      site: v.site || '',
      vehicle_type: v.vehicle_type || '',
      last_reading: last || null,
      days_since: daysSince,
      missing_km: missingKm,
      missing_hours: missingHours,
      state,
    }
  })
}

const DIMS = {
  region: (r) => r.region || NO_REGION,
  site: (r) => r.site || NO_SITE,
  vehicle_type: (r) => r.vehicle_type || NO_TYPE,
}

/** Coverage by region / site / vehicle type, worst coverage first. */
export function groupMeterCoverage(rows = [], dim = 'region') {
  const fn = DIMS[dim] || DIMS.region
  const m = new Map()
  for (const r of rows) {
    if (r.state === 'not_applicable') continue
    const k = fn(r)
    const g = m.get(k) || { key: k, vehicles: 0, fresh: 0, stale: 0, never: 0 }
    g.vehicles++
    g[r.state]++
    m.set(k, g)
  }
  return [...m.values()]
    .map((g) => ({ ...g, ratePct: g.vehicles ? Math.round((g.fresh / g.vehicles) * 1000) / 10 : null }))
    .sort((a, b) => (a.ratePct ?? 101) - (b.ratePct ?? 101) || b.vehicles - a.vehicles || a.key.localeCompare(b.key))
}

export function meterTotals(rows = []) {
  const t = { vehicles: 0, fresh: 0, stale: 0, never: 0, not_applicable: 0, missingKm: 0, missingHours: 0 }
  for (const r of rows) {
    t[r.state]++
    if (r.state !== 'not_applicable') t.vehicles++
    if (r.missing_km) t.missingKm++
    if (r.missing_hours) t.missingHours++
  }
  return { ...t, ratePct: t.vehicles ? Math.round((t.fresh / t.vehicles) * 1000) / 10 : null }
}

/** Flagged / reviewed readings, overall and per source. */
export function flagSummary(history = []) {
  const bySource = new Map()
  let flagged = 0, awaiting = 0, reviewed = 0
  for (const r of history) {
    const src = meterSource(r.source)
    const e = bySource.get(src) || { source: src, readings: 0, flagged: 0 }
    e.readings++
    if (r.flagged) { e.flagged++; flagged++; if (r.reviewed) reviewed++; else awaiting++ }
    bySource.set(src, e)
  }
  return {
    readings: history.length, flagged, awaiting, reviewed,
    bySource: [...bySource.values()].map((e) => ({ ...e, flagRatePct: e.readings ? Math.round((e.flagged / e.readings) * 1000) / 10 : null }))
      .sort((a, b) => b.readings - a.readings),
  }
}

/** Count detectAnomalies() output by type. */
export function anomalyCounts(anomalies = []) {
  const out = { [ANOMALY.BACKWARD]: 0, [ANOMALY.JUMP]: 0, [ANOMALY.DUPLICATE]: 0 }
  for (const a of anomalies) if (a && a.type in out) out[a.type]++
  return out
}

export function filterMeterStatus(rows = [], { search = '', state = '', region = '', site = '', vehicleType = '', missing = '' } = {}) {
  const q = String(search || '').trim().toLowerCase()
  return rows.filter((r) => (!state || r.state === state)
    && (!region || (r.region || NO_REGION) === region)
    && (!site || (r.site || NO_SITE) === site)
    && (!vehicleType || (r.vehicle_type || NO_TYPE) === vehicleType)
    && (!missing || (missing === 'km' ? r.missing_km : r.missing_hours))
    && (!q || `${r.asset_no} ${r.site} ${r.region} ${r.vehicle_type}`.toLowerCase().includes(q)))
}

/** Longest gap first; no reading at all counts as the longest. */
export function sortMeterStatus(rows = [], sortKey = 'days_since', dir = 'desc') {
  const m = dir === 'asc' ? 1 : -1
  const gap = (r) => (r.state === 'never' ? Infinity : r.days_since ?? -1)
  return [...rows].sort((a, b) => {
    if (sortKey === 'days_since') {
      const x = gap(a), y = gap(b)
      if (x === y) return String(a.asset_no).localeCompare(String(b.asset_no))
      return m * (x > y ? 1 : -1)
    }
    return m * String(a[sortKey] || '').localeCompare(String(b[sortKey] || ''), undefined, { numeric: true })
  })
}
