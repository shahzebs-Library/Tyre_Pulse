import { describe, it, expect } from 'vitest'
import {
  GCC_TEMP_PROFILES, GCC_CITIES, ROAD_SURFACE_DELTA, RATING_MAX_C,
  DEFAULT_TARGET_PSI, HIGH_RISK_ROUTES,
  heatSeverity, pressureIncreasePct, currentConditions, heatAdjustedPressure,
  pressureByTimeOfDay, blowoutRiskScore, targetPsiForSize, ageYearsFrom,
  isInstalledTyre, parseSpeedIndex, deratingCap, assessFleetRisk, deratedTyres,
  pearson, correlationFromReadings, heatRecommendations, enrichRoutes, ambientFor,
} from '../lib/heatIntelligence'

describe('heatIntelligence GCC — climatology constants', () => {
  it('carries 10 cities × 12 monthly ambient temperatures', () => {
    expect(GCC_CITIES).toHaveLength(10)
    for (const city of GCC_CITIES) expect(GCC_TEMP_PROFILES[city]).toHaveLength(12)
    expect(GCC_TEMP_PROFILES.Dubai[6]).toBe(41) // July
    expect(GCC_TEMP_PROFILES['Kuwait City'][7]).toBe(45) // August
    expect(ROAD_SURFACE_DELTA).toBe(20)
    expect(HIGH_RISK_ROUTES).toHaveLength(10)
  })

  it('ambientFor resolves city+month and falls back to Dubai', () => {
    const jan = new Date('2026-01-15')
    expect(ambientFor('Riyadh', jan)).toBe(14)
    expect(ambientFor('Nowhere', jan)).toBe(GCC_TEMP_PROFILES.Dubai[0])
  })
})

describe('heatIntelligence GCC — heatSeverity bands', () => {
  it('bands on ambient (≥45 extreme · ≥40 very_high · ≥35 high · ≥28 moderate · else low)', () => {
    expect(heatSeverity(45).severity).toBe('extreme')
    expect(heatSeverity(47).severity).toBe('extreme')
    expect(heatSeverity(44).severity).toBe('very_high')
    expect(heatSeverity(40).severity).toBe('very_high')
    expect(heatSeverity(39).severity).toBe('high')
    expect(heatSeverity(35).severity).toBe('high')
    expect(heatSeverity(34).severity).toBe('moderate')
    expect(heatSeverity(28).severity).toBe('moderate')
    expect(heatSeverity(27).severity).toBe('low')
    expect(heatSeverity(10).severity).toBe('low')
  })
  it('carries an advisory string per band', () => {
    expect(heatSeverity(46).advisory).toMatch(/EXTREME/)
    expect(heatSeverity(20).advisory).toMatch(/standard/i)
  })
})

describe('heatIntelligence GCC — pressureIncreasePct', () => {
  it('is (ambient − 25) × 0.4, rounded 1 dp', () => {
    expect(pressureIncreasePct(45)).toBe(8) // (45-25)*0.4
    expect(pressureIncreasePct(35)).toBe(4)
    expect(pressureIncreasePct(25)).toBe(0)
    expect(pressureIncreasePct(41)).toBe(6.4)
    expect(pressureIncreasePct(null)).toBe(0)
  })
})

describe('heatIntelligence GCC — currentConditions', () => {
  it('assembles ambient, road (+20), severity, advisory and all-city snapshot', () => {
    const c = currentConditions('Dubai', new Date('2026-07-15'))
    expect(c.city).toBe('Dubai')
    expect(c.month).toBe('July')
    expect(c.ambient_c).toBe(41)
    expect(c.road_surface_c).toBe(61)
    expect(c.heat_severity).toBe('very_high')
    expect(c.pressure_increase_pct).toBe(pressureIncreasePct(41))
    expect(Object.keys(c.all_city_temps)).toHaveLength(10)
    expect(c.all_city_temps['Kuwait City']).toBe(45)
  })
  it('falls back to Dubai for an unknown city', () => {
    expect(currentConditions('Atlantis', new Date('2026-07-15')).city).toBe('Dubai')
  })
})

