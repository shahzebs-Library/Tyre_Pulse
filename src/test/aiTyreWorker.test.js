import { describe, it, expect } from 'vitest'
import {
  processJob, ProviderCallError, parseModelOutput, extractUsage, estimateCost, resolveRates,
  canEnqueue, canReview, canBackfill, ENQUEUE_ROLES, REVIEW_ROLES, BACKFILL_ROLES, PROMPT_VERSION,
} from '../../supabase/functions/ai-tyre-inspection/logic.ts'
import {
  AI_ENQUEUE_ROLES, AI_REVIEW_ROLES, AI_BACKFILL_ROLES,
  canQueueAiAnalysis, canReviewAiFinding, canBackfillAi, aiActionNotice,
} from '../lib/aiTyreInspectionRoles'
import { readFileSync } from 'node:fs'
import path from 'node:path'

const GOOD = JSON.stringify({ assessable: true, reason: 'clear', recommendation: 'monitor', defects: [
  { type: 'sidewall_cut', description: 'cut', visibleEvidence: 'visible', severity: 'moderate' }] })
const HAIKU = { input: 0.10, output: 0.50 }

/** In-memory harness that mirrors the SQL reservation semantics (reserve once, settle once). */
function harness({ output = GOOD, usage = { input_tokens: 1000, output_tokens: 200 }, providerError = null,
  rates = HAIKU, limit = 1, reserve = 0.01, photoError = null, spentToday = 0 } = {}) {
  const state = { jobs: new Map(), logs: [], providerCalls: 0, budget: { reserved: 0, settled: spentToday, unknown: 0 }, reservedBy: new Map() }
  const deps = {
    config: { providerName: 'anthropic', model: 'claude-haiku-5-5', rates, reserveUsd: reserve, dailyLimitUsd: limit },
    now: () => new Date('2026-10-23T08:00:00Z'),
    updateJob: async (id, patch, from) => {
      const job = state.jobs.get(id)
      if (!job || job.status !== from) return false
      Object.assign(job, patch)
      return true
    },
    insertTokenLog: async (row) => { state.logs.push(row) },
    reserveBudget: async (_org, jobId) => {
      if (state.reservedBy.has(jobId)) return { ok: false, reason: 'already reserved' }
      if (state.budget.reserved + state.budget.settled + reserve > limit + 1e-9) return { ok: false, reason: 'Daily AI spending limit reached' }
      state.budget.reserved += reserve
      state.reservedBy.set(jobId, { settled: false })
      return { ok: true }
    },
    settleBudget: async (jobId, actual, called) => {
      const r = state.reservedBy.get(jobId)
      if (!r || r.settled) return
      r.settled = true
      state.budget.reserved -= reserve
      if (called) { state.budget.settled += actual ?? reserve; if (actual == null) state.budget.unknown++ }
    },
    loadPhoto: async () => { if (photoError) throw new Error(photoError); return { mediaType: 'image/jpeg', base64: 'AA==' } },
    callProvider: async () => {
      state.providerCalls++
      if (providerError) throw providerError
      return { provider: usage === null ? {} : { usage }, output }
    },
  }
  const add = (id, attempts = 0) => {
    const job = { id, organisation_id: 'org-1', photo_ref: 'tp-storage://b/p.jpg', attempts, status: 'processing' }
    state.jobs.set(id, job)
    return job
  }
  return { state, deps, add }
}

