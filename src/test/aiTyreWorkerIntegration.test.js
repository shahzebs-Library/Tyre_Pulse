// End to end worker path with an in-memory Supabase and a scripted AI provider:
//   queue -> drain/claim -> budget check -> reservation -> provider -> persist -> review -> export -> adjudication.
// Only the real pure modules are used (logic.ts, budget.ts, the web export/feedback/adjudication libs);
// the database and the provider are fakes. Covers success, failure, retry, skipped and budget-stopped runs.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import {
  drainQueue, processJob, ProviderCallError, canReview,
} from '../../supabase/functions/ai-tyre-inspection/logic.ts'
import { evaluateMonthlyBudget, parseAiControls, sumMonthSpend } from '../../supabase/functions/ai-tyre-inspection/budget.ts'
import { buildInspectionExportRows } from '../lib/aiTyreInspectionExport'
import { shapeLabelledFindings, labelledSummary } from '../lib/aiTyreReviewFeedback'
import { buildReport, evaluateGate, fromJobRows } from '../lib/aiTyreAdjudication'

const GOOD = (type = 'sidewall_cut', severity = 'high') => JSON.stringify({
  assessable: true, reason: 'Clear view', recommendation: 'Inspect before dispatch',
  defects: [{ type, description: 'cut near the shoulder', visibleEvidence: 'visible', severity }],
})
const HAIKU = { input: 0.10, output: 0.50 }

/** In-memory ai_tyre_inspection_jobs + ai_token_logs + system_config + a scripted provider. */
function world({ config = { ai_monthly_budget_usd: '0' }, script = {}, photoFail = new Set(), dailyLimit = 1, reserve = 0.01, priorSpend = [] } = {}) {
  const w = {
    jobs: new Map(), logs: [...priorSpend], config: { ...config }, providerCalls: [], loads: 0,
    dailySettled: 0, reservedBy: new Set(), now: new Date('2026-10-25T08:00:00Z'), controlsFail: false,
  }
  const add = (id, over = {}) => {
    w.jobs.set(id, { id, organisation_id: 'org-1', inspection_id: 'insp-1', tyre_position: over.tyre_position || id,
      photo_ref: `tp-storage://tyre-photos/${id}.jpg`, status: 'pending', attempts: 0, review_status: 'unreviewed',
      created_at: id, ...over })
    return w.jobs.get(id)
  }
  const monthly = async (reserveUsd) => {
    if (w.controlsFail) return evaluateMonthlyBudget({ controls: null, spentUsd: null, reserveUsd })
    const controls = parseAiControls(Object.entries(w.config).map(([key, value]) => ({ key, value })))
    return evaluateMonthlyBudget({ controls, spentUsd: sumMonthSpend(w.logs, [...w.jobs.values()], reserveUsd), reserveUsd })
  }
  let lastBudget = null
  const deps = {
    config: { providerName: 'anthropic', model: 'claude-haiku-5-5', rates: HAIKU, reserveUsd: reserve, dailyLimitUsd: dailyLimit },
    now: () => w.now,
    updateJob: async (id, patch, from) => { const j = w.jobs.get(id); if (!j || j.status !== from) return false; Object.assign(j, patch); return true },
    insertTokenLog: async (row) => { w.logs.push({ ...row }) },
    checkMonthlyBudget: async (r) => (lastBudget = await monthly(r)),
    reserveBudget: async (_o, jobId) => {
      if (w.reservedBy.has(jobId)) return { ok: false, reason: 'already reserved' }
      if (w.dailySettled + reserve > dailyLimit + 1e-9) return { ok: false, reason: 'Daily AI spending limit reached' }
      w.reservedBy.add(jobId); return { ok: true }
    },
    settleBudget: async (_id, actual, called) => { if (called) w.dailySettled += actual ?? reserve },
    loadPhoto: async (ref) => {
      w.loads++
      if ([...photoFail].some((f) => ref.includes(f))) throw new Error('Photo unavailable')
      return { mediaType: 'image/jpeg', base64: 'AA==' }
    },
    callProvider: async () => {
      const id = w.current
      w.providerCalls.push(id)
      const step = typeof script[id] === 'function' ? script[id]() : script[id]
      if (step instanceof Error) throw step
      const s = step || { output: GOOD() }
      return { provider: s.usage === null ? {} : { usage: s.usage || { input_tokens: 1000, output_tokens: 200 } }, output: s.output }
    },
  }
  const drain = (opts) => drainQueue({
    fetchBatch: async (n) => [...w.jobs.values()].filter((j) => j.status === 'pending').sort((a, b) => a.created_at.localeCompare(b.created_at)).slice(0, n).map((j) => ({ ...j })),
    claim: async (job) => { const j = w.jobs.get(job.id); if (!j || j.status !== 'pending') return false; j.status = 'processing'; j.attempts = job.attempts + 1; w.current = job.id; return true },
    process: (job) => processJob(deps, job),
    nowMs: () => 0,
  }, { concurrency: 1, ...opts }) // this harness shares w.current, so it is sequential; see aiTyreConcurrency.test.js
  return { w, add, drain, deps, budget: () => lastBudget }
}

