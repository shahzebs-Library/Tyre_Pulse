import { describe, it, expect, vi, beforeEach } from 'vitest'

// Hoisted Supabase mock (mirrors dataQuality.test.js / reconDupKeys.test.js):
// records the last rpc(name, args) and resolves to a configurable { data, error }.
// assetMaster.js imports { supabase } from './_client', which re-exports the
// singleton from '../supabase', so mocking '../lib/supabase' covers it.
const h = vi.hoisted(() => {
  const state = { rpc: { data: null, error: null }, lastRpc: null }
  function rpc(name, args) {
    state.lastRpc = { name, args }
    return Promise.resolve(state.rpc)
  }
  return { state, supabase: { rpc } }
})

vi.mock('../lib/supabase', () => ({ supabase: h.supabase }))

const { getAssetMaster, COUNTRY_CURRENCY } = await import('../lib/api/assetMaster')

beforeEach(() => {
  h.state.rpc = { data: null, error: null }
  h.state.lastRpc = null
})

describe('service layer - getAssetMaster', () => {
  it('calls get_asset_master with p_search and p_limit and returns the array on success', async () => {
    const rows = [
      { asset_no: 'A1', countries: 'KSA', country_count: 1, make: 'Volvo', model: 'FH', vehicle_type: 'TR-MIXER', tyres: 12, work_orders: 30, by_country: [] },
      { asset_no: 'A2', countries: 'KSA,UAE', country_count: 2, make: 'Scania', model: 'P', vehicle_type: 'PUMPS', tyres: 8, work_orders: 15, by_country: [] },
    ]
    h.state.rpc = { data: rows, error: null }
    const out = await getAssetMaster({ search: 'volvo', limit: 500 })
    expect(out).toEqual(rows)
    expect(h.state.lastRpc.name).toBe('get_asset_master')
    expect(h.state.lastRpc.args).toEqual({ p_search: 'volvo', p_limit: 500 })
  })

  it('trims the search term before passing it', async () => {
    h.state.rpc = { data: [], error: null }
    await getAssetMaster({ search: '  A1  ' })
    expect(h.state.lastRpc.args.p_search).toBe('A1')
    expect(h.state.lastRpc.args.p_limit).toBe(1000) // default
  })

  it('passes null p_search when search is blank', async () => {
    h.state.rpc = { data: [], error: null }
    await getAssetMaster({ search: '   ' })
    expect(h.state.lastRpc.args.p_search).toBeNull()
  })

  it('passes null p_search when search is undefined (no args)', async () => {
    h.state.rpc = { data: [], error: null }
    await getAssetMaster()
    expect(h.state.lastRpc.name).toBe('get_asset_master')
    expect(h.state.lastRpc.args).toEqual({ p_search: null, p_limit: 1000 })
  })

  it('returns [] on an RPC error', async () => {
    h.state.rpc = { data: null, error: { message: 'boom', code: '42501' } }
    expect(await getAssetMaster({ search: 'x' })).toEqual([])
  })

  it('returns [] on a null payload', async () => {
    h.state.rpc = { data: null, error: null }
    expect(await getAssetMaster()).toEqual([])
  })

  it('returns [] on a non-array payload', async () => {
    h.state.rpc = { data: { not: 'an array' }, error: null }
    expect(await getAssetMaster()).toEqual([])
  })
})

describe('COUNTRY_CURRENCY map', () => {
  it('maps each country to its own currency', () => {
    expect(COUNTRY_CURRENCY.KSA).toBe('SAR')
    expect(COUNTRY_CURRENCY.UAE).toBe('AED')
    expect(COUNTRY_CURRENCY.Egypt).toBe('EGP')
  })
})