describe('heatIntelligence GCC — heatAdjustedPressure (Gay-Lussac)', () => {
  it('P_hot = P_cold · (T2+273.15)/(T1+273.15), rounded 1 dp', () => {
    const r = heatAdjustedPressure(105, 25, 45)
    expect(r.expected_hot_pressure_psi).toBe(112) // 105*318.15/298.15 = 112.04
    expect(r.pressure_increase_psi).toBe(7)
    expect(r.pressure_increase_pct).toBe(6.7)
    expect(r.cold_pressure_psi).toBe(105)
    expect(r.operating_temp_c).toBe(45)
  })
  it('no change when T1 == T2', () => {
    const r = heatAdjustedPressure(100, 30, 30)
    expect(r.expected_hot_pressure_psi).toBe(100)
    expect(r.pressure_increase_psi).toBe(0)
  })
  it('returns null on missing input', () => {
    expect(heatAdjustedPressure(null, 25, 45)).toBeNull()
    expect(heatAdjustedPressure(105, 25, null)).toBeNull()
  })
})

describe('heatIntelligence GCC — pressureByTimeOfDay', () => {
  it('yields Morning(−8) · Midday(+2) · Peak(+5) · Road(+20) points', () => {
    const pts = pressureByTimeOfDay(105, 25, 40)
    expect(pts).toHaveLength(4)
    expect(pts.map((p) => p.actual_temp_c)).toEqual([32, 42, 45, 60])
    expect(pts.map((p) => p.time_label)).toEqual(['Morning (06:00)', 'Midday (12:00)', 'Peak heat (14:00)', 'Road surface'])
    // Road point is the hottest → highest expected pressure
    expect(pts[3].expected_hot_pressure_psi).toBeGreaterThan(pts[0].expected_hot_pressure_psi)
  })
  it('is empty for a missing ambient', () => {
    expect(pressureByTimeOfDay(105, 25, null)).toEqual([])
  })
})

describe('heatIntelligence GCC — blowoutRiskScore weight bands', () => {
  it('tread term (30%): <1.6→30 · <3→20 · <5→10 · else 0', () => {
    expect(blowoutRiskScore({ tread_mm: 1.5, road_c: 0 }).risk_score).toBe(30)
    expect(blowoutRiskScore({ tread_mm: 2.5, road_c: 0 }).risk_score).toBe(20)
    expect(blowoutRiskScore({ tread_mm: 4, road_c: 0 }).risk_score).toBe(10)
    expect(blowoutRiskScore({ tread_mm: 8, road_c: 0 }).risk_score).toBe(0)
  })
  it('pressure term (25%): dev>30→25 · >20→18 · >10→8 · else 0', () => {
    expect(blowoutRiskScore({ pressure_psi: 140, target_psi: 100, road_c: 0 }).risk_score).toBe(25) // 40%
    expect(blowoutRiskScore({ pressure_psi: 125, target_psi: 100, road_c: 0 }).risk_score).toBe(18) // 25%
    expect(blowoutRiskScore({ pressure_psi: 112, target_psi: 100, road_c: 0 }).risk_score).toBe(8)  // 12%
    expect(blowoutRiskScore({ pressure_psi: 105, target_psi: 100, road_c: 0 }).risk_score).toBe(0)  // 5%
  })
  it('heat term (25%): road>70→25 · >60→18 · >50→10 · >40→5 · else 0', () => {
    expect(blowoutRiskScore({ road_c: 75 }).risk_score).toBe(25)
    expect(blowoutRiskScore({ road_c: 65 }).risk_score).toBe(18)
    expect(blowoutRiskScore({ road_c: 55 }).risk_score).toBe(10)
    expect(blowoutRiskScore({ road_c: 42 }).risk_score).toBe(5)
    expect(blowoutRiskScore({ road_c: 30 }).risk_score).toBe(0)
  })
  it('age term (15%): >5→15 · >3→8 · >2→3 · else 0', () => {
    expect(blowoutRiskScore({ road_c: 0, age_years: 6 }).risk_score).toBe(15)
    expect(blowoutRiskScore({ road_c: 0, age_years: 4 }).risk_score).toBe(8)
    expect(blowoutRiskScore({ road_c: 0, age_years: 2.5 }).risk_score).toBe(3)
    expect(blowoutRiskScore({ road_c: 0, age_years: 1 }).risk_score).toBe(0)
  })
  it('load term (5%): >1.2→5 · >1.1→2 · else 0', () => {
    expect(blowoutRiskScore({ road_c: 0, load_factor: 1.3 }).risk_score).toBe(5)
    expect(blowoutRiskScore({ road_c: 0, load_factor: 1.15 }).risk_score).toBe(2)
    expect(blowoutRiskScore({ road_c: 0, load_factor: 1.0 }).risk_score).toBe(0)
  })
})

