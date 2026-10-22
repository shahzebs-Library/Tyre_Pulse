import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { drainQueue, DEFAULT_DRAIN } from '../../supabase/functions/ai-tyre-inspection/logic.ts'

/** In-memory queue: pending jobs, claim races and an injectable clock. */
function queue(n, { outcomeFor = () => 'completed', lose = new Set(), clockStep = 0 } = {}) {
  const pending = Array.from({ length: n }, (_, i) => ({ id: `j${i}`, organisation_id: 'o', photo_ref: 'p', attempts: 0 }))
  const state = { processed: [], fetches: 0, t: 0 }
  const deps = {
    fetchBatch: async (k) => { state.fetches++; return pending.slice(0, k).map(j => ({ ...j })) },
    claim: async (job) => {
      if (lose.has(job.id)) { pending.splice(pending.findIndex(p => p.id === job.id), 1); return false }
      const i = pending.findIndex(p => p.id === job.id)
      if (i < 0) return false
      return true
    },
    process: async (job) => {
      const out = outcomeFor(job)
      state.processed.push(job.id)
      // completed/failed/skipped jobs leave the pending set; deferred ones go back un-attempted
      if (out !== 'deferred') pending.splice(pending.findIndex(p => p.id === job.id), 1)
      state.t += clockStep
      return out
    },
    nowMs: () => state.t,
  }
  return { deps, state, pending }
}

describe('queue draining', () => {
  it('drains a backlog larger than one batch in a single run (18 pending, batches of 4)', async () => {
    const { deps, state, pending } = queue(18)
    const r = await drainQueue(deps)
    expect(r).toMatchObject({ processed: 18, claimed: 18, batches: 5, stoppedBecause: 'empty' })
    expect(pending).toHaveLength(0)
    expect(new Set(state.processed).size).toBe(18) // every job exactly once
  })

  it('stops at the batch cap and leaves the rest for the next run', async () => {
    const { deps, pending } = queue(100)
    const r = await drainQueue(deps, { batchSize: 4, maxBatches: 3 })
    expect(r.processed).toBe(12)
    expect(r.stoppedBecause).toBe('batches')
    expect(pending).toHaveLength(88)
  })

  it('stops when the daily budget defers a job, with no further provider work', async () => {
    const { deps, state } = queue(10, { outcomeFor: (j) => (j.id === 'j5' ? 'deferred' : 'completed') })
    const r = await drainQueue(deps)
    expect(r).toMatchObject({ processed: 5, deferred: 1, stoppedBecause: 'deferred' })
    expect(state.processed).toEqual(['j0', 'j1', 'j2', 'j3', 'j4', 'j5'])
  })

  it('respects the wall-clock budget before starting each job', async () => {
    const { deps, state } = queue(20, { clockStep: 10_000 })
    const r = await drainQueue(deps, { budgetMs: 35_000 })
    expect(r.stoppedBecause).toBe('time')
    expect(state.processed).toHaveLength(4) // t=0,10k,20k,30k start; 40k >= 35k stops
  })

  it('counts failed and prior-attempt jobs and never re-processes them', async () => {
    const { deps, state } = queue(6, { outcomeFor: (j) => (j.id === 'j1' ? 'failed' : j.id === 'j2' ? 'skipped_prior_attempt' : 'completed') })
    const r = await drainQueue(deps)
    expect(r).toMatchObject({ processed: 4, failed: 1, skipped: 1, claimed: 6 })
    expect(state.processed.filter(id => id === 'j1')).toHaveLength(1)
  })

  it('does not spin when other workers claim every job in a batch', async () => {
    // Another worker took the whole batch: stop (it is being handled) rather than refetch in a loop.
    const { deps, state } = queue(8, { lose: new Set(['j0', 'j1', 'j2', 'j3']) })
    const r = await drainQueue(deps)
    expect(r).toMatchObject({ processed: 0, claimed: 0, batches: 1, stoppedBecause: 'no_progress' })
    // A partly lost batch keeps going.
    const part = queue(8, { lose: new Set(['j1']) })
    expect((await drainQueue(part.deps)).processed).toBe(7)
    // Permanent claim failure never loops forever.
    const stuck = queue(4)
    stuck.deps.claim = async () => false
    expect((await drainQueue(stuck.deps)).stoppedBecause).toBe('no_progress')
    expect(state.fetches).toBe(1)
  })

  it('a queue read failure stops the run without throwing', async () => {
    const r = await drainQueue({ fetchBatch: async () => { throw new Error('db') }, claim: async () => true, process: async () => 'completed', nowMs: () => 0 })
    expect(r).toMatchObject({ batches: 0, stoppedBecause: 'queue_error' })
  })

  it('an empty queue is a clean no-op', async () => {
    const r = await drainQueue(queue(0).deps)
    expect(r).toMatchObject({ processed: 0, batches: 0, stoppedBecause: 'empty' })
    expect(DEFAULT_DRAIN.batchSize).toBe(4)
  })
})

describe('worker wiring', () => {
  it('index.ts drains through drainQueue with claim-before-process and keeps the reaper first', () => {
    const src = readFileSync(path.resolve(process.cwd(), 'supabase/functions/ai-tyre-inspection/index.ts'), 'utf8')
    expect(src).toMatch(/drainQueue\(/)
    expect(src).toMatch(/eq\("status","pending"\)\.select\("id"\)\.maybeSingle\(\)/)
    expect(src.indexOf('ai_tyre_fail_stale_processing')).toBeLessThan(src.indexOf('drainQueue('))
    expect(src).not.toMatch(/\.limit\(4\);\s*\n\s*if \(error\) return fail\("Queue unavailable"/)
  })
})
