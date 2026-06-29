import { describe, it, expect, vi, beforeEach } from 'vitest'

// Shared, hoisted Supabase mock: a chainable, thenable query builder that
// records the table queried and the eq/or filters applied, and resolves to a
// configurable { data, error }.
const h = vi.hoisted(() => {
  const state = { result: { data: [], error: null }, last: null }
  function from(table) {
    const calls = { eq: [], or: [] }
    const b = {
      _table: table,
      _calls: calls,
      select() { return b },
      order() { return b },
      limit() { return b },
      eq(c, v) { calls.eq.push([c, v]); return b },
      or(e) { calls.or.push(e); return b },
      maybeSingle() { return Promise.resolve(state.result) },
      then(onF, onR) { return Promise.resolve(state.result).then(onF, onR) },
    }
    state.last = b
    return b
  }
  return { state, supabase: { from } }
})

vi.mock('../lib/supabase', () => ({ supabase: h.supabase }))

const { assets, tyres, ServiceError, applyCountry } = await import('../lib/api')

beforeEach(() => {
  h.state.result = { data: [], error: null }
  h.state.last = null
})

describe('service layer — assets', () => {
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

describe('service layer — tyres', () => {
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
