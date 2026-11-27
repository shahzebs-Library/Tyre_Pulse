// The shared TV board's first open can hit the anon statement timeout on a cold
// database. The viewer retries ONCE with a longer ceiling; a refusal reply
// (password / revoked / invalid) is data, never retried. And on an
// all-countries board, tyre spend shows one value per currency instead of 0.
import { describe, it, expect, vi, beforeEach } from 'vitest'

const rpc = vi.fn()
vi.mock('../lib/supabase', () => ({ supabase: { rpc: (...a) => rpc(...a) } }))

const { getReportSnapshotWithRetry, isTransientSnapshotError } = await import('../lib/api/reportShares')
const { resolveBlock } = await import('../lib/reportShareLayout')

function reply(result) {
  const p = Promise.resolve(result)
  p.abortSignal = () => p
  return p
}

beforeEach(() => rpc.mockReset())

describe('isTransientSnapshotError', () => {
  it('treats a statement timeout, an abort and a network failure as retryable', () => {
    expect(isTransientSnapshotError({ code: '57014', message: 'canceling statement due to statement timeout' })).toBe(true)
    expect(isTransientSnapshotError({ name: 'AbortError' })).toBe(true)
    expect(isTransientSnapshotError({ message: 'TypeError: Failed to fetch' })).toBe(true)
  })
  it('does not retry a permission or validation error', () => {
    expect(isTransientSnapshotError({ code: '42501', message: 'permission denied' })).toBe(false)
  })
})

describe('getReportSnapshotWithRetry', () => {
  it('retries once after a timeout and returns the second answer', async () => {
    rpc.mockReturnValueOnce(reply({ data: null, error: { code: '57014', message: 'canceling statement due to statement timeout' } }))
      .mockReturnValueOnce(reply({ data: { ok: true, kpis: {} }, error: null }))
    const onRetry = vi.fn()
    const res = await getReportSnapshotWithRetry('rpt_x', null, {}, { onRetry, timeouts: [10, 20] })
    expect(res.ok).toBe(true)
    expect(rpc).toHaveBeenCalledTimes(2)
    expect(onRetry).toHaveBeenCalledTimes(1)
  })
  it('never retries a refusal reply', async () => {
    rpc.mockReturnValueOnce(reply({ data: { ok: false, reason: 'password' }, error: null }))
    const res = await getReportSnapshotWithRetry('rpt_x', null, {}, { timeouts: [10, 20] })
    expect(res.reason).toBe('password')
    expect(rpc).toHaveBeenCalledTimes(1)
  })
  it('throws after the second failure', async () => {
    rpc.mockReturnValue(reply({ data: null, error: { code: '57014', message: 'statement timeout' } }))
    await expect(getReportSnapshotWithRetry('rpt_x', null, {}, { timeouts: [10, 20] })).rejects.toBeTruthy()
    expect(rpc).toHaveBeenCalledTimes(2)
  })
})

describe('tyre spend on a custom board block', () => {
  const snap = {
    kpis: {
      tyre_spend: null,
      tyre_spend_by_country: [
        { country: 'Egypt', currency: 'EGP', value: 5310606 },
        { country: 'KSA', currency: 'SAR', value: 3080739 },
      ],
    },
  }
  it('lists one value per country when no single currency applies', () => {
    const r = resolveBlock({ type: 'kpi', source: 'kpi.tyre_spend' }, snap)
    expect(r.perCountry.map((c) => `${c.currency} ${c.value}`)).toEqual(['EGP 5310606', 'SAR 3080739'])
  })
  it('keeps the single figure when one currency is in scope', () => {
    const r = resolveBlock({ type: 'kpi', source: 'kpi.tyre_spend' }, { kpis: { tyre_spend: 3080739, tyre_spend_by_country: [{ country: 'KSA', currency: 'SAR', value: 3080739 }] } })
    expect(r.value).toBe(3080739)
    expect(r.perCountry).toEqual([])
  })
})
