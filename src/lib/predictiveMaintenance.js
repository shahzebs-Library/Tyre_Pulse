/**
 * Predictive Maintenance — pure, deterministic prediction engines (no I/O, no
 * React, no `Date.now()` inside the math: every time-dependent function takes an
 * injected `nowMs`). Ported and deepened from tyre_saas's Python engines:
 *   • predictive_service.py         (Weibull method-of-moments cohort fit)
 *   • replacement_lifecycle.py      (urgency bands)
 *   • routes/predictive_ai.py       (Weibull reliability + composite risk score)
 *   • routes/replacement_forecast.py(wear-rate + min-of-three forecast)
 *
 * This app's flat `tyre_records` does NOT carry the richer signals the original
 * services read (per-groove tread time-series, TPMS history, manufacture_date).
 * Rather than fabricate them, each engine degrades honestly and documents the
 * approximation it makes:
 *   • No manufacture_date  → `fitment_date` is used as an in-service age proxy
 *     (G2 daysByAge). This is an APPROXIMATION: a tyre's shelf age before
 *     fitment is unknown, so age-to-5yr is measured from first fitment.
 *   • No inspection tread time-series → wear rate (G1) is derived from a single
 *     current `tread_depth` vs a nominal new-tread depth over lifetime km, not
 *     from a regression of readings.
 *   • No TPMS history → pressure risk (G3) uses the single `pressure_reading`
 *     deviation vs a documented fleet target; `hasData:false` when absent. It is
 *     never a fabricated time-series or 3-sigma outlier.
 *
 * Unit-tested (src/test/predictiveMaintenance*.test.js). The page consumes the
 * orchestrators `buildPredictions`, `buildFailureRiskRows`, `buildCohortModels`.
 */

// ── Engineering constants ────────────────────────────────────────────────────

/** UAE / GCC legal minimum tread — replacement is mandatory at/below this. */
export const LEGAL_MIN_TREAD_MM = 1.6
/** Recommended replacement target (safety margin above the legal limit). */
export const REPLACE_TARGET_MM = 3.0
/** Manufacturer default new-tread depth (heavy-commercial), tyre_saas default. */
export const DEFAULT_NEW_TREAD_MM = 16.0
/** GCC service-life age guideline (years) — used from fitment_date as a proxy. */
export const MAX_AGE_YEARS = 5.0
/** Fleet default utilisation when a per-asset rate cannot be derived. */
export const DEFAULT_DAILY_KM = 200
/** Fleet default expected life (km) when no completed history exists. */
export const DEFAULT_AVG_KM_LIFE = 80_000
/** Below this lifetime distance we refuse to derive a wear rate (too noisy). */
export const MIN_KM_FOR_RATE = 50
/** Sane bounds for the derived tread wear rate (mm per km). ~16mm over 800Mm
 *  → 2e-5; ~16mm over 3,200km → 5e-3. Clamp keeps a single bad reading from
 *  producing a physically impossible forecast. */
export const WEAR_RATE_MIN_MM_PER_KM = 2e-5
export const WEAR_RATE_MAX_MM_PER_KM = 1e-2
/** Weibull shape for tyre wear-out failure mode (β≈2.0–2.5). */
export const WEIBULL_BETA = 2.2
/** Documented fleet pressure target (psi, heavy-commercial GCC). Honest single
 *  reading only — there is no per-tyre target or TPMS series in this dataset. */
export const PRESSURE_TARGET_PSI = 105
export const MS_PER_DAY = 86_400_000
const MS_PER_YEAR = 365.25 * MS_PER_DAY

/** Brand characteristic-life η (km) for the Weibull reliability model — the
 *  63.2%-failure mileage. Premium brands last longer. (predictive_ai.py table.) */
export const BRAND_ETA_KM = {
  michelin: 135_000,
  bridgestone: 128_000,
  goodyear: 125_000,
  continental: 130_000,
  pirelli: 122_000,
  hankook: 110_000,
}
export const DEFAULT_ETA_KM = 110_000

/** Minimum completed-life samples to fit a cohort Weibull. */
export const COHORT_MIN_SIZE = 5

