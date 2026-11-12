import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * The existing-key read pages by KEYSET (`id > last id of the previous page`),
 * not by OFFSET. With OFFSET the server re-walked and re-sorted every earlier row
 * for each page (measured on work_orders: 15,452 buffers plus a temp spill for one
 * 1,000-row page at offset 50,000, against 1,470 by keyset), so one intake read
 * grew with the square of the table.
 *
 * Pinned here: page 2 asks for `id > <last id of page 1>` starting at row 0, every
 * key from every page is recognised, and a projection without ids still pages by
 * offset rather than looping on page 1.
 */
const h = vi.hoisted(() => {
  const state = { pages: [], calls: [] }
  function from(table) {
    const call = { table, gt: null, range: null, cols: null }
    const b = {
      select(c) { call.cols = c; return b },
      eq() { return b },
      not() { return b },
      in() { return b },
      gt(col, v) { call.gt = { col, v }; return b },
      order() { return b },
      range(f, t) {
        call.range = [f, t]
        state.calls.push(call)
        const page = state.pages[state.calls.length - 1] || []
        return Promise.resolve({ data: page, error: null })
      },
      then(onF, onR) { return Promise.resolve({ data: [], error: null }).then(onF, onR) },
    }
    return b
  }
  return { state, supabase: { from, rpc: async () => ({ data: null, error: null }) } }
})

vi.mock('../lib/supabase', () => ({ supabase: h.supabase }))

const intake = await import('../lib/api/erpIntake')

const fullPage = (start, withId = true) => Array.from({ length: 1000 }, (_, i) => ({
  work_order_no: `WO-${start + i}`,
  ...(withId ? { id: `id-${String(start + i).padStart(6, '0')}` } : {}),
}))

beforeEach(() => { h.state.pages = []; h.state.calls = [] })

describe('ERP intake existing-key read uses keyset paging', () => {
  it('asks page 2 for id > last id of page 1, from row 0', async () => {
    h.state.pages = [fullPage(0), [{ work_order_no: 'WO-1000', id: 'id-001000' }]]
    const res = await intake.countExistingRows(
      'work_orders', [{ work_order_no: 'wo-5' }, { work_order_no: 'WO-1000' }, { work_order_no: 'NEW-1' }], {},
    )
    expect(h.state.calls).toHaveLength(2)
    expect(h.state.calls[0].gt).toBeNull()
    expect(h.state.calls[0].range).toEqual([0, 999])
    expect(h.state.calls[0].cols).toContain('id')
    expect(h.state.calls[1].gt).toEqual({ col: 'id', v: 'id-000999' })
    expect(h.state.calls[1].range).toEqual([0, 999])
    // keys from BOTH pages are recognised
    expect(res).toMatchObject({ total: 3, existing: 2, fresh: 1 })
  })

  it('falls back to offset paging when rows carry no id', async () => {
    h.state.pages = [fullPage(0, false), [{ work_order_no: 'WO-1000' }]]
    await intake.countExistingRows('work_orders', [{ work_order_no: 'WO-1' }], {})
    expect(h.state.calls).toHaveLength(2)
    expect(h.state.calls[1].gt).toBeNull()
    expect(h.state.calls[1].range).toEqual([1000, 1999])
  })
})
