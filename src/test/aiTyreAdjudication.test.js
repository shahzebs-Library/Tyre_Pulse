import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import path from 'node:path'
import os from 'node:os'
import fs from 'node:fs'
import {
  buildReport, evaluateGate, formatReport, summarizeForBaseline, fromJobRows,
  scoreAgainstGolden, normalizeGolden, normalizeResults, depthCorrection, reviewAgreement,
  DEFAULT_THRESHOLDS,
} from '../lib/aiTyreAdjudication'

const FIX = path.resolve(__dirname, 'fixtures/ai-adjudication')
const load = (f) => JSON.parse(readFileSync(path.join(FIX, f), 'utf8'))
const golden = load('golden.v1.json').cases
const current = load('candidate.current.json')
const regressed = load('candidate.regressed.json')
const baseline = load('baseline.json')

const run = (cand, thresholds = {}, base = baseline) => {
  const report = buildReport({ golden, results: cand.results, reviews: cand.reviews }, thresholds)
  return { report, gate: evaluateGate(report, thresholds, base) }
}
const clone = (o) => JSON.parse(JSON.stringify(o))

describe('golden scoring', () => {
  it('computes precision / recall / agreement from the labelled set', () => {
    const { report } = run(current)
    // 32 expert positives, 3 missed (c05, c14, c20) and 2 false positives (c14 uneven, c28 tread)
    expect(report.golden.micro).toMatchObject({ tp: 29, fn: 3, fp: 2 })
    expect(report.golden.micro.recall).toBeCloseTo(29 / 32, 4)
    expect(report.golden.micro.precision).toBeCloseTo(29 / 31, 4)
    expect(report.golden.assessableAgreement).toBeCloseTo(39 / 40, 4)
    expect(report.golden.types.bulge).toMatchObject({ support: 5, tp: 5, fn: 0, recall: 1 })
    expect(report.golden.dangerousMisses).toEqual([])
  })

  it('withholds per-type recall (null) when the expert positives are below the minimum support', () => {
    const { report } = run(current)
    expect(report.golden.types.shoulder_wear.support).toBe(4)
    expect(report.golden.types.shoulder_wear.recall).toBeNull()
    expect(report.golden.types.sidewall_cut.recall).not.toBeNull()
  })

  it('counts a dangerous miss even when the type itself is low volume, by type or by high severity', () => {
    const c = clone(current)
    c.results[8].analysis.defects = []   // c09 bulge
    c.results[1].analysis.defects = []   // c02 high-severity sidewall_cut
    const { report } = run(c)
    expect(report.golden.dangerousMisses.map((m) => m.caseId + ':' + m.type)).toEqual(['c02:sidewall_cut', 'c09:bulge'])
  })

  it('treats an AI "uncertain" as an abstention, not a precision hit', () => {
    const g = normalizeGolden([{ id: 'a', expert: { assessable: true, defects: ['tread_wear'] } }])
    const r = normalizeResults([{ caseId: 'a', analysis: { assessable: true, defects: [{ type: 'uncertain', severity: 'unknown' }] } }])
    const s = scoreAgainstGolden(g, r)
    expect(s.micro).toMatchObject({ tp: 0, fp: 0, fn: 1 })
    expect(s.uncertainFlags).toBe(1)
  })

  it('does not credit expert positives on a photo the expert called unassessable, and counts overconfidence', () => {
    const g = normalizeGolden([{ id: 'a', expert: { assessable: false, defects: ['bulge'] } }])
    const r = normalizeResults([{ caseId: 'a', analysis: { assessable: true, defects: [{ type: 'bulge', severity: 'high' }] } }])
    const s = scoreAgainstGolden(g, r)
    expect(s.types.bulge).toMatchObject({ support: 0, fp: 1, fn: 0 })
    expect(s.overconfidentUnassessable).toBe(1)
    expect(s.assessableAgreement).toBe(0)
  })

  it('is deterministic: identical inputs give a byte-identical report', () => {
    const a = JSON.stringify(run(current).report)
    const b = JSON.stringify(run(clone(current)).report)
    expect(a).toBe(b)
  })
})

