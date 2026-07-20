import { describe, it, expect, beforeEach, vi } from 'vitest'

const h = vi.hoisted(() => {
  const state = { rpc: {} }
  return {
    state,
    supabase: {
      rpc: vi.fn(async (name) => {
        const r = state.rpc[name]
        if (r?.throw) throw new Error('boom')
        return r || { data: null, error: null }
      }),
    },
  }
})

vi.mock('./_client', () => ({ supabase: h.supabase }))
vi.mock('../safeError', () => ({ toUserMessage: (_e, fb) => fb }))

const api = await import('./dataCleanup')

beforeEach(() => { h.state.rpc = {}; h.supabase.rpc.mockClear() })

describe('dataCleanup — monthsAgoISO (pure)', () => {
  it('subtracts whole months from a fixed date', () => {
    const from = new Date('2026-07-20T00:00:00Z')
    expect(api.monthsAgoISO(24, from)).toBe('2024-07-20')
    expect(api.monthsAgoISO(6, from)).toBe('2026-01-20')
    expect(api.monthsAgoISO(0, from)).toBe('2026-07-20')
  })
  it('exposes age presets', () => {
    expect(api.AGE_PRESETS.map(p => p.months)).toContain(24)
    expect(api.AGE_PRESETS.every(p => typeof p.label === 'string')).toBe(true)
  })
})

describe('dataCleanup — service wrappers', () => {
  it('listCleanupTargets returns the array (and [] on non-array)', async () => {
    h.state.rpc.admin_data_cleanup_targets = { data: [{ key: 'audit_logs' }], error: null }
    expect(await api.listCleanupTargets()).toEqual([{ key: 'audit_logs' }])
    h.state.rpc.admin_data_cleanup_targets = { data: null, error: null }
    expect(await api.listCleanupTargets()).toEqual([])
  })

  it('previewCleanup passes key + before and returns the payload', async () => {
    h.state.rpc.admin_data_cleanup_preview = { data: { count: 42 }, error: null }
    const r = await api.previewCleanup('accidents', '2020-01-01')
    expect(r.count).toBe(42)
    expect(h.supabase.rpc).toHaveBeenCalledWith('admin_data_cleanup_preview', { p_key: 'accidents', p_before: '2020-01-01' })
  })

  it('runCleanup returns {deleted, snapshot}', async () => {
    h.state.rpc.admin_data_cleanup_run = { data: { deleted: 10, snapshot: 's1' }, error: null }
    const r = await api.runCleanup('audit_logs', '2024-01-01')
    expect(r).toEqual({ deleted: 10, snapshot: 's1' })
  })

  it('surfaces a safe error message on RPC error', async () => {
    h.state.rpc.admin_data_cleanup_run = { data: null, error: { message: 'super admin only' } }
    await expect(api.runCleanup('accidents', '2020-01-01')).rejects.toThrow(/could not run the cleanup/i)
  })
})
