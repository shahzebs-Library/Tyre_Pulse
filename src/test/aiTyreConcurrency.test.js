import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import {
  drainQueue, processJob, parseConcurrency, createRateLimitGate, PROMPT_VERSION, ProviderCallError,
} from '../../supabase/functions/ai-tyre-inspection/logic.ts'

const GOOD = JSON.stringify({ assessable: true, reason: 'clear', recommendation: 'monitor', defects: [
  { type: 'sidewall_cut', description: 'cut', visibleEvidence: 'visible', severity: 'moderate' }] })
const HAIKU = { input: 0.10, output: 0.50 }
const tick = () => new Promise((r) => setTimeout(r, 1))

/** Concurrency-safe world: per-job state (no shared "current"), atomic reservation, real async interleaving. */
function world({ n = 12, orgFor = () => 'org-1', hashFor = () => null, limit = 100, reserve = 0.01, script = {}, delay = 2 } = {}) {
  const w = { jobs: new Map(), inflight: 0, maxInflight: 0, providerCalls: [], spent: 0, reserved: 0, now: 0 }
  for (let i = 0; i < n; i++) {
    const id = `j${String(i).padStart(2, '0')}`
    w.jobs.set(id, { id, organisation_id: orgFor(i), photo_ref: `tp-storage://b/${id}.jpg`, status: 'pending', attempts: 0, sha: hashFor(i), tyre_position: id, inspection_id: 'i1' })
  }
  const deps = {
    config: { providerName: 'anthropic', model: 'claude-haiku-5-5', rates: HAIKU, reserveUsd: reserve, dailyLimitUsd: limit },
    now: () => new Date('2026-10-27T08:00:00Z'),
    updateJob: async (id, patch, from) => { const j = w.jobs.get(id); if (!j || j.status !== from) return false; Object.assign(j, patch); return true },
    insertTokenLog: async () => {},
    // Atomic like the SQL function: check + reserve with no await in between.
    reserveBudget: async () => {
      if (w.spent + w.reserved + reserve > limit + 1e-9) return { ok: false, reason: 'Daily AI spending limit reached' }
      w.reserved += reserve; return { ok: true }
    },
    settleBudget: async (_id, actual, called) => { w.reserved -= reserve; if (called) w.spent += actual ?? reserve },
    loadPhoto: async (ref) => {
      const id = ref.split('/').pop().replace('.jpg', '')
      return { mediaType: 'image/jpeg', base64: 'AA==', sha256: w.jobs.get(id).sha || undefined, _id: id }
    },
    callProvider: async (photo) => {
      w.inflight++; w.maxInflight = Math.max(w.maxInflight, w.inflight)
      w.providerCalls.push(photo._id)
      await new Promise((r) => setTimeout(r, delay))
      w.inflight--
      const step = script[photo._id]
      if (step instanceof Error) throw step
      return { provider: { usage: { input_tokens: 1000, output_tokens: 200 } }, output: step?.output ?? GOOD }
    },
  }
  const drain = (opts, extra = {}) => drainQueue({
    fetchBatch: async (k) => [...w.jobs.values()].filter((j) => j.status === 'pending').slice(0, k).map((j) => ({ ...j })),
    claim: async (job) => { await tick(); const j = w.jobs.get(job.id); if (!j || j.status !== 'pending') return false; j.status = 'processing'; j.attempts = job.attempts + 1; return true },
    process: (job) => processJob(deps, job),
    nowMs: () => (w.now += 1),
    ...extra,
  }, opts)
  return { w, deps, drain }
}

describe('parseConcurrency', () => {
  it('defaults to 4 and clamps to 1..6', () => {
    expect(parseConcurrency(undefined)).toBe(4)
    expect(parseConcurrency('')).toBe(4)
    expect(parseConcurrency('abc')).toBe(4)
    expect(parseConcurrency('0')).toBe(1)
    expect(parseConcurrency('-3')).toBe(1)
    expect(parseConcurrency('3')).toBe(3)
    expect(parseConcurrency('99')).toBe(6)
    expect(parseConcurrency('5.9')).toBe(5)
  })
})

