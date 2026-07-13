import { describe, it, expect } from 'vitest'
import {
  // GAP2 weighted score
  eventRisk, weightedDriverScorecard, scoreGrade, scoreBand,
  SEVERITY_WEIGHT, TYPE_WEIGHT, CATEGORY_CAP, OVERSPEED_PER_KMH, SCORE_K,
  // GAP1 tyre correlation
  driverTyreCorrelation, median, DRIVER_CAUSED_REMOVAL_RE,
  // GAP3 composite band
  computeDriverSafetyBand,
  // GAP4 coaching
  coachingQueue, COACHING_TIPS,
  // GAP5 weekly trend
  weeklyEventTrend, weekStartKey,
} from '../lib/driverSafety'

// ── GAP2: weighted event score ──────────────────────────────────────────────

describe('driverSafety — eventRisk (weighted)', () => {
  it('multiplies severity × type weight', () => {
    const { category, risk } = eventRisk({ event_type: 'harsh_brake', severity: 'high' })
    expect(category).toBe('harsh_brake')
    expect(risk).toBeCloseTo(SEVERITY_WEIGHT.high * TYPE_WEIGHT.harsh_brake, 6)
  })
  it('adds overspeed excess only when speed > limit', () => {
    const over = eventRisk({ event_type: 'overspeed', severity: 'medium', speed_kmh: 110, speed_limit_kmh: 80 })
    expect(over.risk).toBeCloseTo(3 * TYPE_WEIGHT.overspeed + 30 * OVERSPEED_PER_KMH, 6)
    const under = eventRisk({ event_type: 'overspeed', severity: 'medium', speed_kmh: 70, speed_limit_kmh: 80 })
    expect(under.risk).toBeCloseTo(3 * TYPE_WEIGHT.overspeed, 6)
  })
  it('unknown type/severity fall back to neutral weights and other category', () => {
    const { category, risk } = eventRisk({ event_type: '', severity: '' })
    expect(category).toBe('other')
    expect(risk).toBeCloseTo(1 * 1.0, 6)
  })
})

describe('driverSafety — weightedDriverScorecard', () => {
  it('caps a dominant category so one behaviour cannot sink the whole score', () => {
    const rows = Array.from({ length: 10 }, () => ({ driver_name: 'X', event_type: 'harsh_brake', severity: 'high' }))
    const [x] = weightedDriverScorecard(rows)
    expect(x.categoryRisk.harsh_brake).toBeCloseTo(104, 3) // 10 * 10.4 raw
    expect(x.riskIndex).toBe(CATEGORY_CAP.harsh_brake) // capped at 25
    expect(x.score).toBe(100 - SCORE_K * 25) // 75
    expect(x.events).toBe(10)
    expect(x.highSeverity).toBe(10)
  })
  it('sums capped categories across event types', () => {
    const rows = [
      ...Array.from({ length: 3 }, () => ({ driver_name: 'Y', event_type: 'harsh_brake', severity: 'high' })),
      { driver_name: 'Y', event_type: 'idling', severity: 'low' },
    ]
    const [y] = weightedDriverScorecard(rows)
    expect(y.riskIndex).toBeCloseTo(25 + 0.5, 3) // harsh_brake capped 25 + idling 0.5
    expect(y.score).toBe(Math.round(100 - 25.5))
  })
  it('assigns grade + band and sorts worst-first', () => {
    const rows = [
      { driver_name: 'Good', event_type: 'idling', severity: 'low' },
      ...Array.from({ length: 8 }, () => ({ driver_name: 'Bad', event_type: 'fatigue', severity: 'high' })),
    ]
    const sc = weightedDriverScorecard(rows)
    expect(sc[0].driver_name).toBe('Bad')
    expect(sc[0].score).toBeLessThan(sc[1].score)
    expect(sc[1].driver_name).toBe('Good')
    expect(scoreGrade(sc[1].score)).toBe('A+')
    expect(sc[1].band).toBe('good')
  })
  it('ignores rows without a driver name', () => {
    expect(weightedDriverScorecard([{ event_type: 'speeding', severity: 'high' }])).toHaveLength(0)
  })
})