// ── Small helpers ────────────────────────────────────────────────────────────

const num = (v) => {
  const n = typeof v === 'number' ? v : parseFloat(v)
  return Number.isFinite(n) ? n : null
}
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v))
const round = (v, dp = 2) => (v == null || !Number.isFinite(v) ? null : Math.round(v * 10 ** dp) / 10 ** dp)
const mean = (a) => (a.length ? a.reduce((s, v) => s + v, 0) / a.length : null)

/** Resolve brand → characteristic life η (km). Case-insensitive, trimmed. */
export function brandEta(brand) {
  const key = String(brand || '').trim().toLowerCase()
  return BRAND_ETA_KM[key] ?? DEFAULT_ETA_KM
}

/**
 * Nominal new-tread depth (mm) for a tyre when no per-tyre initial reading
 * exists. Documented size-class table: heavy-commercial radials (22.5"/19.5"/
 * 17.5" rims, e.g. 315/80R22.5, 11R22.5) carry ~16mm; light-truck / SUV /
 * passenger radials (13"–20" rims) carry ~9mm. `brand` is accepted for future
 * brand-specific spec sheets but is not currently differentiated (avoids
 * fabricating per-brand values we cannot source).
 */
export function nominalNewTread(brand, size) {
  const s = String(size || '').toUpperCase().replace(/\s+/g, '')
  // Heavy-commercial truck & bus rims.
  if (/R(2[024]\.5|19\.5|17\.5)/.test(s) || /^\d{2}R2\d/.test(s)) return 16.0
  // Light-truck / SUV / passenger radials (aspect-ratio Rnn format).
  if (/R1[3-9]\b/.test(s) || /R20\b/.test(s)) return 9.0
  return DEFAULT_NEW_TREAD_MM
}

// ── G1: tread wear-rate predictor ────────────────────────────────────────────

/**
 * Derive the tread wear rate (mm per km) from a single current reading vs the
 * nominal new depth over the tyre's lifetime km. Returns null when the signal
 * is unusable (no reading, non-positive distance, non-positive consumption).
 */
export function treadWearRate(treadDepth, totalKm, newTread) {
  const t = num(treadDepth)
  const km = num(totalKm)
  const nt = num(newTread)
  if (t == null || nt == null || km == null || km < MIN_KM_FOR_RATE) return null
  const consumed = nt - t
  if (consumed <= 0) return null
  return clamp(consumed / km, WEAR_RATE_MIN_MM_PER_KM, WEAR_RATE_MAX_MM_PER_KM)
}

/**
 * Days until tread reaches the legal limit, from the derived wear rate and the
 * asset's average daily km. Null when wear rate or tread is unavailable.
 * @returns {{kmToLimit:number, days:number}|null}
 */
export function forecastByTread(treadDepth, wearRateMmPerKm, avgDailyKm) {
  const t = num(treadDepth)
  const rate = num(wearRateMmPerKm)
  const daily = num(avgDailyKm)
  if (t == null || rate == null || rate <= 0 || daily == null || daily <= 0) return null
  const kmToLimit = Math.max(0, (t - LEGAL_MIN_TREAD_MM) / rate)
  return { kmToLimit, days: kmToLimit / daily }
}

// ── G2: multi-factor min-of-three forecast + limiting factor ─────────────────

/**
 * Days until the km-lifecycle limit, from the existing km-life model.
 * remaining = avgKmLife − kmRunOnTyre; days = remaining / avgDailyKm.
 */
export function forecastByKm(kmRunOnTyre, avgKmLife, avgDailyKm) {
  const run = num(kmRunOnTyre)
  const life = num(avgKmLife)
  const daily = num(avgDailyKm)
  if (life == null || daily == null || daily <= 0) return null
  const remaining = Math.max(0, life - (run ?? 0))
  return remaining / daily
}

/**
 * Days until the GCC 5-year age guideline, measured from `fitment_date` as an
 * in-service age proxy (documented: no manufacture_date in this dataset). Null
 * when there is no fitment date.
 */