describe('honest nulls on small samples', () => {
  it('returns null defect metrics and an insufficient gate with fewer golden cases than the minimum', () => {
    const small = { results: current.results.slice(0, 10), reviews: [] }
    const report = buildReport({ golden: golden.slice(0, 10), results: small.results, reviews: [] })
    expect(report.golden.sampleSufficient).toBe(false)
    expect(report.golden.micro.recall).toBeNull()
    expect(report.golden.micro.precision).toBeNull()
    expect(report.golden.assessableAgreement).toBeNull()
    const gate = evaluateGate(report)
    expect(gate.status).toBe('insufficient')
    expect(gate.pass).toBe(false)
    expect(gate.insufficient.map((i) => i.rule)).toEqual(expect.arrayContaining(['micro_recall', 'micro_precision', 'assessable_agreement']))
  })

  it('can be waived explicitly (failOnInsufficient=false) but still reports insufficient status', () => {
    const report = buildReport({ golden: golden.slice(0, 10), results: current.results.slice(0, 10), reviews: [] })
    const gate = evaluateGate(report, { failOnInsufficient: false })
    expect(gate.status).toBe('insufficient')
    expect(gate.pass).toBe(true)
  })

  it('leaves review acceptance and depth error null (a note, not a failure) when too few samples', () => {
    const c = { results: current.results, reviews: current.reviews.slice(0, 5) }
    const { report, gate } = run(c, {}, null)
    expect(report.review.acceptRate).toBeNull()
    expect(report.review.reviewed).toBe(5)
    expect(gate.notes.join(' ')).toMatch(/Review acceptance not computed/)
    const noDepth = depthCorrection(normalizeGolden(golden), normalizeResults(current.results.slice(0, 13)), [], { minPairs: 10 })
    expect(noDepth.mae).toBeNull()
    expect(noDepth.pairs).toBe(2)
  })
})

describe('human review agreement and depth correction', () => {
  it('counts accepted / rejected / corrected overall and per AI-claimed defect type', () => {
    const { report } = run(current)
    expect(report.review).toMatchObject({ reviewed: 27, accepted: 24, rejected: 1, corrected: 2 })
    expect(report.review.acceptRate).toBeCloseTo(24 / 27, 4)
    expect(report.review.types.bulge.accepted).toBe(5)
    expect(report.review.types.tread_wear.rejected).toBe(1)    // c28 false positive
    expect(report.review.types['(none)'].corrected).toBe(1)    // c05: AI reported nothing, reviewer corrected
  })

  it('measures correction magnitude of predicted tread depth vs the human value, preferring the correction', () => {
    const { report } = run(current)
    expect(report.depth.pairs).toBe(12)
    expect(report.depth.mae).toBeGreaterThan(0.3)
    expect(report.depth.mae).toBeLessThan(0.6)
    expect(report.depth.withinTolerance).toBeGreaterThan(0.5)
    // c14 uses the reviewer-corrected depth (3.0) not the golden depth (4.1 + 0.3 predicted error)
    const g = normalizeGolden([{ id: 'x', expert: { assessable: true, defects: [], depthMm: 5 } }])
    const r = normalizeResults([{ caseId: 'x', analysis: { assessable: true }, predictedDepthMm: 6 }])
    const withCorrection = depthCorrection(g, r, [{ caseId: 'x', decision: 'corrected', correctedDepthMm: 4 }], { minPairs: 1 })
    expect(withCorrection.mae).toBe(2)
    expect(withCorrection.bias).toBe(2)   // positive = engine over-estimates
    const gOnly = depthCorrection(g, r, [], { minPairs: 1 })
    expect(gOnly.mae).toBe(1)
  })

  it('maps persisted jobs to harness inputs (live reviewer decisions can be adjudicated)', () => {
    const jobs = [
      { id: 'j1', status: 'completed', analysis: { assessable: true, defects: [] }, review_status: 'accepted' },
      { id: 'j2', status: 'completed', analysis: { assessable: true, defects: [{ type: 'bulge', severity: 'high' }] }, review_status: 'rejected', reviewer_note: 'dust' },
      { id: 'j3', status: 'failed', analysis: null, review_status: 'unreviewed' },
      { id: 'j4', status: 'completed', analysis: { assessable: false }, review_status: 'unreviewed' },
    ]
    const { results, reviews } = fromJobRows(jobs)
    expect(results.map((r) => r.caseId)).toEqual(['j1', 'j2', 'j4'])
    expect(reviews).toEqual([{ caseId: 'j1', decision: 'accepted', note: '' }, { caseId: 'j2', decision: 'rejected', note: 'dust' }])
    const a = reviewAgreement(normalizeResults(results), reviews.map((r) => ({ ...r, decision: r.decision })), 1)
    expect(a).toMatchObject({ reviewed: 2, accepted: 1, rejected: 1 })
  })
})

describe('disagreement clusters', () => {
  it('groups repeated false positives and reviewer rejections by defect type', () => {
    const { report } = run(regressed)
    const c = report.clusters.find((x) => x.kind === 'false_positive' && x.key.type === 'cracking' && x.dimension === 'type')
    expect(c.count).toBe(3)
    expect(c.caseIds).toEqual(['c27', 'c29', 'c30'])
    expect(report.clusters.some((x) => x.kind === 'reviewer_rejected' && x.key.type === 'cracking')).toBe(true)
  })

  it('suppresses clusters smaller than clusterMin and orders the rest by size then id', () => {
    const { report } = run(regressed, { clusterMin: 2 })
    const counts = report.clusters.map((x) => x.count)
    expect(counts).toEqual([...counts].sort((a, b) => b - a))
    expect(run(current).report.clusters).toEqual([])   // isolated errors only (1-2 cases each)
  })
})

