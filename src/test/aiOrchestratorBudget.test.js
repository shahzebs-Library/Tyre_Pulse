import { describe, it, expect } from 'vitest'
import {
  isSwitchedOff, costUsd, estimateReserveUsd, isMissingFunctionError, interpretReserve,
  shouldStopForBudget, buildSettleArgs,
} from '../../supabase/functions/ai-orchestrator/budget.ts'

const HAIKU = { in: 1.0, out: 5.0 }

describe('ai-orchestrator budget: isSwitchedOff', () => {
  it('treats false/0/off/no (any case, JSON-quoted) as off', () => {
    for (const v of ['false', 'FALSE', '0', 'off', 'No', '"false"', ' off ']) expect(isSwitchedOff(v), v).toBe(true)
  })
  it('treats missing, blank and anything else as on (the default)', () => {
    for (const v of [undefined, null, '', 'true', '1', 'yes', 'maybe']) expect(isSwitchedOff(v), String(v)).toBe(false)
  })
})

describe('ai-orchestrator budget: costUsd / estimateReserveUsd', () => {
  it('prices tokens per million and rounds to 6 dp', () => {
    expect(costUsd(HAIKU, 1_000_000, 0)).toBe(1)
    expect(costUsd(HAIKU, 1000, 200)).toBe(0.002)
    expect(costUsd(HAIKU, -5, NaN)).toBe(0)
  })
  it('reserves every round at its ceiling', () => {
    // 6 x (24000 * 1e-6 + 2000 * 5e-6) = 6 x 0.034 = 0.204
    expect(estimateReserveUsd({ rounds: 6, inputTokensPerRound: 24000, outputTokensPerRound: 2000, pricing: HAIKU })).toBeCloseTo(0.204, 6)
  })
  it('honours a positive env override and clamps to [0.01, 5]', () => {
    const base = { rounds: 6, inputTokensPerRound: 24000, outputTokensPerRound: 2000, pricing: HAIKU }
    expect(estimateReserveUsd({ ...base, override: '0.5' })).toBe(0.5)
    expect(estimateReserveUsd({ ...base, override: '99' })).toBe(5)
    expect(estimateReserveUsd({ ...base, override: '0.0001' })).toBe(0.01)
    // junk / non-positive override falls back to the computed estimate
    expect(estimateReserveUsd({ ...base, override: 'abc' })).toBeCloseTo(0.204, 6)
    expect(estimateReserveUsd({ ...base, override: '-1' })).toBeCloseTo(0.204, 6)
    expect(estimateReserveUsd({ ...base, override: '' })).toBeCloseTo(0.204, 6)
  })
})

describe('ai-orchestrator budget: isMissingFunctionError', () => {
  it('recognises PostgREST and Postgres missing-function errors', () => {
    expect(isMissingFunctionError({ code: 'PGRST202' })).toBe(true)
    expect(isMissingFunctionError({ code: '42883' })).toBe(true)
    expect(isMissingFunctionError({ message: 'Could not find the function public.ai_orchestrator_reserve_budget' })).toBe(true)
  })
  it('does not mistake other errors for a missing function', () => {
    expect(isMissingFunctionError({ code: '42501', message: 'permission denied' })).toBe(false)
    expect(isMissingFunctionError(null)).toBe(false)
    expect(isMissingFunctionError('boom')).toBe(false)
  })
})

