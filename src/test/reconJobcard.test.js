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

vi.mock('../lib/supabase', () => ({ supabase: h.supabase }))

const recon = await import('../lib/api/reconJobcard')

beforeEach(() => {
  h.state.rpc = { data: null, error: null }
  h.state.lastRpc = null
})

describe('service layer - job card date mismatches', () => {
  it('listJobcardMismatches maps p_limit and returns [] on error', async () => {
    h.state.rpc = { data: null, error: { message: 'boom', code: '42501' } }
    expect(await recon.listJobcardMismatches({ limit: 250 })).toEqual([])
    expect(h.state.lastRpc.name).toBe('recon_jobcard_mismatches')
    expect(h.state.lastRpc.args).toEqual({ p_limit: 250 })
  })

  it('listJobcardMismatches defaults the limit to 1000', async () => {
    h.state.rpc = { data: [], error: null }
    await recon.listJobcardMismatches()
    expect(h.state.lastRpc.args).toEqual({ p_limit: 1000 })
  })

  it('listJobcardMismatches returns the array on success', async () => {
    const rows = [{
      id: 'u1', work_order_no: 'WO-0126-001', opened_at: '2026-07-01T00:00:00Z',
      country: 'KSA', site: 'NHC', jobcard_month: 1, jobcard_year: 2026,
      opened_month: 7, opened_year: 2026,
    }]
    h.state.rpc = { data: rows, error: null }
    expect(await recon.listJobcardMismatches({ limit: 5 })).toEqual(rows)
  })

  it('listJobcardMismatches degrades to [] on a null payload', async () => {
    h.state.rpc = { data: null, error: null }
    expect(await recon.listJobcardMismatches()).toEqual([])
  })

  it('getJobcardMismatchSummary returns the per-country shape on success', async () => {
    const rows = [
      { country: 'Egypt', mismatches: 287 },
      { country: 'KSA', mismatches: 232 },
      { country: 'UAE', mismatches: 267 },
    ]
    h.state.rpc = { data: rows, error: null }
    expect(await recon.getJobcardMismatchSummary()).toEqual(rows)
    expect(h.state.lastRpc.name).toBe('recon_jobcard_mismatch_summary')
    expect(h.state.lastRpc.args).toBeUndefined()
  })

  it('getJobcardMismatchSummary returns [] on error and on a null payload', async () => {
    h.state.rpc = { data: null, error: { message: 'boom' } }
    expect(await recon.getJobcardMismatchSummary()).toEqual([])
    h.state.rpc = { data: null, error: null }
    expect(await recon.getJobcardMismatchSummary()).toEqual([])
  })
})
