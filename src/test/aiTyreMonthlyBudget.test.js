import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import {
  parseAiControls, monthStartUtc, sumMonthSpend, evaluateMonthlyBudget,
} from '../../supabase/functions/ai-tyre-inspection/budget.ts'
import { processJob } from '../../supabase/functions/ai-tyre-inspection/logic.ts'
import { parseConfigValue, CONFIG_DEFAULTS } from '../lib/api/systemConfig'

const rows = (o) => Object.entries(o).map(([key, value]) => ({ key, value }))

describe('parseAiControls', () => {
  it('reads the limit and the master switch from system_config rows', () => {
    expect(parseAiControls(rows({ ai_monthly_budget_usd: '25', ai_enabled: 'true' }))).toEqual({ enabled: true, limitUsd: 25, invalidLimit: false })
    expect(parseAiControls(rows({ ai_monthly_budget_usd: '"12.5"' })).limitUsd).toBe(12.5)   // JSON-quoted value
    expect(parseAiControls(rows({ ai_enabled: 'off' })).enabled).toBe(false)
  })
  it('treats unset / 0 as uncapped (the documented default) but junk as INVALID, never silently uncapped', () => {
    expect(parseAiControls([])).toEqual({ enabled: true, limitUsd: 0, invalidLimit: false })
    expect(parseAiControls(rows({ ai_monthly_budget_usd: '0' })).limitUsd).toBe(0)
    expect(parseAiControls(rows({ ai_monthly_budget_usd: 'abc' })).invalidLimit).toBe(true)
    expect(parseAiControls(rows({ ai_monthly_budget_usd: '-5' })).invalidLimit).toBe(true)
    expect(parseAiControls(null).invalidLimit).toBe(false)
  })
  it('agrees with the client-side system_config defaults (0 = no cap)', () => {
    expect(CONFIG_DEFAULTS.ai_monthly_budget_usd).toBe(0)
    expect(parseConfigValue('50')).toBe(50)
  })
})

describe('monthStartUtc / sumMonthSpend', () => {
  it('uses the first instant of the UTC month', () => {
    expect(monthStartUtc(new Date('2026-10-31T23:59:59Z')).toISOString()).toBe('2026-10-01T00:00:00.000Z')
    expect(monthStartUtc(new Date('2026-01-01T00:00:00Z')).toISOString()).toBe('2026-01-01T00:00:00.000Z')
  })
  it('sums both ledgers without double counting and charges unknown tyre calls at the reservation, never zero', () => {
    const logs = [
      { cost_usd: 1.25, feature: 'chat', status: 'success' },
      { cost_usd: null, feature: 'chat', status: 'error' },                       // not ours: 0 like chat-ai
      { cost_usd: 0.0002, feature: 'ai_tyre_inspection', status: 'error' },       // also in jobs: must NOT count twice
      { cost_usd: 0, feature: 'ai_tyre_inspection', status: 'blocked' },
    ]
    const jobs = [
      { cost_usd: '0.5', provider_called_at: '2026-10-02T00:00:00Z' },            // successful call: only in the jobs ledger
      { cost_usd: 0.0002, provider_called_at: '2026-10-03T00:00:00Z' },           // failed but metered: counted once
      { cost_usd: null, provider_called_at: '2026-10-04T00:00:00Z' },             // usage unknown, may be billed
      { cost_usd: null, provider_called_at: null },                               // never reached the provider
    ]
    expect(sumMonthSpend(logs, jobs, 0.01)).toBe(1.7602)
  })
  it('returns null (unknown) when a cost value is corrupt, so a bad row cannot read as a low total', () => {
    expect(sumMonthSpend([{ cost_usd: 'NaN-ish', feature: 'chat' }], [], 0.01)).toBeNull()
    expect(sumMonthSpend([{ cost_usd: -1, feature: 'chat' }], [], 0.01)).toBeNull()
    expect(sumMonthSpend([], [{ cost_usd: 'x', provider_called_at: 'y' }], 0.01)).toBeNull()
    expect(sumMonthSpend([], [], 0.01)).toBe(0)
    expect(sumMonthSpend(null, null, 0.01)).toBe(0)
  })
})

