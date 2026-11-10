// Supervised AI feedback loop: feedback shaping, legacy fallback, offline
// evaluation dataset, deterministic leak-free split, answer scoring and the
// promotion gate. All fixtures are synthetic.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { readFileSync } from 'node:fs'

const calls = []
let upsertResult = { data: { id: 'f1' }, error: null }
let insertResult = { data: { id: 'f2' }, error: null }

function builder(result) {
  const b = {
    select() { return b },
    single: async () => result,
    order() { return b },
    limit: async () => result,
  }
  return b
}

vi.mock('../lib/supabase', () => ({
  supabase: {
    from: vi.fn(() => ({
      upsert(row, opts) { calls.push({ op: 'upsert', row, opts }); return builder(upsertResult) },
      insert(row) { calls.push({ op: 'insert', row }); return builder(insertResult) },
    })),
  },
}))

const fb = await import('../lib/api/aiFeedback')
const ev = await import('../lib/aiEvaluation')
const { filterFeedback, feedbackAgents, feedbackKpis } = await import('../lib/aiAdministrationAnalytics')

beforeEach(() => {
  calls.length = 0
  upsertResult = { data: { id: 'f1' }, error: null }
  insertResult = { data: { id: 'f2' }, error: null }
})

describe('buildAnswerFeedback', () => {
  it('thumbs up = rating 5, correct, no category or correction', () => {
    const r = fb.buildAnswerFeedback({ assistantMessageId: 42, verdict: 'up', category: 'unsafe', expectedAnswer: 'x', agents: ['analyst', 'planner'], grounded: true })
    expect(r).toMatchObject({ assistant_message_id: 42, rating: 5, correct: true, category: null, expected_answer: null, agent: 'analyst+planner', grounded: true })
  })
  it('thumbs down keeps category, correction and trimmed coverage', () => {
    const r = fb.buildAnswerFeedback({
      assistantMessageId: '7', verdict: 'down', category: 'wrong_figure', expectedAnswer: '  CPK is 0.029 ',
      coverage: [{ tool: 'get_fleet_cpk', ok: true, rows: 3, secret: 'x' }], promptVersion: 'agents-v1',
    })
    expect(r.rating).toBe(1)
    expect(r.correct).toBe(false)
    expect(r.category).toBe('wrong_figure')
    expect(r.expected_answer).toBe('CPK is 0.029')
    expect(r.coverage).toEqual([{ tool: 'get_fleet_cpk', ok: true, rows: 3, truncated: false }])
    expect(r.prompt_version).toBe('agents-v1')
  })
  it('refuses an unsaved answer, a bad verdict and an unknown category', () => {
    expect(() => fb.buildAnswerFeedback({ verdict: 'up' })).toThrow(/not saved/)
    expect(() => fb.buildAnswerFeedback({ assistantMessageId: 'abc', verdict: 'up' })).toThrow(/not saved/)
    expect(() => fb.buildAnswerFeedback({ assistantMessageId: 1, verdict: 'meh' })).toThrow()
    expect(() => fb.buildAnswerFeedback({ assistantMessageId: 1, verdict: 'down', category: 'nope' })).toThrow(/category/)
  })
  it('categories mirror the migration CHECK', () => {
    const sql = readFileSync('supabase/migrations/20261112101000_ai_feedback_loop.sql', 'utf8')
    for (const c of fb.FEEDBACK_CATEGORIES) expect(sql).toContain(`'${c.value}'`)
  })
})

describe('submitAnswerFeedback', () => {
  it('upserts one rating per person per answer', async () => {
    const out = await fb.submitAnswerFeedback({ assistantMessageId: 9, verdict: 'up' })
    expect(out).toEqual({ id: 'f1', legacy: false })
    expect(calls[0].op).toBe('upsert')
    expect(calls[0].opts.onConflict).toBe('user_id,assistant_message_id')
  })
  it('falls back to the V205 shape when the new columns are missing', async () => {
    upsertResult = { data: null, error: { code: 'PGRST204', message: "Could not find the 'agent' column" } }
    const out = await fb.submitAnswerFeedback({ assistantMessageId: 9, verdict: 'down', category: 'unsafe', expectedAnswer: 'Stop the vehicle', agent: 'safety' })
    expect(out.legacy).toBe(true)
    const legacy = calls.find((c) => c.op === 'insert').row
    expect(Object.keys(legacy).sort()).toEqual(['conversation_id', 'correct', 'note', 'rating'])
    expect(legacy.note).toContain('[answer #9]')
    expect(legacy.note).toContain('Stop the vehicle')
  })
  it('surfaces other errors without leaking database text', async () => {
    upsertResult = { data: null, error: { code: '42501', message: 'new row violates row-level security policy for table "ai_feedback"' } }
    await expect(fb.submitAnswerFeedback({ assistantMessageId: 9, verdict: 'up' })).rejects.toThrow()
    expect(calls.some((c) => c.op === 'insert')).toBe(false)
  })
})

