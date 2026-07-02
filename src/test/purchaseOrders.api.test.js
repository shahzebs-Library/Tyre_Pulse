import { describe, it, expect, vi, beforeEach } from 'vitest'

// Hoisted Supabase mock - same shape as api.test.js: a chainable, thenable
// query builder that records the table, eq/or/gte/range filters, and resolves
// to a configurable { data, error }. rpc() records name + args.
const h = vi.hoisted(() => {
  const state = { result: { data: [], error: null }, last: null, rpc: { data: null, error: null }, lastRpc: null }
  function rpc(name, args) { state.lastRpc = { name, args }; return Promise.resolve(state.rpc) }
  function from(table) {
    const calls = { eq: [], or: [], gte: [], range: [] }
    const b = {
      _table: table,
      _calls: calls,
      select() { return b },
      order() { return b },
      limit() { return b },
      insert(v) { calls.insert = v; return b },
      update(v) { calls.update = v; return b },
      delete() { calls.delete = true; return b },
      eq(c, v) { calls.eq.push([c, v]); return b },
      or(e) { calls.or.push(e); return b },
      gte(c, v) { calls.gte.push([c, v]); return b },
      range(f, t) { calls.range.push([f, t]); return b },
      maybeSingle() { return Promise.resolve(state.result) },
      single() { return Promise.resolve(state.result) },
      then(onF, onR) { return Promise.resolve(state.result).then(onF, onR) },
    }
    state.last = b
    return b
  }
  return { state, supabase: { from, rpc } }
})

vi.mock('../lib/supabase', () => ({ supabase: h.supabase }))

const purchaseOrders = await import('../lib/api/purchaseOrders')
const { ServiceError } = await import('../lib/api/_client')

beforeEach(() => {
  h.state.result = { data: [], error: null }
  h.state.last = null
  h.state.rpc = { data: null, error: null }
  h.state.lastRpc = null
})

describe('service layer - purchaseOrders', () => {
  it('createPurchaseOrder inserts into purchase_orders and returns the row', async () => {
    h.state.result = { data: { po_number: 'PO-1' }, error: null }
    const payload = { po_number: 'PO-1', vendor_name: 'Acme', status: 'Draft' }
    const row = await purchaseOrders.createPurchaseOrder(payload)
    expect(h.state.last._table).toBe('purchase_orders')
    expect(h.state.last._calls.insert).toEqual(payload)
    expect(row).toEqual({ po_number: 'PO-1' })
  })

  it('generatePoNumber calls the generate_po_number RPC and returns its value', async () => {
    h.state.rpc = { data: 'PO-2026-00042', error: null }
    const po = await purchaseOrders.generatePoNumber()
    expect(h.state.lastRpc.name).toBe('generate_po_number')
    expect(po).toBe('PO-2026-00042')
  })

  it('generatePoNumber throws a ServiceError on RPC failure', async () => {
    h.state.rpc = { data: null, error: { message: 'no fn', code: '42883' } }
    await expect(purchaseOrders.generatePoNumber()).rejects.toBeInstanceOf(ServiceError)
  })

  it('listReplenishmentStock reads `stock` with NULL-inclusive country scoping', async () => {
    h.state.result = { data: [{ id: 's1' }], error: null }
    const rows = await purchaseOrders.listReplenishmentStock({ country: 'KSA' })
    expect(h.state.last._table).toBe('stock')
    expect(h.state.last._calls.or).toContain('country.eq.KSA,country.is.null')
    expect(rows).toEqual([{ id: 's1' }])
  })

  it('listReplenishmentStock applies no country filter for "All"', async () => {
    await purchaseOrders.listReplenishmentStock({ country: 'All' })
    expect(h.state.last._table).toBe('stock')
    expect(h.state.last._calls.or).toHaveLength(0)
  })

  it('listReplenishmentTyreRecords reads tyre_records with the date + country filters and pages', async () => {
    h.state.result = { data: [], error: null }
    await purchaseOrders.listReplenishmentTyreRecords({ country: 'UAE', sinceDate: '2026-04-02' })
    expect(h.state.last._table).toBe('tyre_records')
    expect(h.state.last._calls.gte).toContainEqual(['issue_date', '2026-04-02'])
    expect(h.state.last._calls.or).toContain('country.eq.UAE,country.is.null')
    expect(h.state.last._calls.range.length).toBeGreaterThan(0)
  })

  it('listReplenishmentTyreRecords throws a ServiceError when a page errors', async () => {
    h.state.result = { data: null, error: { message: 'boom', code: '42501' } }
    await expect(
      purchaseOrders.listReplenishmentTyreRecords({ sinceDate: '2026-04-02' })
    ).rejects.toBeInstanceOf(ServiceError)
  })
})