describe('evaluateMonthlyBudget (hard cap)', () => {
  const on = (limitUsd) => ({ enabled: true, limitUsd, invalidLimit: false })
  it('allows an uncapped month without needing the spend total', () => {
    expect(evaluateMonthlyBudget({ controls: on(0), spentUsd: null, reserveUsd: 0.01 })).toMatchObject({ allowed: true, state: 'uncapped' })
  })
  it('allows while spend plus the per-call reservation stays within the limit', () => {
    expect(evaluateMonthlyBudget({ controls: on(10), spentUsd: 9.98, reserveUsd: 0.01 })).toMatchObject({ allowed: true, state: 'ok' })
    expect(evaluateMonthlyBudget({ controls: on(10), spentUsd: 9.99, reserveUsd: 0.01 }).allowed).toBe(true)   // exactly at the limit
  })
  it('refuses BEFORE the limit would be exceeded (stricter than chat-ai, which waits for spent >= limit)', () => {
    const d = evaluateMonthlyBudget({ controls: on(10), spentUsd: 9.995, reserveUsd: 0.01 })
    expect(d).toMatchObject({ allowed: false, state: 'reached', limitUsd: 10, spentUsd: 9.995 })
    expect(d.reason).toMatch(/Monthly AI budget reached/)
    expect(evaluateMonthlyBudget({ controls: on(10), spentUsd: 12, reserveUsd: 0.01 }).state).toBe('reached')
  })
  it('fails CLOSED when controls or spend are unreadable, the setting is invalid, or AI is off', () => {
    expect(evaluateMonthlyBudget({ controls: null, spentUsd: 0, reserveUsd: 0.01 })).toMatchObject({ allowed: false, state: 'unavailable' })
    expect(evaluateMonthlyBudget({ controls: on(10), spentUsd: null, reserveUsd: 0.01 })).toMatchObject({ allowed: false, state: 'unavailable' })
    expect(evaluateMonthlyBudget({ controls: on(10), spentUsd: NaN, reserveUsd: 0.01 }).allowed).toBe(false)
    expect(evaluateMonthlyBudget({ controls: { enabled: true, limitUsd: 0, invalidLimit: true }, spentUsd: 0, reserveUsd: 0.01 })).toMatchObject({ allowed: false, state: 'unavailable' })
    expect(evaluateMonthlyBudget({ controls: { enabled: false, limitUsd: 10, invalidLimit: false }, spentUsd: 0, reserveUsd: 0.01 })).toMatchObject({ allowed: false, state: 'disabled' })
  })
})

