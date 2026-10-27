import { describe, it, expect } from 'vitest'
import {
  processJob, ProviderCallError, canRetry, photoQualityFlags, imageDimensions, modelQualityFlags,
  consistencyFlags, callWithFallback, isFallbackable, parseModelOutput, isRateLimitStatus,
} from '../../supabase/functions/ai-tyre-inspection/logic.ts'
import { sumMonthSpend } from '../../supabase/functions/ai-tyre-inspection/budget.ts'
import { readFileSync } from 'node:fs'

const good = (extra = {}) => JSON.stringify({ assessable: true, reason: 'ok', recommendation: 'x', defects: [], ...extra })
const HAIKU = { input: 0.10, output: 0.50 }
const GEM = { input: 0.10, output: 0.40 }

function harness({ photo = { mediaType: 'image/jpeg', base64: 'AA==', bytes: 200000, width: 1600, height: 1200 }, call, reserveResult = { ok: true }, previous = null } = {}) {
  const state = { job: { id: 'j1', organisation_id: 'o', photo_ref: 'tp-storage://b/p.jpg', attempts: 0, status: 'processing' }, logs: [], reserves: 0 }
  const deps = {
    config: { providerName: 'anthropic', model: 'claude-haiku-5-5', rates: HAIKU, reserveUsd: 0.01, dailyLimitUsd: 1, monthlyLimitUsd: 50 },
    ratesFor: (n) => (n === 'google' ? GEM : HAIKU),
    now: () => new Date('2026-10-26T08:00:00Z'),
    updateJob: async (_id, patch, from) => { if (state.job.status !== from) return false; Object.assign(state.job, patch); return true },
    insertTokenLog: async (r) => { state.logs.push(r) },
    reserveBudget: async (...a) => { state.reserves++; state.args = a; return reserveResult },
    settleBudget: async () => {},
    loadPhoto: async () => photo,
    callProvider: call ?? (async () => ({ provider: { usage: { input_tokens: 1000, output_tokens: 100 } }, output: good() })),
    loadPrevious: async () => previous,
  }
  return { state, deps }
}

describe('admin retry role + helpers', () => {
  it('only admin, manager, director may retry', () => {
    expect(['Admin', 'manager', 'DIRECTOR'].map(canRetry)).toEqual([true, true, true])
    expect(['Tyre Man', 'Maintenance Supervisor', 'PMV Manager', '', null].map(canRetry)).toEqual([false, false, false, false, false])
  })
  it('rate-limit statuses are retry safe, 529 and 401 keep the legacy kind', () => {
    expect([429, 500, 503].every(isRateLimitStatus)).toBe(true)
    expect([401, 529, 400].some(isRateLimitStatus)).toBe(false)
  })
})

describe('photo quality (pre-spend, pure)', () => {
  it('blocks tiny photos, warns on low resolution and low detail', () => {
    expect(photoQualityFlags({ bytes: 5000, width: 100, height: 100, mediaType: 'image/jpeg' }).block).toBe(true)
    const low = photoQualityFlags({ bytes: 90000, width: 400, height: 300, mediaType: 'image/jpeg' })
    expect(low.block).toBe(false)
    expect(low.flags.map(f => f.code)).toContain('low_resolution')
    const flat = photoQualityFlags({ bytes: 20000, width: 1600, height: 1200, mediaType: 'image/jpeg' })
    expect(flat.flags.map(f => f.code)).toEqual(['low_detail'])
    expect(photoQualityFlags({ bytes: 300000, width: 1600, height: 1200, mediaType: 'image/jpeg' }).flags).toEqual([])
  })
  it('unknown metadata never blocks', () => {
    expect(photoQualityFlags({}).block).toBe(false)
  })
  it('reads PNG and JPEG dimensions, null for junk', () => {
    const png = new Uint8Array(33); png.set([0x89, 0x50, 0x4e, 0x47]); new DataView(png.buffer).setUint32(16, 640); new DataView(png.buffer).setUint32(20, 480)
    expect(imageDimensions(png)).toEqual({ width: 640, height: 480 })
    const jpg = new Uint8Array([0xff, 0xd8, 0xff, 0xc0, 0, 17, 8, 0x04, 0xb0, 0x06, 0x40, 3, 0, 0, 0, 0, 0, 0, 0, 0])
    expect(imageDimensions(jpg)).toEqual({ width: 1600, height: 1200 })
    expect(imageDimensions(new Uint8Array([1, 2, 3]))).toBeNull()
  })
  it('a tiny photo fails as photo_unusable with no reservation and no provider call', async () => {
    let called = 0
    const h = harness({ photo: { mediaType: 'image/jpeg', base64: 'AA==', bytes: 3000, width: 80, height: 80 }, call: async () => { called++ } })
    expect(await processJob(h.deps, h.state.job)).toBe('failed')
    expect(h.state.job).toMatchObject({ status: 'failed', failure_kind: 'photo_unusable' })
    expect(h.state.reserves).toBe(0)
    expect(called).toBe(0)
  })
})