describe('heatIntelligence GCC — blowoutRiskScore levels + actions', () => {
  it('maps score to level (≥70 extreme · ≥50 high · ≥30 elevated · ≥15 medium · else low)', () => {
    // 30 tread + 25 pressure + 25 heat = 80 → extreme
    expect(blowoutRiskScore({ tread_mm: 1, pressure_psi: 140, target_psi: 100, road_c: 75 }).risk_level).toBe('extreme')
    // 20 tread + 25 pressure + 10 heat = 55 → high
    expect(blowoutRiskScore({ tread_mm: 2, pressure_psi: 140, target_psi: 100, road_c: 55 }).risk_level).toBe('high')
    // 30 tread only → elevated
    expect(blowoutRiskScore({ tread_mm: 1, road_c: 0 }).risk_level).toBe('elevated')
    // 25 heat only → medium
    expect(blowoutRiskScore({ road_c: 75 }).risk_level).toBe('medium')
    // 5 heat only → low
    expect(blowoutRiskScore({ road_c: 42 }).risk_level).toBe('low')
  })
  it('caps at 100 and emits contributing factors', () => {
    const r = blowoutRiskScore({ tread_mm: 1, pressure_psi: 200, target_psi: 100, road_c: 90, age_years: 10, load_factor: 1.5 })
    expect(r.risk_score).toBeLessThanOrEqual(100)
    expect(r.contributing_factors.length).toBeGreaterThanOrEqual(4)
  })
  it('recommends REMOVE at ≥70, inspect at ≥50, replace when tread<3, hot-PSI when dev>15%', () => {
    const extreme = blowoutRiskScore({ tread_mm: 1, pressure_psi: 140, target_psi: 100, road_c: 75 })
    expect(extreme.recommended_actions.some((a) => /REMOVE FROM SERVICE/.test(a))).toBe(true)
    expect(extreme.recommended_actions.some((a) => /Replace tyre/.test(a))).toBe(true)
    expect(extreme.recommended_actions.some((a) => /PSI in current heat/.test(a))).toBe(true)
    const high = blowoutRiskScore({ tread_mm: 2, pressure_psi: 140, target_psi: 100, road_c: 55 })
    expect(high.recommended_actions.some((a) => /Inspect and rectify/.test(a))).toBe(true)
  })
})

describe('heatIntelligence GCC — target PSI, age, installed filter', () => {
  it('targetPsiForSize resolves a size reference or default 105 (always flagged assumed)', () => {
    const known = targetPsiForSize('11R22.5')
    expect(known.target).toBe(105)
    expect(known.source).toBe('size-reference')
    expect(known.assumed).toBe(true)
    const big = targetPsiForSize('385/65R22.5')
    expect(big.target).toBe(130)
    const unknown = targetPsiForSize('999/99R99')
    expect(unknown.target).toBe(DEFAULT_TARGET_PSI)
    expect(unknown.source).toBe('default')
  })
  it('ageYearsFrom uses fitment/issue date, 0 when absent', () => {
    const now = new Date('2026-07-13')
    expect(ageYearsFrom({ fitment_date: '2021-07-13' }, now)).toBeCloseTo(5, 0)
    expect(ageYearsFrom({ issue_date: '2024-07-13' }, now)).toBeCloseTo(2, 0)
    expect(ageYearsFrom({}, now)).toBe(0)
    expect(ageYearsFrom({ fitment_date: 'not-a-date' }, now)).toBe(0)
  })
  it('isInstalledTyre excludes removed/scrapped/date-removed tyres', () => {
    expect(isInstalledTyre({ status: 'installed' })).toBe(true)
    expect(isInstalledTyre({})).toBe(true)
    expect(isInstalledTyre({ removal_date: '2025-01-01' })).toBe(false)
    expect(isInstalledTyre({ status: 'scrapped' })).toBe(false)
    expect(isInstalledTyre({ status: 'Removed' })).toBe(false)
  })
})

describe('heatIntelligence GCC — derating', () => {
  it('deratingCap maps speed symbols to °C caps, null when unknown', () => {
    expect(deratingCap('W')).toBe(80)
    expect(deratingCap('H')).toBe(70)
    expect(deratingCap('Z')).toBe(90)
    expect(deratingCap('w')).toBe(80)
    expect(deratingCap('Q')).toBeNull()
    expect(deratingCap('')).toBeNull()
    expect(RATING_MAX_C.V).toBe(75)
  })
  it('parseSpeedIndex reads only a recognised trailing speed symbol, never a false rating', () => {
    expect(parseSpeedIndex('225/45R17 94W')).toBe('W')
    expect(parseSpeedIndex('205/55R16 91V')).toBe('V')
    expect(parseSpeedIndex('11R22.5')).toBeNull() // radial R + rim digits, no symbol
    expect(parseSpeedIndex('')).toBeNull()
    expect(parseSpeedIndex(null)).toBeNull()
  })
  it('deratedTyres flags installed tyres whose rating cap is exceeded, skips unparseable/removed', () => {
    const out = deratedTyres([
      { id: 1, size: '225/45R17 94W', status: 'installed' }, // cap 80, road 85 → flagged
      { id: 2, size: '11R22.5', status: 'installed' },        // no rating → skipped
      { id: 3, size: '205/55R16 91V', removal_date: '2025-01-01' }, // removed → skipped
    ], { road_c: 85 })
    expect(out).toHaveLength(1)
    expect(out[0].id).toBe(1)
    expect(out[0].rating).toBe('W')
    expect(out[0].delta_c).toBe(5)
  })
})

