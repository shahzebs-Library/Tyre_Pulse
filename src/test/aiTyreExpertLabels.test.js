import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import {
  fnv1a, groupKeyFor, splitForGroup, inspectorFinding, dangerSignals, stratumFor, expectedFromVerdicts,
  verdictProblems, buildLabelPayload, buildLabellingQueue, consensusLabels, agreementStats, labellingProgress,
  splitLeaks, buildBenchmarkExport, labelledToCsv, runReleaseGate, LABELLED_COLUMNS, EXPERT_DEFECT_TYPES, STRATA,
} from '../lib/aiTyreExpertLabels.js'
import { buildAccuracyReport, parseCsv } from '../lib/aiTyreAccuracy.js'

// Synthetic fixtures only. Never real fleet photographs.
const job = (id, over = {}) => ({
  id, inspection_id: 'insp-' + id, tyre_position: 'FL', photo_ref: 'tp-storage://tyre-photos/photos/' + id + '.jpg',
  status: 'completed', model_version: 'm1', prompt_version: 'p1', analysis: { assessable: true, defects: [] }, ...over,
})
const cand = (j, cond = {}) => ({ job: j, inspection: { id: j.inspection_id, asset_no: 'TM' + j.id, vehicle_type: 'TR-MIXER', tyre_conditions: { [j.tyre_position]: cond } } })
const label = (jobId, reviewer, over = {}) => ({
  id: jobId + reviewer, job_id: jobId, reviewer_id: reviewer, assessable: true, expected_defects: [],
  group_key: 'insp:insp-' + jobId, split: splitForGroup('insp:insp-' + jobId), created_at: '2026-11-10T00:00:0' + (reviewer === 'r2' ? '2' : '1') + 'Z', ...over,
})

describe('split assignment (mirror of SQL ai_tyre_split_for)', () => {
  it('matches values computed by live Postgres', () => {
    expect(fnv1a('ABC123')).toBe(1166364645)
    expect(fnv1a('insp:00000000-0000-0000-0000-000000000001')).toBe(4136581766)
    expect(fnv1a('YMA55310')).toBe(3934211900)
    expect(fnv1a('Ü-1')).toBe(4009446748)
    expect(splitForGroup('ABC123')).toBe('train')
    expect(splitForGroup('insp:00000000-0000-0000-0000-000000000001')).toBe('validation')
  })
  it('groups by serial (case/space-insensitive) else inspection, and is stable', () => {
    expect(groupKeyFor({ tyreSerial: ' abc123 ', inspectionId: 'x' })).toBe('ABC123')
    expect(groupKeyFor({ tyreSerial: '', inspectionId: 'x' })).toBe('insp:x')
    expect(groupKeyFor({})).toBe('')
    expect(splitForGroup('')).toBeNull()
    expect(splitForGroup('ABC123')).toBe(splitForGroup('ABC123'))
  })
  it('one tyre serial across two inspections lands in one split', () => {
    const a = buildLabelPayload({ job: job('1'), reviewerId: 'r1', assessable: true, verdicts: [], missed: [], tyreSerial: 'SER9' })
    const b = buildLabelPayload({ job: job('2'), reviewerId: 'r1', assessable: true, verdicts: [], missed: [], tyreSerial: 'ser9' })
    expect(a.group_key).toBe(b.group_key)
    expect(a.split).toBe(b.split)
  })
  it('distributes roughly 60/20/20 over many groups', () => {
    const n = { train: 0, validation: 0, holdout: 0 }
    for (let i = 0; i < 3000; i++) n[splitForGroup('insp:' + i)]++
    expect(n.train / 3000).toBeGreaterThan(0.55); expect(n.train / 3000).toBeLessThan(0.65)
    expect(n.holdout / 3000).toBeGreaterThan(0.15); expect(n.holdout / 3000).toBeLessThan(0.25)
  })
  it('SQL migration carries the same bucket boundaries and FNV constants', () => {
    const sql = readFileSync('supabase/migrations/20261112104000_ai_tyre_expert_labels.sql', 'utf8')
    expect(sql).toMatch(/2166136261/); expect(sql).toMatch(/16777619/)
    expect(sql).toMatch(/% 100 < 60 then 'train'/); expect(sql).toMatch(/% 100 < 80 then 'validation'/)
    expect(sql).toMatch(/apply_reader_policies/)
    expect(sql).toMatch(/unique \(job_id, reviewer_id\)/)
  })
})

