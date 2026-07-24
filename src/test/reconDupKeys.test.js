import { describe, it, expect, vi, beforeEach } from 'vitest'

// Hoisted Supabase mock (mirrors reconJobcard.test.js): records the last
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

const recon = await import('../lib/api/reconDupKeys')

beforeEach(() => {
  h.state.rpc = { data: null, error: null }
  h.state.lastRpc = null
})

describe('service layer - possible duplicate tyres', () => {
  it('listDuplicateKeyTyres calls the recon_duplicate_key_tyres RPC with no args', async () => {
    h.state.rpc = { data: [], error: null }
    await recon.listDuplicateKeyTyres()
    expect(h.state.lastRpc.name).toBe('recon_duplicate_key_tyres')
    expect(h.state.lastRpc.args).toBeUndefined()
  })

  it('listDuplicateKeyTyres returns the array on success', async () => {
    const rows = [
      { serial_no: 'S1', asset_no: 'A1', issue_date: '2026-01-01', country: 'KSA', copies: 3 },
      { serial_no: 'S2', asset_no: 'A2', issue_date: '2026-02-01', country: 'UAE', copies: 2 },
    ]
    h.state.rpc = { data: rows, error: null }
    expect(await recon.listDuplicateKeyTyres()).toEqual(rows)
  })

  it('listDuplicateKeyTyres returns [] on an RPC error', async () => {
    h.state.rpc = { data: null, error: { message: 'boom', code: '42501' } }
    expect(await recon.listDuplicateKeyTyres()).toEqual([])
  })

  it('listDuplicateKeyTyres degrades to [] on a null payload', async () => {
    h.state.rpc = { data: null, error: null }
    expect(await recon.listDuplicateKeyTyres()).toEqual([])
  })

  it('listDuplicateKeyTyres degrades to [] on a non-array payload', async () => {
    h.state.rpc = { data: { not: 'an array' }, error: null }
    expect(await recon.listDuplicateKeyTyres()).toEqual([])
  })

  it('resolveDuplicateKey calls recon_resolve_duplicate_key with the mapped args', async () => {
    h.state.rpc = { data: { resolved: true, deleted: 2 }, error: null }
    await recon.resolveDuplicateKey('S1', 'A1', '2026-01-01')
    expect(h.state.lastRpc.name).toBe('recon_resolve_duplicate_key')
    expect(h.state.lastRpc.args).toEqual({
      p_serial: 'S1',
      p_asset: 'A1',
      p_issue_date: '2026-01-01',
    })
  })

  it('resolveDuplicateKey passes a null issue_date through', async () => {
    h.state.rpc = { data: { resolved: false, reason: 'not_found' }, error: null }
    await recon.resolveDuplicateKey('S1', 'A1', undefined)
    expect(h.state.lastRpc.args).toEqual({
      p_serial: 'S1',
      p_asset: 'A1',
      p_issue_date: null,
    })
  })

  it('resolveDuplicateKey returns the resolved payload', async () => {
    h.state.rpc = { data: { resolved: true, deleted: 3 }, error: null }
    expect(await recon.resolveDuplicateKey('S1', 'A1', '2026-01-01')).toEqual({
      resolved: true,
      deleted: 3,
    })
  })

  it('resolveDuplicateKey returns the differs payload without throwing', async () => {
    h.state.rpc = { data: { resolved: false, reason: 'differs' }, error: null }
    expect(await recon.resolveDuplicateKey('S1', 'A1', '2026-01-01')).toEqual({
      resolved: false,
      reason: 'differs',
    })
  })

  it('resolveDuplicateKey THROWS on an RPC error', async () => {
    h.state.rpc = { data: null, error: { message: 'Not permitted.', code: '42501' } }
    await expect(recon.resolveDuplicateKey('S1', 'A1', '2026-01-01')).rejects.toBeTruthy()
  })

  it('resolveDuplicateKey falls back to not_found on a null payload', async () => {
    h.state.rpc = { data: null, error: null }
    expect(await recon.resolveDuplicateKey('S1', 'A1', '2026-01-01')).toEqual({
      resolved: false,
      reason: 'not_found',
    })
  })
})