describe('malformed provider output', () => {
  it('records tokens, cost, reason and failed status in the job and the token log', async () => {
    const h = harness({ output: 'not json at all {{' })
    const job = h.add('j1')
    expect(await processJob(h.deps, job)).toBe('failed')
    const row = h.state.jobs.get('j1')
    expect(row.status).toBe('failed')
    expect(row.failure_kind).toBe('invalid_model_output')
    expect(row.input_tokens).toBe(1000)
    expect(row.output_tokens).toBe(200)
    expect(row.total_tokens).toBe(1200)
    expect(row.cost_usd).toBeCloseTo(0.0002, 6)
    expect(row.provider).toBe('anthropic')
    expect(row.billed_at).toBeTruthy()
    expect(row.error_message).toMatch(/no automatic paid retry/)
    expect(h.state.logs).toHaveLength(1)
    expect(h.state.logs[0]).toMatchObject({ feature: 'ai_tyre_inspection', status: 'error', prompt_tokens: 1000, completion_tokens: 200 })
    expect(h.state.logs[0].cost_usd).toBeCloseTo(0.0002, 6)
    expect(h.state.budget.settled).toBeCloseTo(0.0002, 6) // actual, not the reservation
  })

  it('treats valid JSON of the wrong shape (array / null) as unusable', async () => {
    for (const output of ['[]', 'null', '"text"', '']) {
      const h = harness({ output })
      expect(await processJob(h.deps, h.add('j'))).toBe('failed')
      expect(h.state.jobs.get('j').failure_kind).toBe('invalid_model_output')
    }
  })

  it('labels cost UNKNOWN (null), never zero, when the provider returned no usage', async () => {
    const h = harness({ output: 'garbage', usage: null })
    await processJob(h.deps, h.add('j2'))
    const row = h.state.jobs.get('j2')
    expect(row.cost_usd).toBeNull()
    expect(row.input_tokens).toBeNull()
    expect(row.total_tokens).toBeNull()
    expect(row.billed_at).toBeNull()
    expect(h.state.logs[0].cost_usd).toBeNull()
    // The budget still charges the reservation conservatively and flags it as unknown.
    expect(h.state.budget.settled).toBeCloseTo(0.01, 6)
    expect(h.state.budget.unknown).toBe(1)
  })

  it('keeps tokens but leaves cost unknown when pricing for the model is unverified', async () => {
    const h = harness({ output: 'garbage', rates: null })
    await processJob(h.deps, h.add('j3'))
    const row = h.state.jobs.get('j3')
    expect(row.input_tokens).toBe(1000)
    expect(row.cost_usd).toBeNull()
    expect(h.state.logs[0].cost_usd).toBeNull()
    expect(h.state.logs[0].prompt_tokens).toBe(1000)
  })

  it('does not accept the same photograph a second time (no second paid retry)', async () => {
    const h = harness({ output: 'garbage' })
    const job = h.add('j4')
    await processJob(h.deps, job)
    expect(h.state.providerCalls).toBe(1)
    // A re-run sees attempts>0 and is refused without reservation or provider call.
    expect(await processJob(h.deps, { ...job, attempts: 1 })).toBe('skipped_prior_attempt')
    expect(h.state.providerCalls).toBe(1)
    expect(h.state.reservedBy.size).toBe(1)
  })

  it('a previously attempted job never reaches reservation or the provider', async () => {
    const h = harness()
    const job = h.add('j5', 1)
    expect(await processJob(h.deps, job)).toBe('skipped_prior_attempt')
    expect(h.state.providerCalls).toBe(0)
    expect(h.state.reservedBy.size).toBe(0)
    expect(h.state.jobs.get('j5')).toMatchObject({ status: 'failed', failure_kind: 'prior_attempt' })
  })
})

