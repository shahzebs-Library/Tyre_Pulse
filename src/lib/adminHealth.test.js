import { describe, it, expect } from 'vitest'
import {
  HEALTH_BANDS,
  healthBand,
  STREAM_STALE_DAYS,
  freshnessScore,
  errorRateScore,
  reachabilityScore,
  anomalyScore,
  computeHealthScore,
  DEFAULT_HEALTH_WEIGHTS,
} from './adminHealth'

const NOW = new Date('2026-07-16T00:00:00Z')
const daysAgo = (n) => new Date(NOW.getTime() - n * 24 * 3600 * 1000).toISOString()

describe('healthBand thresholds', () => {
  it('maps scores to the right band', () => {
    expect(healthBand(100)).toBe(HEALTH_BANDS.good)
    expect(healthBand(80)).toBe(HEALTH_BANDS.good)
    expect(healthBand(79.9)).toBe(HEALTH_BANDS.warning)
    expect(healthBand(50)).toBe(HEALTH_BANDS.warning)
    expect(healthBand(49.9)).toBe(HEALTH_BANDS.critical)
    expect(healthBand(0)).toBe(HEALTH_BANDS.critical)
  })
  it('non-finite input falls to critical', () => {
    expect(healthBand(null)).toBe(HEALTH_BANDS.critical)
    expect(healthBand(NaN)).toBe(HEALTH_BANDS.critical)
    expect(healthBand(undefined)).toBe(HEALTH_BANDS.critical)
  })
  it('band shape is stable', () => {
    expect(HEALTH_BANDS.good).toEqual({ min: 80, label: 'Healthy', tone: 'green' })
    expect(HEALTH_BANDS.warning).toEqual({ min: 50, label: 'Needs attention', tone: 'amber' })
    expect(HEALTH_BANDS.critical).toEqual({ min: 0, label: 'Critical', tone: 'red' })
  })
})

describe('freshnessScore', () => {
  it('fresh streams (within budget) score 100', () => {
    const s = freshnessScore(
      {
        tyre_records: daysAgo(1),
        inspections: daysAgo(1),
        accidents: daysAgo(1),
        work_orders: daysAgo(1),
      },
      NOW,
    )
    expect(s).toBe(100)
  })

  it('decays to 0 at 3x the stream budget', () => {
    // tyre_records budget = 14 -> 3x = 42 days -> exactly 0
    expect(freshnessScore({ tyre_records: daysAgo(42) }, NOW)).toBe(0)
    expect(freshnessScore({ tyre_records: daysAgo(60) }, NOW)).toBe(0)
  })

  it('decays linearly between budget and 3x budget', () => {
    // tyre_records: budget 14, 3x = 42. Midpoint 28 days -> 50.
    expect(freshnessScore({ tyre_records: daysAgo(28) }, NOW)).toBe(50)
  })

  it('averages only present streams; nulls / missing are excluded', () => {
    // present: tyre_records fresh (100) + accidents at 3x budget (0). Missing ones ignored.
    const s = freshnessScore(
      { tyre_records: daysAgo(1), accidents: daysAgo(90), inspections: null },
      NOW,
    )
    expect(s).toBe(50) // (100 + 0) / 2
  })

  it('all-null / empty returns 0', () => {
    expect(freshnessScore({ tyre_records: null, inspections: null }, NOW)).toBe(0)
    expect(freshnessScore({}, NOW)).toBe(0)
    expect(freshnessScore(null, NOW)).toBe(0)
  })

  it('accounts for every configured stream budget', () => {
    expect(Object.keys(STREAM_STALE_DAYS).sort()).toEqual(
      ['accidents', 'inspections', 'tyre_records', 'work_orders'],
    )
  })
})

describe('errorRateScore - { errors, total } shape', () => {
  it('zero errors scores 100', () => {
    expect(errorRateScore({ errors: 0, total: 1000 })).toBe(100)
  })
  it('~20% error rate scores ~0', () => {
    expect(errorRateScore({ errors: 200, total: 1000 })).toBe(0)
  })
  it('10% error rate scores ~50', () => {
    expect(errorRateScore({ errors: 100, total: 1000 })).toBe(50)
  })
  it('clamps beyond 20%', () => {
    expect(errorRateScore({ errors: 500, total: 1000 })).toBe(0)
  })
  it('guards divide-by-zero total', () => {
    expect(errorRateScore({ errors: 0, total: 0 })).toBe(100)
  })
})

describe('errorRateScore - { unresolvedCritical, unresolvedError } shape', () => {
  it('no backlog scores 100', () => {
    expect(errorRateScore({ unresolvedCritical: 0, unresolvedError: 0 })).toBe(100)
  })
  it('penalizes criticals heavily', () => {
    expect(errorRateScore({ unresolvedCritical: 2, unresolvedError: 0 })).toBe(60)
  })
  it('penalizes errors', () => {
    expect(errorRateScore({ unresolvedCritical: 0, unresolvedError: 5 })).toBe(60)
  })
  it('clamps to 0', () => {
    expect(errorRateScore({ unresolvedCritical: 10, unresolvedError: 10 })).toBe(0)
  })
  it('detects the backlog shape even when only one key is present', () => {
    expect(errorRateScore({ unresolvedCritical: 1 })).toBe(80)
    expect(errorRateScore({ unresolvedError: 1 })).toBe(92)
  })
})

