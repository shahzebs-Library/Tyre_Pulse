import { describe, it, expect } from 'vitest'
import {
  brandEta, nominalNewTread, treadWearRate, forecastByTread, forecastByKm,
  forecastByAge, combineForecast, urgencyBand, weibullReliability, failureProbability,
  compositeRisk, riskBand, gamma, weibullMomFit, weibullSurvival, cohortPosition,
  buildCohortModels, assetConfidence, confidenceLabel, cohortCiSpread,
  buildPredictions, buildFailureRiskRows, legacyUrgency,
  LEGAL_MIN_TREAD_MM, DEFAULT_NEW_TREAD_MM, DEFAULT_ETA_KM, WEIBULL_BETA,
} from '../lib/predictiveMaintenance'

const DAY = 86_400_000
// Fixed clock so every time-dependent assertion is deterministic.
const NOW = Date.parse('2026-07-13T00:00:00Z')

// ── G1: tread wear-rate predictor ─────────────────────────────────────────────
describe('G1 — tread wear rate', () => {
  it('picks nominal new tread by size class', () => {
    expect(nominalNewTread('Michelin', '315/80R22.5')).toBe(16.0)
    expect(nominalNewTread('Bridgestone', '11R22.5')).toBe(16.0)
    expect(nominalNewTread('Goodyear', '265/65R17')).toBe(9.0)
    expect(nominalNewTread('X', '')).toBe(DEFAULT_NEW_TREAD_MM)
  })

  it('derives mm/km from current tread vs new over lifetime km', () => {
    // 16 → 8 over 80,000 km: consumed 8mm → 1e-4 mm/km
    expect(treadWearRate(8, 80_000, 16)).toBeCloseTo(1e-4, 8)
  })

  it('returns null on unusable signals and clamps extremes', () => {
    expect(treadWearRate(null, 80_000, 16)).toBeNull()
    expect(treadWearRate(8, 10, 16)).toBeNull() // below MIN_KM_FOR_RATE
    expect(treadWearRate(18, 80_000, 16)).toBeNull() // negative consumption
    // Extremely fast wear clamps to the max bound.
    expect(treadWearRate(1, 100, 16)).toBe(1e-2)
  })

  it('forecasts days-to-legal-limit from wear rate + daily km', () => {
    // tread 9mm, rate 1e-4 mm/km, 200 km/day
    // kmToLimit = (9-1.6)/1e-4 = 74,000 → 370 days
    const f = forecastByTread(9, 1e-4, 200)
    expect(f.kmToLimit).toBeCloseTo(74_000, 0)
    expect(f.days).toBeCloseTo(370, 0)
    expect(forecastByTread(9, null, 200)).toBeNull()
  })
})

// ── G2: min-of-three + limiting factor ────────────────────────────────────────
describe('G2 — multi-factor forecast + limiting factor', () => {
  it('forecastByKm uses remaining life over daily km', () => {
    // life 80k, run 60k → 20k remaining / 200 = 100 days
    expect(forecastByKm(60_000, 80_000, 200)).toBeCloseTo(100, 6)
    // already past life → 0
    expect(forecastByKm(90_000, 80_000, 200)).toBe(0)
  })

  it('forecastByAge counts from fitment_date to 5yr GCC guideline', () => {
    const fittedThreeYearsAgo = new Date(NOW - 3 * 365.25 * DAY).toISOString()
    const days = forecastByAge(fittedThreeYearsAgo, NOW)
    // ~2 years remaining to the 5yr limit
    expect(days).toBeCloseTo(2 * 365.25, 0)
    expect(forecastByAge(null, NOW)).toBeNull()
  })

  it('takes the minimum of the three and names the limiting factor', () => {
    const c = combineForecast({ byTread: 300, byKm: 120, byAge: 900 })
    expect(c.days).toBe(120)
    expect(c.limitingFactor).toBe('km_lifecycle')

    const c2 = combineForecast({ byTread: 40, byKm: 120, byAge: 900 })
    expect(c2.limitingFactor).toBe('tread_wear')

    const c3 = combineForecast({ byTread: null, byKm: null, byAge: 10 })
    expect(c3.days).toBe(10)
    expect(c3.limitingFactor).toBe('age_limit')

    const none = combineForecast({ byTread: null, byKm: null, byAge: null })
    expect(none.days).toBeNull()
    expect(none.limitingFactor).toBeNull()
  })

  it('bands urgency by days', () => {
    expect(urgencyBand(3).band).toBe('immediate')
    expect(urgencyBand(20).band).toBe('urgent')
    expect(urgencyBand(60).band).toBe('soon')
    expect(urgencyBand(150).band).toBe('planned')
    expect(urgencyBand(400).band).toBe('normal')
    expect(urgencyBand(null).band).toBe('unknown')
  })
})