describe('heatIntelligence GCC — assessFleetRisk', () => {
  it('scores only installed tyres, bands them, ranks ≥30, and excludes elevated from fleet score', () => {
    const res = assessFleetRisk([
      { id: 1, size: '11R22.5', tread_depth: 1.5, pressure_reading: 105, status: 'installed' }, // 30 tread + 18 heat(65) = 48 → elevated
      { id: 2, size: '11R22.5', removal_date: '2024-01-01', tread_depth: 1 },                    // removed → skipped
      { id: 3, size: '11R22.5', tread_depth: 10, pressure_reading: 105, status: 'installed' },   // 18 heat only → medium
    ], { ambient_c: 45, road_c: 65 })
    expect(res.fleet_size).toBe(2)
    expect(res.risk_summary.elevated).toBe(1)
    expect(res.risk_summary.medium).toBe(1)
    expect(res.high_risk_tyres).toHaveLength(1) // only the ≥30 one
    expect(res.high_risk_tyres[0].id).toBe(1)
    // fleet_risk_score = (extreme+high)/fleet = 0 (elevated not counted)
    expect(res.fleet_risk_score).toBe(0)
  })
  it('returns zeroed summary for an empty fleet', () => {
    const res = assessFleetRisk([], { ambient_c: 45, road_c: 65 })
    expect(res.fleet_size).toBe(0)
    expect(res.fleet_risk_score).toBe(0)
    expect(res.high_risk_tyres).toEqual([])
  })
})

describe('heatIntelligence GCC — Pearson correlation', () => {
  it('computes r for real pairs and returns null when < 3 or zero variance', () => {
    expect(pearson([[1, 1], [2, 2], [3, 3]])).toBe(1)
    expect(pearson([[1, 3], [2, 2], [3, 1]])).toBe(-1)
    expect(pearson([[1, 1], [2, 2]])).toBeNull()   // < 3 pairs
    expect(pearson([[5, 1], [5, 2], [5, 3]])).toBeNull() // zero variance in x
    expect(pearson([])).toBeNull()
  })
  it('correlationFromReadings pairs temperature with pressure, honest empty under 3', () => {
    const strong = correlationFromReadings([
      { temperature_c: 60, pressure_bar: 8.0 },
      { temperature_c: 70, pressure_bar: 8.5 },
      { temperature_c: 80, pressure_bar: 9.0 },
    ])
    expect(strong.samples).toBe(3)
    expect(strong.correlation).toBeCloseTo(1, 5)

    const sparse = correlationFromReadings([
      { temperature_c: 60, pressure_bar: 8.0 },
      { temperature_c: 70 }, // no pressure → dropped
    ])
    expect(sparse.samples).toBe(1)
    expect(sparse.correlation).toBeNull()
    expect(correlationFromReadings([]).correlation).toBeNull()
  })
})

describe('heatIntelligence GCC — recommendations + routes', () => {
  it('heatRecommendations escalates by ambient band and always includes procurement', () => {
    const extreme = heatRecommendations(46, 66)
    expect(extreme.some((r) => r.priority === 'critical')).toBe(true)
    expect(extreme.some((r) => r.action === 'procurement_audit')).toBe(true)
    const mild = heatRecommendations(20, 40)
    expect(mild.every((r) => r.priority === 'low')).toBe(true)
  })
  it('enrichRoutes returns all 10 corridors with current ambient/road and checks', () => {
    const routes = enrichRoutes(new Date('2026-07-15'))
    expect(routes).toHaveLength(10)
    for (const r of routes) {
      expect(r.road_surface_temp_c).toBe(r.current_ambient_c + ROAD_SURFACE_DELTA)
      expect(Array.isArray(r.recommended_checks)).toBe(true)
      expect(r.recommended_checks.length).toBeGreaterThan(0)
    }
    const extreme = routes.find((r) => r.risk === 'extreme')
    expect(extreme.recommended_checks.length).toBeGreaterThan(1)
  })
})