describe('verdicts and expected labels', () => {
  const defects = [{ type: 'uncertain' }, { type: 'cracking' }, { type: 'bulge' }]
  it('correct keeps real types, wrong_type substitutes, wrong drops, missed adds', () => {
    const v = [{ index: 0, verdict: 'wrong_type', corrected_type: 'exposed_cord' }, { index: 1, verdict: 'correct' }, { index: 2, verdict: 'wrong' }]
    expect(expectedFromVerdicts(defects, v, ['tread_cut'])).toEqual(['cracking', 'exposed_cord', 'tread_cut'])
  })
  it('an AI "uncertain" marked correct is not a ground-truth label', () => {
    expect(expectedFromVerdicts(defects, [{ index: 0, verdict: 'correct' }], [])).toEqual([])
    expect(EXPERT_DEFECT_TYPES).not.toContain('uncertain')
  })
  it('unassessable photos carry no expected defects and need no verdicts', () => {
    expect(expectedFromVerdicts(defects, [{ index: 1, verdict: 'correct' }], ['bulge'], false)).toEqual([])
    expect(verdictProblems(defects, [], false)).toEqual([])
  })
  it('flags missing verdicts and a wrong_type without a corrected type', () => {
    expect(verdictProblems(defects, [{ index: 0, verdict: 'wrong_type' }, { index: 1, verdict: 'correct' }], true)).toHaveLength(2)
  })
})

describe('stratified queue', () => {
  const pool = [
    cand(job('d1', { analysis: { assessable: true, defects: [{ type: 'uncertain', description: 'chunk missing, exposing steel cords' }] } })),
    cand(job('d2', { analysis: { assessable: true, defects: [{ type: 'bulge' }] } })),
    cand(job('d3'), { condition: 'Damaged' }),
    ...Array.from({ length: 10 }, (_, i) => cand(job('x' + i, { analysis: { assessable: true, defects: [{ type: 'cracking', description: 'fine lines' }] } }))),
    ...Array.from({ length: 10 }, (_, i) => cand(job('c' + i), { condition: 'Good' })),
    cand(job('u1', { analysis: { assessable: false, defects: [] } })),
  ]
  it('detects danger from AI type, AI wording and the inspector condition', () => {
    expect(stratumFor(pool[0].job, {})).toBe('dangerous')
    expect(dangerSignals(pool[1].job).reasons[0]).toMatch(/bulge/)
    expect(stratumFor(job('d3'), { condition: 'Damaged' })).toBe('dangerous')
    expect(stratumFor(job('u1', { analysis: { assessable: false } }), {})).toBe('unassessable')
  })
  it('oversamples dangerous suspects relative to their share of the pool', () => {
    const { items, available } = buildLabellingQueue(pool, [], { reviewerId: 'r1', limit: 8 })
    expect(available.dangerous).toBe(3)
    const dangerousShare = items.filter((i) => i.stratum === 'dangerous').length / items.length
    expect(dangerousShare).toBeGreaterThan(3 / pool.length)
    expect(new Set(items.map((i) => i.stratum)).size).toBeGreaterThan(2)
  })
  it('is deterministic and never repeats a photo', () => {
    const a = buildLabellingQueue(pool, [], { limit: 30 }).items.map((i) => i.job.id)
    const b = buildLabellingQueue([...pool].reverse(), [], { limit: 30 }).items.map((i) => i.job.id)
    expect(a).toEqual(b)
    expect(new Set(a).size).toBe(a.length)
    expect(a.length).toBe(pool.length)
  })
  it('first-label mode skips labelled photos; second-opinion mode offers only photos labelled once by someone else', () => {
    const labels = [label('d1', 'r2'), label('d2', 'r1'), label('x0', 'r2'), label('x0', 'r3')]
    const first = buildLabellingQueue(pool, labels, { reviewerId: 'r1', limit: 50 }).items.map((i) => i.job.id)
    expect(first).not.toContain('d1'); expect(first).not.toContain('d2')
    const second = buildLabellingQueue(pool, labels, { reviewerId: 'r1', mode: 'second', limit: 50 }).items.map((i) => i.job.id)
    expect(second).toEqual(['d1'])
  })
  it('ignores incomplete jobs and jobs without a photo', () => {
    const items = buildLabellingQueue([cand(job('p', { status: 'pending' })), cand(job('n', { photo_ref: '' }))], []).items
    expect(items).toHaveLength(0)
    expect(STRATA.reduce((s, x) => s + x.weight, 0)).toBeCloseTo(1)
  })
})

describe('consensus, agreement and progress', () => {
  const labels = [
    label('a', 'r1', { expected_defects: ['bulge'] }), label('a', 'r2', { expected_defects: ['bulge'] }),
    label('b', 'r1', { expected_defects: ['cracking'] }), label('b', 'r2', { expected_defects: [] }),
    label('c', 'r1', { assessable: false }),
  ]
  it('classifies single / agreed / disagreement', () => {
    const c = consensusLabels(labels)
    expect(Object.fromEntries(c.map((r) => [r.jobId, r.status]))).toEqual({ a: 'agreed', b: 'disagreement', c: 'single' })
  })
  it('measures agreement and dangerous disagreement', () => {
    const s = agreementStats([...labels, label('d', 'r1', { expected_defects: ['exposed_cord'] }), label('d', 'r2', { expected_defects: [] })])
    expect(s.pairs).toBe(3); expect(s.exactAgreement).toBeCloseTo(1 / 3, 3); expect(s.dangerousDisagreements).toBe(1)
    expect(agreementStats([]).exactAgreement).toBeNull()
  })
  it('progress excludes disagreements and counts dangerous cases', () => {
    const p = labellingProgress(consensusLabels(labels))
    expect(p.cases).toBe(2); expect(p.dangerous).toBe(1); expect(p.disagreements).toBe(1); expect(p.casesTarget).toBe(500)
  })
  it('reports split leakage when one group lands in two splits', () => {
    expect(splitLeaks(consensusLabels(labels))).toEqual([])
    expect(splitLeaks([{ groupKey: 'S1', split: 'train' }, { groupKey: 'S1', split: 'holdout' }])).toHaveLength(1)
  })
})

