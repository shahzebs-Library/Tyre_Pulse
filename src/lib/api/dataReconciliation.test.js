import { describe, it, expect, vi, beforeEach } from 'vitest'

// Hoisted Supabase mock (mirrors accessGrants.test.js): records the last
// rpc(name, args) and resolves to a configurable { data, error }.
const h = vi.hoisted(() => {
  const state = { rpc: { data: null, error: null }, lastRpc: null }
  function rpc(name, args) {
    state.lastRpc = { name, args }
    return Promise.resolve(state.rpc)
  }
  return { state, supabase: { rpc } }
})

vi.mock('../supabase', () => ({ supabase: h.supabase }))

const recon = await import('./dataReconciliation')

beforeEach(() => {
  h.state.rpc = { data: null, error: null }
  h.state.lastRpc = null
})

describe('service layer - data reconciliation', () => {
  it('listOrphanAssets returns [] on error and the array on success', async () => {
    h.state.rpc = { data: null, error: { message: 'boom', code: '42501' } }
    expect(await recon.listOrphanAssets()).toEqual([])
    expect(h.state.lastRpc.name).toBe('recon_orphan_assets')

    const rows = [{ asset_no: 'A1', vehicle_type: 'Truck', country: 'KSA', tyre_count: 6 }]
    h.state.rpc = { data: rows, error: null }
    expect(await recon.listOrphanAssets()).toEqual(rows)
  })

  it('listDuplicateTyres returns [] on error and the array on success', async () => {
    h.state.rpc = { data: null, error: { message: 'boom' } }
    expect(await recon.listDuplicateTyres()).toEqual([])
    expect(h.state.lastRpc.name).toBe('recon_duplicate_tyres')

    const rows = [{ serial_no: 'S1', asset_no: 'A1', row_count: 2, keep_id: 'k', remove_ids: ['r1'] }]
    h.state.rpc = { data: rows, error: null }
    expect(await recon.listDuplicateTyres()).toEqual(rows)
  })

  it('listSerialConflicts returns [] on error and the array on success', async () => {
    h.state.rpc = { data: null, error: { message: 'boom' } }
    expect(await recon.listSerialConflicts()).toEqual([])
    expect(h.state.lastRpc.name).toBe('recon_serial_conflicts')

    const rows = [{ serial_no: 'S1', asset_count: 2, rows: [{ id: 'x', asset_no: 'A1', status: 'active', created_at: 't' }] }]
    h.state.rpc = { data: rows, error: null }
    expect(await recon.listSerialConflicts()).toEqual(rows)
  })

  it('backfillAsset passes exact p_asset_no and returns the new id', async () => {
    h.state.rpc = { data: 'new-uuid', error: null }
    const id = await recon.backfillAsset('A9')
    expect(h.state.lastRpc.name).toBe('recon_backfill_asset')
    expect(h.state.lastRpc.args).toEqual({ p_asset_no: 'A9' })
    expect(id).toBe('new-uuid')
  })

  it('backfillAllOrphanAssets returns the count', async () => {
    h.state.rpc = { data: 7, error: null }
    const count = await recon.backfillAllOrphanAssets()
    expect(h.state.lastRpc.name).toBe('recon_backfill_all_orphan_assets')
    expect(count).toBe(7)
  })

  it('mergeDuplicate passes exact p_keep_id/p_remove_ids and returns the count', async () => {
    h.state.rpc = { data: 2, error: null }
    const count = await recon.mergeDuplicate('keep-1', ['rm-1', 'rm-2'])
    expect(h.state.lastRpc.name).toBe('recon_merge_duplicate')
    expect(h.state.lastRpc.args).toEqual({ p_keep_id: 'keep-1', p_remove_ids: ['rm-1', 'rm-2'] })
    expect(count).toBe(2)
  })
})
