import { describe, it, expect, vi, beforeEach } from 'vitest'

const h = vi.hoisted(() => ({ calls: [], tyreResults: [], stock: [] }))
vi.mock('../lib/api/_client', () => {
  const builder = table => {
    const call = { table, ops: [] }
    h.calls.push(call)
    const b = {}
    for (const op of ['select', 'eq', 'is', 'or', 'order', 'range']) b[op] = (...a) => { call.ops.push([op, ...a]); return b }
    b.limit = (...a) => { call.ops.push(['limit', ...a]); return Promise.resolve(h.tyreResults.shift()) }
    return b
  }
  return {
    supabase: { from: builder },
    applyCountry: (q, c) => (c && c !== 'All' ? q.or(`country.eq.${c},country.is.null`) : q),
    toServiceError: e => e,
    fetchAllPages: async fn => { fn(0, 999); return { data: h.stock, error: null, truncated: false } },
  }
})

import { loadStockReadiness } from '../lib/api/workforceStockReadiness'

beforeEach(() => { h.calls.length = 0; h.tyreResults.length = 0; h.stock = [{ site: 'NHC', description: '315/80R22.5 Eracle', stock_qty: 4 }] })

describe('loadStockReadiness', () => {
  it('reads fitted tyres for the selected country only', async () => {
    h.tyreResults.push({ data: [{ size: '315/80 R22.5', status: 'Active', removal_date: null }], error: null })
    const r = await loadStockReadiness({ assetNo: 'tm514', site: 'NHC', country: 'KSA' })
    const tyre = h.calls.filter(c => c.table === 'tyre_records')
    expect(tyre).toHaveLength(1)
    expect(tyre[0].ops).toContainEqual(['eq', 'asset_no', 'TM514'])
    expect(tyre[0].ops).toContainEqual(['is', 'removal_date', null])
    expect(tyre[0].ops).toContainEqual(['or', 'country.eq.KSA,country.is.null'])
    expect(r.result.lines[0]).toMatchObject({ size: '315/80R22.5', state: 'in_stock', qty: 4 })
  })

  it('falls back to newest history only when nothing is fitted', async () => {
    h.tyreResults.push({ data: [], error: null }, { data: [{ size: '315/80R22.5', status: 'Removed', removal_date: '2026-01-01' }], error: null })
    const r = await loadStockReadiness({ assetNo: 'TM514', site: 'NHC', country: 'KSA' })
    const tyre = h.calls.filter(c => c.table === 'tyre_records')
    expect(tyre).toHaveLength(2)
    expect(tyre[1].ops).toContainEqual(['order', 'removal_date', { ascending: false, nullsFirst: false }])
    expect(tyre[1].ops).toContainEqual(['or', 'country.eq.KSA,country.is.null'])
    expect(r.result.state).toBe('in_stock')
  })

  it('a failed read reports failure instead of a figure', async () => {
    h.tyreResults.push({ data: null, error: new Error('denied') })
    expect((await loadStockReadiness({ assetNo: 'TM514', site: 'NHC' })).ok).toBe(false)
  })
})
