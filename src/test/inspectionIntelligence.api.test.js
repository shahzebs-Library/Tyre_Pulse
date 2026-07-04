import { describe, it, expect, vi, beforeEach } from 'vitest'

// Chainable, thenable Supabase mock (mirrors src/test/dashboard.api.test.js).
// Records select/eq/or/insert so we can assert the STRICT (eq) country scope
// this page uses - deliberately NOT the null-safe OR filter.
const h = vi.hoisted(() => {
  const state = { result: { data: [], error: null }, last: null }
  function from(table) {
    const calls = { eq: [], or: [] }
    const b = {
      _table: table,
      _calls: calls,
      select(cols) { calls.select = cols; return b },
      eq(c, v) { calls.eq.push([c, v]); return b },
      or(e) { calls.or.push(e); return b },
      insert(v) { calls.insert = v; return b },
      then(onF, onR) { return Promise.resolve(state.result).then(onF, onR) },
    }
    state.last = b
    return b
  }
  return { state, supabase: { from } }
})

vi.mock('../lib/supabase', () => ({ supabase: h.supabase }))

const inspIntelApi = await import('../lib/api/inspectionIntelligence')

beforeEach(() => {
  h.state.result = { data: [], error: null }
  h.state.last = null
})

describe('service layer - inspectionIntelligence', () => {
  it('listInspectionIntelInspections strict-scopes inspections when a country is active', async () => {
    await inspIntelApi.listInspectionIntelInspections({ country: 'KSA' })
    expect(h.state.last._table).toBe('inspections')
    expect(h.state.last._calls.select).toBe('*')
    // Strict eq - never the null-safe OR filter.
    expect(h.state.last._calls.eq).toContainEqual(['country', 'KSA'])
    expect(h.state.last._calls.or).toHaveLength(0)
  })

  it('listInspectionIntelInspections omits the country filter for "All"', async () => {
    await inspIntelApi.listInspectionIntelInspections({ country: 'All' })
    expect(h.state.last._calls.eq).toHaveLength(0)
  })

  it('listInspectionIntelFleet strict-scopes vehicle_fleet', async () => {
    await inspIntelApi.listInspectionIntelFleet({ country: 'UAE' })
    expect(h.state.last._table).toBe('vehicle_fleet')
    expect(h.state.last._calls.select).toBe('asset_no, site, country')
    expect(h.state.last._calls.eq).toContainEqual(['country', 'UAE'])
  })

  it('insertCorrectiveAction inserts the raised-alert payload', async () => {
    await inspIntelApi.insertCorrectiveAction({ asset_no: 'A1', status: 'Open' })
    expect(h.state.last._table).toBe('corrective_actions')
    expect(h.state.last._calls.insert).toEqual({ asset_no: 'A1', status: 'Open' })
  })

  it('pass-through surfaces the raw { data, error } the page reads', async () => {
    h.state.result = { data: [{ id: 'i1' }], error: null }
    const res = await inspIntelApi.listInspectionIntelInspections({ country: 'All' })
    expect(res).toEqual({ data: [{ id: 'i1' }], error: null })
  })
})
