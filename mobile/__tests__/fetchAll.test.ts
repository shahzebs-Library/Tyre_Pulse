/**
 * Pure-logic tests for lib/fetchAll.ts (PostgREST max-rows paging).
 *
 * Regression cover for the mobile Analytics screen defect: its tyre_records
 * read was un-paged, so PostgREST capped it at 1000 rows and every KPI total,
 * percentage and ranking derived from it was understated with no error.
 */
import { fetchAllPages, FETCH_PAGE_SIZE, PageResult } from '../lib/fetchAll'

/** Build a fake paged endpoint over `total` rows, recording every range asked for. */
function fakeTable(total: number, cap = FETCH_PAGE_SIZE) {
  const calls: Array<[number, number]> = []
  const rows = Array.from({ length: total }, (_, i) => ({ id: i }))
  const pageFn = (from: number, to: number): Promise<PageResult<{ id: number }>> => {
    calls.push([from, to])
    // PostgREST never returns more than `cap` rows for one request.
    const end = Math.min(to, from + cap - 1)
    return Promise.resolve({ data: rows.slice(from, end + 1), error: null })
  }
  return { calls, pageFn }
}

describe('fetchAllPages', () => {
  it('defaults to the PostgREST max-rows page size', () => {
    expect(FETCH_PAGE_SIZE).toBe(1000)
  })

  it('returns EVERY row when the table exceeds the 1000-row cap', async () => {
    // 6016 = the documented KSA tyre_records volume. An un-paged read would
    // have returned 1000 and the "Total Records" KPI would have read 1,000.
    const { pageFn, calls } = fakeTable(6016)
    const { data, error, truncated } = await fetchAllPages(pageFn)

    expect(error).toBeNull()
    expect(truncated).toBe(false)
    expect(data).toHaveLength(6016)
    // No duplicates and no gaps across page boundaries.
    expect(new Set(data.map(r => r.id)).size).toBe(6016)
    expect(data[0].id).toBe(0)
    expect(data[6015].id).toBe(6015)
    // 6 full pages + 1 short page.
    expect(calls).toHaveLength(7)
    expect(calls[0]).toEqual([0, 999])
    expect(calls[1]).toEqual([1000, 1999])
    expect(calls[6]).toEqual([6000, 6999])
  })

  it('sums a cost total correctly across pages', async () => {
    // The concrete lie this fixes: a total derived from a truncated read.
    const rows = Array.from({ length: 2500 }, () => ({ cost_per_tyre: 10 }))
    const pageFn = (from: number, to: number) =>
      Promise.resolve({ data: rows.slice(from, to + 1), error: null })

    const { data } = await fetchAllPages<{ cost_per_tyre: number }>(pageFn)
    const total = data.reduce((s, r) => s + r.cost_per_tyre, 0)

    expect(data).toHaveLength(2500)
    expect(total).toBe(25000) // an un-paged read would have reported 10000
  })

  it('stops on a short page without an extra request', async () => {
    const { pageFn, calls } = fakeTable(450)
    const { data } = await fetchAllPages(pageFn)
    expect(data).toHaveLength(450)
    expect(calls).toHaveLength(1)
  })

  it('stops cleanly on an exactly-full single page', async () => {
    const { pageFn, calls } = fakeTable(1000)
    const { data } = await fetchAllPages(pageFn)
    expect(data).toHaveLength(1000)
    // Second request returns empty and ends the loop.
    expect(calls).toHaveLength(2)
  })

  it('returns an empty result for an empty table', async () => {
    const { pageFn } = fakeTable(0)
    const { data, error } = await fetchAllPages(pageFn)
    expect(data).toEqual([])
    expect(error).toBeNull()
  })

  it('surfaces an error and keeps the pages that succeeded', async () => {
    const boom = { message: 'permission denied' }
    let n = 0
    const pageFn = (from: number, to: number): Promise<PageResult<{ id: number }>> => {
      n++
      if (n === 2) return Promise.resolve({ data: null, error: boom })
      return Promise.resolve({
        data: Array.from({ length: 1000 }, (_, i) => ({ id: from + i })),
        error: null,
      })
    }
    const { data, error } = await fetchAllPages(pageFn)
    expect(error).toBe(boom)
    expect(data).toHaveLength(1000) // partial, and the caller throws on error
  })

  it('honours a finite max ceiling and flags truncation', async () => {
    const { pageFn } = fakeTable(5000)
    const { data, truncated } = await fetchAllPages(pageFn, { max: 2000 })
    expect(data).toHaveLength(2000)
    expect(truncated).toBe(true)
  })

  it('respects a custom page size', async () => {
    const { pageFn, calls } = fakeTable(250, 100)
    const { data } = await fetchAllPages(pageFn, { pageSize: 100 })
    expect(data).toHaveLength(250)
    expect(calls[0]).toEqual([0, 99])
    expect(calls[1]).toEqual([100, 199])
    expect(calls).toHaveLength(3)
  })

  it('clamps a nonsensical page size instead of looping forever', async () => {
    const { pageFn, calls } = fakeTable(10)
    const { data } = await fetchAllPages(pageFn, { pageSize: 0 })
    expect(data).toHaveLength(10)
    expect(calls[0]).toEqual([0, 999]) // fell back to the default page size
  })
})