describe('benchmark export shape', () => {
  const jobs = [
    job('a', { tyre_position: 'RR1', analysis: { assessable: true, defects: [{ type: 'bulge', confidence: 0.8 }, { type: 'uncertain' }] } }),
    job('b'), job('c', { analysis: { assessable: false, defects: [] } }),
  ]
  const jobsById = new Map(jobs.map((j) => [j.id, j]))
  const inspectionsById = new Map(jobs.map((j) => [j.inspection_id, { id: j.inspection_id, vehicle_type: 'TR-MIXER' }]))
  const labels = [
    label('a', 'r1', { expected_defects: ['bulge'], tyre_serial: 'SER1' }), label('a', 'r2', { expected_defects: ['bulge'] }),
    label('b', 'r1', { expected_defects: ['cracking'] }), label('b', 'r2', { expected_defects: [] }),
    label('c', 'r1', { assessable: false }),
  ]
  const names = new Map([['r1', 'Expert One'], ['r2', 'Expert Two']])
  const out = buildBenchmarkExport({ consensus: consensusLabels(labels), jobsById, inspectionsById, names })
  it('carries exactly the columns ai-accuracy.mjs reads, one row per photo', () => {
    expect(out.labelled.map((r) => r.photo_ref)).toEqual([jobs[0].photo_ref, jobs[2].photo_ref])
    for (const k of ['photo_ref', 'expected', 'assessable', 'reviewer', 'position', 'vehicle_type', 'tyre_serial', 'split']) expect(out.labelled[0]).toHaveProperty(k)
    expect(out.labelled[0]).toMatchObject({ expected: ['bulge'], assessable: true, reviewer: 'Expert One', position: 'RR1', vehicle_type: 'TR-MIXER', tyre_serial: 'SER1', consensus: 'agreed' })
    expect(out.excludedDisagreement).toBe(1)
    expect(out.predictions[0]).toEqual({ photo_ref: jobs[0].photo_ref, assessable: true, defects: [{ type: 'bulge', confidence: 0.8 }, { type: 'uncertain', confidence: null }], model_version: 'm1', prompt_version: 'p1' })
  })
  it('requireAgreement keeps only photographs two reviewers agreed on', () => {
    const strict = buildBenchmarkExport({ consensus: consensusLabels(labels), jobsById, inspectionsById, names, requireAgreement: true })
    expect(strict.labelled).toHaveLength(1); expect(strict.excludedSingle).toBe(1)
  })
  it('the accuracy engine ingests the JSON and CSV forms identically', () => {
    const fromJson = buildAccuracyReport({ labelled: out.labelled, predictions: out.predictions })
    const csv = labelledToCsv(out.labelled)
    expect(csv.split('\n')[0]).toBe(LABELLED_COLUMNS.join(','))
    expect(parseCsv(csv)).toHaveLength(2)
    const fromCsv = buildAccuracyReport({ labelled: csv, predictions: out.predictions })
    expect(fromCsv.micro).toEqual(fromJson.micro)
    expect(fromJson.issues).toEqual([])
    expect(fromJson.micro.tp).toBe(1)
  })
  it('the release gate is honest: insufficient, never pass, on a tiny set', () => {
    const { gate, profile } = runReleaseGate(out)
    expect(profile).toMatch(/release/)
    expect(gate.status).not.toBe('pass')
    expect(gate.checks.find((c) => c.id === 'dangerous_support')).toBeTruthy()
  })
  it('the CSV neutralises spreadsheet formulas', () => {
    expect(labelledToCsv([{ photo_ref: '=HYPERLINK("x")', expected: [] }])).toMatch(/"'=HYPERLINK\(""x""\)"/)
  })
})

describe('inspector finding', () => {
  it('reads condition, notes and serial; never a depth', () => {
    const f = inspectorFinding(JSON.stringify({ FL: { condition: 'Worn', notes: 'n', serial_number: 'S1', tread_depth_mm: '5' } }), 'FL')
    expect(f).toEqual({ recorded: true, condition: 'Worn', notes: 'n', serial: 'S1' })
    expect(inspectorFinding({}, 'FL').recorded).toBe(false)
  })
})
