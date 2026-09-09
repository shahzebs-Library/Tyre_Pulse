import { act, renderHook } from '@testing-library/react'
import { useLayoutEffect } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import useInspectionRegister from '../hooks/useInspectionRegister'
import { listInspectionsForPage } from '../lib/api/inspections'

vi.mock('../lib/supabase', () => ({ supabase: {} }))
vi.mock('../lib/api/inspections', () => ({ listInspectionsForPage: vi.fn() }))

const pending = () => {
  let resolve
  const promise = new Promise(r => { resolve = r })
  return { promise, resolve }
}

beforeEach(() => vi.clearAllMocks())

describe('inspection register scope changes', () => {
  it('does not refetch when an action finishes after leaving the register', async () => {
    listInspectionsForPage.mockResolvedValue({ data: [], error: null })
    const { result, unmount } = renderHook(() => useInspectionRegister({ country: 'KSA' }))
    await act(async () => {})
    const reload = result.current.reload
    unmount()
    await reload()
    expect(listInspectionsForPage).toHaveBeenCalledTimes(1)
  })

  it('reloads for a different signed-in manager even without a creator filter', async () => {
    listInspectionsForPage.mockResolvedValue({ data: [], error: null })
    const { rerender } = renderHook(props => useInspectionRegister(props), {
      initialProps: { country: 'KSA', actorId: 'manager-a', role: 'Manager' },
    })
    await act(async () => {})
    rerender({ country: 'KSA', actorId: 'manager-b', role: 'Manager' })
    await act(async () => {})
    expect(listInspectionsForPage).toHaveBeenCalledTimes(2)
  })

  it('ignores reloads captured by an action in the previous country', async () => {
    const oldRead = pending()
    const newRead = pending()
    listInspectionsForPage.mockReturnValueOnce(oldRead.promise).mockReturnValueOnce(newRead.promise)
    const { result, rerender } = renderHook(props => useInspectionRegister(props), {
      initialProps: { country: 'KSA' },
    })
    const previousReload = result.current.reload
    rerender({ country: 'UAE' })
    await act(async () => { await previousReload() })
    await act(async () => { newRead.resolve({ data: [{ id: 'uae' }], error: null }) })
    expect(listInspectionsForPage).toHaveBeenCalledTimes(2)
    expect(result.current.loading).toBe(false)
    expect(result.current.rows).toEqual([{ id: 'uae' }])
    await act(async () => { oldRead.resolve({ data: [], error: null }) })
  })

  it('never paints previous rows when authentication resumes', async () => {
    const refresh = pending()
    const paintedRows = []
    listInspectionsForPage.mockResolvedValueOnce({ data: [{ id: 'previous-session' }], error: null })
      .mockReturnValueOnce(refresh.promise)
    const { rerender } = renderHook(props => {
      const value = useInspectionRegister(props)
      useLayoutEffect(() => { paintedRows.push(value.rows) }, [value.rows])
      return value
    }, { initialProps: { country: 'KSA', enabled: true } })
    await act(async () => {})
    rerender({ country: 'KSA', enabled: false })
    paintedRows.length = 0
    rerender({ country: 'KSA', enabled: true })
    expect(paintedRows.flat()).toEqual([])
    await act(async () => { refresh.resolve({ data: [], error: null }) })
  })

  it('reports a failed read instead of presenting an empty successful total', async () => {
    listInspectionsForPage.mockResolvedValue({ data: [], error: { message: 'Network request failed' } })
    const { result } = renderHook(() => useInspectionRegister({ country: 'KSA' }))
    await act(async () => {})
    expect(result.current.loading).toBe(false)
    expect(result.current.rows).toEqual([])
    expect(result.current.error).toEqual(expect.any(String))
    expect(result.current.error.length).toBeGreaterThan(0)
  })

  it('keeps the current country when an older response arrives last', async () => {
    const oldRead = pending()
    const newRead = pending()
    listInspectionsForPage.mockReturnValueOnce(oldRead.promise).mockReturnValueOnce(newRead.promise)
    const { result, rerender } = renderHook(props => useInspectionRegister(props), {
      initialProps: { country: 'KSA' },
    })
    rerender({ country: 'UAE' })
    await act(async () => { newRead.resolve({ data: [{ id: 'new', asset_no: 'UAE-20' }], error: null }) })
    await act(async () => { oldRead.resolve({ data: [{ id: 'old', asset_no: 'KSA-10' }], error: null }) })
    expect(result.current.rows.map(row => row.asset_no)).toEqual(['UAE-20'])
    expect(listInspectionsForPage.mock.calls.map(([q]) => q.country)).toEqual(['KSA', 'UAE'])
  })

  it('does not finish the new load when the previous creator response arrives', async () => {
    const oldRead = pending()
    const newRead = pending()
    listInspectionsForPage.mockReturnValueOnce(oldRead.promise).mockReturnValueOnce(newRead.promise)
    const { result, rerender } = renderHook(props => useInspectionRegister(props), {
      initialProps: { country: 'KSA', createdBy: 'first-user' },
    })
    rerender({ country: 'KSA', createdBy: 'second-user' })
    await act(async () => { oldRead.resolve({ data: [{ id: 'old' }], error: null }) })
    expect(result.current.loading).toBe(true)
    expect(result.current.rows).toEqual([])
    await act(async () => { newRead.resolve({ data: [{ id: 'new' }], error: null }) })
    expect(result.current.rows).toEqual([{ id: 'new' }])
  })

  it('clears earlier rows and ignores pending reads while authentication is loading', async () => {
    const read = pending()
    listInspectionsForPage.mockReturnValue(read.promise)
    const { result, rerender } = renderHook(props => useInspectionRegister(props), {
      initialProps: { country: 'KSA', enabled: true },
    })
    rerender({ country: 'KSA', enabled: false })
    await act(async () => { read.resolve({ data: [{ id: 'old' }], error: null }) })
    expect(result.current.rows).toEqual([])
    expect(result.current.loading).toBe(false)
  })
})