// ── G3: Weibull failure probability + composite risk ──────────────────────────
describe('G3 — Weibull reliability + composite risk', () => {
  it('R(t)=exp(-(t/eta)^beta) and failureProb=1-R', () => {
    // At t = eta, R = exp(-1) ≈ 0.3679, F ≈ 0.6321
    expect(weibullReliability(120_000, 120_000, 2.2)).toBeCloseTo(Math.exp(-1), 6)
    expect(failureProbability(120_000, 120_000, 2.2)).toBeCloseTo(1 - Math.exp(-1), 6)
    // t=0 → fully reliable
    expect(weibullReliability(0, 120_000, 2.2)).toBe(1)
    expect(failureProbability(0, 120_000, 2.2)).toBe(0)
  })

  it('brandEta resolves premium vs default', () => {
    expect(brandEta('Michelin')).toBe(135_000)
    expect(brandEta('michelin')).toBe(135_000)
    expect(brandEta('NoName')).toBe(DEFAULT_ETA_KM)
  })

  it('composite score sums weighted factors within [0,100] and bands', () => {
    const r = compositeRisk({
      totalKm: 135_000, treadDepth: 2, brand: 'Michelin',
      fitmentDate: new Date(NOW - 4 * 365.25 * DAY).toISOString(),
      pressureReading: 80, nowMs: NOW,
    })
    // failureProb at eta → mileage ≈ 0.632*40 ≈ 25.3
    expect(r.factors.mileage).toBeCloseTo(25.3, 0)
    // tread 2mm → (5-2)/5*30 = 18
    expect(r.factors.tread).toBeCloseTo(18, 1)
    // age ~4y in service → capped rising factor ≤ 15
    expect(r.factors.age).toBeGreaterThan(0)
    expect(r.factors.age).toBeLessThanOrEqual(15)
    // pressure 80 vs 105 target → dev ≈ 23.8% capped to 15
    expect(r.factors.pressure).toBe(15)
    expect(r.score).toBeGreaterThan(0)
    expect(r.score).toBeLessThanOrEqual(100)
    expect(['extreme', 'high', 'elevated', 'low']).toContain(r.band)
    expect(r.pressureHasData).toBe(true)
    expect(r.ageHasData).toBe(true)
  })

  it('is honest when pressure / age signals are absent', () => {
    const r = compositeRisk({ totalKm: 50_000, treadDepth: 8, brand: 'X', fitmentDate: null, pressureReading: null, nowMs: NOW })
    expect(r.factors.pressure).toBe(0)
    expect(r.pressureHasData).toBe(false)
    expect(r.factors.age).toBe(0)
    expect(r.ageHasData).toBe(false)
  })

  it('riskBand thresholds', () => {
    expect(riskBand(80)).toBe('extreme')
    expect(riskBand(55)).toBe('high')
    expect(riskBand(35)).toBe('elevated')
    expect(riskBand(10)).toBe('low')
    expect(riskBand(null)).toBe('unknown')
  })
})