export function forecastByAge(fitmentDate, nowMs) {
  if (!fitmentDate) return null
  const fitted = new Date(fitmentDate).getTime()
  if (!Number.isFinite(fitted)) return null
  const expireMs = fitted + MAX_AGE_YEARS * MS_PER_YEAR
  return Math.max(0, (expireMs - nowMs) / MS_PER_DAY)
}

/** Named limiting factors (which model bounds the replacement date). */
export const LIMITING_FACTORS = {
  tread: 'tread_wear',
  km: 'km_lifecycle',
  age: 'age_limit',
}

/**
 * Combine the three forecasts into a conservative (minimum) days-to-replace and
 * report which factor limits it. Any factor may be null (unavailable).
 * @returns {{days:number|null, limitingFactor:string|null, byTread:number|null, byKm:number|null, byAge:number|null}}
 */
export function combineForecast({ byTread, byKm, byAge }) {
  const candidates = [
    [LIMITING_FACTORS.tread, num(byTread)],
    [LIMITING_FACTORS.km, num(byKm)],
    [LIMITING_FACTORS.age, num(byAge)],
  ].filter(([, d]) => d != null)
  if (!candidates.length) {
    return { days: null, limitingFactor: null, byTread: num(byTread), byKm: num(byKm), byAge: num(byAge) }
  }
  const [factor, days] = candidates.reduce((min, cur) => (cur[1] < min[1] ? cur : min))
  return {
    days,
    limitingFactor: factor,
    byTread: num(byTread),
    byKm: num(byKm),
    byAge: num(byAge),
  }
}

/** Urgency bands (replacement_lifecycle.py / replacement_forecast.py). */
export const URGENCY_BANDS = [
  { band: 'immediate', maxDays: 7, color: 'red', label: 'Replace within 7 days' },
  { band: 'urgent', maxDays: 30, color: 'orange', label: 'Replace within 30 days' },
  { band: 'soon', maxDays: 90, color: 'amber', label: 'Schedule within 3 months' },
  { band: 'planned', maxDays: 180, color: 'teal', label: 'Include in next procurement cycle' },
  { band: 'normal', maxDays: Infinity, color: 'green', label: 'No immediate action needed' },
]

export function urgencyBand(days) {
  if (days == null || !Number.isFinite(days)) {
    return { band: 'unknown', color: 'gray', label: 'Insufficient data to forecast' }
  }
  return URGENCY_BANDS.find((b) => days <= b.maxDays) || URGENCY_BANDS[URGENCY_BANDS.length - 1]
}

// ── G3: Weibull failure probability + composite risk ─────────────────────────

/** Weibull reliability R(t) = exp(-(t/η)^β). Guards non-physical inputs. */
export function weibullReliability(t, eta = DEFAULT_ETA_KM, beta = WEIBULL_BETA) {
  const tt = num(t)
  if (tt == null || tt < 0 || eta <= 0 || beta <= 0) return 1.0
  try {
    return Math.exp(-((tt / eta) ** beta))
  } catch {
    return 0.0
  }
}

/** Probability of failure by t: F(t) = 1 − R(t), in [0,1]. */
export function failureProbability(t, eta = DEFAULT_ETA_KM, beta = WEIBULL_BETA) {
  return clamp(1 - weibullReliability(t, eta, beta), 0, 1)
}

/**
 * Composite 0–100 risk score for a single tyre, decomposed into weighted,
 * honest sub-factors (predictive_ai.py). Weights cap at 40/30/15/15 = 100.
 *   • mileage  = failureProb × 40                (Weibull wear-out)
 *   • tread    ≤ 30, rises as tread drops below 5mm
 *   • age      ≤ 15, rises after 3y in-service (fitment proxy)
 *   • pressure ≤ 15, single-reading deviation vs documented target; 0 + hasData
 *     false when no reading exists (never fabricated)
 * @returns {{score, band, failureProb, factors:{mileage,tread,age,pressure}, pressureHasData, ageHasData}}
 */
