import { describe, it, expect, vi, beforeEach } from 'vitest'

// Hoisted Supabase mock (mirrors dataReconciliation.test.js): records the last
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

const backups = await import('./backups')

beforeEach(() => {
  h.state.rpc = { data: null, error: null }
  h.state.lastRpc = null
})

describe('service layer - backups', () => {
  it('createBackupSnapshot maps to create_backup_snapshot with p_reason', async () => {
    const header = {
      id: 'snap-1', reason: 'manual', taken_at: 't', taken_by: 'u',
      table_count: 12, total_rows: 3400,
    }
    h.state.rpc = { data: header, error: null }
    const out = await backups.createBackupSnapshot('manual')
    expect(h.state.lastRpc.name).toBe('create_backup_snapshot')
    expect(h.state.lastRpc.args).toEqual({ p_reason: 'manual' })
    expect(out).toEqual(header)
  })

  it('createBackupSnapshot defaults the reason to "manual"', async () => {
    h.state.rpc = { data: { id: 'snap-2' }, error: null }
    await backups.createBackupSnapshot()
    expect(h.state.lastRpc.args).toEqual({ p_reason: 'manual' })
  })

  it('listBackupSnapshots maps to list_backup_snapshots with p_limit and returns the array', async () => {
    const rows = [
      { id: 's1', reason: 'nightly', taken_at: 't', taken_by: 'cron', table_count: 12, total_rows: 3400, tables: [] },
    ]
    h.state.rpc = { data: rows, error: null }
    const out = await backups.listBackupSnapshots(60)
    expect(h.state.lastRpc.name).toBe('list_backup_snapshots')
    expect(h.state.lastRpc.args).toEqual({ p_limit: 60 })
    expect(out).toEqual(rows)
  })

  it('listBackupSnapshots degrades to [] on error', async () => {
    h.state.rpc = { data: null, error: { message: 'permission denied', code: '42501' } }
    expect(await backups.listBackupSnapshots()).toEqual([])
    expect(h.state.lastRpc.args).toEqual({ p_limit: 60 })
  })

  it('listBackupSnapshots degrades to [] when data is not an array', async () => {
    h.state.rpc = { data: null, error: null }
    expect(await backups.listBackupSnapshots(10)).toEqual([])
    expect(h.state.lastRpc.args).toEqual({ p_limit: 10 })
  })

  it('restorePreview passes p_snapshot_id/p_table and returns the delta', async () => {
    const delta = {
      table: 'tyre_records', taken_at: 't', snapshot_rows: 100,
      current_rows: 95, missing_rows: 5, newer_current_rows: 2,
    }
    h.state.rpc = { data: delta, error: null }
    const out = await backups.restorePreview('snap-1', 'tyre_records')
    expect(h.state.lastRpc.name).toBe('backup_restore_preview')
    expect(h.state.lastRpc.args).toEqual({ p_snapshot_id: 'snap-1', p_table: 'tyre_records' })
    expect(out).toEqual(delta)
  })

  it('restoreMissing maps to backup_restore_missing with exact params and returns the count', async () => {
    h.state.rpc = { data: { table: 'tyre_records', restored: 5 }, error: null }
    const out = await backups.restoreMissing('snap-1', 'tyre_records')
    expect(h.state.lastRpc.name).toBe('backup_restore_missing')
    expect(h.state.lastRpc.args).toEqual({ p_snapshot_id: 'snap-1', p_table: 'tyre_records' })
    expect(out).toEqual({ table: 'tyre_records', restored: 5 })
  })

  it('restoreMissing surfaces a ServiceError on failure (does not degrade)', async () => {
    h.state.rpc = { data: null, error: { message: 'boom', code: 'XX000' } }
    await expect(backups.restoreMissing('snap-1', 'tyre_records')).rejects.toThrow()
  })
})