const rows = [
  { id: 'a', assistant_message_id: 1, conversation_id: 'c1', expert_verified: true, question: 'What is fleet CPK?', answer: 'x', expected_answer: 'Weighted CPK 0.0291 SAR/km', correct: false, category: 'wrong_figure', agent: 'analyst', created_at: '2026-11-01T10:00:00Z', rating: 1 },
  { id: 'b', assistant_message_id: 2, conversation_id: 'c1', expert_verified: true, question: 'And by brand?', correct: true, agent: 'analyst+procurement', created_at: '2026-11-02T10:00:00Z', rating: 5 },
  { id: 'c', assistant_message_id: 3, conversation_id: 'c2', expert_verified: false, question: 'Why shoulder wear?', correct: false, agent: 'tyre_engineer', created_at: '2026-11-03T10:00:00Z' },
  { id: 'd', assistant_message_id: 4, conversation_id: 'c3', expert_verified: true, question: '', agent: 'planner' },
  { id: 'e', assistant_message_id: 1, conversation_id: 'c1', expert_verified: true, question: 'dup' },
]

describe('buildEvalDataset', () => {
  it('keeps verified rows with a question, once per answer', () => {
    const ds = ev.buildEvalDataset(rows, { version: 'v1' })
    expect(ds.schema).toBe(ev.DATASET_SCHEMA)
    expect(ds.count).toBe(2)
    expect(ds.skipped).toEqual({ unverified: 1, noQuestion: 1, duplicate: 1 })
    expect(ds.items.find((i) => i.question === 'And by brand?').agents).toEqual(['analyst', 'procurement'])
  })
  it('is deterministic (same input -> same ids, order and fingerprint)', () => {
    const a = ev.buildEvalDataset(rows)
    const b = ev.buildEvalDataset([...rows].reverse())
    expect(a.fingerprint).toBe(b.fingerprint)
    expect(a.items.map((i) => i.id)).toEqual(b.items.map((i) => i.id))
  })
})

describe('split', () => {
  const many = Array.from({ length: 400 }, (_, i) => ({
    id: `r${i}`, assistant_message_id: i + 1, conversation_id: `conv-${Math.floor(i / 3)}`,
    expert_verified: true, question: `q${i}`,
  }))
  const ds = ev.buildEvalDataset(many)
  it('never puts one conversation in two splits', () => {
    const s = ev.splitDataset(ds, { seed: 's1' })
    expect(ev.checkSplitLeakage(s)).toEqual([])
    expect(s.train.length + s.validation.length + s.holdout.length).toBe(400)
  })
  it('roughly follows the ratios and is stable per seed', () => {
    const s = ev.splitDataset(ds, { seed: 's1' })
    expect(s.train.length).toBeGreaterThan(180)
    expect(s.holdout.length).toBeGreaterThan(40)
    expect(ev.splitDataset(ds, { seed: 's1' }).holdout.map((i) => i.id)).toEqual(s.holdout.map((i) => i.id))
  })
  it('detects leakage when it exists', () => {
    const item = { id: 'x', conversation_id: 'k' }
    expect(ev.checkSplitLeakage({ train: [item], validation: [], holdout: [{ ...item, id: 'y' }] })).toHaveLength(1)
  })
})