export function compositeRisk({ totalKm, treadDepth, brand, fitmentDate, pressureReading, nowMs }) {
  const eta = brandEta(brand)
  const fp = failureProbability(totalKm ?? 0, eta)
  const mileageFactor = fp * 40

  const tread = num(treadDepth)
  const treadFactor = tread != null ? (Math.max(0, 5 - tread) / 5) * 30 : 0

  let ageFactor = 0
  let ageHasData = false
  const ageDays = fitmentDate ? (nowMs - new Date(fitmentDate).getTime()) / MS_PER_DAY : null
  if (ageDays != null && Number.isFinite(ageDays)) {
    ageHasData = true
    // Rises after 3 years (1095 days) in service, capped at 15.
    ageFactor = clamp(((ageDays - 1095) / 365) * 5, 0, 15)
  }

  const pressure = num(pressureReading)
  let pressureFactor = 0
  let pressureHasData = false
  let pressureDevPct = null
  if (pressure != null && PRESSURE_TARGET_PSI > 0) {
    pressureHasData = true
    pressureDevPct = Math.abs((pressure - PRESSURE_TARGET_PSI) / PRESSURE_TARGET_PSI) * 100
    pressureFactor = clamp(pressureDevPct, 0, 15)
  }

  const score = clamp(mileageFactor + treadFactor + ageFactor + pressureFactor, 0, 100)
  return {
    score: round(score, 1),
    band: riskBand(score),
    failureProb: round(fp, 4),
    eta,
    factors: {
      mileage: round(mileageFactor, 1),
      tread: round(treadFactor, 1),
      age: round(ageFactor, 1),
      pressure: round(pressureFactor, 1),
    },
    pressureHasData,
    pressureDevPct: round(pressureDevPct, 1),
    ageHasData,
    ageDays: ageDays != null ? Math.round(ageDays) : null,
  }
}

/** Risk band from a 0–100 composite score (predictive_ai.py thresholds). */
export function riskBand(score) {
  if (score == null || !Number.isFinite(score)) return 'unknown'
  if (score >= 70) return 'extreme'
  if (score >= 50) return 'high'
  if (score >= 30) return 'elevated'
  return 'low'
}

// ── G4: cohort Weibull life distribution (method-of-moments) ─────────────────

// Lanczos approximation for the Gamma function (g=7, n=9). Pure JS, accurate to
// ~1e-13 on the [1,5] arguments used by the MoM fit. Handles z<0.5 by reflection.
const LANCZOS_G = 7
const LANCZOS_C = [
  0.99999999999980993,
  676.5203681218851,
  -1259.1392167224028,
  771.32342877765313,
  -176.61502916214059,
  12.507343278686905,
  -0.13857109526572012,
  9.9843695780195716e-6,
  1.5056327351493116e-7,
]

export function gamma(z) {
  if (z < 0.5) {
    return Math.PI / (Math.sin(Math.PI * z) * gamma(1 - z))
  }
  z -= 1
  let x = LANCZOS_C[0]
  for (let i = 1; i < LANCZOS_G + 2; i++) x += LANCZOS_C[i] / (z + i)
  const t = z + LANCZOS_G + 0.5
  return Math.sqrt(2 * Math.PI) * Math.pow(t, z + 0.5) * Math.exp(-t) * x
}

/**
 * Method-of-moments 2-parameter Weibull fit to positive lifetime samples.
 * Solves CV² = Γ(1+2/β)/Γ(1+1/β)² − 1 for β via bisection on [0.5,10], then
 * η = mean / Γ(1+1/β). Returns null when there are < COHORT_MIN_SIZE samples
 * or the moments are degenerate.
 * @returns {{beta,eta,mean,std,cv,n}|null}
 */