describe('reachabilityScore', () => {
  it('all ok -> 100', () => {
    expect(reachabilityScore({ ok: 10, degraded: 0, down: 0, total: 10 })).toBe(100)
  })
  it('all down -> 0', () => {
    expect(reachabilityScore({ ok: 0, degraded: 0, down: 10, total: 10 })).toBe(0)
  })
  it('degraded gives half credit', () => {
    expect(reachabilityScore({ ok: 0, degraded: 10, down: 0, total: 10 })).toBe(50)
  })
  it('down weighs most', () => {
    const mostlyDown = reachabilityScore({ ok: 2, degraded: 0, down: 8, total: 10 })
    const mostlyDegraded = reachabilityScore({ ok: 2, degraded: 8, down: 0, total: 10 })
    expect(mostlyDown).toBeLessThan(mostlyDegraded)
    expect(mostlyDown).toBe(20)
  })
  it('derives total when omitted', () => {
    expect(reachabilityScore({ ok: 4, degraded: 0, down: 0 })).toBe(100)
  })
  it('nothing to measure -> null', () => {
    expect(reachabilityScore({ ok: 0, degraded: 0, down: 0, total: 0 })).toBeNull()
    expect(reachabilityScore({})).toBeNull()
  })
})

describe('anomalyScore', () => {
  it('no anomalies -> 100', () => {
    expect(anomalyScore({ anomalies: 0, assets: 100 })).toBe(100)
  })
  it('one anomaly per asset -> 0', () => {
    expect(anomalyScore({ anomalies: 100, assets: 100 })).toBe(0)
  })
  it('scales with rate', () => {
    expect(anomalyScore({ anomalies: 10, assets: 100 })).toBe(90)
  })
  it('null anomalies -> null (unknown, not assumed perfect)', () => {
    expect(anomalyScore({ anomalies: null, assets: 100 })).toBeNull()
    expect(anomalyScore({})).toBeNull()
  })
  it('missing assets defaults denom to 1', () => {
    expect(anomalyScore({ anomalies: 0 })).toBe(100)
    expect(anomalyScore({ anomalies: 5 })).toBe(0)
  })
})

describe('computeHealthScore', () => {
  it('weights the four sub-scores by default', () => {
    const { score, band, factors } = computeHealthScore({
      freshness: 100,
      errorRate: 100,
      reachability: 100,
      anomaly: 100,
    })
    expect(score).toBe(100)
    expect(band).toBe(HEALTH_BANDS.good)
    expect(factors).toHaveLength(4)
    const totalWeight = factors.reduce((a, f) => a + f.weight, 0)
    expect(totalWeight).toBeCloseTo(1, 5)
  })

  it('applies the documented default weighting', () => {
    // 100/0/0/0 with weights .3/.3/.3/.1 -> 30
    expect(
      computeHealthScore({ freshness: 100, errorRate: 0, reachability: 0, anomaly: 0 }).score,
    ).toBe(30)
    expect(DEFAULT_HEALTH_WEIGHTS.freshness).toBe(0.3)
  })

  it('renormalizes weights when an input is null', () => {
    // anomaly null -> remaining .3/.3/.3 renormalize to equal thirds.
    const { score, factors } = computeHealthScore({
      freshness: 90,
      errorRate: 60,
      reachability: 30,
      anomaly: null,
    })
    expect(score).toBe(60) // (90 + 60 + 30) / 3
    const anomalyFactor = factors.find((f) => f.key === 'anomaly')
    expect(anomalyFactor.weight).toBe(0)
    expect(anomalyFactor.score).toBeNull()
    const present = factors.filter((f) => f.weight > 0)
    expect(present).toHaveLength(3)
    present.forEach((f) => expect(f.weight).toBeCloseTo(1 / 3, 1))
  })

  it('renormalizes to a single present input', () => {
    const { score } = computeHealthScore({
      freshness: 70,
      errorRate: null,
      reachability: null,
      anomaly: null,
    })
    expect(score).toBe(70)
  })

  it('all-null yields honest null score and band', () => {
    const { score, band, factors } = computeHealthScore({
      freshness: null,
      errorRate: null,
      reachability: null,
      anomaly: null,
    })
    expect(score).toBeNull()
    expect(band).toBeNull()
    expect(factors.every((f) => f.weight === 0 && f.score === null)).toBe(true)
  })

  it('band tracks the composite score', () => {
    const warn = computeHealthScore({
      freshness: 60,
      errorRate: 60,
      reachability: 60,
      anomaly: 60,
    })
    expect(warn.band).toBe(HEALTH_BANDS.warning)
    const crit = computeHealthScore({
      freshness: 10,
      errorRate: 10,
      reachability: 10,
      anomaly: 10,
    })
    expect(crit.band).toBe(HEALTH_BANDS.critical)
  })

  it('accepts custom weights', () => {
    // Put all weight on reachability.
    const { score } = computeHealthScore(
      { freshness: 0, errorRate: 0, reachability: 100, anomaly: 0 },
      { freshness: 0, errorRate: 0, reachability: 1, anomaly: 0 },
    )
    expect(score).toBe(100)
  })
})
