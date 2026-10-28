import { describe, it, expect } from 'vitest'
import { parseCsv, normalizeLabelled, buildAccuracyReport, evaluateAccuracyGate, formatAccuracyReport } from '../lib/aiTyreAccuracy'
import { proposeAdjustments, aggregateCorrections, formatFeedbackProposals } from '../lib/aiTyreFeedbackLoop'

// SYNTHETIC data only: refs are fake, no real photos.
const mk = (n) => Array.from({ length: n }, (_, i) => ({
  photo_ref: `syn-${i}`, expected: i % 2 ? ['bulge'] : ['cracking'], reviewer: 'syn-expert', position: i % 4 < 2 ? 'steer' : 'drive',
}))
const perfect = (L) => L.map((l) => ({ photo_ref: l.photo_ref, assessable: true, defects: l.expected.map((t) => ({ type: t, confidence: 0.9 })) }))

describe('accuracy ingest', () => {
  it('parses CSV with quotes and multi-valued expected', () => {
    const rows = normalizeLabelled('photo_ref,expected,reviewer,position\r\na1,"bulge;cracking",R1,steer\na2,none,R1,drive\n')
    expect(rows[0]).toMatchObject({ photoRef: 'a1', expected: ['bulge', 'cracking'], reviewer: 'R1', position: 'steer' })
    expect(rows[1].expected).toEqual([])
    expect(parseCsv('a,b\n"x,1","y""z"\n')[0]).toEqual({ a: 'x,1', b: 'y"z' })
  })
})

describe('accuracy report + gate', () => {
  it('perfect predictions pass', () => {
    const L = mk(60)
    const r = buildAccuracyReport({ labelled: L, predictions: perfect(L) })
    expect(r.micro.precision).toBe(1); expect(r.micro.recall).toBe(1)
    expect(r.positions.steer.exactAgreement).toBe(1)
    expect(r.calibration.n).toBe(60)
    expect(evaluateAccuracyGate(r).status).toBe('pass')
    expect(formatAccuracyReport(r, evaluateAccuracyGate(r))).toMatch(/Gate: PASS/)
  })
  it('a missed dangerous defect fails and shows in the confusion matrix', () => {
    const L = mk(60)
    const P = perfect(L); P[1] = { photo_ref: 'syn-1', assessable: true, defects: [] }
    const r = buildAccuracyReport({ labelled: L, predictions: P })
    expect(r.dangerousMisses).toBe(1)
    const g = evaluateAccuracyGate(r)
    expect(g.status).toBe('fail')
    const i = r.confusion.labels.indexOf('bulge'), j = r.confusion.labels.indexOf('none')
    expect(r.confusion.matrix[i][j]).toBe(1)
  })
  it('small sample is insufficient, not pass; metrics are null', () => {
    const L = mk(4)
    const r = buildAccuracyReport({ labelled: L, predictions: perfect(L) })
    expect(r.micro.precision).toBeNull()
    expect(evaluateAccuracyGate(r).status).toBe('insufficient')
  })
  it('missing reviewer and missing predictions are flagged', () => {
    const L = mk(60); L[0].reviewer = ''
    const r = buildAccuracyReport({ labelled: L, predictions: perfect(L).slice(1) })
    expect(r.missingPredictions).toBe(1)
    expect(evaluateAccuracyGate(r).status).toBe('fail')
  })
  it('overconfident wrong predictions raise calibration error', () => {
    const L = mk(60)
    const P = perfect(L).map((p, i) => (i % 2 ? { ...p, defects: [{ type: 'tread_cut', confidence: 0.95 }] } : p))
    const r = buildAccuracyReport({ labelled: L, predictions: P })
    expect(r.calibration.ece).toBeGreaterThan(0.15)
    expect(evaluateAccuracyGate(r).checks.find((c) => c.id === 'calibration').status).toBe('fail')
  })
})

describe('feedback loop', () => {
  const rows = [
    ...Array.from({ length: 8 }, () => ({ condition: 'cracking', decision: 'rejected', confidence: 0.8 })),
    ...Array.from({ length: 4 }, () => ({ condition: 'cracking', decision: 'accepted', confidence: 0.9 })),
    ...Array.from({ length: 12 }, () => ({ condition: 'bulge', decision: 'accepted' })),
    ...Array.from({ length: 4 }, () => ({ condition: 'tread_wear', decision: 'corrected', correctedTo: 'uneven_wear' })),
    ...Array.from({ length: 6 }, () => ({ condition: 'tread_wear', decision: 'accepted' })),
  ]
  it('computes per-condition error rates, null under minimum', () => {
    const a = aggregateCorrections(rows)
    expect(a.conditions.find((c) => c.condition === 'cracking').errorRate).toBeCloseTo(0.667, 2)
    expect(aggregateCorrections([{ condition: 'x', decision: 'rejected' }]).conditions[0].errorRate).toBeNull()
  })
  it('proposes adjustments, never applies', () => {
    const r = proposeAdjustments(rows)
    expect(r.applied).toBe(false)
    expect(r.proposals.some((p) => p.kind === 'raise_confidence_threshold' && p.condition === 'cracking')).toBe(true)
    expect(r.proposals.some((p) => p.kind === 'disambiguate_pair' && p.condition === 'tread_wear')).toBe(true)
    expect(formatFeedbackProposals(r)).toMatch(/Proposals only/)
  })
  it('empty input gives no proposals', () => {
    expect(proposeAdjustments([]).proposals).toEqual([])
  })
})
