import { describe, it, expect, vi, beforeEach } from 'vitest'

// Shared, hoisted Supabase mock: a chainable, thenable query builder that
// records the table queried and the eq/or filters applied, and resolves to a
// configurable { data, error }.
const h = vi.hoisted(() => {
  const state = { result: { data: [], error: null }, last: null, rpc: { data: null, error: null }, lastRpc: null }
  function rpc(name, args) { state.lastRpc = { name, args }; return Promise.resolve(state.rpc) }
  function from(table) {
    const calls = { eq: [], or: [], range: [] }
    const b = {
      _table: table,
      _calls: calls,
      select() { return b },
      order() { return b },
      limit() { return b },
      range(a, c) { calls.range.push([a, c]); return b },
      insert(v) { calls.insert = v; return b },
      update(v) { calls.update = v; return b },
      eq(c, v) { calls.eq.push([c, v]); return b },
      or(e) { calls.or.push(e); return b },
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

const { assets, tyres, stock, workOrders, inspections, accidents, gatePasses, correctiveActions, ServiceError, applyCountry } =
  await import('../lib/api')

beforeEach(() => {
  h.state.result = { data: [], error: null }
  h.state.last = null
  h.state.rpc = { data: null, error: null }
  h.state.lastRpc = null
})

describe('service layer - assets', () => {
  it('lists from vehicle_fleet and returns data', async () => {
    h.state.result = { data: [{ id: 'a1', asset_no: 'V-1' }], error: null }
    const rows = await assets.listAssets({ limit: 10 })
    expect(h.state.last._table).toBe('vehicle_fleet')
    expect(rows).toEqual([{ id: 'a1', asset_no: 'V-1' }])
  })

  it('applies a null-safe country filter when a country is active', async () => {
    await assets.listAssets({ country: 'KSA' })
    expect(h.state.last._calls.or).toContain('country.eq.KSA,country.is.null')
  })

  it('does NOT filter country for "All"', async () => {
    await assets.listAssets({ country: 'All' })
    expect(h.state.last._calls.or).toHaveLength(0)
  })

  it('getAsset looks up by id via maybeSingle', async () => {
    h.state.result = { data: { id: 'a1' }, error: null }
    const a = await assets.getAsset('a1')
    expect(h.state.last._table).toBe('vehicle_fleet')
    expect(h.state.last._calls.eq).toContainEqual(['id', 'a1'])
    expect(a).toEqual({ id: 'a1' })
  })

  it('throws a ServiceError on a Supabase error', async () => {
    h.state.result = { data: null, error: { message: 'boom', code: '42501' } }
    await expect(assets.listAssets()).rejects.toBeInstanceOf(ServiceError)
    await expect(assets.listAssets()).rejects.toMatchObject({ code: '42501' })
  })
})

describe('service layer - tyres', () => {
  it('lists from tyre_records and filters by risk level', async () => {
    await tyres.listTyreRecords({ riskLevel: 'Critical' })
    expect(h.state.last._table).toBe('tyre_records')
    expect(h.state.last._calls.eq).toContainEqual(['risk_level', 'Critical'])
  })

  it('getTyreBySerial queries serial_no', async () => {
    h.state.result = { data: { serial_no: 'SN1' }, error: null }
    const t = await tyres.getTyreBySerial('SN1')
    expect(h.state.last._calls.eq).toContainEqual(['serial_no', 'SN1'])
    expect(t).toEqual({ serial_no: 'SN1' })
  })
})

describe('service layer - stock', () => {
  it('lists from stock_records and returns data', async () => {
    h.state.result = { data: [{ id: 's1' }], error: null }
    const rows = await stock.listStock({ limit: 10 })
    expect(h.state.last._table).toBe('stock_records')
    expect(rows).toEqual([{ id: 's1' }])
  })

  it('applies a null-safe country filter and filters by stock status', async () => {
    await stock.listStock({ country: 'KSA', status: 'Low' })
    expect(h.state.last._calls.or).toContain('country.eq.KSA,country.is.null')
    expect(h.state.last._calls.eq).toContainEqual(['stock_status', 'Low'])
  })
})

describe('service layer - workOrders', () => {
  it('lists from work_orders and applies country filter', async () => {
    await workOrders.listWorkOrders({ country: 'UAE', status: 'Open' })
    expect(h.state.last._table).toBe('work_orders')
    expect(h.state.last._calls.or).toContain('country.eq.UAE,country.is.null')
    expect(h.state.last._calls.eq).toContainEqual(['status', 'Open'])
  })

  it('does NOT filter country for "All"', async () => {
    await workOrders.listWorkOrders({ country: 'All' })
    expect(h.state.last._calls.or).toHaveLength(0)
  })
})

describe('service layer - inspections', () => {
  it('lists from inspections and applies country filter', async () => {
    await inspections.listInspections({ country: 'Oman', severity: 'High' })
    expect(h.state.last._table).toBe('inspections')
    expect(h.state.last._calls.or).toContain('country.eq.Oman,country.is.null')
    expect(h.state.last._calls.eq).toContainEqual(['severity', 'High'])
  })

  it('getInspection looks up by id via maybeSingle', async () => {
    h.state.result = { data: { id: 'i1' }, error: null }
    const i = await inspections.getInspection('i1')
    expect(h.state.last._calls.eq).toContainEqual(['id', 'i1'])
    expect(i).toEqual({ id: 'i1' })
  })
})

describe('service layer - accidents', () => {
  it('lists from accidents and applies country filter', async () => {
    await accidents.listAccidents({ country: 'Qatar', status: 'Open' })
    expect(h.state.last._table).toBe('accidents')
    expect(h.state.last._calls.or).toContain('country.eq.Qatar,country.is.null')
    expect(h.state.last._calls.eq).toContainEqual(['status', 'Open'])
  })

  it('throws a ServiceError on a Supabase error', async () => {
    h.state.result = { data: null, error: { message: 'boom', code: '42501' } }
    await expect(accidents.listAccidents()).rejects.toBeInstanceOf(ServiceError)
  })
})

describe('service layer - gatePasses safety gate', () => {
  it('lists blockers via the gate_pass_blockers RPC with trimmed asset + country', async () => {
    h.state.rpc = { data: { asset_no: 'A1', total: 0, blocked: false, corrective_actions: [], tyres: [], inspections: [] }, error: null }
    await gatePasses.listGatePassBlockers({ assetNo: '  A1 ', country: 'KSA' })
    expect(h.state.lastRpc.name).toBe('gate_pass_blockers')
    expect(h.state.lastRpc.args).toEqual({ p_asset_no: 'A1', p_country: 'KSA' })
  })

  it('passes null country for "All"', async () => {
    h.state.rpc = { data: { total: 0, blocked: false }, error: null }
    await gatePasses.listGatePassBlockers({ assetNo: 'A1', country: 'All' })
    expect(h.state.lastRpc.args.p_country).toBeNull()
  })

  it('refuses to create a Cleared pass when blockers exist (BLOCKED)', async () => {
    h.state.rpc = { data: { asset_no: 'A1', total: 2, blocked: true, corrective_actions: [{ id: 'c1' }], tyres: [], inspections: [] }, error: null }
    await expect(gatePasses.createGatePass({ asset_no: 'A1', status: 'Cleared', country: 'KSA' }))
      .rejects.toMatchObject({ code: 'BLOCKED' })
  })

  it('allows a Denied pass without running the safety gate', async () => {
    h.state.result = { data: { id: 'g1', status: 'Denied' }, error: null }
    const { pass } = await gatePasses.createGatePass({ asset_no: 'A1', status: 'Denied' })
    expect(h.state.lastRpc).toBeNull() // gate not consulted for denials
    expect(pass.status).toBe('Denied')
  })

  it('requires an assetNo', async () => {
    await expect(gatePasses.listGatePassBlockers({})).rejects.toBeInstanceOf(ServiceError)
  })
})

describe('service layer - correctiveActions', () => {
  it('lists from corrective_actions with STRICT country eq (not null-inclusive)', async () => {
    await correctiveActions.listCorrectiveActions({ country: 'KSA' })
    expect(h.state.last._table).toBe('corrective_actions')
    expect(h.state.last._calls.eq).toContainEqual(['country', 'KSA'])
    expect(h.state.last._calls.or).toHaveLength(0)
  })

  it('applies no country filter for "All"', async () => {
    await correctiveActions.listCorrectiveActions({ country: 'All' })
    expect(h.state.last._calls.eq).toHaveLength(0)
  })

  it('updateCorrectiveAction patches by id', async () => {
    await correctiveActions.updateCorrectiveAction('ca1', { status: 'Closed' })
    expect(h.state.last._calls.update).toEqual({ status: 'Closed' })
    expect(h.state.last._calls.eq).toContainEqual(['id', 'ca1'])
  })

  it('throws a ServiceError on a Supabase error', async () => {
    h.state.result = { data: null, error: { message: 'boom', code: '42501' } }
    await expect(correctiveActions.listCorrectiveActions()).rejects.toBeInstanceOf(ServiceError)
  })
})

describe('applyCountry helper', () => {
  it('adds an or() filter for a real country', () => {
    const calls = []
    const q = { or: (e) => { calls.push(e); return q } }
    applyCountry(q, 'UAE')
    expect(calls).toEqual(['country.eq.UAE,country.is.null'])
  })
  it('is a no-op for empty / All', () => {
    const q = { or: () => { throw new Error('should not filter') } }
    expect(() => applyCountry(q, '')).not.toThrow()
    expect(() => applyCountry(q, 'All')).not.toThrow()
  })
})