describe('processJob honours the monthly cap', () => {
  const GOOD = JSON.stringify({ assessable: true, reason: 'ok', recommendation: 'monitor', defects: [] })
  function setup(decide) {
    const s = { job: { id: 'j1', organisation_id: 'o', photo_ref: 'tp-storage://b/p.jpg', attempts: 0, status: 'processing' }, logs: [], provider: 0, loads: 0, reserved: 0 }
    const deps = {
      config: { providerName: 'anthropic', model: 'claude-haiku-5-5', rates: { input: 0.1, output: 0.5 }, reserveUsd: 0.01, dailyLimitUsd: 1 },
      now: () => new Date('2026-10-25T08:00:00Z'),
      updateJob: async (_id, patch, from) => { if (s.job.status !== from) return false; Object.assign(s.job, patch); return true },
      insertTokenLog: async (row) => { s.logs.push(row) },
      checkMonthlyBudget: decide,
      reserveBudget: async () => { s.reserved++; return { ok: true } },
      settleBudget: async () => {},
      loadPhoto: async () => { s.loads++; return { mediaType: 'image/jpeg', base64: 'AA==' } },
      callProvider: async () => { s.provider++; return { provider: { usage: { input_tokens: 100, output_tokens: 50 } }, output: GOOD } },
    }
    return { s, deps }
  }
  const verdict = (o) => ({ limitUsd: 10, spentUsd: 10, reason: 'x', ...o })

  it('stops cleanly when the cap is reached: no download, no reservation, no provider call, job back to pending', async () => {
    const { s, deps } = setup(async () => verdict({ allowed: false, state: 'reached', reason: 'Monthly AI budget reached (10.00 of 10.00 USD)' }))
    expect(await processJob(deps, s.job)).toBe('deferred')
    expect(s.provider).toBe(0); expect(s.loads).toBe(0); expect(s.reserved).toBe(0)
    expect(s.job).toMatchObject({ status: 'pending', attempts: 0, failure_kind: 'monthly_budget_reached' })
    expect(s.job.error_message).toMatch(/Monthly AI budget reached/)
    expect(s.logs).toHaveLength(1)
    expect(s.logs[0]).toMatchObject({ feature: 'ai_tyre_inspection', status: 'blocked', cost_usd: 0 })
    expect(s.logs[0].error).toMatch(/^reached:/)
  })

  it('fails closed when the budget check throws', async () => {
    const { s, deps } = setup(async () => { throw new Error('db down') })
    expect(await processJob(deps, s.job)).toBe('deferred')
    expect(s.provider).toBe(0)
    expect(s.job.failure_kind).toBe('monthly_budget_reached')
    expect(s.logs[0].error).toMatch(/^unavailable:/)
  })

  it('does not break the run if writing the blocked log fails', async () => {
    const { s, deps } = setup(async () => verdict({ allowed: false, state: 'reached' }))
    deps.insertTokenLog = async () => { throw new Error('log down') }
    expect(await processJob(deps, s.job)).toBe('deferred')
    expect(s.job.status).toBe('pending')
  })

  it('proceeds normally when allowed, and is optional so existing callers are unchanged', async () => {
    const ok = setup(async () => verdict({ allowed: true, state: 'ok' }))
    expect(await processJob(ok.deps, ok.s.job)).toBe('completed')
    expect(ok.s.provider).toBe(1)
    const legacy = setup(undefined)
    delete legacy.deps.checkMonthlyBudget
    expect(await processJob(legacy.deps, legacy.s.job)).toBe('completed')
  })

  it('never lets a prior-attempt job reach the budget check (no spend path at all)', async () => {
    let checks = 0
    const { s, deps } = setup(async () => { checks++; return verdict({ allowed: true, state: 'ok' }) })
    s.job.attempts = 1
    expect(await processJob(deps, s.job)).toBe('skipped_prior_attempt')
    expect(checks).toBe(0)
  })
})

describe('wiring in the edge function source', () => {
  const src = readFileSync(path.resolve(__dirname, '../../supabase/functions/ai-tyre-inspection/index.ts'), 'utf8')
  it('reads the cap from system_config and pages month spend (PostgREST truncates plain selects at 1000)', () => {
    expect(src).toMatch(/from\("system_config"\)\.select\("key,value"\)/)
    expect(src).toMatch(/"ai_enabled",\s*"ai_monthly_budget_usd"/)
    expect(src).toMatch(/from\("ai_token_logs"\)\.select\("id,cost_usd,feature,status"\)/)
    expect(src).toMatch(/from\("ai_tyre_inspection_jobs"\)\.select\("id,cost_usd,provider_called_at"\)/)
    expect(src).toMatch(/\.range\(f, t\)/)
  })
  it('runs a pre-flight check before claiming any job and passes the check into the job deps', () => {
    const work = src.slice(src.indexOf('async function work'))
    expect(work.indexOf('monthlyBudgetDecision(reserveUsd)')).toBeGreaterThan(-1)
    expect(work.indexOf('monthlyBudgetDecision(reserveUsd)')).toBeLessThan(work.indexOf('drainQueue('))
    expect(work).toMatch(/stoppedBecause: "monthly_budget"/)
    expect(work).toMatch(/checkMonthlyBudget:/)
    expect(work).toMatch(/budget: lastBudget/)
  })
  it('every unreadable-spend path resolves to the fail-closed decision', () => {
    const fn = src.slice(src.indexOf('async function monthlyBudgetDecision'), src.indexOf('const PROMPT'))
    expect(fn).toMatch(/catch \{\s*return evaluateMonthlyBudget\(\{ controls: null/)
    expect(fn).toMatch(/MAX_PAGES/)
    expect(fn).toMatch(/if \(!logs \|\| !jobs\) return evaluateMonthlyBudget\(\{ controls, spentUsd: null/)
  })
})