/** Mirrors the review rules of index.ts review(): role gate, completed+unreviewed only, optimistic update. */
function reviewJob(w, role, jobId, decision, note = '') {
  if (!canReview(role)) return { status: 403 }
  if (!['accepted', 'rejected', 'corrected'].includes(decision)) return { status: 400 }
  const j = w.jobs.get(jobId)
  if (!j) return { status: 404 }
  if (j.status !== 'completed' || j.review_status !== 'unreviewed') return { status: 409 }
  Object.assign(j, { review_status: decision, reviewer_note: note, reviewed_at: w.now.toISOString() })
  return { status: 200 }
}

describe('worker path: queue -> measurement -> persist -> review -> export', () => {
  it('processes a backlog, persists analysis + cost, lets a supervisor review, and exports the result', async () => {
    const { w, add, drain } = world()
    add('a1'); add('a2'); add('a3')
    const r = await drain()
    expect(r).toMatchObject({ processed: 3, failed: 0, stoppedBecause: 'empty' })
    for (const j of w.jobs.values()) {
      expect(j).toMatchObject({ status: 'completed', attempts: 1, provider: 'anthropic', input_tokens: 1000, output_tokens: 200 })
      expect(j.cost_usd).toBeCloseTo(0.0002, 6)
      expect(j.analysis).toMatchObject({ assessable: true, humanReviewRequired: true, exactTreadDepthMm: null })
      expect(j.prompt_version).toBe('tyre-photo-v3')
    }
    expect(w.providerCalls).toEqual(['a1', 'a2', 'a3'])
    expect(w.reservedBy.size).toBe(3)

    // Review: only supervisors; once; never on a job that did not complete.
    expect(reviewJob(w, 'Tyre Data Collector', 'a1', 'accepted')).toEqual({ status: 403 })
    expect(reviewJob(w, 'Manager', 'a1', 'accepted', 'matches photo')).toEqual({ status: 200 })
    expect(reviewJob(w, 'Manager', 'a1', 'rejected')).toEqual({ status: 409 })          // already reviewed
    expect(reviewJob(w, 'Manager', 'a2', 'maybe')).toEqual({ status: 400 })
    expect(reviewJob(w, 'Manager', 'a2', 'corrected', 'cut is on the tread, not the sidewall')).toEqual({ status: 200 })

    // Export: the Excel row carries the persisted AI result and the review state.
    const jobs = [...w.jobs.values()]
    const rows = buildInspectionExportRows({
      inspection: { id: 'insp-1', asset_no: 'TM514', site: 'NHC', inspection_date: '2026-10-25', inspector: 'Sajid' },
      readings: ['a1', 'a2', 'a3'].map((p) => ({ position: p, condition: 'Damaged', calculation: { valid: false } })),
      analysisJobs: jobs, evidence: { allPhotos: [{ position: 'a1', ref: 'tp-storage://tyre-photos/a1.jpg' }] },
      positionLabel: (p) => p.toUpperCase(),
    })
    expect(rows).toHaveLength(3)
    expect(rows[0]).toMatchObject({ vehicle: 'TM514', position: 'A1', ai_status: 'completed', review_status: 'accepted', model: 'claude-haiku-5-5', photos: 1 })
    expect(rows[0].findings).toMatch(/sidewall_cut: cut near the shoulder/)
    expect(rows[1].review_status).toBe('corrected')
    expect(rows[2].review_status).toBe('unreviewed')
    expect(rows[2].measured_mm).toBe('Not measured')           // AI never fills in millimetres

    // Evaluation feed: labelled findings and the adjudication bridge agree on the human decisions.
    const labelled = shapeLabelledFindings(jobs.map((j) => ({ job_id: j.id, review_status: j.review_status, model_version: j.model_version,
      prompt_version: j.prompt_version, defects: j.analysis.defects, assessable: j.analysis.assessable, reviewer_note: j.reviewer_note })))
    expect(labelledSummary(labelled)).toMatchObject({ total: 2, accepted: 1, corrected: 1 })
    const { results, reviews } = fromJobRows(jobs)
    expect(results).toHaveLength(3)
    expect(reviews.map((x) => x.decision)).toEqual(['accepted', 'corrected'])
    const report = buildReport({ golden: [], results, reviews })
    expect(report.review).toMatchObject({ reviewed: 2, accepted: 1, corrected: 1 })
    expect(evaluateGate(report).status).toBe('insufficient')   // 2 reviews cannot certify anything
  })
})

