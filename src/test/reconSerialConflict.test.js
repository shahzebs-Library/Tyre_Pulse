import { describe, it, expect, vi, beforeEach } from 'vitest'

// Hoisted Supabase mock (mirrors reconDupKeys.test.js): records the last
// rpc(name, args) and resolves to a configurable { data, error }.
const h = vi.hoisted(() => {
  const state = { rpc: { data: null, error: null }, lastRpc: null }
  function rpc(name, args) {
    state.lastRpc = { name, args }
    return Promise.resolve(state.rpc)
  }
  return { state, supabase: { rpc } }
})

vi.mock('../lib/supabase', () => ({ supabase: h.supabase }))

const recon = await import('../lib/api/reconSerialConflict')

beforeEach(() => {
  h.state.rpc = { data: null, error: null }
  h.state.lastRpc = null
})

describe('service layer - serial on multiple assets', () => {
  it('listSerialMultiAsset calls the recon_serial_multi_asset RPC with no args', async () => {
    h.state.rpc = { data: [], error: null }
    await recon.listSerialMultiAsset()
    expect(h.state.lastRpc.name).toBe('recon_serial_multi_asset')
    expect(h.state.lastRpc.args).toBeUndefined()
  })

  it('listSerialMultiAsset returns the array on success', async () => {
    const rows = [
      { serial_no: 'S1', country: 'KSA', asset_count: 3, assets: 'A1, A2, A3' },
      { serial_no: 'S2', country: 'UAE', asset_count: 2, assets: 'A4, A5' },
    ]
    h.state.rpc = { data: rows, error: null }
    expect(await recon.listSerialMultiAsset()).toEqual(rows)
  })

  it('listSerialMultiAsset returns [] on an RPC error', async () => {
    h.state.rpc = { data: null, error: { message: 'boom', code: '42501' } }
    expect(await recon.listSerialMultiAsset()).toEqual([])
  })

  it('listSerialMultiAsset degrades to [] on a null payload', async () => {
    h.state.rpc = { data: null, error: null }
    expect(await recon.listSerialMultiAsset()).toEqual([])
  })

  it('listSerialMultiAsset degrades to [] on a non-array payload', async () => {
    h.state.rpc = { data: { not: 'an array' }, error: null }
    expect(await recon.listSerialMultiAsset()).toEqual([])
  })
})