// ── G4: cohort Weibull method-of-moments ──────────────────────────────────────
describe('G4 — cohort Weibull fit (method-of-moments)', () => {
  it('gamma matches known values (Lanczos)', () => {
    expect(gamma(1)).toBeCloseTo(1, 6)
    expect(gamma(2)).toBeCloseTo(1, 6)
    expect(gamma(5)).toBeCloseTo(24, 4) // 4!
    expect(gamma(0.5)).toBeCloseTo(Math.sqrt(Math.PI), 6)
  })

  it('recovers beta≈2, eta≈100k from a known Weibull fixture', () => {
    // Deterministic fixture: inverse-CDF quantiles of Weibull(beta=2, eta=100000)
    // at p = 0.1..0.9. MoM should recover the generating parameters closely.
    const betaTrue = 2
    const etaTrue = 100_000
    const samples = [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9].map(
      (p) => etaTrue * Math.pow(-Math.log(1 - p), 1 / betaTrue),
    )
    const fit = weibullMomFit(samples)
    expect(fit).not.toBeNull()
    expect(fit.n).toBe(9)
    expect(fit.beta).toBeGreaterThan(1.5)
    expect(fit.beta).toBeLessThan(2.6)
    expect(fit.eta).toBeGreaterThan(85_000)
    expect(fit.eta).toBeLessThan(115_000)
    // mean of samples is preserved
    expect(fit.mean).toBeCloseTo(samples.reduce((s, v) => s + v, 0) / samples.length, 3)
  })

  it('returns null below the minimum cohort size', () => {
    expect(weibullMomFit([1, 2, 3, 4])).toBeNull()
  })

  it('clamps beta high when samples are near-constant (CV→0)', () => {
    const fit = weibullMomFit([100_000, 100_010, 99_990, 100_005, 99_995, 100_002])
    expect(fit).not.toBeNull()
    expect(fit.beta).toBeGreaterThan(5) // low CV → large shape, clamps toward 10
  })

  it('survival + cohort position at current km', () => {
    const fit = { beta: 2, eta: 100_000, mean: 88623, std: 46325, cv: 0.52, n: 20 }
    expect(weibullSurvival(0, 2, 100_000)).toBe(1)
    expect(weibullSurvival(100_000, 2, 100_000)).toBeCloseTo(Math.exp(-1), 6)
    const pos = cohortPosition(fit, 100_000)
    expect(pos.survivalPct).toBeCloseTo(36.8, 1)
    expect(pos.percentileInCohort).toBeCloseTo(63.2, 1)
    expect(pos.expectedRemainingKm).toBeGreaterThanOrEqual(0)
  })

  it('buildCohortModels groups completed lives by brand+size', () => {
    const records = []
    for (let i = 0; i < 6; i++) {
      records.push({ brand: 'Michelin', size: '11R22.5', km_at_fitment: 0, km_at_removal: 90_000 + i * 1000 })
    }
    // a second cohort too small to fit
    records.push({ brand: 'Hankook', size: '11R22.5', km_at_fitment: 0, km_at_removal: 70_000 })
    const models = buildCohortModels(records)
    expect(models.has('Michelin||11R22.5')).toBe(true)
    expect(models.has('Hankook||11R22.5')).toBe(false)
    const m = models.get('Michelin||11R22.5')
    expect(m.n).toBe(6)
    expect(m.eta).toBeGreaterThan(0)
    expect(m.ciSpread).toBeGreaterThan(0)
  })
})

// ── G5: confidence ────────────────────────────────────────────────────────────
describe('G5 — confidence', () => {
  it('assetConfidence saturates at 6 completed samples', () => {
    expect(assetConfidence(0)).toBe(0)
    expect(assetConfidence(3)).toBeCloseTo(0.5, 6)
    expect(assetConfidence(6)).toBe(1)
    expect(assetConfidence(12)).toBe(1)
  })

  it('confidenceLabel maps 0–1 to labels', () => {
    expect(confidenceLabel(0.9)).toBe('high')
    expect(confidenceLabel(0.5)).toBe('medium')
    expect(confidenceLabel(0.1)).toBe('low')
  })

  it('cohortCiSpread is 30/sqrt(n), bounded [3,35]', () => {
    expect(cohortCiSpread(1)).toBeCloseTo(30, 6)
    expect(cohortCiSpread(9)).toBeCloseTo(10, 6)
    expect(cohortCiSpread(100)).toBe(3) // 30/10=3 lower bound
    expect(cohortCiSpread(0)).toBe(35)
  })
})

