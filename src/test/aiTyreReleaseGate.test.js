import { describe, expect, it } from 'vitest'
import {
  buildAccuracyReport, evaluateAccuracyGate, RELEASE_THRESHOLDS, ACCURACY_THRESHOLDS,
  wilsonInterval, checkSplitLeakage, formatAccuracyReport,
} from '../lib/aiTyreAccuracy'

// SYNTHETIC fixtures only: they prove the gate logic, never model accuracy.
function synth(n, { dangerous = 0, missDangerous = 0, reviewers = ['A', 'B'] } = {}) {
  const labelled = [], predictions = []
  for (let i = 0; i < n; i++) {
    const ref = `p${i}`
    const isD = i < dangerous
    const expected = isD ? ['bulge'] : (i % 3 === 0 ? ['cracking'] : [])
    labelled.push({ photo_ref: ref, expected, reviewer: reviewers[i % reviewers.length], position: 'LHF1', vehicle_type: i % 2 ? 'TR-MIXER' : 'PUMPS' })
    const miss = isD && i < missDangerous
    predictions.push({ photo_ref: ref, defects: miss ? [] : expected.map((t) => ({ type: t, confidence: 0.9 })) })
  }
  return { labelled, predictions }
}

describe('wilson interval', () => {
  it('is null on empty and bounded otherwise', () => {
    expect(wilsonInterval(0, 0)).toBeNull()
    const ci = wilsonInterval(60, 60)
    expect(ci.high).toBe(1)
    expect(ci.low).toBeGreaterThan(0.93)
    expect(ci.low).toBeLessThan(0.95)
  })
})

describe('release gate', () => {
  it('is stricter than the development gate', () => {
    expect(RELEASE_THRESHOLDS.minCases).toBe(500)
    expect(RELEASE_THRESHOLDS.minMicroPrecision).toBe(0.9)
    expect(RELEASE_THRESHOLDS.minMicroRecall).toBe(0.95)
    expect(RELEASE_THRESHOLDS.minAssessableAgreement).toBe(0.95)
    expect(RELEASE_THRESHOLDS.maxDangerousMisses).toBe(0)
    expect(ACCURACY_THRESHOLDS.minCases).toBeLessThan(RELEASE_THRESHOLDS.minCases)
  })

  it('a small set is insufficient, never a pass', () => {
    const r = buildAccuracyReport(synth(120, { dangerous: 10 }), RELEASE_THRESHOLDS)
    expect(evaluateAccuracyGate(r).status).toBe('insufficient')
  })

  it('zero misses on too few dangerous defects is insufficient', () => {
    const r = buildAccuracyReport(synth(600, { dangerous: 20 }), RELEASE_THRESHOLDS)
    const g = evaluateAccuracyGate(r)
    expect(g.checks.find((c) => c.id === 'dangerous_support').status).toBe('insufficient')
    expect(g.status).not.toBe('pass')
  })

  it('one dangerous miss fails even when everything else passes', () => {
    const r = buildAccuracyReport(synth(600, { dangerous: 80, missDangerous: 1 }), RELEASE_THRESHOLDS)
    expect(r.dangerousMisses).toBe(1)
    expect(evaluateAccuracyGate(r).status).toBe('fail')
  })

  it('reports intervals and a per-vehicle-type breakdown', () => {
    const r = buildAccuracyReport(synth(600, { dangerous: 80 }), RELEASE_THRESHOLDS)
    expect(r.intervals.recall.low).toBeGreaterThan(0.95)
    expect(Object.keys(r.vehicleTypes)).toEqual(['PUMPS', 'TR-MIXER'])
    expect(formatAccuracyReport(r, evaluateAccuracyGate(r))).toMatch(/95% intervals/)
  })
})

describe('split leakage', () => {
  it('flags one physical tyre in two splits', () => {
    const rows = [
      { photo_ref: 'a', expected: [], reviewer: 'A', tyre_serial: 'S1', split: 'train' },
      { photo_ref: 'b', expected: [], reviewer: 'A', tyre_serial: 'S1', split: 'holdout' },
      { photo_ref: 'c', expected: [], reviewer: 'A', tyre_serial: 'S2', split: 'holdout' },
      { photo_ref: 'd', expected: [], reviewer: 'A' },
    ]
    const r = checkSplitLeakage(rows)
    expect(r.ok).toBe(false)
    expect(r.leaks).toEqual([{ group: 'S1', splits: ['holdout', 'train'] }])
    expect(r.unassigned).toBe(1)
  })
})
