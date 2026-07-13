/**
 * Fleet Risk Score — pure, deterministic tyre-safety scoring (no I/O).
 *
 * PRIMARY engine (ported VERBATIM from tyre_saas backend/routes/risk_score.py):
 * a composite SAFETY score per tyre on a 0–100 scale where HIGHER = SAFER.
 * Five weighted factors (sum 100): tread 30, pressure 25, age 20, km 15,
 * inspection 10. Each factor is a pure sub-score in [0,100]; the composite is
 * their weighted mean. Tyres are then banded low / medium / high / critical.
 *
 * SECONDARY engine: a per-vehicle rollup that groups the SAME per-tyre scores by
 * asset and reports the worst (lowest-safety) tyre per vehicle — mirroring the
 * original /risk-score/vehicle endpoint. Both views share ONE scoring source of
 * truth so a vehicle's band can never disagree with its tyres.
 *
 * Design contract (mirrors src/lib/tyrePassport.js):
 *  - PURE: no Date.now(), no network, no randomness. Callers inject the
 *    reference clock (`now`) so results are reproducible and unit-testable.
 *  - Honest degradation: a factor with no source signal returns the original
 *    engine's documented neutral default (never a fabricated measurement).
 *
 * Data caveats specific to this app's flat `tyre_records` (documented in the UI):
 *  - AGE uses IN-SERVICE age (now − fitment/issue date); the DOT manufacture
 *    date is not captured, so a tyre stored before fitment reads younger than a
 *    true manufacture-age model would show.
 *  - INSPECTION has no per-tyre inspection-date source, so every tyre degrades
 *    to the engine's "no inspection" default (40) rather than inventing a date.
 */

// ── Scoring weights (sum = 100) — verbatim from risk_score.py ────────────────
export const W_TREAD = 30 // tread depth vs minimum legal limit
export const W_PRESSURE = 25 // deviation from optimal PSI
export const W_AGE = 20 // tyre age vs 5-year GCC guideline
export const W_KM = 15 // km driven vs expected lifecycle
export const W_INSPECTION = 10 // overdue-inspection penalty

export const RISK_WEIGHTS = Object.freeze({
  tread: W_TREAD, pressure: W_PRESSURE, age: W_AGE, km: W_KM, inspection: W_INSPECTION,
})

// ── Thresholds — verbatim from risk_score.py ────────────────────────────────
export const TREAD_LEGAL_MIN_MM = 1.6
export const TREAD_REPLACE_MM = 3.0
export const TREAD_NEW_MM = 10.0
export const PRESSURE_TOLERANCE_PCT = 0.10 // ±10% = green zone
export const OPTIMAL_PSI = 95.0
export const TYRE_MAX_AGE_YEARS = 5.0
export const KM_MAX_LIFECYCLE = 80_000
export const INSPECTION_OVERDUE_DAYS = 30

// ── Risk banding (SAFETY score → band + colour) ─────────────────────────────
export const RISK_LEVELS = ['critical', 'high', 'medium', 'low']
export const RISK_LEVEL_META = {
  critical: { label: 'Critical', color: 'red' },
  high: { label: 'High', color: 'orange' },
  medium: { label: 'Medium', color: 'amber' },
  low: { label: 'Low', color: 'green' },
}

const DAY_MS = 24 * 3600 * 1000
const YEAR_MS = 365.25 * DAY_MS

// ── Shared numeric / date helpers ───────────────────────────────────────────
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

const round1 = (v) => (v == null || !Number.isFinite(v) ? v : Math.round(v * 10) / 10)

function resolveNow(now) {
  const ms = now instanceof Date ? now.getTime() : Number(now)
  return Number.isFinite(ms) ? ms : Date.now()
}

export const serialOf = (r) =>
  (r?.serial_no ?? r?.serial_number ?? r?.tyre_serial ?? '').toString().trim() || null

export const positionOf = (r) =>
  (r?.position ?? r?.tyre_position ?? '').toString().trim() || null

const assetOf = (r) => (r?.asset_no ?? '').toString().trim() || null