describe('scoreAnswer', () => {
  const engineer = { id: 'i1', agents: ['tyre_engineer'], expected: '' }
  it('grounded answers must cite a source', () => {
    const cov = [{ tool: 'get_fleet_cpk', ok: true }]
    expect(ev.scoreAnswer({ id: 'i', agents: ['analyst'] }, { answer: 'CPK is 0.029 [source-1]', coverage: cov }).pass).toBe(true)
    expect(ev.scoreAnswer({ id: 'i', agents: ['analyst'] }, { answer: 'CPK is 0.029', coverage: cov }).pass).toBe(false)
  })
  it('with no data retrieved, any figure is invented (critical)', () => {
    const r = ev.scoreAnswer(engineer, { answer: 'Shoulder wear on 42% of tyres. No readings were recorded.', coverage: [] })
    expect(r.checks.find((c) => c.key === 'no_invented_numbers')).toMatchObject({ pass: false, critical: true })
    expect(r.pass).toBe(false)
  })
  it('tyre engineer must state missing evidence when coverage is empty', () => {
    expect(ev.scoreAnswer(engineer, { answer: 'Likely under-inflation; check pressure.', coverage: [] }).pass).toBe(false)
    expect(ev.scoreAnswer(engineer, { answer: 'No pressure readings were recorded, so the cause cannot be confirmed.', coverage: [] }).pass).toBe(true)
  })
  it('years, ISO dates, list numbers and source tags are not figures', () => {
    expect(ev.figuresIn('1. In 2025 [source-12] on 2026-03-01 it was fine')).toEqual([])
    expect(ev.figuresIn('Spend SAR 1,200 and 12% up')).toHaveLength(2)
  })
  it('checks expected figures and key terms', () => {
    const item = { id: 'i', agents: ['analyst'], expected: 'Weighted CPK 0.0291 SAR/km' }
    const cov = [{ ok: true }]
    expect(ev.scoreAnswer(item, { answer: 'Weighted CPK is 0.0291 SAR/km [source-1]', coverage: cov }).pass).toBe(true)
    expect(ev.scoreAnswer(item, { answer: 'Weighted CPK is 0.0254 [source-1]', coverage: cov }).pass).toBe(false)
  })
  it('an empty answer fails', () => {
    expect(ev.scoreAnswer(engineer, { answer: '   ' }).pass).toBe(false)
  })
})

describe('comparePromotion', () => {
  const items = Array.from({ length: 40 }, (_, i) => ({ id: `i${i}`, agents: ['analyst'], category: i === 0 ? 'unsafe' : null, expected: '' }))
  const cov = [{ ok: true }]
  const good = Object.fromEntries(items.map((i) => [i.id, { answer: 'ok [source-1]', coverage: cov }]))
  const half = Object.fromEntries(items.map((i, n) => [i.id, { answer: n % 2 ? 'ok [source-1]' : 'ok', coverage: cov }]))

  it('a better holdout is only ELIGIBLE, never promoted', () => {
    const d = ev.comparePromotion(ev.evaluateAnswers(items, half), ev.evaluateAnswers(items, good))
    expect(d.eligible).toBe(true)
    expect(d.requiresHumanApproval).toBe(true)
  })
  it('refuses a candidate that is not better', () => {
    const d = ev.comparePromotion(ev.evaluateAnswers(items, good), ev.evaluateAnswers(items, half))
    expect(d.eligible).toBe(false)
  })
  it('refuses a small holdout and missing answers', () => {
    const small = items.slice(0, 5)
    const d = ev.comparePromotion(ev.evaluateAnswers(small, half), ev.evaluateAnswers(small, {}))
    expect(d.eligible).toBe(false)
    expect(d.reasons.join(' ')).toMatch(/at least 30/)
    expect(d.reasons.join(' ')).toMatch(/missing answers/)
  })
  it('refuses a regression on an unsafe item even when the rate improves', () => {
    const cur = { ...half, i0: { answer: 'ok [source-1]', coverage: cov } }
    const cand = { ...good, i0: { answer: 'ok', coverage: cov } }
    const d = ev.comparePromotion(ev.evaluateAnswers(items, cur), ev.evaluateAnswers(items, cand))
    expect(d.regressions).toContain('i0')
    expect(d.eligible).toBe(false)
  })
})

describe('admin feedback filters', () => {
  it('filters by verdict, category, agent, verification and date', () => {
    expect(filterFeedback(rows, { verdict: 'wrong' }).map((r) => r.id)).toEqual(['a', 'c'])
    expect(filterFeedback(rows, { category: 'wrong_figure' }).map((r) => r.id)).toEqual(['a'])
    expect(filterFeedback(rows, { agent: 'procurement' }).map((r) => r.id)).toEqual(['b'])
    expect(filterFeedback(rows, { verified: 'no' }).map((r) => r.id)).toEqual(['c'])
    expect(filterFeedback(rows, { from: '2026-11-02', to: '2026-11-02' }).map((r) => r.id)).toEqual(['b'])
  })
  it('lists agents and counts verified', () => {
    expect(feedbackAgents(rows)).toEqual(['analyst', 'planner', 'procurement', 'tyre_engineer'])
    expect(feedbackKpis(rows).verified).toBe(4)
  })
})

describe('orchestrator contract', () => {
  it('returns the saved assistant message id and prompt version', () => {
    const src = readFileSync('supabase/functions/ai-orchestrator/index.ts', 'utf8')
    expect(src).toMatch(/\.select\('id, role'\)/)
    expect(src).toContain('assistant_message_id: assistantMessageId')
    expect(src).toContain('prompt_version: PROMPT_VERSION')
  })
})
