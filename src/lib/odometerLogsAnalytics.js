/**
 * odometerLogsAnalytics.js - pure filtering, KPI and export logic for the
 * Vehicle Meter Logs page (src/pages/OdometerLogs.jsx). Builds on the meter
 * primitives in vehicleMeters.js (buildVehicleMeters, meterSource). No I/O, no
 * React; `today` is passed in as the country-local YYYY-MM-DD so the staleness
 * maths is deterministic.
 *
 * Honesty rules:
 *   - a vehicle with no reading is "no reading", never 0 km / 0 hours
 *   - a coverage percentage is null when the denominator is zero
 *   - staleness is measured from the latest recorded MEASUREMENT date only; a
 *     vehicle whose current meter has no dated reading is counted as undated,
 *     not as fresh
 */
import { meterSource } from './vehicleMeters'

export const STALE_DAYS = 30
const MS_DAY = 86400000

export const distinct = (values) => [...new Set((values || []).filter(Boolean))].sort()

/** Meter-type predicate for the "Applicable meters" filter. */
export function matchesMeterType(row, type) {
  if (!type) return true
  const km = !!row?.supportsKm
  const hrs = !!row?.supportsHours
  return ({
    km, hours: hrs, both: km && hrs, km_only: km && !hrs, hours_only: hrs && !km, unknown: !km && !hrs,
  })[type] ?? true
}

/** Reading-level predicate: source, date window, awaiting review. */
export function matchesReading(r, filters) {
  const f = filters || {}
  return (!f.source || meterSource(r?.source) === f.source)
    && (!f.from || (r?.reading_date && r.reading_date >= f.from))
    && (!f.to || (r?.reading_date && r.reading_date <= f.to))
    && (!f.flagged || (r?.flagged && !r?.reviewed))
}

/** Asset-level predicate: type, meter type, region, site, one asset, free text (every word). */
export function matchesAsset(r, filters) {
  const f = filters || {}
  const text = `${r?.asset_no || ''} ${r?.registration_no || ''} ${r?.fleet_number || ''} ${r?.vehicle_type || ''} ${r?.region || ''} ${r?.site || ''} ${r?.source || ''} ${r?.notes || ''}`.toLowerCase()
  const words = String(f.search || '').trim().toLowerCase().split(/\s+/).filter(Boolean)
  return (!f.vehicleType || (r?.vehicle_type || '__unknown') === f.vehicleType)
    && matchesMeterType(r, f.meterType)
    && (!f.region || r?.region === f.region)
    && (!f.site || r?.site === f.site)
    && (!f.assetId || (r?.vehicleId || r?.id) === f.assetId)
    && words.every((w) => text.includes(w))
}

const readingFilterActive = (f) => !!(f.source || f.from || f.to || f.flagged || f.readingKind)

/** Vehicles passing the asset filters and, when a reading filter is set, owning a matching latest reading. */
export function filterVehicles(vehicles, filters) {
  const f = filters || {}
  return (vehicles || []).filter((v) => {
    if (!matchesAsset(v, f)) return false
    if (!readingFilterActive(f)) return true
    const logs = f.readingKind === 'km' ? [v.kmLog] : f.readingKind === 'hours' ? [v.hoursLog] : [v.kmLog, v.hoursLog]
    return logs.filter(Boolean).some((r) => matchesReading(r, f))
  })
}

/** History rows passing every filter. */
export function filterHistory(history, filters) {
  const f = filters || {}
  return (history || []).filter((r) => matchesAsset(r, f) && matchesReading(r, f) && (!f.readingKind || r.kind === f.readingKind))
}

function daysBetween(fromIso, toIso) {
  const a = Date.parse(`${fromIso}T00:00:00Z`)
  const b = Date.parse(`${toIso}T00:00:00Z`)
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null
  return Math.round((b - a) / MS_DAY)
}

/** The measurement date backing a vehicle's current meter, or null. */
export function latestReadingDate(v) {
  const dates = []
  if (v?.kmLog && Number(v.kmLog.odometer_km) === v.km && v.kmLog.reading_date) dates.push(v.kmLog.reading_date)
  if (v?.hoursLog && Number(v.hoursLog.engine_hours) === v.engineHours && v.hoursLog.reading_date) dates.push(v.hoursLog.reading_date)
  return dates.length ? dates.sort().at(-1) : null
}

/**
 * KPI strip over the filtered vehicles and readings:
 *   vehicles, withKm, withHours, kmCoveragePct, hoursCoveragePct
 *   fresh (dated within STALE_DAYS), stale, undated
 *   readings, flagged (awaiting Admin review), duplicates
 */
export function meterKpis(vehicles, history, today) {
  const list = vehicles || []
  let withKm = 0, withHours = 0, needKm = 0, needHours = 0, fresh = 0, stale = 0, undated = 0, duplicates = 0
  for (const v of list) {
    if (v.supportsKm) { needKm++; if (v.km != null) withKm++ }
    if (v.supportsHours) { needHours++; if (v.engineHours != null) withHours++ }
    if (v.duplicate) duplicates++
    const d = latestReadingDate(v)
    if (!d) undated++
    else {
      const age = today ? daysBetween(d, today) : null
      if (age == null) undated++
      else if (age > STALE_DAYS) stale++
      else fresh++
    }
  }
  const rows = history || []
  const pct = (n, d) => (d > 0 ? Math.round((n / d) * 1000) / 10 : null)
  return {
    vehicles: list.length,
    withKm, withHours,
    kmCoveragePct: pct(withKm, needKm),
    hoursCoveragePct: pct(withHours, needHours),
    fresh, stale, undated, duplicates,
    readings: rows.length,
    flagged: rows.filter((r) => r.flagged && !r.reviewed).length,
  }
}

/** Date window preset ending `today` (days, or 'month' for month to date). */
export function presetRange(today, days) {
  const start = new Date(`${today}T12:00:00Z`)
  if (Number.isNaN(start.getTime())) return { from: '', to: '' }
  if (days === 'month') start.setUTCDate(1)
  else start.setUTCDate(start.getUTCDate() - Number(days) + 1)
  return { from: start.toISOString().slice(0, 10), to: today }
}

/** Export rows for the latest-per-vehicle view. */
export function vehicleExportRows(vehicles) {
  return (vehicles || []).map((v) => {
    const kmLog = v.kmLog && Number(v.kmLog.odometer_km) === v.km ? v.kmLog : null
    const hoursLog = v.hoursLog && Number(v.hoursLog.engine_hours) === v.engineHours ? v.hoursLog : null
    return {
      asset: v.asset_no, registration: v.registration_no || v.fleet_number || '', country: v.country || '',
      region: v.region || '', site: v.site || '',
      km: v.km ?? 'No reading', hours: v.engineHours ?? 'No reading',
      km_date: kmLog?.reading_date || '', hours_date: hoursLog?.reading_date || '',
      km_source: kmLog ? meterSource(kmLog.source) : '', hours_source: hoursLog ? meterSource(hoursLog.source) : '',
    }
  })
}
