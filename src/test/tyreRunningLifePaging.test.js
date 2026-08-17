import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * The running-life read fetches its pages CONCURRENTLY, and that is a claim worth
 * pinning rather than asserting in a comment.
 *
 * WHY IT MATTERS: this RPC costs the same for one row as for a thousand - measured flat
 * at ~7.5 s for `limit 1` and `limit 1000` alike, because the expensive part is the fleet
 * baseline it builds before slicing. So four SEQUENTIAL pages cost four times one page
 * for no benefit, and past a gateway timeout that is not slowness, it is the error users
 * were reporting. Paging fixed a dropped 2.2 MB payload and made the wall clock worse.
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
    let inFlight = 0
    let maxInFlight = 0
    rpc.mockImplementation(async (_fn, args) => {
      inFlight += 1
      maxInFlight = Math.max(maxInFlight, inFlight)
      await new Promise((r) => setTimeout(r, 5))
      inFlight -= 1
      return { data: page(args.p_offset, 1000, 3518), error: null }
    })

    const res = await getTyreRunningLife({ country: 'KSA' })
    expect(res.ok).not.toBe(false)
    // 3,518 rows over pages of 1,000 = offsets 0, 1000, 2000, 3000.
    expect(rpc.mock.calls.map((c) => c[1].p_offset)).toEqual(
      expect.arrayContaining([0, 1000, 2000, 3000]),
    )
    // Sequential would never exceed 1. This is the whole point of the change.
    expect(maxInFlight).toBeGreaterThan(1)
  })

  it('keeps the server ordering even when a later page answers first', async () => {
    // Page 2 is made deliberately slow. If the code concatenated by arrival, its rows
    // would land after page 3's and the table would silently be in the wrong order -
    // which for a list sorted by "remaining km" means the wrong tyres at the top.
    rpc.mockImplementation(async (_fn, args) => {
      const delay = args.p_offset === 1000 ? 30 : 1
      await new Promise((r) => setTimeout(r, delay))
      return { data: page(args.p_offset, args.p_offset === 3000 ? 518 : 1000, 3518), error: null }
    })

    const res = await getTyreRunningLife({ country: 'KSA' })
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
