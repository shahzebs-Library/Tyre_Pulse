import { describe, it, expect, vi, beforeEach } from 'vitest'

// Chainable, thenable Supabase mock (mirrors src/test/dashboard.api.test.js)
// extended with not()/in() for the Gate Pass page queries.
const h = vi.hoisted(() => {
  const state = { result: { data: [], error: null }, last: null }
  function from(table) {
    const calls = { eq: [], order: [], gte: [], lte: [], in: [], not: [], limit: null }
    const b = {
      _table: table,
      _calls: calls,
      select(cols) { calls.select = cols; return b },
      order(c, o) { calls.order.push([c, o]); return b },
      eq(c, v) { calls.eq.push([c, v]); return b },
      gte(c, v) { calls.gte.push([c, v]); return b },
      lte(c, v) { calls.lte.push([c, v]); return b },
      in(c, v) { calls.in.push([c, v]); return b },
      not(c, op, v) { calls.not.push([c, op, v]); return b },
      limit(n) { calls.limit = n; return b },
      range(f, t) { calls.range = [f, t]; return b },
      insert(v) { calls.insert = v; return b },
      then(onF, onR) { return Promise.resolve(state.result).then(onF, onR) },
    }
    state.last = b
    return b
  }
  return { state, supabase: { from } }
})

vi.mock('../lib/supabase', () => ({ supabase: h.supabase }))

const gatePassPageApi = await import('../lib/api/gatePassPage')

beforeEach(() => {
  h.state.result = { data: [], error: null }
  h.state.last = null
})

describe('service layer - gatePassPage', () => {
  it('listGatePassSites reads non-null sites from vehicle_fleet', async () => {
    await gatePassPageApi.listGatePassSites()
    expect(h.state.last._table).toBe('vehicle_fleet')
    expect(h.state.last._calls.select).toBe('site')
    expect(h.state.last._calls.not).toContainEqual(['site', 'is', null])
  })

  it('listGatePasses filters by pass_date, newest-first, and applies the site filter', async () => {
    await gatePassPageApi.listGatePasses({ date: '2026-07-04', site: 'Riyadh' })
    expect(h.state.last._table).toBe('gate_passes')
    expect(h.state.last._calls.eq).toContainEqual(['pass_date', '2026-07-04'])
    expect(h.state.last._calls.eq).toContainEqual(['site', 'Riyadh'])
    expect(h.state.last._calls.order).toContainEqual(['created_at', { ascending: false }])
  })

  it('listGatePasses omits the site filter when no site given', async () => {
    await gatePassPageApi.listGatePasses({ date: '2026-07-04' })
    expect(h.state.last._calls.eq).toContainEqual(['pass_date', '2026-07-04'])
    expect(h.state.last._calls.eq).not.toContainEqual(['site', undefined])
  })

  it('findAssetInspectionForClearance builds the exact clearance filter chain', async () => {
    await gatePassPageApi.findAssetInspectionForClearance({ assetNo: 'A1', date: '2026-07-04' })
    expect(h.state.last._table).toBe('inspections')
    expect(h.state.last._calls.eq).toContainEqual(['asset_no', 'A1'])
    expect(h.state.last._calls.gte).toContainEqual(['scheduled_date', '2026-07-04'])
    expect(h.state.last._calls.lte).toContainEqual(['scheduled_date', '2026-07-04'])
    expect(h.state.last._calls.in).toContainEqual(['status', ['Done', 'In Progress']])
    expect(h.state.last._calls.order).toContainEqual(['created_at', { ascending: false }])
    expect(h.state.last._calls.limit).toBe(1)
  })

  it('insertGatePass inserts the pass values', async () => {
    await gatePassPageApi.insertGatePass({ asset_no: 'A1', status: 'Denied' })
    expect(h.state.last._table).toBe('gate_passes')
    expect(h.state.last._calls.insert).toEqual({ asset_no: 'A1', status: 'Denied' })
  })

  it('listGatePasses pages past the 1000-row cap and surfaces { data, error }', async () => {
    h.state.result = { data: [{ id: 'g1' }], error: null }
    const res = await gatePassPageApi.listGatePasses({ date: 'd' })
    expect(res).toEqual({ data: [{ id: 'g1' }], error: null, truncated: false })
    expect(h.state.last._calls.range).toEqual([0, 999])
  })
})