describe('every provider attempt is accounted for', () => {
  const cases = [
    ['timeout', new ProviderCallError('provider_timeout', 'AI provider timed out')],
    ['HTTP error', new ProviderCallError('provider_http_error', 'AI provider HTTP 529', 529)],
    ['non-JSON body', new ProviderCallError('provider_non_json', 'AI provider returned a non-JSON body')],
  ]
  for (const [name, err] of cases) {
    it(`${name}: failed job, unknown cost, budget charged at the reservation, logged`, async () => {
      const h = harness({ providerError: err })
      expect(await processJob(h.deps, h.add('p'))).toBe('failed')
      const row = h.state.jobs.get('p')
      expect(row).toMatchObject({ status: 'failed', failure_kind: err.kind, provider_attempts: 1 })
      expect(row.cost_usd).toBeNull()
      expect(row.input_tokens).toBeNull()
      expect(h.state.logs).toHaveLength(1)
      expect(h.state.logs[0]).toMatchObject({ status: 'error', cost_usd: null, feature: 'ai_tyre_inspection' })
      expect(h.state.logs[0].error).toMatch(/usage unknown/)
      expect(h.state.budget.settled).toBeCloseTo(0.01, 6)
      expect(h.state.budget.unknown).toBe(1)
      expect(h.state.budget.reserved).toBeCloseTo(0, 9)
    })
  }

  it('an unexpected non-ProviderCallError from the provider is still attempted+failed+settled', async () => {
    const h = harness({ providerError: new TypeError('boom') })
    await processJob(h.deps, h.add('p2'))
    expect(h.state.jobs.get('p2').status).toBe('failed')
    expect(h.state.budget.settled).toBeCloseTo(0.01, 6)
  })

  it('the attempt is persisted BEFORE the request so a crash cannot cause a second charge', async () => {
    const h = harness()
    let seenAtCall = null
    const original = h.deps.callProvider
    h.deps.callProvider = async (photo) => { seenAtCall = { ...h.state.jobs.get('p3') }; return original(photo) }
    await processJob(h.deps, h.add('p3'))
    expect(seenAtCall).toMatchObject({ provider_attempts: 1, prompt_version: PROMPT_VERSION })
    expect(seenAtCall.provider_called_at).toBeTruthy()
  })

  it('a successful call stores usage, cost, prompt version and settles actual cost', async () => {
    const h = harness()
    expect(await processJob(h.deps, h.add('ok'))).toBe('completed')
    const row = h.state.jobs.get('ok')
    expect(row).toMatchObject({ status: 'completed', input_tokens: 1000, output_tokens: 200, failure_kind: null })
    expect(row.analysis).toMatchObject({ humanReviewRequired: true, exactTreadDepthMm: null })
    expect(row.cost_usd).toBeCloseTo(0.0002, 6)
    expect(h.state.logs).toHaveLength(0)
    expect(h.state.budget.settled).toBeCloseTo(0.0002, 6)
  })

  it('unavailable photo: no reservation, no provider call, no charge', async () => {
    const h = harness({ photoError: 'Photo unavailable' })
    expect(await processJob(h.deps, h.add('np'))).toBe('failed')
    expect(h.state.providerCalls).toBe(0)
    expect(h.state.reservedBy.size).toBe(0)
    expect(h.state.budget.settled).toBe(0)
    expect(h.state.jobs.get('np').failure_kind).toBe('photo_unavailable')
  })

  it('a budget RPC outage fails the job without any paid call', async () => {
    const h = harness()
    h.deps.reserveBudget = async () => { throw new Error('rpc down') }
    expect(await processJob(h.deps, h.add('rpc'))).toBe('failed')
    expect(h.state.providerCalls).toBe(0)
  })
})

describe('spending ceiling', () => {
  it('defers (does not fail or call the provider) when the day is already at the ceiling', async () => {
    const h = harness({ limit: 1, spentToday: 1 })
    const job = h.add('c1')
    expect(await processJob(h.deps, job)).toBe('deferred')
    expect(h.state.providerCalls).toBe(0)
    expect(h.state.jobs.get('c1')).toMatchObject({ status: 'pending', attempts: 0, failure_kind: 'budget_deferred' })
  })

  it('concurrent workers cannot overshoot: 5 jobs, room for 3 reservations => exactly 3 provider calls', async () => {
    const h = harness({ limit: 0.03, reserve: 0.01 })
    const jobs = ['a', 'b', 'c', 'd', 'e'].map(id => h.add(id))
    const outcomes = await Promise.all(jobs.map(j => processJob(h.deps, j)))
    expect(h.state.providerCalls).toBe(3)
    expect(outcomes.filter(o => o === 'completed')).toHaveLength(3)
    expect(outcomes.filter(o => o === 'deferred')).toHaveLength(2)
    expect(h.state.budget.settled).toBeLessThanOrEqual(0.03)
  })

  it('failed unknown-usage calls consume the ceiling at the reservation amount', async () => {
    const h = harness({ limit: 0.02, reserve: 0.01, providerError: new ProviderCallError('provider_timeout', 'AI provider timed out') })
    const first = await processJob(h.deps, h.add('u1'))
    const second = await processJob(h.deps, h.add('u2'))
    const third = await processJob(h.deps, h.add('u3'))
    expect([first, second, third]).toEqual(['failed', 'failed', 'deferred'])
    expect(h.state.providerCalls).toBe(2)
  })
})