describe('model quality + consistency flags stored on the result', () => {
  it('parses the model imageQuality and flags blurry / dark / wrong subject', () => {
    const a = parseModelOutput(good({ imageQuality: { focus: 'blurry', lighting: 'dark', subject: 'not_tyre' } }))
    expect(modelQualityFlags(a).map(f => f.code)).toEqual(['blurry', 'too_dark', 'wrong_subject'])
    expect(modelQualityFlags(parseModelOutput(good()))).toEqual([])
  })
  it('flags a clean reading after a previous severe, non-healing defect', () => {
    const prev = { analysis: { assessable: true, defects: [{ type: 'bulge', severity: 'high' }] } }
    expect(consistencyFlags({ assessable: true, defects: [] }, prev).map(f => f.code)).toEqual(['contradicts_previous'])
    expect(consistencyFlags({ assessable: true, defects: [{ type: 'bulge' }] }, prev)).toEqual([])
    expect(consistencyFlags({ assessable: true, defects: [] }, null)).toEqual([])
    expect(consistencyFlags({ assessable: true, defects: [{ type: 'cracking', severity: 'urgent' }] },
      { analysis: { assessable: true, defects: [] } }).map(f => f.code)).toEqual(['new_severe_defect'])
  })
  it('completed job carries flags and the serving provider', async () => {
    const out = good({ imageQuality: { focus: 'blurry' } })
    const h = harness({
      call: async () => ({ provider: { usage: { input_tokens: 1000, output_tokens: 100 } }, output: out }),
      previous: { analysis: { assessable: true, defects: [{ type: 'sidewall_cut', severity: 'urgent' }] } },
    })
    expect(await processJob(h.deps, h.state.job)).toBe('completed')
    const a = h.state.job.analysis
    expect(a.flags.map(f => f.code).sort()).toEqual(['blurry', 'contradicts_previous'])
    expect(a.serving).toEqual({ provider: 'anthropic', model: 'claude-haiku-5-5' })
  })
})

describe('provider fallback', () => {
  const attempt = (name, fn) => ({ providerName: name, model: name + '-m', call: fn })
  const photo = { mediaType: 'image/jpeg', base64: 'AA==' }
  it('falls back on timeout / 429 / 5xx and records the primary failure', async () => {
    const r = await callWithFallback([
      attempt('anthropic', async () => { throw new ProviderCallError('provider_http_error', 'x', 503) }),
      attempt('google', async () => ({ provider: {}, output: 'ok' })),
    ], photo)
    expect(r.served).toEqual({ providerName: 'google', model: 'google-m' })
    expect(r.fallbackFrom).toMatchObject({ providerName: 'anthropic', kind: 'provider_http_error' })
  })
  it('does not fall back on auth errors or bad bodies, and throws when all fail', async () => {
    expect(isFallbackable(new ProviderCallError('provider_http_error', 'x', 401))).toBe(false)
    expect(isFallbackable(new ProviderCallError('provider_non_json', 'x'))).toBe(false)
    let second = 0
    await expect(callWithFallback([
      attempt('a', async () => { throw new ProviderCallError('provider_http_error', 'x', 401) }),
      attempt('b', async () => { second++ }),
    ], photo)).rejects.toThrow()
    expect(second).toBe(0)
    await expect(callWithFallback([
      attempt('a', async () => { throw new ProviderCallError('provider_timeout', 't') }),
      attempt('b', async () => { throw new ProviderCallError('provider_timeout', 't2') }),
    ], photo)).rejects.toThrow('t2')
  })
  it('job served by the fallback is priced at the fallback rates and records it', async () => {
    const h = harness({ call: async () => ({ provider: { usageMetadata: { promptTokenCount: 1000000, candidatesTokenCount: 1000000 } }, output: good(),
      served: { providerName: 'google', model: 'gemini-2.5-flash-lite' }, fallbackFrom: { providerName: 'anthropic', model: 'claude-haiku-5-5', kind: 'provider_timeout' } }) })
    await processJob(h.deps, h.state.job)
    expect(h.state.job).toMatchObject({ status: 'completed', provider: 'google', model_version: 'gemini-2.5-flash-lite' })
    expect(h.state.job.cost_usd).toBeCloseTo(0.5, 6)
    expect(h.state.job.analysis.serving.fallbackFrom.kind).toBe('provider_timeout')
  })
})

describe('failure classification for retry', () => {
  it('429/5xx become provider_rate_limited (retry safe); timeout stays billable-unknown', async () => {
    const a = harness({ call: async () => { throw new ProviderCallError('provider_http_error', 'HTTP 503', 503) } })
    await processJob(a.deps, a.state.job)
    expect(a.state.job.failure_kind).toBe('provider_rate_limited')
    const b = harness({ call: async () => { throw new ProviderCallError('provider_timeout', 't') } })
    await processJob(b.deps, b.state.job)
    expect(b.state.job.failure_kind).toBe('provider_timeout')
  })
  it('a monthly-scoped reservation refusal defers with monthly_budget_reached and passes the monthly limit', async () => {
    const h = harness({ reserveResult: { ok: false, scope: 'monthly', reason: 'Monthly AI budget reached' } })
    expect(await processJob(h.deps, h.state.job)).toBe('deferred')
    expect(h.state.job).toMatchObject({ status: 'pending', failure_kind: 'monthly_budget_reached' })
    expect(h.state.args[4]).toBe(50)
  })
  it('prior billed spend from a forced re-queue stays in the month ledger', () => {
    expect(sumMonthSpend([], [{ prior_billed_usd: 0.02, provider_called_at: null }], 0.01)).toBeCloseTo(0.02, 6)
  })
})

describe('migration contract', () => {
  const sql = readFileSync('supabase/migrations/20261026090000_ai_tyre_atomic_month_budget_and_retry.sql', 'utf8')
  it('serialises the month decision, fails closed, and is service_role only', () => {
    expect(sql).toMatch(/pg_advisory_xact_lock/)
    expect(sql).toMatch(/revoke all on function public\.ai_tyre_requeue_jobs[^;]*from anon, authenticated/)
    expect(sql).toMatch(/grant execute on function public\.ai_tyre_auto_requeue[^;]*to service_role/)
    expect(sql).not.toMatch(/\bdelete from\b/i)
  })
  it('auto-retry only covers kinds that cannot have been billed', () => {
    expect(sql).toMatch(/failure_kind in \('photo_unavailable', 'provider_rate_limited'\)/)
  })
})