export function weibullMomFit(samples) {
  const xs = (Array.isArray(samples) ? samples : []).map(num).filter((v) => v != null && v > 0)
  const n = xs.length
  if (n < COHORT_MIN_SIZE) return null
  const mu = mean(xs)
  if (mu == null || mu <= 0) return null
  const variance = xs.reduce((s, v) => s + (v - mu) ** 2, 0) / Math.max(1, n - 1)
  const sigma = Math.sqrt(variance)
  if (sigma <= 0) return null
  const cv = sigma / mu
  const target = cv * cv

  const f = (beta) => {
    const numr = gamma(1 + 2 / beta)
    const den = gamma(1 + 1 / beta) ** 2
    if (den <= 0 || !Number.isFinite(numr) || !Number.isFinite(den)) return NaN
    return numr / den - 1 - target
  }

  let lo = 0.5
  let hi = 10.0
  let fLo = f(lo)
  let fHi = f(hi)
  let beta
  if (Number.isNaN(fLo) || Number.isNaN(fHi)) return null
  if (fLo * fHi > 0) {
    // Target CV outside the solvable bracket — clamp to the nearer endpoint.
    beta = Math.abs(fLo) < Math.abs(fHi) ? lo : hi
  } else {
    for (let i = 0; i < 100; i++) {
      const mid = 0.5 * (lo + hi)
      const fMid = f(mid)
      if (Number.isNaN(fMid)) break
      if (fLo * fMid <= 0) {
        hi = mid
        fHi = fMid
      } else {
        lo = mid
        fLo = fMid
      }
      if (hi - lo < 1e-6) break
    }
    beta = 0.5 * (lo + hi)
  }

  const g1 = gamma(1 + 1 / beta)
  if (!Number.isFinite(g1) || g1 <= 0) return null
  const eta = mu / g1
  if (!Number.isFinite(eta) || eta <= 0) return null
  return { beta, eta, mean: mu, std: sigma, cv, n }
}

/** Weibull survival S(t) = exp(-(t/η)^β). */
export function weibullSurvival(t, beta, eta) {
  const tt = num(t)
  if (tt == null || tt < 0 || eta <= 0 || beta <= 0) return 1.0
  try {
    return Math.exp(-((tt / eta) ** beta))
  } catch {
    return 0.0
  }
}

/**
 * Evaluate a fitted cohort against a tyre's current km.
 * @returns {{survivalPct, percentileInCohort, expectedRemainingKm}}
 */
export function cohortPosition(fit, currentKm) {
  const km = num(currentKm) ?? 0
  const s = weibullSurvival(km, fit.beta, fit.eta)
  const cohortMean = fit.eta * gamma(1 + 1 / fit.beta)
  return {
    survivalPct: round(100 * s, 1),
    percentileInCohort: round(100 * (1 - s), 1),
    expectedRemainingKm: Math.max(0, Math.round(cohortMean - km)),
  }
}

/**
 * Fit a Weibull to the COMPLETED lives (km_at_removal − km_at_fitment, both
 * present, positive) of every (brand, size) cohort with ≥ COHORT_MIN_SIZE
 * samples. Returns a Map keyed `brand||size`.
 */
export function buildCohortModels(records = []) {
  const groups = new Map()
  for (const r of records) {
    const fit = num(r.km_at_fitment)
    const rem = num(r.km_at_removal)
    if (fit == null || rem == null) continue
    const life = rem - fit
    if (life <= 0) continue
    const key = `${(r.brand || 'Unknown').toString().trim()}||${(r.size || 'Unknown').toString().trim()}`
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key).push(life)
  }
  const models = new Map()
  for (const [key, lives] of groups) {
    const fit = weibullMomFit(lives)
    if (fit) {
      const [brand, size] = key.split('||')
      models.set(key, { brand, size, ...fit, ciSpread: cohortCiSpread(fit.n) })
    }
  }
  return models
}

export const cohortKey = (brand, size) =>
  `${(brand || 'Unknown').toString().trim()}||${(size || 'Unknown').toString().trim()}`

// ── G5: confidence ───────────────────────────────────────────────────────────

/** Per-asset confidence 0–1 from completed-life sample count (saturates at 6). */
export function assetConfidence(nCompleted) {
  const n = num(nCompleted) ?? 0
  return clamp(n / 6, 0, 1)
}

/** Map a 0–1 confidence to a label. */
export function confidenceLabel(conf) {
  if (conf == null) return 'low'
  if (conf >= 0.75) return 'high'
  if (conf >= 0.4) return 'medium'
  return 'low'
}

/** Cohort CI half-width (± percentage points): 30/√n, bounded [3,35]. */
export function cohortCiSpread(n) {
  const nn = num(n) ?? 0
  if (nn <= 0) return 35
  return clamp(30 / Math.sqrt(nn), 3, 35)
}

