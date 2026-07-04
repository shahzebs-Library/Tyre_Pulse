import { describe, it, expect, vi, beforeEach } from 'vitest'

// Chainable, thenable Supabase mock (mirrors src/test/dashboard.api.test.js).
// rpc() records name + args. Records table + select/order/eq/insert/update calls.
const h = vi.hoisted(() => {
  const state = { result: { data: [], error: null }, last: null, rpc: { data: null, error: null }, lastRpc: null }
  function rpc(name, args) { state.lastRpc = { name, args }; return Promise.resolve(state.rpc) }
  function from(table) {
    const calls = { eq: [], order: [] }
    const b = {
      _table: table,
      _calls: calls,
      select(cols) { calls.select = cols; return b },
      order(c) { calls.order.push(c); return b },
      eq(c, v) { calls.eq.push([c, v]); return b },
      insert(v) { calls.insert = v; return b },
      update(v) { calls.update = v; return b },
      then(onF, onR) { return Promise.resolve(state.result).then(onF, onR) },
    }
    state.last = b
    return b
  }
  return { state, supabase: { from, rpc } }
})

vi.mock('../lib/supabase', () => ({ supabase: h.supabase }))

const assetApi = await import('../lib/api/assetManagement')

beforeEach(() => {
  h.state.result = { data: [], error: null }
  h.state.last = null
  h.state.rpc = { data: null, error: null }
  h.state.lastRpc = null
})

describe('service layer - assetManagement', () => {
  it('listFleetMaster selects all and orders by asset_no', async () => {
    await assetApi.listFleetMaster()
    expect(h.state.last._table).toBe('fleet_master')
    expect(h.state.last._calls.select).toBe('*')
    expect(h.state.last._calls.order).toContain('asset_no')
  })

  it('reportAssetOverview calls the RPC with the active country', async () => {
    await assetApi.reportAssetOverview({ country: 'KSA' })
    expect(h.state.lastRpc.name).toBe('report_asset_overview')
    expect(h.state.lastRpc.args).toEqual({ p_country: 'KSA' })
  })

  it('listAssetWorkOrders reads the cost/health columns from work_orders', async () => {
    await assetApi.listAssetWorkOrders()
    expect(h.state.last._table).toBe('work_orders')
    expect(h.state.last._calls.select).toBe('id,asset_no,status,total_cost,created_at,work_type')
  })

  it('listAssetTyres scopes tyre_records by asset_no', async () => {
    await assetApi.listAssetTyres('A1')
    expect(h.state.last._table).toBe('tyre_records')
    expect(h.state.last._calls.eq).toContainEqual(['asset_no', 'A1'])
    expect(h.state.last._calls.select).toContain('tread_depth')
  })

  it('updateAsset updates fleet_master and scopes by id', async () => {
    await assetApi.updateAsset('id1', { site: 'S' })
    expect(h.state.last._table).toBe('fleet_master')
    expect(h.state.last._calls.update).toEqual({ site: 'S' })
    expect(h.state.last._calls.eq).toContainEqual(['id', 'id1'])
  })

  it('insertAsset inserts a single-element array (matches prior inline call)', async () => {
    await assetApi.insertAsset({ asset_no: 'A2' })
    expect(h.state.last._calls.insert).toEqual([{ asset_no: 'A2' }])
  })

  it('pass-through surfaces the raw { data, error } the page reads', async () => {
    h.state.result = { data: [{ id: 'x' }], error: null }
    const res = await assetApi.listFleetMaster()
    expect(res).toEqual({ data: [{ id: 'x' }], error: null })
  })
})
