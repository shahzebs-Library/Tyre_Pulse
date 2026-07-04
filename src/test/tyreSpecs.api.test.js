import { describe, it, expect, vi, beforeEach } from 'vitest'

// Hoisted Supabase mock: chainable, thenable query builder (also supports
// .catch for the soft-failing fleet_master read and .range for the paged
// compliance read via the real fetchAllPages). rpc() records name + args.
const h = vi.hoisted(() => {
  const state = { result: { data: [], error: null }, last: null, rpc: { data: null, error: null }, lastRpc: null }
  function rpc(name, args) { state.lastRpc = { name, args }; return Promise.resolve(state.rpc) }
  function from(table) {
    const calls = { eq: [], or: [], order: [], range: [] }
    const b = {
      _table: table, _calls: calls,
      select(cols, opts) { calls.select = cols; calls.selectOpts = opts; return b },
      order(c, o) { calls.order.push([c, o]); return b },
      eq(c, v) { calls.eq.push([c, v]); return b },
      or(e) { calls.or.push(e); return b },
      insert(v) { calls.insert = v; return b },
      update(v) { calls.update = v; return b },
      delete() { calls.delete = true; return b },
      range(f, t) { calls.range.push([f, t]); return b },
      then(onF, onR) { return Promise.resolve(state.result).then(onF, onR) },
      catch(onR) { return Promise.resolve(state.result).catch(onR) },
    }
    state.last = b
    return b
  }
  return { state, supabase: { from, rpc } }
})

vi.mock('../lib/supabase', () => ({ supabase: h.supabase }))

const tyreSpecs = await import('../lib/api/tyreSpecs')

beforeEach(() => {
  h.state.result = { data: [], error: null }
  h.state.last = null
  h.state.rpc = { data: null, error: null }
  h.state.lastRpc = null
})

describe('service layer - tyreSpecs', () => {
  it('listSpecs NULL-inclusive country scope + double order', async () => {
    await tyreSpecs.listSpecs({ country: 'KSA' })
    expect(h.state.last._table).toBe('tyre_specifications')
    expect(h.state.last._calls.select).toContain('approved_sizes')
    expect(h.state.last._calls.or).toContain('country.eq.KSA,country.is.null')
    expect(h.state.last._calls.order).toContainEqual(['vehicle_type', { ascending: true }])
    expect(h.state.last._calls.order).toContainEqual(['position', { ascending: true }])
  })

  it('listSpecs omits the country OR when no country', async () => {
    await tyreSpecs.listSpecs({})
    expect(h.state.last._calls.or).toHaveLength(0)
  })

  it('listComplianceTyreRecords uses STRICT eq country scope and pages', async () => {
    await tyreSpecs.listComplianceTyreRecords({ country: 'UAE' })
    expect(h.state.last._table).toBe('tyre_records')
    expect(h.state.last._calls.eq).toContainEqual(['country', 'UAE'])
    expect(h.state.last._calls.or).toHaveLength(0)
    expect(h.state.last._calls.range.length).toBeGreaterThan(0)
  })

  it('listComplianceTyreRecords applies no country filter for "All"', async () => {
    await tyreSpecs.listComplianceTyreRecords({ country: 'All' })
    expect(h.state.last._calls.eq).toHaveLength(0)
  })

  it('getFleetMaster reads fleet_master and soft-fails to { data: null }', async () => {
    const res = await tyreSpecs.getFleetMaster()
    expect(h.state.last._table).toBe('fleet_master')
    expect(h.state.last._calls.select).toContain('vehicle_type')
    expect(res).toBeTruthy()
  })

  it('generateWorkOrderNo calls the RPC', async () => {
    h.state.rpc = { data: 'WO-1', error: null }
    const res = await tyreSpecs.generateWorkOrderNo()
    expect(h.state.lastRpc.name).toBe('generate_work_order_no')
    expect(res.data).toBe('WO-1')
  })

  it('insertWorkOrder inserts into work_orders', async () => {
    await tyreSpecs.insertWorkOrder({ asset_no: 'A1' })
    expect(h.state.last._table).toBe('work_orders')
    expect(h.state.last._calls.insert).toEqual({ asset_no: 'A1' })
  })

  it('updateSpec / insertSpec / deleteSpec target tyre_specifications', async () => {
    await tyreSpecs.updateSpec('s1', { notes: 'x' })
    expect(h.state.last._table).toBe('tyre_specifications')
    expect(h.state.last._calls.update).toEqual({ notes: 'x' })
    expect(h.state.last._calls.eq).toContainEqual(['id', 's1'])

    await tyreSpecs.insertSpec([{ vehicle_type: 'Tipper' }])
    expect(h.state.last._calls.insert).toEqual([{ vehicle_type: 'Tipper' }])

    await tyreSpecs.deleteSpec('s2')
    expect(h.state.last._calls.delete).toBe(true)
    expect(h.state.last._calls.eq).toContainEqual(['id', 's2'])
  })
})
