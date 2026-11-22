import { describe, it, expect, vi, beforeEach } from 'vitest'

const calls = []
const state = { truncated: false }
function builder(table) {
  const b = { table, orders: [] }
  for (const m of ['select', 'eq', 'in', 'or', 'gte', 'lte', 'range', 'limit']) b[m] = () => b
  b.order = (col) => { b.orders.push(col); return b }
  b.then = (res, rej) => Promise.resolve({ data: [], error: null }).then(res, rej)
  calls.push(b)
  return b
}
vi.mock('../lib/supabase', () => ({ supabase: { from: (t) => builder(t), rpc: () => Promise.resolve({ data: null, error: null }) } }))
vi.mock('../lib/fetchAll', () => ({
  fetchAllPages: async (fn) => { await fn(0, 999); return { data: [{ id: 'x' }], error: null, truncated: state.truncated } },
  fetchAllRpcPages: async () => ({ data: [], error: null }),
}))

import { loadStockHistory, _readByIds } from '../lib/api/inventoryKpi'

beforeEach(() => { calls.length = 0; state.truncated = false })

describe('inventory KPI source reads', () => {
  it('orders v_inventory_valuation by its own key only (the view has no id column)', async () => {
    await loadStockHistory({ country: 'KSA', site: 'all' })
    const val = calls.find((c) => c.table === 'v_inventory_valuation')
    expect(val.orders).toEqual(['stock_id'])
    const mv = calls.find((c) => c.table === 'v_inv_movements' && c.orders.length > 1)
    expect(mv.orders).toEqual(['posted_at', 'id'])
  })

  it('keeps the truncated flag of batched child reads', async () => {
    state.truncated = true
    const ids = Array.from({ length: 150 }, (_, i) => `po${i}`)
    const r = await _readByIds('purchase_order_lines', 'id', 'po_id', ids)
    expect(r.status).toBe('ok')
    expect(r.truncated).toBe(true)
    state.truncated = false
    expect((await _readByIds('purchase_order_lines', 'id', 'po_id', ids)).truncated).toBe(false)
  })
})