describe('bounded worker pool', () => {
  it('processes jobs in parallel up to the limit, each job exactly once', async () => {
    const { w, drain } = world({ n: 12 })
    const r = await drain({ concurrency: 4 })
    expect(r).toMatchObject({ processed: 12, claimed: 12, stoppedBecause: 'empty' })
    expect(w.maxInflight).toBeGreaterThan(1)
    expect(w.maxInflight).toBeLessThanOrEqual(4)
    expect(new Set(w.providerCalls).size).toBe(12)
    expect(w.providerCalls).toHaveLength(12)
  })

  it('honours concurrency 1 (sequential) and the 6 ceiling', async () => {
    const one = world({ n: 6 }); await one.drain({ concurrency: 1 })
    expect(one.w.maxInflight).toBe(1)
    const big = world({ n: 24 }); await big.drain({ concurrency: 50 })
    expect(big.w.maxInflight).toBeLessThanOrEqual(6)
  })

  it('claim atomicity: two overlapping drains never process the same job twice', async () => {
    const { w, drain } = world({ n: 20 })
    const [a, b] = await Promise.all([drain({ concurrency: 4 }), drain({ concurrency: 4 })])
    expect(a.processed + b.processed).toBe(20)
    expect(w.providerCalls).toHaveLength(20)
    expect(new Set(w.providerCalls).size).toBe(20)
  })

  it('failures are isolated: one provider error and one thrown process do not stop or taint the others', async () => {
    const { w, drain } = world({ n: 8, script: { j02: new ProviderCallError('provider_timeout', 'timed out'), j05: { output: 'not json {{' } } })
    const r = await drain({ concurrency: 4 })
    expect(r).toMatchObject({ processed: 6, failed: 2, stoppedBecause: 'empty' })
    expect(w.jobs.get('j02')).toMatchObject({ status: 'failed', failure_kind: 'provider_timeout' })
    expect(w.jobs.get('j05')).toMatchObject({ status: 'failed', failure_kind: 'invalid_model_output' })
    expect([...w.jobs.values()].filter((j) => j.status === 'completed')).toHaveLength(6)
    // a process() that throws is counted failed, siblings continue
    const t = world({ n: 6 })
    const r2 = await t.drain({ concurrency: 3 }, { process: async (job) => { if (job.id === 'j01') throw new Error('boom'); return 'completed' } })
    expect(r2).toMatchObject({ processed: 5, failed: 1 })
  })

  it('a deferral stops NEW claims; in-flight jobs finish; nothing further starts', async () => {
    const { w, drain } = world({ n: 20, limit: 0.03, reserve: 0.01 })
    const r = await drain({ concurrency: 4 })
    expect(r.stoppedBecause).toBe('deferred')
    expect(r.deferred).toBeGreaterThanOrEqual(1)
    // Claims after the first deferral are bounded by what was already in flight in that batch (<= 4 per batch).
    expect(r.claimed).toBeLessThanOrEqual(8)
    const pendingLeft = [...w.jobs.values()].filter((j) => j.status === 'pending').length
    expect(pendingLeft).toBeGreaterThanOrEqual(20 - r.claimed)
    // deferred jobs went back un-attempted
    for (const j of w.jobs.values()) if (j.failure_kind === 'budget_deferred') expect(j.status).toBe('pending')
  })

  it('budget overshoot is bounded: spend never exceeds the limit and reservations settle to zero', async () => {
    const { w, drain } = world({ n: 30, limit: 0.1, reserve: 0.01 })
    await drain({ concurrency: 6 })
    // actual cost ~0.0002 per call; reservations (0.01) gate admission, never more than limit/reserve at once
    expect(w.spent).toBeLessThanOrEqual(0.1 + 1e-9)
    expect(w.reserved).toBeCloseTo(0, 9)
    expect(w.maxInflight).toBeLessThanOrEqual(6)
  })

  it('a tight cap admits only what fits even with a full pool racing for the last slots', async () => {
    const { w, drain } = world({ n: 12, limit: 0.025, reserve: 0.01 })
    const r = await drain({ concurrency: 6 })
    expect(w.spent).toBeLessThanOrEqual(0.025 + 1e-9) // the pool racing for the last slots never overspends
    expect(r.processed + r.deferred).toBeGreaterThan(0)
    expect(w.reserved).toBeCloseTo(0, 9)
  })

  it('wall-clock budget stops new claims', async () => {
    const { w, drain } = world({ n: 40 })
    const r = await drain({ concurrency: 4, budgetMs: 15 })
    expect(r.stoppedBecause).toBe('time')
    expect(r.claimed).toBeLessThan(40)
    expect(w.inflight).toBe(0) // in-flight work was awaited, not abandoned
  })
})