describe('gate', () => {
  it('passes the current engine against its own baseline', () => {
    const { gate } = run(current)
    expect(gate).toMatchObject({ status: 'pass', pass: true, failures: [] })
  })

  it('fails a regressed run with specific reasons (dangerous misses, regression vs baseline)', () => {
    const { gate } = run(regressed)
    expect(gate.status).toBe('fail')
    expect(gate.pass).toBe(false)
    const rules = gate.failures.map((f) => f.rule)
    expect(rules).toEqual(expect.arrayContaining(['dangerous_misses', 'regression:microPrecision', 'regression:microRecall']))
  })

  it('fails when the AI certifies millimetres from a photo', () => {
    const c = clone(current)
    c.results[11].analysis.exactTreadDepthMm = 3.2
    const { gate } = run(c)
    expect(gate.failures.map((f) => f.rule)).toContain('ai_certified_depth')
  })

  it('fails on missing results, duplicate ids and unknown cases (bad data cannot look like a pass)', () => {
    const missing = clone(current); missing.results = missing.results.slice(1)
    expect(run(missing).gate.failures.map((f) => f.rule)).toContain('missing_results')
    const dup = clone(current); dup.results.push(clone(dup.results[0]))
    expect(run(dup).gate.failures.map((f) => f.rule)).toContain('input:duplicate_ids')
    const unknown = clone(current); unknown.results.push({ caseId: 'zzz', analysis: { assessable: true, defects: [] } })
    expect(run(unknown).gate.failures.map((f) => f.rule)).toContain('input:unknown_case')
  })

  it('fails on low precision or recall thresholds and low reviewer acceptance', () => {
    expect(run(current, { minMicroRecall: 0.95 }, null).gate.failures.map((f) => f.rule)).toContain('micro_recall')
    expect(run(current, { minReviewAcceptRate: 0.95 }, null).gate.failures.map((f) => f.rule)).toContain('review_accept_rate')
    expect(run(current, { maxDepthMae: 0.1 }, null).gate.failures.map((f) => f.rule)).toContain('depth_mae')
  })

  it('does not flag a small drop within the allowed regression and ignores a null baseline metric', () => {
    const base = { ...baseline, microRecall: baseline.microRecall + 0.03, depthMae: null }
    expect(run(current, {}, base).gate.status).toBe('pass')
    expect(run(current, {}, { ...baseline, microRecall: null }).gate.status).toBe('pass')
  })

  it('summarises a run for a baseline and formats ASCII text', () => {
    const { report, gate } = run(current)
    expect(summarizeForBaseline(report)).toEqual(baseline)
    const text = formatReport(report, gate)
    expect(text).toMatch(/PASS/)
    expect(/^[\x20-\x7e\n]*$/.test(text)).toBe(true)
  })

  it('exposes its defaults as frozen so a caller cannot weaken them by mutation', () => {
    expect(Object.isFrozen(DEFAULT_THRESHOLDS)).toBe(true)
    expect(DEFAULT_THRESHOLDS.maxDangerousMisses).toBe(0)
  })
})

describe('CLI scripts/ai-adjudicate.mjs', () => {
  const cli = path.resolve(__dirname, '../../scripts/ai-adjudicate.mjs')
  const runCli = (...args) => spawnSync(process.execPath, [cli, ...args], { encoding: 'utf8' })

  it('exits 0 on the current fixtures', () => {
    const r = runCli()
    expect(r.status).toBe(0)
    expect(r.stdout).toMatch(/PASS/)
  })

  it('exits 1 on the regressed run and names the reasons', () => {
    const r = runCli('--candidate', path.join(FIX, 'candidate.regressed.json'))
    expect(r.status).toBe(1)
    expect(r.stdout).toMatch(/FAIL dangerous_misses/)
  })

  it('exits 2 when the golden set is too small to decide', () => {
    const f = path.join(os.tmpdir(), 'ai-adjudicate-golden-' + process.pid + '.json')
    const c = path.join(os.tmpdir(), 'ai-adjudicate-cand-' + process.pid + '.json')
    const ids = new Set(golden.slice(0, 5).map((g) => g.id))
    fs.writeFileSync(f, JSON.stringify({ cases: golden.slice(0, 5) }))
    fs.writeFileSync(c, JSON.stringify({ results: current.results.filter((r) => ids.has(r.caseId)), reviews: [] }))
    try {
      const r = runCli('--golden', f, '--candidate', c, '--baseline', 'none')
      expect(r.status).toBe(2)
      expect(r.stdout).toMatch(/INSUFFICIENT/)
    } finally { fs.unlinkSync(f); fs.unlinkSync(c) }
  })

  it('exits 3 on unreadable input or unknown arguments, and emits JSON on request', () => {
    expect(runCli('--golden', '/nonexistent/golden.json').status).toBe(3)
    expect(runCli('--bogus').status).toBe(3)
    const j = runCli('--json')
    expect(j.status).toBe(0)
    expect(JSON.parse(j.stdout.slice(j.stdout.indexOf('{'))).gate.status).toBe('pass')
  })
})
