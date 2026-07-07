import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock the chat-ai client path (lib/api/uploads → supabase.functions.invoke)
const h = vi.hoisted(() => ({ invoke: vi.fn() }))
vi.mock('../lib/api/uploads', () => ({ invokeChatAI: h.invoke }))

import {
  clip, digestLines, capList, scalarDigest,
  COPILOT_TASKS, runCopilotTask, clearCopilotCache, copilotCacheKey,
  LIST_CAP, TEXT_CAP, COPILOT_MODEL, COPILOT_MAX_TOKENS,
} from '../lib/aiCopilot'

beforeEach(() => {
  h.invoke.mockReset()
  clearCopilotCache()
})

describe('digest helpers', () => {
  it('clip truncates and collapses whitespace', () => {
    expect(clip('  a   b  ')).toBe('a b')
    expect(clip('x'.repeat(TEXT_CAP + 50)).length).toBe(TEXT_CAP)
    expect(clip(null)).toBe('')
  })

  it('digestLines skips empty values', () => {
    expect(digestLines([['A', 'x'], ['B', ''], ['C', null], ['D', 0]])).toBe('A: x\nD: 0')
  })

  it('capList caps and counts omissions', () => {
    const { items, omitted } = capList(Array.from({ length: LIST_CAP + 5 }))
    expect(items.length).toBe(LIST_CAP)
    expect(omitted).toBe(5)
  })

  it('scalarDigest never emits nested objects or arrays (no full-row dumps)', () => {
    const out = scalarDigest({
      asset_no: 'A-1', qty: 2, nested: { a: 1 }, list: [1, 2], ok: true, empty: '',
    })
    expect(out).toContain('asset no: A-1')
    expect(out).toContain('qty: 2')
    expect(out).toContain('ok: true')
    expect(out).not.toContain('nested')
    expect(out).not.toContain('list')
    expect(out).not.toContain('[object')
  })
})

describe('prompt builders', () => {
  it('summarize_accident selects whitelisted fields only and caps lists', () => {
    const remarks = Array.from({ length: 30 }, (_, i) => ({ remark: `r${i}`, remark_type: 'note' }))
    const { system, user } = COPILOT_TASKS.summarize_accident.buildPrompt({
      accident: {
        asset_no: 'T-9', severity: 'Major', repair_cost: 5000, parts_cost: 1000,
        secret_internal_column: 'DO-NOT-SEND',
      },
      remarks,
      parts: [{ part_name: 'Bumper', quantity: 2, total_cost: 300 }],
    })
    expect(system).toContain('**Observation**')
    expect(user).toContain('Asset: T-9')
    expect(user).toContain('Gross cost: 6,000')
    expect(user).toContain('Bumper')
    expect(user).toContain(`+${30 - LIST_CAP} more entries omitted`)
    expect(user).not.toContain('DO-NOT-SEND')
  })

  it('assess_vehicle_tyres reports per-position lines with km life', () => {
    const { user } = COPILOT_TASKS.assess_vehicle_tyres.buildPrompt({
      vehicle: { asset_no: 'V-1', make: 'Volvo', expected_km_per_tyre: 80000 },
      tyres: [{ position: 'FL', brand: 'Michelin', size: '315/80R22.5', km_at_fitment: 1000, km_at_removal: 51000, risk_level: 'High' }],
      metrics: { total: 10, spend: 12345, critical: 1 },
    })
    expect(user).toContain('pos FL')
    expect(user).toContain('50,000 km')
    expect(user).toContain('risk High')
    expect(user).toContain('Expected km per tyre: 80000')
  })

  it('every task produces non-empty system+user strings', () => {
    for (const [key, task] of Object.entries(COPILOT_TASKS)) {
      const { system, user } = task.buildPrompt({})
      expect(system.length, key).toBeGreaterThan(50)
      expect(typeof user, key).toBe('string')
    }
  })
})

describe('runCopilotTask', () => {
  it('calls the chat-ai contract and returns text', async () => {
    h.invoke.mockResolvedValue({ data: { content: 'insight' } })
    const res = await runCopilotTask('draft_action_plan', { record: { id: 1 }, recordType: 'tyre' })
    expect(res).toEqual({ text: 'insight', cached: false })
    const body = h.invoke.mock.calls[0][0]
    expect(body.model).toBe(COPILOT_MODEL)
    expect(body.max_tokens).toBe(COPILOT_MAX_TOKENS)
    expect(typeof body.system).toBe('string')
    expect(typeof body.user).toBe('string')
  })

  it('caches per record version and bypasses on regenerate', async () => {
    h.invoke.mockResolvedValue({ data: { content: 'v1' } })
    const ctx = { record: { id: 7, updated_at: 'a' }, recordType: 'wo' }
    await runCopilotTask('draft_action_plan', ctx)
    const second = await runCopilotTask('draft_action_plan', ctx)
    expect(second.cached).toBe(true)
    expect(h.invoke).toHaveBeenCalledTimes(1)

    h.invoke.mockResolvedValue({ data: { content: 'v2' } })
    const regen = await runCopilotTask('draft_action_plan', ctx, { bypassCache: true })
    expect(regen).toEqual({ text: 'v2', cached: false })
    expect(h.invoke).toHaveBeenCalledTimes(2)

    // A changed record version misses the cache
    const bumped = { record: { id: 7, updated_at: 'b' }, recordType: 'wo' }
    expect(copilotCacheKey('draft_action_plan', bumped)).not.toBe(copilotCacheKey('draft_action_plan', ctx))
  })

  it('surfaces edge-function errors as friendly messages', async () => {
    h.invoke.mockResolvedValue({ data: { error: 'rate limited' } })
    await expect(runCopilotTask('draft_action_plan', { record: {} })).rejects.toThrow(/AI is unavailable: rate limited/)
  })

  it('rejects unknown tasks and empty responses', async () => {
    await expect(runCopilotTask('nope', {})).rejects.toThrow(/Unknown AI copilot task/)
    h.invoke.mockResolvedValue({ data: { content: '' } })
    await expect(runCopilotTask('draft_action_plan', { record: {} })).rejects.toThrow(/empty response/)
  })
})