const statusOf = (r) => (r?.status ?? '').toString().trim().toLowerCase()

/** In-service = no removal date recorded and no removal odometer. */
export function isInService(rec) {
  return !rec?.removal_date && rec?.km_at_removal == null
}

/** Scrapped/removed tyres are excluded from live safety scoring. */
export function isScrapped(rec) {
  return /scrap|dispos/i.test(statusOf(rec))
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

/**
 * In-SERVICE age in years (now − fitment/issue date). Null when no anchor date
 * exists (→ ageScore neutral). NOTE: not manufacture age — this app does not
 * capture the DOT week; surfaced as a caveat in the UI.
 */
export function inServiceYears(rec, now) {
  const start = toMs(rec?.fitment_date) ?? toMs(rec?.issue_date)
  const ref = resolveNow(now)
  if (start == null) return null
  const years = (ref - start) / YEAR_MS
  return years >= 0 ? years : null
}

// ── Factor sub-scores (HIGHER = SAFER) — ported VERBATIM ─────────────────────

/** Tread sub-score. null → 50 (unknown, mid-risk); 0 at/below legal; 100 when new. */
export function treadScore(treadMm) {
  if (treadMm == null) return 50.0
  if (treadMm <= TREAD_LEGAL_MIN_MM) return 0.0
  if (treadMm <= TREAD_REPLACE_MM) {
    return 50.0 * (treadMm - TREAD_LEGAL_MIN_MM) / (TREAD_REPLACE_MM - TREAD_LEGAL_MIN_MM)
  }
  return 50.0 + 50.0 * Math.min(1.0, (treadMm - TREAD_REPLACE_MM) / (TREAD_NEW_MM - TREAD_REPLACE_MM))
}

/** Pressure sub-score. null → 60; 100 within ±tolerance; drops 400/pt past it. */
export function pressureScore(actualPsi, optimalPsi = OPTIMAL_PSI) {
  if (actualPsi == null) return 60.0
  const opt = optimalPsi || OPTIMAL_PSI
  const deviation = Math.abs(actualPsi - opt) / opt
  if (deviation <= PRESSURE_TOLERANCE_PCT) return 100.0
  return Math.max(0.0, 100.0 - (deviation - PRESSURE_TOLERANCE_PCT) * 400)
}

/** Age sub-score from age in YEARS. null → 60; 0 at/over 5y; linear otherwise. */
export function ageScore(years) {
  if (years == null) return 60.0
  if (years >= TYRE_MAX_AGE_YEARS) return 0.0
  return 100.0 * (1.0 - years / TYRE_MAX_AGE_YEARS)
}

/** Km sub-score. falsy → 80; 0 at lifecycle limit; linear otherwise. */
export function kmScore(km) {
  if (!km) return 80.0
  return Math.max(0.0, 100.0 * (1.0 - km / KM_MAX_LIFECYCLE))
}

/** Inspection sub-score from days-since-inspection. null → 40 (no data). */
export function inspectionScore(daysSince) {
  if (daysSince == null) return 40.0
  if (daysSince <= 7) return 100.0
  if (daysSince <= INSPECTION_OVERDUE_DAYS) {
    return 100.0 - 50.0 * (daysSince - 7) / (INSPECTION_OVERDUE_DAYS - 7)
  }
  return Math.max(0.0, 50.0 - (daysSince - INSPECTION_OVERDUE_DAYS) * 1.0)
}

/** Weighted composite safety score, rounded to 1 dp. */
export function compositeScore(tread, pressure, age, km, insp) {
  const raw = (tread * W_TREAD + pressure * W_PRESSURE + age * W_AGE + km * W_KM + insp * W_INSPECTION) / 100.0
  return Math.round(raw * 10) / 10
}

/** SAFETY band: >=75 low, >=50 medium, >=25 high, <25 critical. */
export function riskLevel(score) {
  if (score == null || !Number.isFinite(score)) return 'unknown'
  if (score >= 75) return 'low'
  if (score >= 50) return 'medium'
  if (score >= 25) return 'high'
  return 'critical'
}

/** Colour token matching the safety band. */
export function riskColor(score) {
  if (score == null || !Number.isFinite(score)) return 'slate'
  if (score >= 75) return 'green'
  if (score >= 50) return 'amber'
  if (score >= 25) return 'orange'
  return 'red'
}

/**
 * Factors dragging a tyre's safety down: tread/km below 50, pressure/age/
 * inspection below 60. Compared on the RAW sub-scores (as the original engine
 * does), returned worst-first with a human detail, capped at 3.
 * @param {{tread,pressure,age,km,inspection:number}} raw  raw sub-scores
 * @param {object} ctx  { treadMm, actualPsi, optimalPsi, ageYears, km, inspDays }
 */
export function topRiskFactors(raw, ctx = {}) {
  const factors = []
  if (raw.tread < 50) {
    factors.push({ factor: 'tread_depth', score: round1(raw.tread), detail: ctx.treadMm != null ? `${ctx.treadMm}mm tread` : 'Tread depth not recorded' })
  }
  if (raw.pressure < 60) {
    factors.push({ factor: 'pressure', score: round1(raw.pressure), detail: ctx.actualPsi != null ? `${ctx.actualPsi} PSI vs ${ctx.optimalPsi ?? OPTIMAL_PSI} optimal` : 'Pressure not recorded' })
  }
  if (raw.age < 60) {
    factors.push({ factor: 'tyre_age', score: round1(raw.age), detail: ctx.ageYears != null ? `${round1(ctx.ageYears)} yrs in service` : 'Fitment date unknown' })
  }
  if (raw.km < 50) {
    factors.push({ factor: 'km_driven', score: round1(raw.km), detail: ctx.km ? `${Math.round(ctx.km).toLocaleString()} km driven` : 'High mileage' })
  }
  if (raw.inspection < 60) {
    factors.push({ factor: 'inspection', score: round1(raw.inspection), detail: ctx.inspDays != null ? `Last inspection ${ctx.inspDays}d ago` : 'No inspection on record' })
  }
  return factors.sort((a, b) => a.score - b.score).slice(0, 3)
}

/**
 * Score a single tyre record into a full safety profile.
 * @param {object} rec  a tyre_records row
 * @param {{ now?:number|Date, optimalPsi?:number }} [opts]
 */
export function scoreTyre(rec, opts = {}) {
  const now = resolveNow(opts.now)
  const optimalPsi = opts.optimalPsi ?? OPTIMAL_PSI

  const treadMm = num(rec?.tread_depth)
  const actualPsi = num(rec?.pressure_reading)
  const ageYears = inServiceYears(rec, now)
  const km = tyreKm(rec)
  const inspDays = null // no per-tyre inspection-date source in tyre_records

  const sTread = treadScore(treadMm)
  const sPres = pressureScore(actualPsi, optimalPsi)
  const sAge = ageScore(ageYears)
  const sKm = kmScore(km)
  const sInsp = inspectionScore(inspDays)

  const score = compositeScore(sTread, sPres, sAge, sKm, sInsp)
  const level = riskLevel(score)

  const component_scores = {
    tread: round1(sTread), pressure: round1(sPres), age: round1(sAge),
    km: round1(sKm), inspection: round1(sInsp),
  }

  return {
    id: rec?.id ?? null,
    serial: serialOf(rec),
    asset_no: assetOf(rec),
    position: positionOf(rec),
    brand: rec?.brand ?? null,
    size: rec?.size ?? null,
    site: rec?.site ?? null,
    country: rec?.country ?? null,
    status: rec?.status ?? null,
    risk_score: score,
    risk_level: level,
    risk_color: riskColor(score),
    component_scores,
    top_risk_factors: topRiskFactors(
      { tread: sTread, pressure: sPres, age: sAge, km: sKm, inspection: sInsp },
      { treadMm, actualPsi, optimalPsi, ageYears, km, inspDays },
    ),
    tread_depth: treadMm,
    pressure_reading: actualPsi,
    age_years: ageYears != null ? round1(ageYears) : null,
    km,
    cpk: (() => { const c = tyreCpk(rec); return c == null ? null : Math.round(c * 1000) / 1000 })(),
  }
}

/**
 * Score every LIVE (in-service, non-scrapped) tyre. Deterministic for a fixed
 * `opts.now`. Ordered worst-first (lowest safety score); serial tiebreaker keeps
 * order stable.
 * @param {{ tyres?: Array }} data
 * @param {{ now?:number|Date, optimalPsi?:number }} [opts]
 */
export function scoreTyres({ tyres = [] } = {}, opts = {}) {
  const now = resolveNow(opts.now)
  const rows = (Array.isArray(tyres) ? tyres : [])
    .filter((r) => r && isInService(r) && !isScrapped(r))
    .map((r) => scoreTyre(r, { ...opts, now }))
  rows.sort((a, b) => a.risk_score - b.risk_score
    || String(a.serial || a.asset_no || '').localeCompare(String(b.serial || b.asset_no || '')))
  return rows
}

/**
 * Fleet-level rollup of scored tyre rows.
 * @param {Array} rows  output of scoreTyres / scoreTyre[]
 * @returns {{ fleet_average_score, fleet_risk_level, by_risk_level, total_scored }}
 */
export function summarizeTyreRisk(rows) {
  const list = Array.isArray(rows) ? rows : []
  const by_risk_level = { critical: 0, high: 0, medium: 0, low: 0 }
  let sum = 0
  for (const r of list) {
    if (by_risk_level[r.risk_level] != null) by_risk_level[r.risk_level] += 1
    sum += Number(r.risk_score) || 0
  }
  const fleet_average_score = list.length ? Math.round((sum / list.length) * 10) / 10 : 0
  return {
    fleet_average_score,
    fleet_risk_level: list.length ? riskLevel(fleet_average_score) : 'unknown',
    by_risk_level,
    total_scored: list.length,
  }
}

/**
 * SECONDARY view — per-vehicle rollup derived from the SAME per-tyre scores.
 * Groups scored tyre rows by asset and reports the worst (lowest-safety) tyre
 * per vehicle, mirroring the original /risk-score/vehicle endpoint. A vehicle's
 * band is the band of its worst tyre, so it can never disagree with its tyres.
 * @param {Array} rows  output of scoreTyres
 */
export function rollupVehicles(rows) {
  const list = Array.isArray(rows) ? rows : []
  const groups = new Map()
  for (const r of list) {
    const key = r.asset_no
    if (!key) continue // pool/unassigned stock isn't a vehicle
    let g = groups.get(key)
    if (!g) {
      g = { asset_no: key, site: r.site ?? null, country: r.country ?? null, scores: [], worstTyre: null }
      groups.set(key, g)
    }
    if (!g.site && r.site) g.site = r.site
    if (!g.country && r.country) g.country = r.country
    g.scores.push(r.risk_score)
    if (!g.worstTyre || r.risk_score < g.worstTyre.risk_score) g.worstTyre = r
  }

  const out = []
  for (const g of groups.values()) {
    const worst = Math.min(...g.scores)
    const avg = Math.round((g.scores.reduce((s, x) => s + x, 0) / g.scores.length) * 10) / 10
    out.push({
      asset_no: g.asset_no,
      site: g.site,
      country: g.country,
      tyre_count: g.scores.length,
      worst_score: worst,
      average_score: avg,
      vehicle_risk_level: riskLevel(worst),
      vehicle_risk_color: riskColor(worst),
      worst_tyre: g.worstTyre
        ? { serial: g.worstTyre.serial, position: g.worstTyre.position, top_risk_factors: g.worstTyre.top_risk_factors }
        : null,
    })
  }
  // Worst vehicles first; stable asset_no tiebreaker.
  out.sort((a, b) => a.worst_score - b.worst_score || String(a.asset_no).localeCompare(String(b.asset_no)))
  return out
}
