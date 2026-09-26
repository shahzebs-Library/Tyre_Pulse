/**
 * Fleet Utilization - register-aware analytics, pure and I/O-free.
 *
 * Builds on the base engine (src/lib/fleetUtilization.js - bands, idle %,
 * summaries) rather than duplicating it. This module adds what needs the FLEET
 * REGISTER: the site and vehicle type of each telematics row, the per-site
 * comparison, the telematics coverage gap (active register assets with no
 * telematics at all), and the capture timeline.
 *
 * Honesty rules:
 *  - Identity is (country, asset_no). A row the register cannot place keeps
 *    site '' and is shown as "Site not recorded", never guessed.
 *  - Trends need more than one capture. With a single snapshot the timeline
 *    says so instead of drawing a line.
 *  - A group with no measurable value averages to null, never 0.
 */
import { num, mean, secondsToHours, idlePct } from './fleetUtilization'

export const NO_SITE = 'Site not recorded'
export const NO_TYPE = 'Type not recorded'

const key = (country, asset) => `${String(country || '').trim().toUpperCase()}|${String(asset || '').trim().toUpperCase()}`

export function isActiveAsset(row) {
  const s = String(row?.status || '').trim().toLowerCase()
  return !s || s === 'active'
}

/** Attach register site / vehicle type / status to every telematics row. */
export function attachRegister(rows = [], fleet = []) {
  const idx = new Map(fleet.map((f) => [key(f.country, f.asset_no), f]))
  return rows.map((r) => {
    const f = idx.get(key(r.country, r.asset_no))
    return {
      ...r,
      site: f?.site || '',
      vehicle_type: f?.vehicle_type || '',
      register_status: f?.status || '',
      in_register: Boolean(f),
    }
  })
}

/** Per-site comparison over register-attached rows, busiest first. */
export function siteComparison(rows = []) {
  const m = new Map()
  for (const r of rows) {
    const k = r.site || NO_SITE
    const e = m.get(k) || { site: k, assets: 0, util: [], idle: [], distance: null, working: null, idleSec: null, highIdle: 0 }
    e.assets++
    const u = num(r.utilization_pct); if (u != null) e.util.push(u)
    const ip = idlePct(r); if (ip != null) { e.idle.push(ip); if (ip >= 50) e.highIdle++ }
    // Stay null until a real value is seen, so an unmeasured site reads N/A.
    const add = (acc, v) => (num(v) == null ? acc : (acc || 0) + num(v))
    e.distance = add(e.distance, r.distance_km)
    e.working = add(e.working, r.working_seconds)
    e.idleSec = add(e.idleSec, r.idle_seconds)
    m.set(k, e)
  }
  return [...m.values()].map((e) => ({
    site: e.site,
    assets: e.assets,
    avgUtilization: mean(e.util),
    avgIdlePct: e.idle.length ? mean(e.idle) : null,
    distanceKm: e.distance,
    workingHours: secondsToHours(e.working),
    idleHours: secondsToHours(e.idleSec),
    highIdle: e.highIdle,
  })).sort((a, b) => b.assets - a.assets || a.site.localeCompare(b.site))
}

/**
 * Telematics coverage gap: ACTIVE register assets with no utilization row, and
 * utilization rows whose asset is not in the register.
 */
export function telematicsCoverage(rows = [], fleet = []) {
  const tracked = new Set(rows.map((r) => key(r.country, r.asset_no)))
  const active = fleet.filter(isActiveAsset)
  const uncovered = active.filter((f) => !tracked.has(key(f.country, f.asset_no)))
  const registerKeys = new Set(fleet.map((f) => key(f.country, f.asset_no)))
  const unregistered = rows.filter((r) => !registerKeys.has(key(r.country, r.asset_no)))
  const bySite = new Map()
  for (const f of active) {
    const k = f.site || NO_SITE
    const e = bySite.get(k) || { site: k, active: 0, covered: 0 }
    e.active++
    if (tracked.has(key(f.country, f.asset_no))) e.covered++
    bySite.set(k, e)
  }
  return {
    activeAssets: active.length,
    covered: active.length - uncovered.length,
    coveragePct: active.length ? Math.round(((active.length - uncovered.length) / active.length) * 1000) / 10 : null,
    uncovered: uncovered.map((f) => ({ asset_no: f.asset_no, country: f.country || '', site: f.site || '', vehicle_type: f.vehicle_type || '' })),
    unregistered: unregistered.length,
    bySite: [...bySite.values()]
      .map((e) => ({ ...e, gap: e.active - e.covered, coveragePct: Math.round((e.covered / e.active) * 1000) / 10 }))
      .sort((a, b) => b.gap - a.gap || a.site.localeCompare(b.site)),
  }
}

/** Captures per day with the average utilization of that capture. */
export function captureTimeline(rows = []) {
  const m = new Map()
  for (const r of rows) {
    const d = r.captured_at ? String(r.captured_at).slice(0, 10) : ''
    if (!d) continue
    const e = m.get(d) || { date: d, assets: 0, util: [] }
    e.assets++
    const u = num(r.utilization_pct); if (u != null) e.util.push(u)
    m.set(d, e)
  }
  const points = [...m.values()].map((e) => ({ date: e.date, assets: e.assets, avgUtilization: mean(e.util) }))
    .sort((a, b) => a.date.localeCompare(b.date))
  return { points, trendable: points.length > 1 }
}

/** Idle ranking: assets with the most idle hours, optionally above an idle %. */
export function idleRanking(rows = [], { minIdlePct = 0, limit = 15 } = {}) {
  return rows
    .map((r) => ({ ...r, idleHours: secondsToHours(r.idle_seconds), idle: idlePct(r) }))
    .filter((r) => r.idleHours != null && (r.idle == null ? minIdlePct <= 0 : r.idle >= minIdlePct))
    .sort((a, b) => b.idleHours - a.idleHours)
    .slice(0, limit)
}

export function filterByRegister(rows = [], { site = '', vehicleType = '' } = {}) {
  return rows.filter((r) => (!site || (r.site || NO_SITE) === site)
    && (!vehicleType || (r.vehicle_type || NO_TYPE) === vehicleType))
}
