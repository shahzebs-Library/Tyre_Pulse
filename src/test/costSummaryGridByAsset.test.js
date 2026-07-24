import { describe, it, expect, vi, beforeEach } from 'vitest'

// Hoisted Supabase mock. costSummary.js imports { supabase } from './_client',
// which re-exports the singleton from '../supabase'. loadGridTyreByAsset only
// touches supabase.rpc('get_tyre_cost_by_asset', ...), so a thin rpc mock is
// sufficient - the from()/fetchAllPages paths are not reached by this function.
const h = vi.hoisted(() => {
  const state = { rpc: { data: null, error: null }, lastRpc: null }
  function rpc(name, args) {
    state.lastRpc = { name, args }
    return Promise.resolve(state.rpc)
  }
  return { state, supabase: { rpc, from: () => { throw new Error('from() should not be called') } } }
})

vi.mock('../lib/supabase', () => ({ supabase: h.supabase }))

const { loadGridTyreByAsset } = await import('../lib/api/costSummary')

beforeEach(() => {
  h.state.rpc = { data: null, error: null }
  h.state.lastRpc = null
})

describe('service layer - loadGridTyreByAsset', () => {
  it('calls get_tyre_cost_by_asset and returns { map, total } keyed by UPPER(TRIM(asset_code))', async () => {
    h.state.rpc = {
      data: [
        { asset_code: ' a1 ', tyre_cost: 1000 },
        { asset_code: 'b2', tyre_cost: 250.5 },
      ],
      error: null,
    }
    const out = await loadGridTyreByAsset({ country: 'KSA', from: '2026-01-01', to: '2026-12-31' })
    expect(h.state.lastRpc.name).toBe('get_tyre_cost_by_asset')
    expect(h.state.lastRpc.args).toEqual({ p_country: 'KSA', p_from: '2026-01-01', p_to: '2026-12-31' })
    expect(out.map instanceof Map).toBe(true)
    expect(out.map.get('A1')).toBe(1000)
    expect(out.map.get('B2')).toBe(250.5)
    expect(out.total).toBe(1250.5)
  })

  it('passes null args and skips rows with a blank asset_code', async () => {
    h.state.rpc = {
      data: [
        { asset_code: '', tyre_cost: 999 },
        { asset_code: '  ', tyre_cost: 5 },
        { asset_code: 'C3', tyre_cost: 40 },
      ],
      error: null,
    }
    const out = await loadGridTyreByAsset()
    expect(h.state.lastRpc.args).toEqual({ p_country: null, p_from: null, p_to: null })
    expect(out.map.size).toBe(1)
    expect(out.map.get('C3')).toBe(40)
    expect(out.total).toBe(40)
  })

  it("treats 'All' country as null", async () => {
    h.state.rpc = { data: [{ asset_code: 'A1', tyre_cost: 10 }], error: null }
    await loadGridTyreByAsset({ country: 'All' })
    expect(h.state.lastRpc.args.p_country).toBeNull()
  })

  it('returns null when the RPC errors', async () => {
    h.state.rpc = { data: null, error: { message: 'boom', code: '42501' } }
    expect(await loadGridTyreByAsset()).toBeNull()
  })

  it('returns null when data is an empty array', async () => {
    h.state.rpc = { data: [], error: null }
    expect(await loadGridTyreByAsset()).toBeNull()
  })

  it('returns null when data is null', async () => {
    h.state.rpc = { data: null, error: null }
    expect(await loadGridTyreByAsset()).toBeNull()
  })
})