describe('failure paths', () => {
  it('malformed JSON: failed, tokens and cost still recorded, one log row, never re-queued or re-billed', async () => {
    const { w, add, drain } = world({ script: { f1: { output: 'not json {{' } } })
    add('f1'); add('f2')
    const r1 = await drain()
    expect(r1).toMatchObject({ processed: 1, failed: 1 })
    expect(w.jobs.get('f1')).toMatchObject({ status: 'failed', failure_kind: 'invalid_model_output', input_tokens: 1000 })
    expect(w.jobs.get('f1').cost_usd).toBeCloseTo(0.0002, 6)
    expect(w.logs.filter((l) => l.status === 'error')).toHaveLength(1)
    const callsAfterFirst = w.providerCalls.length
    // A later cron tick finds nothing pending: the failed photo is not paid for again.
    const r2 = await drain()
    expect(r2.stoppedBecause).toBe('empty')
    expect(w.providerCalls.length).toBe(callsAfterFirst)
  })

  it('provider timeout / HTTP error / non-JSON: failed with unknown (null) cost, charged to the budget as a reservation', async () => {
    const { w, add, drain } = world({ script: {
      t1: new ProviderCallError('provider_timeout', 'AI provider timed out'),
      t2: new ProviderCallError('provider_http_error', 'AI provider HTTP 529', 529),
      t3: new ProviderCallError('provider_non_json', 'AI provider returned a non-JSON body'),
    } })
    add('t1'); add('t2'); add('t3')
    const r = await drain()
    expect(r.failed).toBe(3)
    expect([...w.jobs.values()].map((j) => j.failure_kind)).toEqual(['provider_timeout', 'provider_http_error', 'provider_non_json'])
    for (const j of w.jobs.values()) { expect(j.cost_usd).toBeNull(); expect(j.status).toBe('failed') }
    expect(w.dailySettled).toBeCloseTo(0.03, 6)                 // 3 unknown calls x reservation, not 0
    // The month total also counts them (unknown failed tyre calls are charged, not free).
    expect(sumMonthSpend(w.logs, [...w.jobs.values()], 0.01)).toBeCloseTo(0.03, 6)
  })

  it('missing usage metadata on a good reply: completes but cost stays NULL (unknown), not 0', async () => {
    const { w, add, drain } = world({ script: { u1: { output: GOOD(), usage: null } } })
    add('u1')
    await drain()
    expect(w.jobs.get('u1')).toMatchObject({ status: 'completed', cost_usd: null, input_tokens: null })
  })

  it('unavailable photo and invalid reference fail without any provider call or spend', async () => {
    const { w, add, drain } = world({ photoFail: new Set(['p1']) })
    add('p1'); add('p2', { photo_ref: 'https://evil.example/x.jpg' })
    w.jobs.get('p2').photo_ref = 'tp-storage://tyre-photos/ok.jpg'
    const r = await drain()
    expect(r.failed).toBe(1)
    expect(w.jobs.get('p1')).toMatchObject({ status: 'failed', failure_kind: 'photo_unavailable' })
    expect(w.providerCalls).toEqual(['p2'])
  })
})