// ── Orchestrators (consumed by the page) ─────────────────────────────────────

const mkMasterIndex = (fleetMaster = []) => {
  const idx = {}
  for (const fm of fleetMaster) if (fm && fm.asset_no) idx[fm.asset_no] = fm
  return idx
}

/**
 * Fleet-level statistics used as fallbacks by the per-asset engine.
 */
export function computeFleetStats(records = []) {
  const completed = records.filter((r) => num(r.km_at_removal) != null && num(r.km_at_fitment) != null)
  const lives = completed.map((r) => num(r.km_at_removal) - num(r.km_at_fitment)).filter((v) => v > 0)
  const costs = records.map((r) => num(r.cost_per_tyre)).filter((v) => v != null && v > 0)
  return {
    avgKmLife: lives.length ? mean(lives) : DEFAULT_AVG_KM_LIFE,
    avgCost: costs.length ? mean(costs) : 0,
    avgDailyKm: DEFAULT_DAILY_KM,
  }
}

/**
 * Build per-active-tyre replacement predictions. Deepened from the original
 * one-line km model: each prediction now carries G1 wear-rate + G2 min-of-three
 * forecast (tread / km / age) with a limiting factor, G5 confidence, and G3
 * composite failure-risk fields — while preserving every field the budget /
 * procurement dashboard already consumes (due_date, estimated_cost, urgency,
 * km_remaining, days_away, avg_km_life, avg_daily_km).
 *
 * @param {object[]} records
 * @param {object[]} fleetMaster
 * @param {object} opts { fleetAvgCost, fleetAvgKmLife, fleetAvgDailyKm, nowMs }
 */
