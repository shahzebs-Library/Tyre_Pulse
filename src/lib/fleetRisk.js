/**
 * Fleet Risk Score — pure, deterministic scoring helpers (no I/O) for the Fleet
 * Risk Score module. Each fleet asset is ranked with a 0–100 composite risk
 * score derived from real tyre/maintenance signals in `tyre_records`, so the
 * fleet team sees which vehicles are most at risk and exactly why.
 *
 * Design contract (mirrors src/lib/tyreAge.js):
 *  - PURE: no Date.now(), no network, no randomness. Callers inject the
 *    reference clock (`now`) so results are reproducible and unit-testable.
 *  - Banding/weights live here in ONE auditable place; the page and service
 *    consume these functions rather than re-deriving the maths.
 *
 * Signals per asset (grouped by asset_no; in-service = removal_date IS NULL):
 *   aged      — in-service tyres past the GCC/RTA age limit (weight: high)
 *   lowTread  — in-service tyres with tread_depth < LOW_TREAD_MM (weight: high)
 *   failures  — recently removed tyres carrying a removal reason (weight: med)
 *   cpk       — asset avg cost-per-km vs fleet median CPK       (weight: med)
 *   noInsp    — in-service tyres with no tread/pressure reading  (weight: low)
 *
 * Each signal is normalised to 0–1, combined with the documented weights (which
 * sum to 1) into a 0–100 score, then banded Low(<34)/Medium(34–66)/High(>66).
 */
import { tyreAgeBand } from './tyreAge'

// ── Tunables (overridable via opts) ─────────────────────────────────────────
export const LOW_TREAD_MM = 3 // tread depth (mm) below which a tyre is "low"
export const FAILURE_WINDOW_DAYS = 365 // removals older than this don't count as "recent"

/**
 * Signal weights — MUST sum to 1 so the weighted combination lands in [0,1] and
 * scales cleanly to 0–100. High-severity signals (aged, low tread) dominate;
 * medium (failures, CPK) are mid; missing-inspection is a low nudge.
 */
export const DEFAULT_WEIGHTS = Object.freeze({
  aged: 0.28,
  lowTread: 0.28,
  failures: 0.18,
  cpk: 0.16,
  noInsp: 0.10,
})

// Band thresholds on the 0–100 score.
export const RISK_BANDS = ['high', 'medium', 'low']
export const RISK_BAND_META = {
  high: { label: 'High', tone: 'red' },
  medium: { label: 'Medium', tone: 'amber' },
  low: { label: 'Low', tone: 'green' },
}

const DAY_MS = 24 * 3600 * 1000

/** Band a 0–100 score. Low(<34) / Medium(34–66) / High(>66). */
export function riskBand(score) {
  if (score > 66) return 'high'
  if (score >= 34) return 'medium'
  return 'low'
}

function num(v) {
  if (v == null || v === '') return null
  const n = typeof v === 'number' ? v : parseFloat(String(v).replace(/[^0-9.\-]/g, ''))
  return Number.isFinite(n) ? n : null
}

function toMs(v) {
  if (!v) return null
  const t = new Date(v).getTime()
  return Number.isNaN(t) ? null : t
}

const assetKeyOf = (r) => {
  const k = (r?.asset_no ?? '').toString().trim()
  return k || null
}

/** In-service = no removal date recorded. */
export function isInService(rec) {
  return !rec?.removal_date && rec?.km_at_removal == null
}

/** Distance (km) attributable to a tyre — total_km, else fitment→removal delta. */
export function tyreKm(rec) {
  const total = num(rec?.total_km)
  if (total != null && total > 0) return total
  const fit = num(rec?.km_at_fitment)
  const rem = num(rec?.km_at_removal)
  if (fit != null && rem != null && rem - fit > 0) return rem - fit
  return null
}

/** Per-tyre cost-per-km (cost_per_tyre / km) or null when not derivable. */
export function tyreCpk(rec) {
  const cost = num(rec?.cost_per_tyre)
  const km = tyreKm(rec)
  if (cost == null || km == null || km <= 0) return null
  return cost / km
}

const removalReasonOf = (r) => {
  const v = r?.reason_for_removal ?? r?.removal_reason ?? null
  const s = v == null ? '' : String(v).trim()
  return s || null
}

function hasNoInspection(rec) {
  return num(rec?.tread_depth) == null && num(rec?.pressure_reading) == null
}

function median(nums) {
  const arr = nums.filter((n) => typeof n === 'number' && Number.isFinite(n)).sort((a, b) => a - b)
  if (!arr.length) return null
  const mid = Math.floor(arr.length / 2)
  return arr.length % 2 ? arr[mid] : (arr[mid - 1] + arr[mid]) / 2
}

function clamp01(n) {
  if (!Number.isFinite(n)) return 0
  return n < 0 ? 0 : n > 1 ? 1 : n
}

/**
 * Score every asset represented in `tyres` (optionally enriched with
 * `vehicles` master data). Deterministic: pass `opts.now` (ms or Date).
 *
 * @param {{ tyres?: Array, vehicles?: Array }} data
 * @param {{ now?: number|Date, weights?: object, lowTreadMm?: number,
 *   failureWindowDays?: number, ageThresholds?: object }} [opts]
 * @returns {Array<{asset_no, score, band, signals, make, model, vehicle_type,
 *   site, country, status, inServiceCount, totalTyres}>}
 */