describe('retry and skipped cases', () => {
  it('a pending job that was attempted before is skipped to manual review: no reservation, no provider call', async () => {
    const { w, add, drain } = world()
    add('s1', { attempts: 1 }); add('s2')
    const r = await drain()
    expect(r).toMatchObject({ skipped: 1, processed: 1 })
    expect(w.jobs.get('s1')).toMatchObject({ status: 'failed', failure_kind: 'prior_attempt' })
    expect(w.providerCalls).toEqual(['s2'])
    expect(w.reservedBy.has('s1')).toBe(false)
  })

  it('a job that lost the claim race to another worker is not processed twice', async () => {
    const { w, add, drain } = world()
    add('r1'); add('r2')
    w.jobs.get('r1').status = 'processing'                // another worker already holds it
    const r = await drain()
    expect(r.processed).toBe(1)
    expect(w.providerCalls).toEqual(['r2'])
  })

  it('a daily-budget deferral is un-attempted and is picked up by the next run, which charges once', async () => {
    const { w, add, drain } = world({ dailyLimit: 0.01, reserve: 0.01 })
    add('d1'); add('d2')
    const first = await drain()
    expect(first).toMatchObject({ processed: 1, deferred: 1, stoppedBecause: 'deferred' })
    expect(w.jobs.get('d2')).toMatchObject({ status: 'pending', attempts: 0, failure_kind: 'budget_deferred' })
    expect(w.providerCalls).toEqual(['d1'])
    w.dailySettled = 0                                       // next UTC day
    const second = await drain()
    expect(second.processed).toBe(1)
    expect(w.jobs.get('d2')).toMatchObject({ status: 'completed', failure_kind: null, attempts: 1 })
    expect(w.providerCalls).toEqual(['d1', 'd2'])
  })
})

