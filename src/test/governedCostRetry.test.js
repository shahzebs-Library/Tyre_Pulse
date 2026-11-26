import { describe, expect, it, vi } from 'vitest'
vi.mock('../lib/supabase', () => ({ supabase: {} }))
import { rpcWithTimeoutRetry } from '../lib/api/governedCost'

describe('rpcWithTimeoutRetry', () => {
  it('retries once on a statement timeout', async () => {
    const call = vi.fn()
      .mockResolvedValueOnce({ data: null, error: { code: '57014', message: 'canceling statement due to statement timeout' } })
      .mockResolvedValueOnce({ data: { ok: true }, error: null })
    const r = await rpcWithTimeoutRetry(call, { delayMs: 0 })
    expect(call).toHaveBeenCalledTimes(2)
    expect(r.data.ok).toBe(true)
  })
  it('does not retry other errors or successes', async () => {
    const bad = vi.fn().mockResolvedValue({ data: null, error: { code: '42501', message: 'denied' } })
    await rpcWithTimeoutRetry(bad, { delayMs: 0 })
    expect(bad).toHaveBeenCalledTimes(1)
    const ok = vi.fn().mockResolvedValue({ data: { ok: true }, error: null })
    await rpcWithTimeoutRetry(ok, { delayMs: 0 })
    expect(ok).toHaveBeenCalledTimes(1)
  })
})
