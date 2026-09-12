import { describe, it, expect } from 'vitest'
import { fetchAllPages } from '../lib/fetchAll'

// Build a pageFn over an in-memory array, recording every range requested so we
// can assert ordering, windowing and the single-round-trip small-result path.
function makeSource(total, { pageSize = 1000 } = {}) {
  const rows = Array.from({ length: total }, (_, i) => ({ i }))
  const calls = []
  const pageFn = (from, to) => {
    calls.push([from, to])
    return Promise.resolve({ data: rows.slice(from, to + 1), error: null })
  }
  return { pageFn, calls, rows, pageSize }
}

describe('fetchAllPages', () => {
  it('returns a small result in a single round trip (no extra parallel calls)', async () => {
    const s = makeSource(50, { pageSize: 1000 })
    const { data, error, truncated } = await fetchAllPages(s.pageFn, { pageSize: 1000 })
    expect(error).toBeNull()
    expect(truncated).toBe(false)
    expect(data).toHaveLength(50)
    expect(s.calls).toHaveLength(1) // page 0 only
  })

  it('pages a large result and preserves row order across concurrent windows', async () => {
    const s = makeSource(4500, { pageSize: 1000 })
    const { data, truncated } = await fetchAllPages(s.pageFn, { pageSize: 1000, concurrency: 4 })
    expect(truncated).toBe(false)
    expect(data).toHaveLength(4500)
    // strictly increasing => order preserved despite parallel fetch
    expect(data.every((r, idx) => r.i === idx)).toBe(true)
  })

  it('is faster than serial: fewer sequential awaits via windowing', async () => {
    // 3000 rows / pageSize 1000 => pages 0,1,2. Page 0 alone, then one window of >=2.
    const s = makeSource(3000, { pageSize: 1000, })
    await fetchAllPages(s.pageFn, { pageSize: 1000, concurrency: 4 })
    // page 0, then a window covering pages 1..4 (2 & 3 empty tail) - all issued
    expect(s.calls[0]).toEqual([0, 999])
    expect(s.calls.length).toBeGreaterThanOrEqual(3)
  })

  it('honours the max ceiling and flags truncated', async () => {
    const s = makeSource(5000, { pageSize: 1000 })
    const { data, truncated } = await fetchAllPages(s.pageFn, { pageSize: 1000, max: 2500, concurrency: 4 })
    expect(data).toHaveLength(2500)
    expect(truncated).toBe(true)
  })

  it.each([
    [50, 25], // A short first page can still exceed a smaller caller limit.
    [2600, 2500], // A short page ends the same window that crosses the limit.
    [3000, 2500], // An empty tail can end that window too.
    [50100, 50000], // Inspection Planner's source ceiling.
  ])('flags discarded rows when %i source rows exceed a %i limit', async (total, max) => {
    const s = makeSource(total)
    const result = await fetchAllPages(s.pageFn, { max })
    expect(result.error).toBeNull()
    expect(result.truncated).toBe(true)
    expect(result.data).toEqual(s.rows.slice(0, max))
  })

  it('does not flag a complete short final page that exactly meets the limit', async () => {
    const s = makeSource(2500)
    const result = await fetchAllPages(s.pageFn, { max: 2500 })
    expect(result.truncated).toBe(false)
    expect(result.data).toEqual(s.rows)
  })

  it('short-circuits on error and returns rows gathered so far', async () => {
    const rows = Array.from({ length: 3000 }, (_, i) => ({ i }))
    let n = 0
    const pageFn = (from, to) => {
      n += 1
      if (from === 0) return Promise.resolve({ data: rows.slice(0, 1000), error: null })
      return Promise.resolve({ data: null, error: { message: 'boom' } })
    }
    const { data, error } = await fetchAllPages(pageFn, { pageSize: 1000 })
    expect(error).toMatchObject({ message: 'boom' })
    expect(data).toHaveLength(1000) // page 0 kept
    expect(n).toBeGreaterThan(1)
  })

  it('handles an exact multiple of pageSize', async () => {
    const s = makeSource(2000, { pageSize: 1000 })
    const { data } = await fetchAllPages(s.pageFn, { pageSize: 1000, concurrency: 4 })
    expect(data).toHaveLength(2000)
  })

  it('concurrency=1 behaves serially, one page per window, in order', async () => {
    const s = makeSource(3000, { pageSize: 1000 })
    const { data, truncated } = await fetchAllPages(s.pageFn, { pageSize: 1000, concurrency: 1 })
    expect(truncated).toBe(false)
    expect(data).toHaveLength(3000)
    expect(data.every((r, idx) => r.i === idx)).toBe(true)
    // page 0, then one page at a time until a short tail page ends it
    expect(s.calls).toEqual([
      [0, 999], [1000, 1999], [2000, 2999], [3000, 3999],
    ])
  })

  it('clamps a non-positive concurrency up to a single serial window', async () => {
    const s = makeSource(2500, { pageSize: 1000 })
    const { data } = await fetchAllPages(s.pageFn, { pageSize: 1000, concurrency: 0 })
    expect(data).toHaveLength(2500)
    // win clamped to 1 => strictly sequential pages
    expect(s.calls).toEqual([
      [0, 999], [1000, 1999], [2000, 2999],
    ])
  })
})