export function buildPredictions(records, fleetMaster = [], opts = {}) {
  const nowMs = opts.nowMs ?? Date.now()
  const fleetAvgCost = opts.fleetAvgCost ?? 0
  const fleetAvgKmLife = opts.fleetAvgKmLife ?? DEFAULT_AVG_KM_LIFE
  const fleetAvgDailyKm = opts.fleetAvgDailyKm ?? DEFAULT_DAILY_KM
  const cohortModels = opts.cohortModels ?? buildCohortModels(records)

  const byAsset = {}
  for (const r of records) {
    if (!r.asset_no) continue
    ;(byAsset[r.asset_no] ||= []).push(r)
  }
  const masterByAsset = mkMasterIndex(fleetMaster)

  const predictions = []

  for (const [assetNo, recs] of Object.entries(byAsset)) {
    const master = masterByAsset[assetNo] || null

    const completed = recs.filter((r) => num(r.km_at_removal) != null && num(r.km_at_fitment) != null)
    const completedLifeKms = completed.map((r) => num(r.km_at_removal) - num(r.km_at_fitment)).filter((v) => v > 0)
    const avgKmLife = completedLifeKms.length
      ? mean(completedLifeKms)
      : num(master?.expected_km_per_tyre) ?? fleetAvgKmLife ?? DEFAULT_AVG_KM_LIFE

    // Average daily km for the asset from its odometer span over service days.
    let avgDailyKm = DEFAULT_DAILY_KM
    if (completed.length > 0) {
      const times = completed
        .map((r) => (r.issue_date ? new Date(r.issue_date).getTime() : null))
        .filter((v) => Number.isFinite(v))
      if (times.length >= 2) {
        const totalDays = (Math.max(...times) - Math.min(...times)) / MS_PER_DAY
        const lastRemoval = Math.max(...completed.map((r) => num(r.km_at_removal) ?? 0))
        const firstFitment = Math.min(...completed.map((r) => num(r.km_at_fitment) ?? 0))
        const totalKm = lastRemoval - firstFitment
        if (totalDays > 0 && totalKm > 0) avgDailyKm = totalKm / totalDays
      }
    }
    if (!avgDailyKm || avgDailyKm <= 0) avgDailyKm = fleetAvgDailyKm || DEFAULT_DAILY_KM

    // Current odometer from master, else projected from the last removal.
    let currentKm = num(master?.current_km)
    if (currentKm == null && completed.length > 0) {
      const lastRemoval = [...completed].sort((a, b) => (num(b.km_at_removal) ?? 0) - (num(a.km_at_removal) ?? 0))[0]
      const lastMs = lastRemoval.issue_date ? new Date(lastRemoval.issue_date).getTime() : null
      if (Number.isFinite(lastMs)) {
        const daysSince = (nowMs - lastMs) / MS_PER_DAY
        currentKm = (num(lastRemoval.km_at_removal) ?? 0) + daysSince * avgDailyKm
      }
    }

    const active = recs.filter((r) => num(r.km_at_removal) == null)
    if (active.length === 0) continue

    const assetCosts = recs.map((r) => num(r.cost_per_tyre)).filter((v) => v != null && v > 0)
    const assetAvgCost = assetCosts.length ? mean(assetCosts) : fleetAvgCost || 0
    const confidence = assetConfidence(completedLifeKms.length)

    for (const tyre of active) {
      const fitmentKm = num(tyre.km_at_fitment) ?? currentKm ?? 0
      const runFromOdometer = currentKm != null ? Math.max(0, currentKm - fitmentKm) : null
      const tyreRunKm = num(tyre.total_km) ?? runFromOdometer ?? 0

      // G1 — tread wear rate + tread-limited days.
      const newTread = nominalNewTread(tyre.brand, tyre.size)
      const wearRate = treadWearRate(tyre.tread_depth, tyreRunKm, newTread)
      const tread = forecastByTread(tyre.tread_depth, wearRate, avgDailyKm)
      const byTread = tread?.days ?? null

      // G2 — km + age forecasts, then min-of-three.
      const byKm = forecastByKm(tyreRunKm, avgKmLife, avgDailyKm)
      const byAge = forecastByAge(tyre.fitment_date, nowMs)
      const combined = combineForecast({ byTread, byKm, byAge })

      // Effective days: the conservative combined estimate, else the km model.
      const daysUntil = combined.days != null ? combined.days : byKm != null ? byKm : 365
      const daysAway = Math.round(daysUntil)
      const dueMs = nowMs + Math.round(daysUntil) * MS_PER_DAY
      const dueDate = new Date(dueMs)
      const band = urgencyBand(daysUntil)

      // Legacy tri-band urgency retained for the dashboard KPIs / filters.
      const urgency = legacyUrgency(tyre.tread_depth, daysAway)

      // G3 — composite failure risk.
      const risk = compositeRisk({
        totalKm: tyreRunKm,
        treadDepth: tyre.tread_depth,
        brand: tyre.brand,
        fitmentDate: tyre.fitment_date,
        pressureReading: tyre.pressure_reading,
        nowMs,
      })

      // Cohort position (G4), when the (brand,size) cohort was fit.
      const cModel = cohortModels.get(cohortKey(tyre.brand, tyre.size)) || null
      const cohort = cModel ? { ...cohortPosition(cModel, tyreRunKm), size: cModel.size, brand: cModel.brand, beta: round(cModel.beta, 3), etaKm: Math.round(cModel.eta), n: cModel.n, ciSpread: round(cModel.ciSpread, 1) } : null

      const remainingKm = Math.max(0, (avgKmLife ?? DEFAULT_AVG_KM_LIFE) - tyreRunKm)
      const estimatedCost = num(tyre.cost_per_tyre) > 0 ? num(tyre.cost_per_tyre) : assetAvgCost

      predictions.push({
        id: tyre.id,
        asset_no: assetNo,
        site: tyre.site ?? master?.site ?? '-',
        vehicle_type: master?.vehicle_type ?? '-',
        position: tyre.position ?? '-',
        brand: tyre.brand ?? '-',
        size: tyre.size ?? '-',
        tyre_serial: tyre.tyre_serial ?? '-',
        tread_depth: num(tyre.tread_depth),
        pressure_reading: num(tyre.pressure_reading),
        km_remaining: Math.round(remainingKm),
        due_date: dueDate,
        urgency,
        band: band.band,
        band_label: band.label,
        limiting_factor: combined.limitingFactor,
        forecast_days: { byTread: round(byTread, 0), byKm: round(byKm, 0), byAge: round(byAge, 0) },
        wear_rate_mm_per_1000km: wearRate != null ? round(wearRate * 1000, 3) : null,
        new_tread_mm: newTread,
        estimated_cost: Math.round(estimatedCost || 0),
        days_away: daysAway,
        avg_km_life: Math.round(avgKmLife ?? DEFAULT_AVG_KM_LIFE),
        avg_daily_km: Math.round(avgDailyKm),
        confidence: round(confidence, 2),
        confidence_label: confidenceLabel(confidence),
        completed_samples: completedLifeKms.length,
        risk_score: risk.score,
        risk_band: risk.band,
        failure_prob: risk.failureProb,
        risk_factors: risk.factors,
        pressure_has_data: risk.pressureHasData,
        pressure_dev_pct: risk.pressureDevPct,
        age_has_data: risk.ageHasData,
        cohort,
      })
    }
  }

  return predictions.sort((a, b) => a.due_date - b.due_date)
}