describe('driverSafety — scoreGrade / scoreBand boundaries', () => {
  it('grade buckets', () => {
    expect(scoreGrade(95)).toBe('A+')
    expect(scoreGrade(90)).toBe('A+')
    expect(scoreGrade(80)).toBe('A')
    expect(scoreGrade(70)).toBe('B')
    expect(scoreGrade(60)).toBe('C')
    expect(scoreGrade(50)).toBe('D')
    expect(scoreGrade(49)).toBe('F')
    expect(scoreGrade(null)).toBe('N/A')
  })
  it('band buckets', () => {
    expect(scoreBand(90)).toBe('good')
    expect(scoreBand(85)).toBe('good')
    expect(scoreBand(70)).toBe('watch')
    expect(scoreBand(69)).toBe('coach')
    expect(scoreBand(null)).toBe('unknown')
  })
})

// ── GAP1: driver ↔ tyre-damage correlation ──────────────────────────────────

describe('driverSafety — median', () => {
  it('odd + even length + empty', () => {
    expect(median([3, 1, 2])).toBe(2)
    expect(median([1, 2, 3, 4])).toBe(2.5)
    expect(median([])).toBeNull()
  })
})

describe('driverSafety — driverTyreCorrelation', () => {
  const records = [
    { driver_name: 'A', reason_for_removal: 'Impact break', km_at_fitment: 0, km_at_removal: 20000, cost_per_tyre: 1600 },
    { driver_name: 'A', reason_for_removal: 'Worn out', km_at_fitment: 0, km_at_removal: 100000, cost_per_tyre: 1600 },
    { driver_name: 'B', removal_reason: 'Underinflation damage', km_at_fitment: 10000, km_at_removal: 50000, cost_per_tyre: 1200 },
    { driver_name: 'C', total_km: 5000, cost_per_tyre: 1500 },
  ]

  it('computes fleet median removed-tyre life', () => {
    expect(driverTyreCorrelation(records).fleetMedianLifeKm).toBe(40000) // median of 20000,100000,40000
  })
  it('driver-caused removal rate matches the damage regex', () => {
    const { drivers } = driverTyreCorrelation(records)
    const a = drivers.find((d) => d.driver_name === 'A')
    const b = drivers.find((d) => d.driver_name === 'B')
    expect(a.removals).toBe(2)
    expect(a.driverCausedRemovals).toBe(1)
    expect(a.driverCausedRemovalRate).toBe(0.5)
    expect(b.driverCausedRemovalRate).toBe(1)
  })
  it('driver CPK = total cost / total life km', () => {
    const a = driverTyreCorrelation(records).drivers.find((d) => d.driver_name === 'A')
    expect(a.driverCpk).toBeCloseTo(0.027, 3) // 3200 / 120000
  })
  it('premature removal rate vs fleet median', () => {
    const a = driverTyreCorrelation(records).drivers.find((d) => d.driver_name === 'A')
    expect(a.prematureRemovals).toBe(1) // 20000 < 40000
    expect(a.prematureRemovalRate).toBe(0.5)
  })
  it('driver with no removals gets honest null rates', () => {
    const c = driverTyreCorrelation(records).drivers.find((d) => d.driver_name === 'C')
    expect(c.tyres).toBe(1)
    expect(c.removals).toBe(0)
    expect(c.driverCausedRemovalRate).toBeNull()
    expect(c.prematureRemovalRate).toBeNull()
    expect(c.driverCpk).toBeNull()
  })
  it('empty input → null median, empty drivers', () => {
    const r = driverTyreCorrelation([])
    expect(r.fleetMedianLifeKm).toBeNull()
    expect(r.drivers).toEqual([])
  })
  it('damage regex recognises the documented reasons', () => {
    for (const w of ['impact', 'cut', 'kerb', 'curb', 'underinflation', 'run flat', 'run-flat', 'overload']) {
      expect(DRIVER_CAUSED_REMOVAL_RE.test(w)).toBe(true)
    }
    expect(DRIVER_CAUSED_REMOVAL_RE.test('normal wear')).toBe(false)
  })
})

// ── GAP3: composite band (verbatim port branches) ───────────────────────────

