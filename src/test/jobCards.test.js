/**
 * The job card intake's client edge.
 *
 * The SQL is where the real judgement lives (the breakdown-hours guard, the
 * status/type mapping, the refresh-in-place upsert), so what is worth pinning
 * here is the contract the front page depends on: the panel must disappear
 * quietly on a backend that predates V381 rather than showing an error to every
 * user, and it must not swallow a genuine failure.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const rpc = vi.fn()
vi.mock('../lib/api/_client', () => ({ supabase: { rpc: (...a) => rpc(...a) } }))

const { getDailyJobCards } = await import('../lib/api/jobCards')

beforeEach(() => rpc.mockReset())

describe('getDailyJobCards', () => {
  it('passes the country through and returns the snapshot', async () => {
    rpc.mockResolvedValue({ data: { ok: true, kpis: { still_out: 3 } }, error: null })
    const out = await getDailyJobCards({ country: 'KSA' })
    expect(rpc).toHaveBeenCalledWith('get_daily_job_cards', { p_country: 'KSA', p_on: null })
    expect(out.kpis.still_out).toBe(3)
  })

  it('sends null for the All-countries scope', async () => {
    // 'All' is a UI token, not a country. Sending it verbatim would filter
    // every row out and report an empty day as fact.
    rpc.mockResolvedValue({ data: { ok: true }, error: null })
    await getDailyJobCards({ country: 'All' })
    expect(rpc.mock.calls[0][1].p_country).toBeNull()
    await getDailyJobCards({})
    expect(rpc.mock.calls[1][1].p_country).toBeNull()
  })

  it('degrades to not-ok when the RPC does not exist yet', async () => {
    for (const message of ['function does not exist', 'Could not find the function', 'schema cache miss']) {
      rpc.mockResolvedValue({ data: null, error: { message } })
      await expect(getDailyJobCards({})).resolves.toEqual({ ok: false })
    }
  })

  it('still throws on a real failure', async () => {
    // A permission or network error must not be disguised as "nothing imported".
    rpc.mockResolvedValue({ data: null, error: { message: 'permission denied', code: '42501' } })
    await expect(getDailyJobCards({})).rejects.toBeTruthy()
  })

  it('treats an unauthorized payload as nothing to show', async () => {
    rpc.mockResolvedValue({ data: { ok: false, reason: 'unauthorized' }, error: null })
    await expect(getDailyJobCards({})).resolves.toEqual({ ok: false })
  })
})