/** Legacy tri-band urgency (Urgent/Soon/Monitor) — dashboard KPIs & filters. */
export function legacyUrgency(treadDepth, daysAway) {
  const t = num(treadDepth)
  if (t != null && t < REPLACE_TARGET_MM) return 'Urgent'
  if (daysAway <= 30) return 'Urgent'
  if (daysAway <= 90) return 'Soon'
  return 'Monitor'
}

/**
 * Build the per-tyre failure-risk table rows (G3 + G4 + G5) for ACTIVE tyres,
 * sorted by composite risk descending. Each row carries decomposed reasoning
 * factors so the UI can render an expandable explanation.
 */
export function buildFailureRiskRows(records = [], opts = {}) {
  const nowMs = opts.nowMs ?? Date.now()
  const cohortModels = opts.cohortModels ?? buildCohortModels(records)

  // Completed sample counts per asset drive confidence.
  const completedByAsset = {}
  for (const r of records) {
    if (!r.asset_no) continue
    if (num(r.km_at_removal) != null && num(r.km_at_fitment) != null && num(r.km_at_removal) - num(r.km_at_fitment) > 0) {
      completedByAsset[r.asset_no] = (completedByAsset[r.asset_no] || 0) + 1
    }
  }

  const rows = []
  for (const r of records) {
    if (num(r.km_at_removal) != null) continue // active only
    const totalKm = num(r.total_km) ?? 0
    const risk = compositeRisk({
      totalKm,
      treadDepth: r.tread_depth,
      brand: r.brand,
      fitmentDate: r.fitment_date,
      pressureReading: r.pressure_reading,
      nowMs,
    })
    const nCompleted = completedByAsset[r.asset_no] || 0
    const conf = assetConfidence(nCompleted)
    const cModel = cohortModels.get(cohortKey(r.brand, r.size)) || null
    const cohort = cModel ? { ...cohortPosition(cModel, totalKm), n: cModel.n, ciSpread: round(cModel.ciSpread, 1) } : null

    rows.push({
      id: r.id,
      asset_no: r.asset_no ?? '-',
      site: r.site ?? '-',
      position: r.position ?? '-',
      brand: r.brand ?? '-',
      size: r.size ?? '-',
      tyre_serial: r.tyre_serial ?? '-',
      tread_depth: num(r.tread_depth),
      pressure_reading: num(r.pressure_reading),
      total_km: totalKm,
      eta_km: risk.eta,
      risk_score: risk.score,
      risk_band: risk.band,
      failure_prob: risk.failureProb,
      failure_prob_pct: round(risk.failureProb * 100, 1),
      factors: risk.factors,
      pressure_has_data: risk.pressureHasData,
      pressure_dev_pct: risk.pressureDevPct,
      age_has_data: risk.ageHasData,
      age_days: risk.ageDays,
      confidence: round(conf, 2),
      confidence_label: confidenceLabel(conf),
      completed_samples: nCompleted,
      cohort,
    })
  }

  return rows.sort((a, b) => b.risk_score - a.risk_score)
}