describe('driverSafety — computeDriverSafetyBand', () => {
  it('unknown when no activity and no signals', () => {
    expect(computeDriverSafetyBand({ km: 0, trips: 0 }))
      .toEqual({ band: 'unknown', label: 'No activity', composite: null, urgency: 'none' })
  })
  it('inactive when zero km/trips but a behaviour signal exists', () => {
    const r = computeDriverSafetyBand({ km: 0, trips: 0, behavior: 80 })
    expect(r.band).toBe('inactive')
    expect(r.composite).toBeNull()
  })
  it('composite = behavior*0.6 + utilization*0.4, None→50', () => {
    const r = computeDriverSafetyBand({ behavior: 90, km: 1000, trips: 10 })
    expect(r.composite).toBeCloseTo(74, 1) // 90*.6 + 50*.4
    expect(r.band).toBe('steady')
  })
  it('top_performer / coaching / risk bands', () => {
    expect(computeDriverSafetyBand({ behavior: 95, utilization: 95, km: 100, trips: 5 }).band).toBe('top_performer')
    expect(computeDriverSafetyBand({ behavior: 55, utilization: 55, km: 100, trips: 5 }).band).toBe('coaching')
    expect(computeDriverSafetyBand({ behavior: 20, utilization: 20, km: 100, trips: 5 }).band).toBe('risk')
  })
  it('harsh-rate fallback when no behavior/utilization but active', () => {
    const r = computeDriverSafetyBand({ km: 1000, trips: 10, harshEvents: 5 })
    expect(r.composite).toBeCloseTo(50, 1) // 100 - (5/1000*1000)*10
    expect(r.band).toBe('coaching')
    const r2 = computeDriverSafetyBand({ km: 1000, trips: 10, harshEvents: 50 })
    expect(r2.composite).toBe(0)
    expect(r2.band).toBe('risk')
  })
})

// ── GAP4: coaching queue ────────────────────────────────────────────────────

describe('driverSafety — coachingQueue', () => {
  it('selects below-threshold drivers with weakest-category tip + session length', () => {
    const rows = [
      ...Array.from({ length: 8 }, () => ({ driver_name: 'Bad', event_type: 'fatigue', severity: 'high' })),
      ...Array.from({ length: 3 }, () => ({ driver_name: 'Mid', event_type: 'harsh_corner', severity: 'high' })),
      { driver_name: 'Good', event_type: 'idling', severity: 'low' },
    ]
    const sc = weightedDriverScorecard(rows)
    const q = coachingQueue(sc)
    const names = q.map((d) => d.driver_name)
    expect(names).toContain('Bad')
    expect(names).not.toContain('Good')
    const bad = q.find((d) => d.driver_name === 'Bad')
    expect(bad.focus).toBe('fatigue')
    expect(bad.tip).toBe(COACHING_TIPS.fatigue)
    expect(bad.suggestedSessionMin).toBe(bad.score < 60 ? 30 : 20)
    expect(q[0].score).toBeLessThanOrEqual(q[q.length - 1].score)
  })
  it('empty when everyone is in the good band', () => {
    const sc = weightedDriverScorecard([{ driver_name: 'Clean', event_type: 'idling', severity: 'low' }])
    expect(coachingQueue(sc)).toEqual([])
  })
})

// ── GAP5: weekly trend bucketing ────────────────────────────────────────────

describe('driverSafety — weekStartKey', () => {
  it('maps any weekday to that ISO week Monday (UTC)', () => {
    expect(weekStartKey('2026-07-13T10:00:00Z')).toBe('2026-07-13') // Monday
    expect(weekStartKey('2026-07-15T23:00:00Z')).toBe('2026-07-13') // Wednesday same week
    expect(weekStartKey('2026-07-12T10:00:00Z')).toBe('2026-07-06') // Sunday → prior Monday
    expect(weekStartKey('not-a-date')).toBeNull()
    expect(weekStartKey(null)).toBeNull()
  })
})

describe('driverSafety — weeklyEventTrend', () => {
  const rows = [
    { driver_name: 'A', severity: 'high', event_at: '2026-07-06T08:00:00Z' },
    { driver_name: 'A', severity: 'low', event_at: '2026-07-08T08:00:00Z' },
    { driver_name: 'B', severity: 'high', event_at: '2026-07-13T08:00:00Z' },
    { driver_name: 'A', severity: 'medium', event_at: 'bad-date' },
  ]
  it('buckets fleet events by ISO week with high-severity rate', () => {
    const { fleet } = weeklyEventTrend(rows)
    expect(fleet).toHaveLength(2)
    expect(fleet[0]).toMatchObject({ week: '2026-07-06', events: 2, highSeverity: 1, highSeverityRate: 0.5 })
    expect(fleet[1]).toMatchObject({ week: '2026-07-13', events: 1, highSeverity: 1, highSeverityRate: 1 })
  })
  it('per-driver breakdown + ignores unparseable timestamps', () => {
    const { byDriver } = weeklyEventTrend(rows)
    expect(byDriver.A).toHaveLength(1)
    expect(byDriver.A[0].events).toBe(2)
    expect(byDriver.B[0].week).toBe('2026-07-13')
  })
  it('empty input → empty series', () => {
    expect(weeklyEventTrend([]).fleet).toEqual([])
  })
})