describe('shared provider rate-limit backoff', () => {
  it('gate doubles per hit, caps, resets on success and is per provider', () => {
    let t = 1000
    const g = createRateLimitGate(() => t, 2000, 8000)
    expect(g.waitMs()).toBe(0)
    g.hit('anthropic'); expect(g.waitMs()).toBe(2000)
    t += 500; g.hit('anthropic'); expect(g.waitMs()).toBe(4000 - 0) // until = max(prev, now+4000)
    g.hit('anthropic'); g.hit('anthropic'); expect(g.waitMs()).toBeLessThanOrEqual(8000)
    g.ok('anthropic'); expect(g.waitMs()).toBe(0)
    g.hit('google'); g.ok('anthropic'); expect(g.waitMs()).toBe(2000)
  })

  it('processJob reports a 429 to the gate (not billed as success) and ok on success', async () => {
    const hits = [], oks = []
    const { deps, w } = world({ n: 2, script: { j00: new ProviderCallError('provider_http_error', 'HTTP 429', 429) } })
    deps.onProviderRateLimited = (p) => hits.push(p)
    deps.onProviderOk = (p) => oks.push(p)
    for (const j of w.jobs.values()) j.status = 'processing'
    const a = await processJob(deps, { ...w.jobs.get('j00') })
    const b = await processJob(deps, { ...w.jobs.get('j01') })
    expect([a, b]).toEqual(['failed', 'completed'])
    expect(hits).toEqual(['anthropic'])
    expect(oks).toEqual(['anthropic'])
    expect(w.jobs.get('j00').failure_kind).toBe('provider_rate_limited')
  })

  it('all workers wait out the cooldown before claiming, but never sleep past the time budget', async () => {
    const { w, drain } = world({ n: 8 })
    let cool = 50, slept = 0
    const r = await drain({ concurrency: 4, budgetMs: 100_000 }, {
      cooldownMs: () => cool, sleep: async (ms) => { slept += ms; cool = 0 }, nowMs: () => 0,
    })
    expect(slept).toBeGreaterThan(0)
    expect(r.processed).toBe(8)
    const t = world({ n: 4 })
    const r2 = await t.drain({ concurrency: 2, budgetMs: 100 }, { cooldownMs: () => 5000, sleep: async () => {}, nowMs: () => 0 })
    expect(r2.stoppedBecause).toBe('time')
    expect(r2.claimed).toBe(0)
  })
})