export function scoreVehicles({ tyres = [], vehicles = [] } = {}, opts = {}) {
  const nowMs = opts.now instanceof Date ? opts.now.getTime() : Number(opts.now)
  const now = Number.isFinite(nowMs) ? nowMs : NaN
  const weights = { ...DEFAULT_WEIGHTS, ...(opts.weights || {}) }
  const lowTreadMm = opts.lowTreadMm ?? LOW_TREAD_MM
  const windowMs = (opts.failureWindowDays ?? FAILURE_WINDOW_DAYS) * DAY_MS

  const vehicleByAsset = new Map()
  for (const v of Array.isArray(vehicles) ? vehicles : []) {
    const k = assetKeyOf(v)
    if (k && !vehicleByAsset.has(k)) vehicleByAsset.set(k, v)
  }

  // ── Pass 1: group tyres by asset and gather raw counts + per-asset CPK. ──
  const groups = new Map()
  for (const rec of Array.isArray(tyres) ? tyres : []) {
    const key = assetKeyOf(rec)
    if (!key) continue // pool/unassigned stock isn't a vehicle to rank
    let g = groups.get(key)
    if (!g) {
      g = {
        asset_no: key, totalTyres: 0, inServiceCount: 0, agedCount: 0,
        lowTreadCount: 0, noInspectionCount: 0, recentFailures: 0,
        cpkVals: [], site: null, country: null, status: null,
      }
      groups.set(key, g)
    }
    g.totalTyres += 1
    if (!g.site && rec.site) g.site = rec.site
    if (!g.country && rec.country) g.country = rec.country

    const cpk = tyreCpk(rec)
    if (cpk != null) g.cpkVals.push(cpk)

    if (isInService(rec)) {
      g.inServiceCount += 1
      if (tyreAgeBand(rec, now, opts.ageThresholds) === 'non_compliant') g.agedCount += 1
      const tread = num(rec.tread_depth)
      if (tread != null && tread < lowTreadMm) g.lowTreadCount += 1
      if (hasNoInspection(rec)) g.noInspectionCount += 1
    } else if (removalReasonOf(rec)) {
      // Recent failure: a removed tyre carrying a removal reason, within window.
      const remMs = toMs(rec.removal_date)
      const recent = !Number.isFinite(now) || remMs == null || (now - remMs) <= windowMs
      if (recent) g.recentFailures += 1
    }
  }

  // Fleet median CPK from per-asset average CPK (assets with any CPK signal).
  const assetCpk = new Map()
  for (const g of groups.values()) {
    if (g.cpkVals.length) {
      assetCpk.set(g.asset_no, g.cpkVals.reduce((s, x) => s + x, 0) / g.cpkVals.length)
    }
  }
  const fleetMedianCpk = median([...assetCpk.values()])

  // ── Pass 2: normalise signals → weighted 0–100 score → band. ──
  const rows = []
  for (const g of groups.values()) {
    const denom = g.inServiceCount || g.totalTyres || 1
    const agedN = clamp01(g.agedCount / denom)
    const lowTreadN = clamp01(g.lowTreadCount / denom)
    const noInspN = clamp01(g.noInspectionCount / denom)
    // Failure rate relative to the asset's own tyre population, capped at 1.
    const failuresN = clamp01(g.recentFailures / Math.max(g.totalTyres, 1))
    // CPK: 0 at/below fleet median, 1 at >=2x median. No CPK data → 0.
    const cpk = assetCpk.get(g.asset_no)
    const cpkN = (cpk != null && fleetMedianCpk != null && fleetMedianCpk > 0)
      ? clamp01((cpk / fleetMedianCpk) - 1)
      : 0

    const weighted = weights.aged * agedN
      + weights.lowTread * lowTreadN
      + weights.failures * failuresN
      + weights.cpk * cpkN
      + weights.noInsp * noInspN
    const score = Math.round(clamp01(weighted) * 100)

    const veh = vehicleByAsset.get(g.asset_no) || {}
    rows.push({
      asset_no: g.asset_no,
      score,
      band: riskBand(score),
      make: veh.make ?? null,
      model: veh.model ?? null,
      vehicle_type: veh.vehicle_type ?? null,
      site: veh.site ?? g.site ?? null,
      country: veh.country ?? g.country ?? null,
      status: veh.status ?? null,
      inServiceCount: g.inServiceCount,
      totalTyres: g.totalTyres,
      signals: {
        agedCount: g.agedCount,
        lowTreadCount: g.lowTreadCount,
        recentFailures: g.recentFailures,
        noInspectionCount: g.noInspectionCount,
        cpk: cpk != null ? Math.round(cpk * 1000) / 1000 : null,
        fleetMedianCpk: fleetMedianCpk != null ? Math.round(fleetMedianCpk * 1000) / 1000 : null,
        normalized: {
          aged: Math.round(agedN * 100) / 100,
          lowTread: Math.round(lowTreadN * 100) / 100,
          failures: Math.round(failuresN * 100) / 100,
          cpk: Math.round(cpkN * 100) / 100,
          noInsp: Math.round(noInspN * 100) / 100,
        },
      },
    })
  }

  // Highest risk first; stable tiebreaker on asset_no for deterministic order.
  rows.sort((a, b) => b.score - a.score || String(a.asset_no).localeCompare(String(b.asset_no)))
  return rows
}

/**
 * Aggregate scored rows into fleet-level KPIs + band split.
 * @param {Array} rows  output of scoreVehicles
 */
export function summarizeRisk(rows) {
  const list = Array.isArray(rows) ? rows : []
  const counts = { total: list.length, high: 0, medium: 0, low: 0 }
  let scoreSum = 0
  for (const r of list) {
    counts[r.band] = (counts[r.band] || 0) + 1
    scoreSum += Number(r.score) || 0
  }
  const avgScore = list.length ? Math.round(scoreSum / list.length) : null
  const topRisk = list.slice(0, 10)
  return { counts, avgScore, topRisk }
}