describe('hard monthly budget end to end', () => {
  const spent = (usd) => [{ cost_usd: usd, feature: 'chat', status: 'success' }]

  it('runs normally while under the cap', async () => {
    const { w, add, drain, budget } = world({ config: { ai_monthly_budget_usd: '10' }, priorSpend: spent(5) })
    add('m1'); add('m2')
    expect((await drain()).processed).toBe(2)
    expect(budget()).toMatchObject({ allowed: true, state: 'ok' })
    expect(w.providerCalls).toHaveLength(2)
  })

  it('stops the run with a visible budget-reached state when the cap is hit, with no further paid calls', async () => {
    const { w, add, drain, budget } = world({ config: { ai_monthly_budget_usd: '10' }, priorSpend: spent(9.995) })
    add('b1'); add('b2'); add('b3')
    const r = await drain()
    expect(r).toMatchObject({ processed: 0, deferred: 1, stoppedBecause: 'deferred' })
    expect(w.providerCalls).toHaveLength(0)
    expect(w.loads).toBe(0)                                  // not even downloaded
    expect(budget()).toMatchObject({ allowed: false, state: 'reached', limitUsd: 10 })
    const b1 = w.jobs.get('b1')
    expect(b1).toMatchObject({ status: 'pending', attempts: 0, failure_kind: 'monthly_budget_reached' })
    expect(b1.error_message).toMatch(/Monthly AI budget reached/)
    expect(w.logs.filter((l) => l.status === 'blocked')).toHaveLength(1)
    // The other jobs were never touched, so they remain a clean queue for when the cap is raised.
    expect(w.jobs.get('b2')).toMatchObject({ status: 'pending', attempts: 0 })
    expect(w.jobs.get('b2').failure_kind).toBeUndefined()
  })

  it('the cap is crossed mid-run by the run\'s own spend: the first job is kept, the next one stops', async () => {
    const usage = { input_tokens: 10000, output_tokens: 1800 }          // actual cost 0.0019 per call
    const { w, add, drain } = world({ config: { ai_monthly_budget_usd: '1' }, priorSpend: spent(0.99),
      script: { x1: { output: GOOD(), usage }, x2: { output: GOOD(), usage } } })
    add('x1'); add('x2')
    // 0.99 + 0.01 reservation = 1.00 <= limit: x1 runs. 0.9919 + 0.01 > 1: x2 is refused.
    const r = await drain()
    expect(r).toMatchObject({ processed: 1, deferred: 1, stoppedBecause: 'deferred' })
    expect(w.jobs.get('x1').status).toBe('completed')
    expect(w.jobs.get('x2')).toMatchObject({ status: 'pending', failure_kind: 'monthly_budget_reached', attempts: 0 })
    expect(w.providerCalls).toEqual(['x1'])
    expect(sumMonthSpend(w.logs, [...w.jobs.values()], 0.01)).toBeLessThanOrEqual(1)
  })

  it('raising the cap resumes the same queue without double-billing anything', async () => {
    const { w, add, drain } = world({ config: { ai_monthly_budget_usd: '10' }, priorSpend: spent(10) })
    add('c1')
    expect((await drain()).deferred).toBe(1)
    w.config.ai_monthly_budget_usd = '20'
    expect((await drain()).processed).toBe(1)
    expect(w.providerCalls).toEqual(['c1'])
    expect(w.jobs.get('c1')).toMatchObject({ status: 'completed', failure_kind: null, attempts: 1 })
  })

  it('fails closed when the budget controls cannot be read, and when the admin switched AI off', async () => {
    const down = world({ config: { ai_monthly_budget_usd: '10' } })
    down.add('k1'); down.w.controlsFail = true
    expect((await down.drain()).deferred).toBe(1)
    expect(down.w.providerCalls).toHaveLength(0)
    expect(down.w.logs[0].error).toMatch(/^unavailable:/)
    const off = world({ config: { ai_enabled: 'false', ai_monthly_budget_usd: '10' } })
    off.add('k2')
    expect((await off.drain()).deferred).toBe(1)
    expect(off.w.providerCalls).toHaveLength(0)
    expect(off.w.logs[0].error).toMatch(/^disabled:/)
  })

  it('an unset or zero cap means uncapped (documented default), so existing deployments keep working', async () => {
    const { w, add, drain, budget } = world({ config: {}, priorSpend: spent(999) })
    add('n1')
    expect((await drain()).processed).toBe(1)
    expect(budget().state).toBe('uncapped')
    expect(w.providerCalls).toEqual(['n1'])
  })
})

describe('review handler guards exist in the deployed source', () => {
  const src = readFileSync(path.resolve(__dirname, '../../supabase/functions/ai-tyre-inspection/index.ts'), 'utf8')
  const review = src.slice(src.indexOf('async function review'), src.indexOf('async function callProvider'))
  it('mirrors the rules the in-memory review above relies on', () => {
    expect(review).toMatch(/canReview\(profile\.role\)/)
    expect(review).toMatch(/job\.organisation_id !== profile\.organisation_id/)
    expect(review).toMatch(/job\.status !== "completed" \|\| job\.review_status !== "unreviewed"/)
    expect(review).toMatch(/\.eq\("review_status","unreviewed"\)/)                // optimistic concurrency
    expect(review).toMatch(/\["accepted","rejected","corrected"\]/)
  })
})