describe('ai-orchestrator budget: interpretReserve (fail closed)', () => {
  const base = { attemptId: 'a-1', estimateUsd: 0.2 }
  it('reserved answer -> reserved mode with the server amount', () => {
    const r = interpretReserve({ ...base, data: { ok: true, attempt_id: 'a-1', reserved_usd: 0.2 }, error: null, capConfigured: true })
    expect(r).toEqual({ mode: 'reserved', attemptId: 'a-1', reservedUsd: 0.2 })
  })
  it('missing RPC with a cap configured -> 503 (cannot enforce the cap atomically)', () => {
    const r = interpretReserve({ ...base, data: null, error: { code: 'PGRST202' }, capConfigured: true })
    expect(r.mode).toBe('refuse')
    expect(r.httpStatus).toBe(503)
  })
  it('missing RPC with no cap -> legacy mode (nothing to overshoot)', () => {
    expect(interpretReserve({ ...base, data: null, error: { code: 'PGRST202' }, capConfigured: false })).toEqual({ mode: 'legacy' })
  })
  it('any other RPC error -> 503 even without a cap', () => {
    const r = interpretReserve({ ...base, data: null, error: { code: '57014', message: 'timeout' }, capConfigured: false })
    expect(r.mode).toBe('refuse')
    expect(r.httpStatus).toBe(503)
  })
  it('budget reached -> 402, disabled -> 403, unavailable/unknown -> 503', () => {
    expect(interpretReserve({ ...base, data: { ok: false, state: 'reached', reason: 'x' }, error: null, capConfigured: true }).httpStatus).toBe(402)
    expect(interpretReserve({ ...base, data: { ok: false, state: 'disabled' }, error: null, capConfigured: true }).httpStatus).toBe(403)
    expect(interpretReserve({ ...base, data: { ok: false, state: 'unavailable' }, error: null, capConfigured: true }).httpStatus).toBe(503)
    expect(interpretReserve({ ...base, data: { ok: false, state: 'reserved' }, error: null, capConfigured: true }).httpStatus).toBe(503)
  })
  it('a malformed answer is refused, never treated as ok', () => {
    expect(interpretReserve({ ...base, data: null, error: null, capConfigured: false }).mode).toBe('refuse')
    expect(interpretReserve({ ...base, data: 'ok', error: null, capConfigured: false }).mode).toBe('refuse')
  })
  it('never echoes the server reason as the user message (no internals leak)', () => {
    const r = interpretReserve({ ...base, data: { ok: false, state: 'reached', reason: 'Monthly AI budget reached (19.90 of 20.00 USD)' }, error: null, capConfigured: true })
    expect(r.userMessage).not.toContain('19.90')
    expect(r.detail).toContain('19.90')
  })
})

describe('ai-orchestrator budget: shouldStopForBudget', () => {
  it('stops when the next worst-case round would pass the reservation', () => {
    // next round = (20000 + 6000) * 1e-6 + 2000 * 5e-6 = 0.036
    expect(shouldStopForBudget({ spentUsd: 0.17, reservedUsd: 0.2, lastInputTokens: 20000, maxOutputTokens: 2000, pricing: HAIKU })).toBe(true)
    expect(shouldStopForBudget({ spentUsd: 0.1, reservedUsd: 0.2, lastInputTokens: 20000, maxOutputTokens: 2000, pricing: HAIKU })).toBe(false)
  })
  it('never stops when there is no reservation (legacy mode)', () => {
    expect(shouldStopForBudget({ spentUsd: 99, reservedUsd: 0, lastInputTokens: 1, maxOutputTokens: 1, pricing: HAIKU })).toBe(false)
  })
})

describe('ai-orchestrator budget: buildSettleArgs', () => {
  const base = { attemptId: 'a-1', model: 'claude-haiku-4-5', pricing: HAIKU, inputTokens: 1000, outputTokens: 200 }
  it('success records the known cost', () => {
    const a = buildSettleArgs({ ...base, ok: true, providerCalled: true, latencyMs: 900 })
    expect(a).toMatchObject({ p_outcome: 'success', p_actual_usd: 0.002, p_cost_known: true, p_http_status: 200, p_latency_ms: 900 })
  })
  it('failure before any provider request is released (nothing billed)', () => {
    const a = buildSettleArgs({ ...base, ok: false, providerCalled: false, inputTokens: 0, outputTokens: 0, error: 'Conversation not found' })
    expect(a).toMatchObject({ p_outcome: 'released', p_actual_usd: 0, p_cost_known: true })
  })
  it('failure after a provider request is an error with cost UNKNOWN, keeping the partial known cost', () => {
    const a = buildSettleArgs({ ...base, ok: false, providerCalled: true, httpStatus: 502, error: 'Upstream 529' })
    expect(a).toMatchObject({ p_outcome: 'error', p_actual_usd: 0.002, p_cost_known: false, p_http_status: 502, p_error: 'Upstream 529' })
  })
  it('truncates long errors and floors token counts', () => {
    const a = buildSettleArgs({ ...base, ok: false, providerCalled: true, error: 'x'.repeat(900), inputTokens: 10.7, outputTokens: -3 })
    expect(a.p_error).toHaveLength(500)
    expect(a.p_prompt_tokens).toBe(10)
    expect(a.p_completion_tokens).toBe(0)
  })
})
