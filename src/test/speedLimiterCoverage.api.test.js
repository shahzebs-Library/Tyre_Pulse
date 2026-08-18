import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * `listFleetForCoverage` is the DENOMINATOR of speed-limiter coverage, which is
 * what makes its truncation worse than a short list: it used to say
 * `.limit(5000)`, PostgREST returned 1,000, and a 1,617-asset fleet was measured
 * as 1,000 - so coverage was reported HIGHER than it really is. These tests
 * serve `.range()` windows so the paging is exercised, not mocked away.
 */
const h = vi.hoisted(() => {
  const state = { rows: [], error: null, ranges: [], orders: [] }
  function makeBuilder() {
    const b = {
      select: () => b,
      or: () => b,
      eq: () => b,
      order: (col) => { state.orders.push(col); return b },
      range: (from, to) => {
        state.ranges.push([from, to])
        if (state.error) return Promise.resolve({ data: null, error: state.error })
        return Promise.resolve({ data: state.rows.slice(from, to + 1), error: null })
      },
    }
    return b
  }
  return { state, supabase: { from: () => makeBuilder() } }
})

vi.mock('../lib/supabase', () => ({ supabase: h.supabase }))

const { listFleetForCoverage } = await import('../lib/api/speedLimiters')

const asset = (n, active = true) => ({ asset_no: `A${n}`, site: 'NHC', is_active: active })

beforeEach(() => {
  h.state.rows = []
  h.state.error = null
  h.state.ranges = []
  h.state.orders = []
})

describe('speed-limiter coverage denominator', () => {
  it('pages past the 1000-row cap so the whole fleet is counted', async () => {
    h.state.rows = Array.from({ length: 1617 }, (_, i) => asset(i))
    const rows = await listFleetForCoverage({ country: 'All' })
    expect(rows).toHaveLength(1617)
    expect(h.state.ranges.length).toBeGreaterThan(1)
    expect(h.state.ranges[0]).toEqual([0, 999])
  })

  it('orders on a UNIQUE tiebreak, or a page boundary drops or repeats rows', () => {
    // asset_no is unique per COUNTRY, not globally, so ordering on it alone is
    // not enough on the All-countries scope.
    return listFleetForCoverage({ country: 'All' }).then(() => {
      expect(h.state.orders).toContain('id')
    })
  })

  it('still excludes retired assets from the denominator', async () => {
    h.state.rows = [asset(1), asset(2, false), { asset_no: 'A3', site: 'NHC', is_active: null }]
    const rows = await listFleetForCoverage({})
    // is_active null is legacy data and counts as in service; false does not.
    expect(rows.map((r) => r.asset_no)).toEqual(['A1', 'A3'])
  })

  it('respects an explicit row ceiling', async () => {
    h.state.rows = Array.from({ length: 5000 }, (_, i) => asset(i))
    const rows = await listFleetForCoverage({ limit: 2000 })
    expect(rows).toHaveLength(2000)
  })
})
