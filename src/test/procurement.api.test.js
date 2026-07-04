import { describe, it, expect, vi, beforeEach } from 'vitest'

// Hoisted Supabase mock: chainable, thenable query builder recording table,
// select/order/eq filters and insert/update/upsert payloads. rpc() records
// name + args. maybeSingle resolves like a single-row read.
const h = vi.hoisted(() => {
  const state = { result: { data: [], error: null }, last: null, rpc: { data: null, error: null }, lastRpc: null }
  function rpc(name, args) { state.lastRpc = { name, args }; return Promise.resolve(state.rpc) }
  function from(table) {
    const calls = { eq: [], order: [] }
    const b = {
      _table: table, _calls: calls,
      select(cols, opts) { calls.select = cols; calls.selectOpts = opts; return b },
      order(c, o) { calls.order.push([c, o]); return b },
      eq(c, v) { calls.eq.push([c, v]); return b },
      insert(v) { calls.insert = v; return b },
      update(v) { calls.update = v; return b },
      upsert(v, opts) { calls.upsert = v; calls.upsertOpts = opts; return b },
      maybeSingle() { return Promise.resolve(state.result) },
      then(onF, onR) { return Promise.resolve(state.result).then(onF, onR) },
    }
    state.last = b
    return b
  }
  return { state, supabase: { from, rpc } }
})

vi.mock('../lib/supabase', () => ({ supabase: h.supabase }))

const procurement = await import('../lib/api/procurement')

beforeEach(() => {
  h.state.result = { data: [], error: null }
  h.state.last = null
  h.state.rpc = { data: null, error: null }
  h.state.lastRpc = null
})

describe('service layer - procurement', () => {
  it('getSetting reads a settings value by key via maybeSingle', async () => {
    h.state.result = { data: { value: '5000' }, error: null }
    const res = await procurement.getSetting('tp_procurement_budget')
    expect(h.state.last._table).toBe('settings')
    expect(h.state.last._calls.select).toBe('value')
    expect(h.state.last._calls.eq).toContainEqual(['key', 'tp_procurement_budget'])
    expect(res.data.value).toBe('5000')
  })

  it('listPurchaseOrders orders by order_date desc, STRICT country eq', async () => {
    await procurement.listPurchaseOrders({ country: 'KSA' })
    expect(h.state.last._table).toBe('purchase_orders')
    expect(h.state.last._calls.select).toBe('*')
    expect(h.state.last._calls.order).toContainEqual(['order_date', { ascending: false }])
    expect(h.state.last._calls.eq).toContainEqual(['country', 'KSA'])
  })

  it('listPurchaseOrders applies no country filter for "All"', async () => {
    await procurement.listPurchaseOrders({ country: 'All' })
    expect(h.state.last._calls.eq).toHaveLength(0)
  })

  it('updatePurchaseOrder updates by id', async () => {
    await procurement.updatePurchaseOrder('po1', { status: 'Delivered' })
    expect(h.state.last._calls.update).toEqual({ status: 'Delivered' })
    expect(h.state.last._calls.eq).toContainEqual(['id', 'po1'])
  })

  it('generatePoNumber calls the generate_po_number RPC', async () => {
    h.state.rpc = { data: 'PO-9', error: null }
    const res = await procurement.generatePoNumber()
    expect(h.state.lastRpc.name).toBe('generate_po_number')
    expect(res.data).toBe('PO-9')
  })

  it('insertPurchaseOrder inserts the payload', async () => {
    await procurement.insertPurchaseOrder({ vendor_name: 'Acme' })
    expect(h.state.last._table).toBe('purchase_orders')
    expect(h.state.last._calls.insert).toEqual({ vendor_name: 'Acme' })
  })

  it('upsertSetting upserts key/value on key', async () => {
    await procurement.upsertSetting('tp_procurement_budget', '9000')
    expect(h.state.last._table).toBe('settings')
    expect(h.state.last._calls.upsert).toEqual({ key: 'tp_procurement_budget', value: '9000' })
    expect(h.state.last._calls.upsertOpts).toEqual({ onConflict: 'key' })
  })
})
