/**
 * usePagedRows - the arithmetic behind every paged table.
 *
 * These pin the two behaviours that are easy to get wrong and impossible to
 * spot by reading: the page must never render empty because it is out of range,
 * and narrowing a filter must return the reader to the first page rather than
 * stranding them past the end of a now-short list.
 */

import { describe, it, expect } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import {
  usePagedRows, DEFAULT_PAGE_SIZE, PAGE_SIZE_OPTIONS,
} from '../components/ui/TablePagination'

const rows = (n) => Array.from({ length: n }, (_, i) => ({ id: i }))

describe('usePagedRows', () => {
  it('defaults to 50 per page', () => {
    const { result } = renderHook(() => usePagedRows(rows(4379)))
    expect(DEFAULT_PAGE_SIZE).toBe(50)
    expect(result.current.pageSize).toBe(50)
    expect(result.current.pageRows).toHaveLength(50)
    expect(result.current.totalPages).toBe(88)   // ceil(4379 / 50)
  })

  it('reaches every row - the whole point, since the old code capped at 500', () => {
    const all = rows(4379)
    const { result } = renderHook(() => usePagedRows(all))
    act(() => result.current.setPage(result.current.totalPages - 1))
    const last = result.current.pageRows
    // 4379 = 87 full pages of 50 + 29
    expect(last).toHaveLength(29)
    expect(last[last.length - 1].id).toBe(4378)
  })

  it('reports honest 1-indexed totals', () => {
    const { result } = renderHook(() => usePagedRows(rows(120)))
    expect([result.current.from, result.current.to, result.current.total]).toEqual([1, 50, 120])
    act(() => result.current.setPage(2))
    expect([result.current.from, result.current.to]).toEqual([101, 120])
  })

  it('an empty set reports 0 to 0, never 1 to 0', () => {
    const { result } = renderHook(() => usePagedRows([]))
    expect([result.current.from, result.current.to, result.current.total]).toEqual([0, 0, 0])
    expect(result.current.totalPages).toBe(1)
  })

  it('tolerates null rows instead of throwing', () => {
    const { result } = renderHook(() => usePagedRows(null))
    expect(result.current.pageRows).toEqual([])
    expect(result.current.total).toBe(0)
  })

  // The clamp and the reset are two DIFFERENT guarantees, and an earlier version
  // of these tests could not tell them apart: each mechanism covered for the
  // other, so removing either one on its own still passed. Both mutations below
  // now fail exactly one test each.

  // RESET. Only observable when the set GROWS: shrinking is already handled by
  // the clamp, so asserting the shrink case tested nothing.
  it('returns to page 1 when the result set changes size', () => {
    let data = rows(12)
    const { result, rerender } = renderHook(() => usePagedRows(data))
    act(() => result.current.setPage(0))

    data = rows(4000)                 // filter cleared - a completely different list
    rerender()

    expect(result.current.page).toBe(0)
    act(() => result.current.setPage(39))
    expect(result.current.page).toBe(39)

    data = rows(4000).slice(0, 3999)  // size changes again
    rerender()
    expect(result.current.page).toBe(0)
  })

  // CLAMP. Observable only when the page goes out of range WITHOUT the row
  // count changing, so the reset effect never fires and cannot cover for it.
  it('clamps a page set beyond the end instead of rendering empty', () => {
    const { result } = renderHook(() => usePagedRows(rows(120)))
    act(() => result.current.setPage(999))     // total unchanged, so no reset
    expect(result.current.page).toBe(2)        // ceil(120/50) - 1
    expect(result.current.pageRows).toHaveLength(20)
    expect(result.current.pageRows.length).toBeGreaterThan(0)
  })

  it('keeps the first visible row visible when the page size changes', () => {
    const { result } = renderHook(() => usePagedRows(rows(1000)))
    act(() => result.current.setPage(4))          // rows 201-250 at size 50
    expect(result.current.from).toBe(201)
    act(() => result.current.setPageSize(100))
    // row 201 must still be on screen, not thrown to an unrelated part of the list
    expect(result.current.from).toBeLessThanOrEqual(201)
    expect(result.current.to).toBeGreaterThanOrEqual(201)
  })

  it('offers 50 among its page sizes', () => {
    expect(PAGE_SIZE_OPTIONS).toContain(50)
    expect(PAGE_SIZE_OPTIONS).toEqual([...PAGE_SIZE_OPTIONS].sort((a, b) => a - b))
  })
})
