import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * The running-life read fetches its pages CONCURRENTLY, and that is a claim worth
 * pinning rather than asserting in a comment.
 *
 * WHY IT MATTERS: this RPC costs the same for one row as for a thousand - measured flat
 * at ~7.5 s for `limit 1` and `limit 1000` alike, because the expensive part is the fleet
 * baseline it builds before slicing. V576 and V577 took one call to ~1.1 s, but the cost
 * is still per CALL, so four SEQUENTIAL pages would still cost four times one page for no
 * benefit, and past a gateway timeout that is not slowness, it is the error users were
 * reporting. Paging fixed a dropped 2.2 MB payload and made the wall clock worse.
 *
 * Three things are pinned here, and each of them was a real way to get this wrong:
 *   1. the pages after the first overlap in time (otherwise the fix does nothing)
 *   2. the rows come back in the SERVER's order regardless of which response lands
 *      first - a fast page 3 must not jump ahead of a slow page 2
 *   3. one failed page fails the whole read - a partial list rendered as a complete one
 *      is silently wrong, which is worse than an honest error
 */

const rpc = vi.fn()
vi.mock('../lib/api/_client', () => ({
  supabase: { rpc: (...a) => rpc(...a) },
  applyCountry: (q) => q,
}))
vi.mock('../lib/safeError', () => ({ toUserMessage: (e) => String(e?.message || e) }))

const { getTyreRunningLife } = await import('../lib/api/tyreRunningLife')

/** A page of `n` rows whose serials encode the offset, so order is checkable. */
const page = (offset, n, total) => ({
  ok: true,
  total,
  rows: Array.from({ length: n }, (_, i) => ({ serial_no: `S${offset + i}` })),
})

beforeEach(() => { rpc.mockReset() })

describe('running-life paged read', () => {
  it('fetches the pages after the first CONCURRENTLY', async () => {
    // Page 0 must resolve before the rest can be planned (its `total` is what says
    // how many there are), so only pages 1..3 are expected to overlap.
    //
    // CONCURRENCY IS OBSERVED STRUCTURALLY, NOT BY WALL CLOCK. An earlier version of
    // this test slept a few milliseconds per page, which makes it sensitive to load in
    // a 525-file suite - a test that fails only when the machine is busy teaches
    // nobody anything. Here each page is held open until this test releases it, so
    // "were they in flight together" is a fact about the code, not about the host.
    const gates = new Map()
    let inFlight = 0
    let maxInFlight = 0
    rpc.mockImplementation((_fn, args) => {
      inFlight += 1
      maxInFlight = Math.max(maxInFlight, inFlight)
      return new Promise((resolve) => {
        gates.set(args.p_offset, () => {
          inFlight -= 1
          resolve({ data: page(args.p_offset, 1000, 3518), error: null })
        })
      })
    })

    const pending = getTyreRunningLife({ country: 'KSA' })

    // Let page 0 be requested, then release it so `total` is known.
    await vi.waitFor(() => expect(gates.has(0)).toBe(true))
    gates.get(0)()

    // Now the remaining three must ALL be on the wire before any of them answers.
    // Sequential code could never reach this state.
    await vi.waitFor(() => {
      expect(gates.has(1000)).toBe(true)
      expect(gates.has(2000)).toBe(true)
      expect(gates.has(3000)).toBe(true)
    })
    expect(maxInFlight).toBeGreaterThan(1)

    for (const offset of [1000, 2000, 3000]) gates.get(offset)()
    const res = await pending
    expect(res.ok).not.toBe(false)
    expect(rpc.mock.calls.map((c) => c[1].p_offset).sort((a, b) => a - b))
      .toEqual([0, 1000, 2000, 3000])
  })

  it('keeps the server ordering even when a later page answers first', async () => {
    // Page 2 is released LAST. If the code concatenated by arrival, its rows would land
    // after page 3's and the table would silently be in the wrong order - which for a
    // list sorted by "remaining km" means the wrong tyres at the top. Release order is
    // controlled explicitly rather than by sleeping, so this proves ordering rather
    // than merely observing it on one lucky run.
    const gates = new Map()
    rpc.mockImplementation((_fn, args) => new Promise((resolve) => {
      gates.set(args.p_offset, () => resolve({
        data: page(args.p_offset, args.p_offset === 3000 ? 518 : 1000, 3518),
        error: null,
      }))
    }))

    const pending = getTyreRunningLife({ country: 'KSA' })
    await vi.waitFor(() => expect(gates.has(0)).toBe(true))
    gates.get(0)()
    await vi.waitFor(() => expect(gates.size).toBe(4))
    // Deliberately out of order: 3000, then 2000, and the slow 1000 last.
    gates.get(3000)()
    gates.get(2000)()
    gates.get(1000)()

    const res = await pending
    expect(res.rows).toHaveLength(3518)
    expect(res.rows[0].serial_no).toBe('S0')
    expect(res.rows[1000].serial_no).toBe('S1000')
    expect(res.rows[2000].serial_no).toBe('S2000')
    expect(res.rows[3517].serial_no).toBe('S3517')
  })

  it('one failed page fails the whole read rather than returning a partial list', async () => {
    rpc.mockImplementation(async (_fn, args) => {
      if (args.p_offset === 2000) return { data: null, error: { message: 'boom' } }
      return { data: page(args.p_offset, 1000, 3518), error: null }
    })
    const res = await getTyreRunningLife({ country: 'KSA' })
    expect(res.ok).toBe(false)
    expect(res.reason).toMatch(/boom/)
  })

  it('a single page is still exactly one request', async () => {
    // The due-only path is small (424 rows live) and must not pay for paging at all.
    rpc.mockImplementation(async () => ({ data: page(0, 424, 424), error: null }))
    const res = await getTyreRunningLife({ country: 'KSA', dueOnly: true })
    expect(res.rows).toHaveLength(424)
    expect(rpc).toHaveBeenCalledTimes(1)
    expect(rpc.mock.calls[0][1].p_due_only).toBe(true)
  })

  it('still terminates when the server gives no total', async () => {
    // Older/absent `total` falls back to "a short page is the last one". That path is
    // sequential on purpose - there is nothing to predict - but it must not loop forever.
    rpc.mockImplementation(async (_fn, args) => ({
      data: { ok: true, rows: page(args.p_offset, args.p_offset >= 2000 ? 10 : 1000).rows },
      error: null,
    }))
    const res = await getTyreRunningLife({ country: 'KSA' })
    expect(res.rows).toHaveLength(2010)
    expect(rpc.mock.calls.map((c) => c[1].p_offset)).toEqual([0, 1000, 2000])
  })
})