describe('pure helpers', () => {
  it('parseModelOutput strips fences, forces human review and never certifies depth', () => {
    const a = parseModelOutput('```json\n' + GOOD + '\n```')
    expect(a).toMatchObject({ assessable: true, humanReviewRequired: true, exactTreadDepthMm: null, remainingTreadLifeKm: null })
    expect(() => parseModelOutput('nope')).toThrow()
  })
  it('unassessable images carry no defects', () => {
    expect(parseModelOutput(JSON.stringify({ assessable: false, defects: [{ type: 'bulge' }] })).defects).toEqual([])
  })
  it('usage extraction is strict and cost is null when anything is missing', () => {
    expect(extractUsage('anthropic', {}).known).toBe(false)
    expect(extractUsage('anthropic', { usage: { input_tokens: 'x', output_tokens: 1 } }).known).toBe(false)
    expect(extractUsage('anthropic', { usage: { input_tokens: -1, output_tokens: 1 } }).known).toBe(false)
    expect(estimateCost(extractUsage('anthropic', {}), HAIKU)).toBeNull()
    expect(estimateCost(extractUsage('anthropic', { usage: { input_tokens: 10, output_tokens: 10 } }), null)).toBeNull()
    expect(estimateCost(extractUsage('anthropic', { usage: { input_tokens: 1e6, output_tokens: 0 } }), HAIKU)).toBe(0.1)
  })
  it('pricing is only assumed for verified models', () => {
    const none = () => undefined
    expect(resolveRates('anthropic', 'claude-haiku-5-5', none)).toEqual(HAIKU)
    expect(resolveRates('anthropic', 'claude-mystery-9', none)).toBeNull()
    expect(resolveRates('anthropic', 'claude-mystery-9', k => ({ AI_INPUT_USD_PER_MILLION: '1', AI_OUTPUT_USD_PER_MILLION: '2' })[k])).toEqual({ input: 1, output: 2 })
  })
})

describe('tenant and role refusal', () => {
  it('Tyre Data Collector (Sajid-style) may read but cannot queue, review or backfill', () => {
    for (const fn of [canEnqueue, canReview, canBackfill, canQueueAiAnalysis, canReviewAiFinding, canBackfillAi]) {
      expect(fn('Tyre Data Collector')).toBe(false)
    }
  })
  it('unknown, empty and null roles are refused', () => {
    for (const r of ['', null, undefined, 'Reporter', 'Driver', 'Inspector']) {
      expect(canEnqueue(r)).toBe(false)
      expect(canReview(r)).toBe(false)
      expect(canBackfill(r)).toBe(false)
    }
  })
  it('Tyre Man may queue but not review; supervisors may review; PMV Manager may only backfill', () => {
    expect([canEnqueue('Tyre Man'), canReview('Tyre Man')]).toEqual([true, false])
    expect([canEnqueue('Maintenance Supervisor'), canReview('maintenance supervisor')]).toEqual([true, true])
    expect([canEnqueue('PMV Manager'), canReview('PMV Manager'), canBackfill('PMV Manager')]).toEqual([false, false, true])
  })
  it('UI role lists are an exact mirror of the edge function lists', () => {
    expect([...AI_ENQUEUE_ROLES]).toEqual([...ENQUEUE_ROLES])
    expect([...AI_REVIEW_ROLES]).toEqual([...REVIEW_ROLES])
    expect([...AI_BACKFILL_ROLES]).toEqual([...BACKFILL_ROLES])
  })
  it('explains read-only access to the user', () => {
    expect(aiActionNotice('Tyre Data Collector')).toMatch(/Read-only/)
    expect(aiActionNotice('Tyre Man')).toMatch(/cannot accept or reject/)
    expect(aiActionNotice('Manager')).toBe('')
  })
  const edge = readFileSync(path.resolve(process.cwd(), 'supabase/functions/ai-tyre-inspection/index.ts'), 'utf8')
  it('every handler in the edge function enforces role and tenant', () => {
    expect(edge).toMatch(/if \(!canEnqueue\(profile\.role\)\) return fail/)
    expect(edge).toMatch(/if \(!canReview\(profile\.role\)\)/)
    expect(edge).toMatch(/if\(!canBackfill\(profile\.role\)\)/)
    expect(edge).toMatch(/inspection\.organisation_id !== profile\.organisation_id\) return fail\("Inspection unavailable", 403\)/)
    expect(edge).toMatch(/job\.organisation_id !== profile\.organisation_id\) return fail\("Job not found",404\)/)
    expect(edge).toMatch(/\.eq\("organisation_id",profile\.organisation_id\)/) // backfill scope
    expect(edge).toMatch(/provided !== expected\) return fail\("Worker unauthorized",403\)/)
  })
  it('the worker reserves budget through the atomic RPC and has no unmetered provider path', () => {
    expect(edge).toMatch(/ai_tyre_reserve_budget/)
    expect(edge).toMatch(/ai_tyre_settle_budget/)
    expect(edge).toMatch(/ai_tyre_fail_stale_processing/)
    expect(edge.match(/api\.anthropic\.com/g)).toHaveLength(1)
    expect(edge.match(/generativelanguage\.googleapis\.com/g)).toHaveLength(1)
  })
})
