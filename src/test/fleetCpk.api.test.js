import { describe, it, expect, vi, beforeEach } from 'vitest'

// Thin rpc-only Supabase mock. fleetCpk.js imports { supabase } from './_client',
// which re-exports the singleton from '../supabase'. getFleetCpk only calls
// supabase.rpc('get_fleet_cpk', ...), so from() must never be reached.
const h = vi.hoisted(() => {
  const state = { rpc: { data: null, error: null }, lastRpc: null }
  function rpc(name, args) {
    state.lastRpc = { name, args }
    return Promise.resolve(state.rpc)
  }
  return { state, supabase: { rpc, from: () => { throw new Error('from() should not be called') } } }
})

vi.mock('../lib/supabase', () => ({ supabase: h.supabase }))

const { getFleetCpk } = await import('../lib/api/fleetCpk')

beforeEach(() => {
  h.state.rpc = { data: null, error: null }
  h.state.lastRpc = null
})

describe('service layer - getFleetCpk', () => {
  it('calls get_fleet_cpk with mapped args and parses the three arrays', async () => {
    h.state.rpc = {
      data: {
        per_vehicle: [{ asset_no: 'TM1', cpk_total: 1.2 }],
        by_type: [{ vehicle_type: 'TR-MIXER', cpk_total: 0.9 }],
        fleet: [{ country: 'KSA', currency: 'SAR' }],
      },
      error: null,
    }
    const out = await getFleetCpk({ country: 'KSA', from: '2026-01-01', to: '2026-12-31' })
    expect(h.state.lastRpc.name).toBe('get_fleet_cpk')
    expect(h.state.lastRpc.args).toEqual({ p_country: 'KSA', p_from: '2026-01-01', p_to: '2026-12-31' })
    expect(out.perVehicle).toHaveLength(1)
    expect(out.byType[0].vehicle_type).toBe('TR-MIXER')
    expect(out.fleet[0].country).toBe('KSA')
  })

  it("maps 'All' / missing country and dates to null", async () => {
    await getFleetCpk({ country: 'All' })
    expect(h.state.lastRpc.args).toEqual({ p_country: null, p_from: null, p_to: null })
  })

  it('degrades to empty shape on RPC error (never throws)', async () => {
    h.state.rpc = { data: null, error: { message: 'boom', code: '42883' } }
    const out = await getFleetCpk({ country: 'KSA' })
    expect(out).toEqual({ perVehicle: [], byType: [], fleet: [] })
  })

  it('degrades to empty shape when arrays are absent', async () => {
    h.state.rpc = { data: {}, error: null }
    const out = await getFleetCpk({})
    expect(out).toEqual({ perVehicle: [], byType: [], fleet: [] })
  })
})