// ── Orchestrators ─────────────────────────────────────────────────────────────
describe('buildPredictions orchestrator', () => {
  const records = [
    // completed history for asset A → gives avgKmLife + confidence samples
    { id: 1, asset_no: 'A', brand: 'Michelin', size: '11R22.5', km_at_fitment: 0, km_at_removal: 90_000, cost_per_tyre: 1600, issue_date: '2023-01-01' },
    { id: 2, asset_no: 'A', brand: 'Michelin', size: '11R22.5', km_at_fitment: 90_000, km_at_removal: 180_000, cost_per_tyre: 1600, issue_date: '2024-06-01' },
    // active tyre on asset A
    { id: 3, asset_no: 'A', brand: 'Michelin', size: '11R22.5', km_at_fitment: 180_000, km_at_removal: null, tread_depth: 5, total_km: 40_000, cost_per_tyre: 1600, fitment_date: '2025-01-01', pressure_reading: 100, position: 'Drive', site: 'DXB' },
  ]

  it('produces an active-tyre prediction with deepened fields', () => {
    const preds = buildPredictions(records, [], { nowMs: NOW })
    expect(preds).toHaveLength(1)
    const p = preds[0]
    expect(p.asset_no).toBe('A')
    // legacy dashboard fields preserved
    expect(p.due_date).toBeInstanceOf(Date)
    expect(typeof p.estimated_cost).toBe('number')
    expect(['Urgent', 'Soon', 'Monitor']).toContain(p.urgency)
    // deepened fields present
    expect(['tread_wear', 'km_lifecycle', 'age_limit']).toContain(p.limiting_factor)
    expect(p.band).toBeTruthy()
    expect(p.confidence).toBeGreaterThan(0)
    expect(p.risk_score).toBeGreaterThanOrEqual(0)
    expect(p.failure_prob).toBeGreaterThanOrEqual(0)
    expect(p.wear_rate_mm_per_1000km).not.toBeNull()
    // cohort not fit here (only completed lives feed cohorts; 2 completed < 5)
    expect(p.cohort).toBeNull()
  })

  it('is deterministic under injected nowMs', () => {
    const a = buildPredictions(records, [], { nowMs: NOW })
    const b = buildPredictions(records, [], { nowMs: NOW })
    expect(a[0].days_away).toBe(b[0].days_away)
    expect(a[0].due_date.getTime()).toBe(b[0].due_date.getTime())
  })

  it('skips assets with no active tyres', () => {
    const onlyCompleted = records.slice(0, 2)
    expect(buildPredictions(onlyCompleted, [], { nowMs: NOW })).toHaveLength(0)
  })
})

describe('buildFailureRiskRows orchestrator', () => {
  it('scores active tyres and sorts by risk descending', () => {
    const records = [
      { id: 1, asset_no: 'A', brand: 'Hankook', size: '11R22.5', tread_depth: 2, total_km: 120_000, km_at_removal: null, pressure_reading: 70, fitment_date: '2021-01-01' },
      { id: 2, asset_no: 'B', brand: 'Michelin', size: '11R22.5', tread_depth: 12, total_km: 10_000, km_at_removal: null, pressure_reading: 105, fitment_date: '2025-06-01' },
      { id: 3, asset_no: 'C', brand: 'X', size: 'Y', km_at_fitment: 0, km_at_removal: 90_000 }, // completed, excluded
    ]
    const rows = buildFailureRiskRows(records, { nowMs: NOW })
    expect(rows).toHaveLength(2)
    expect(rows[0].risk_score).toBeGreaterThanOrEqual(rows[1].risk_score)
    // worn old Hankook should out-risk fresh Michelin
    expect(rows[0].asset_no).toBe('A')
    expect(rows[0].failure_prob_pct).toBeGreaterThan(0)
    expect(rows[0]).toHaveProperty('factors')
    expect(rows[0]).toHaveProperty('confidence')
  })
})

describe('legacyUrgency', () => {
  it('matches the original tri-band logic', () => {
    expect(legacyUrgency(2, 200)).toBe('Urgent') // tread below target
    expect(legacyUrgency(8, 20)).toBe('Urgent') // ≤30 days
    expect(legacyUrgency(8, 60)).toBe('Soon') // ≤90 days
    expect(legacyUrgency(8, 200)).toBe('Monitor')
  })
})