describe('photo reuse by content hash', () => {
  const HASH = 'a'.repeat(64)
  const source = { id: 'src-1', analysis: { assessable: true, reason: 'clear', recommendation: 'monitor', defects: [{ type: 'sidewall_cut', severity: 'moderate', description: 'cut', visibleEvidence: 'v' }], humanReviewRequired: true, flags: [], serving: { provider: 'anthropic', model: 'claude-haiku-5-5' } } }

  function reuseWorld(findReusable, sha = HASH) {
    const { deps, w } = world({ n: 1, hashFor: () => sha })
    deps.findReusable = findReusable
    const job = w.jobs.get('j00'); job.status = 'processing'
    return { deps, w, job }
  }

  it('copies the analysis with reusedFrom, cost 0, no provider call and no budget reservation', async () => {
    const seen = []
    const { deps, w, job } = reuseWorld(async (j, sha, pv) => { seen.push([j.organisation_id, sha, pv]); return source })
    const out = await processJob(deps, { ...job })
    expect(out).toBe('completed')
    expect(w.providerCalls).toHaveLength(0)
    expect(w.reserved).toBe(0); expect(w.spent).toBe(0)
    const j = w.jobs.get('j00')
    expect(j).toMatchObject({ status: 'completed', cost_usd: 0, input_tokens: 0, photo_content_sha256: HASH, prompt_version: PROMPT_VERSION })
    expect(j.analysis.reusedFrom).toBe('src-1')
    expect(j.analysis.defects).toHaveLength(1)
    expect(j.analysis.serving.reused).toBe(true)
    expect(seen).toEqual([['org-1', HASH, PROMPT_VERSION]]) // scoped to the job's own organisation
  })

  it('keeps pointing at the ORIGINAL when the source was itself a reuse', async () => {
    const { deps, w, job } = reuseWorld(async () => ({ id: 'copy-2', analysis: { ...source.analysis, reusedFrom: 'orig-0' } }))
    await processJob(deps, { ...job })
    expect(w.jobs.get('j00').analysis.reusedFrom).toBe('orig-0')
  })

  it('no match, lookup error, or photo without a hash falls through to a normal paid analysis', async () => {
    for (const find of [async () => null, async () => { throw new Error('db down') }]) {
      const { deps, w, job } = reuseWorld(find)
      expect(await processJob(deps, { ...job })).toBe('completed')
      expect(w.providerCalls).toHaveLength(1)
      expect(w.jobs.get('j00').photo_content_sha256).toBe(HASH) // recorded so LATER jobs can reuse it
      expect(w.jobs.get('j00').analysis.reusedFrom).toBeUndefined()
    }
    let asked = 0
    const { deps, w, job } = reuseWorld(async () => { asked++; return source }, '')
    await processJob(deps, { ...job })
    expect(asked).toBe(0); expect(w.providerCalls).toHaveLength(1)
  })

  it('never reuses across organisations (contract + edge function source)', () => {
    const edge = readFileSync(path.resolve(process.cwd(), 'supabase/functions/ai-tyre-inspection/index.ts'), 'utf8')
    const fn = edge.slice(edge.indexOf('findReusable: async'), edge.indexOf('onProviderRateLimited'))
    expect(fn).toMatch(/\.eq\("organisation_id", job\.organisation_id\)/)
    expect(fn).toMatch(/\.eq\("prompt_version", promptVersion\)/)
    expect(fn).toMatch(/\.eq\("status", "completed"\)/)
  })

  it('a deferral does not defer reuse bookkeeping: reuse runs before any reservation', async () => {
    const { deps, w, job } = reuseWorld(async () => source)
    deps.reserveBudget = async () => { throw new Error('must not reserve') }
    expect(await processJob(deps, { ...job })).toBe('completed')
    expect(w.providerCalls).toHaveLength(0)
  })
})

describe('worker kick + migration contract', () => {
  const edge = readFileSync(path.resolve(process.cwd(), 'supabase/functions/ai-tyre-inspection/index.ts'), 'utf8')
  const mig = readFileSync(path.resolve(process.cwd(), 'supabase/migrations/20261027110000_ai_tyre_content_hash_reuse_and_worker_kick.sql'), 'utf8')

  it('enqueue kicks the worker only after a successful enqueue, behind a lock and the existing secret', () => {
    const enq = edge.slice(edge.indexOf('async function enqueue'), edge.indexOf('async function backfill') > 0 ? edge.indexOf('/** Organization-bound') : undefined)
    expect(enq.indexOf('if (error) return fail')).toBeLessThan(enq.indexOf('triggerWorkerSoon()'))
    expect(edge).toMatch(/ai_tyre_try_acquire_worker_lock/)
    expect(edge).toMatch(/"x-worker-secret": secret/)
    expect(edge).toMatch(/EdgeRuntime/)
    expect(edge).toMatch(/KICK_DEBOUNCE_MS/)
    // work path auth is unchanged
    expect(edge).toMatch(/provided !== expected\) return fail\("Worker unauthorized",403\)/)
  })

  it('the new migration is additive, nullable, org-scoped and grants the lock only to service_role', () => {
    expect(mig).toMatch(/add column if not exists photo_content_sha256 text/)
    expect(mig).not.toMatch(/not null\s*check|photo_content_sha256 text not null/i)
    expect(mig).toMatch(/\(organisation_id, photo_content_sha256, prompt_version/)
    expect(mig).toMatch(/grant execute on function public\.ai_tyre_try_acquire_worker_lock\(int\) to service_role/)
    expect(mig.replace(/--.*$/gm, '')).not.toMatch(/\bdrop table|\bdelete from|\btruncate\b/i)
  })

  it('the drain call passes the clamped env concurrency', () => {
    expect(edge).toMatch(/concurrency: parseConcurrency\(env\("AI_WORKER_CONCURRENCY"\)\)/)
  })
})
