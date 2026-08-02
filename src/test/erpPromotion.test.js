/**
 * ERP promotion service (V415) - the step that moves a reviewed staging batch
 * into the master tables. The contract worth pinning is the mapping from a
 * dataset to its promotion RPC and the dry-run flag, because getting either
 * wrong silently promotes the wrong thing (or writes when a preview was asked
 * for). The RPC bodies are tested live against the database; here we pin the
 * seam the page depends on.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'

const h = vi.hoisted(() => {
  const calls = []
  const state = { result: { to_insert_total: 1 }, error: null }
  return {
    calls, state,
    supabase: {
      rpc: (fn, args) => {
        calls.push({ fn, args })
        return Promise.resolve({ data: state.error ? null : state.result, error: state.error })
      },
    },
  }
})

vi.mock('../lib/api/_client', () => ({
  supabase: h.supabase,
  unwrap: (r) => { if (r?.error) throw r.error; return r.data },
  applyCountry: (q) => q,
  fetchAllPages: async () => ({ data: [], error: null }),
}))

const {
  previewPromotion, applyPromotion, undoPromotion, promotionStatus,
} = await import('../lib/api/erpImport')

beforeEach(() => { h.calls.length = 0; h.state.result = { to_insert_total: 1 }; h.state.error = null })

describe('promotion RPC routing', () => {
  it.each([
    ['asset', 'promote_erp_assets'],
    ['change', 'promote_erp_tyre_changes'],
    ['expense', 'promote_erp_tyre_expense'],
  ])('previewPromotion(%s) calls %s with p_dry_run true', async (dataset, fn) => {
    await previewPromotion(dataset, 'batch-1')
    expect(h.calls).toHaveLength(1)
    expect(h.calls[0]).toEqual({ fn, args: { p_batch: 'batch-1', p_dry_run: true } })
  })

  it.each([
    ['asset', 'promote_erp_assets'],
    ['change', 'promote_erp_tyre_changes'],
    ['expense', 'promote_erp_tyre_expense'],
  ])('applyPromotion(%s) calls %s with p_dry_run false', async (dataset, fn) => {
    await applyPromotion(dataset, 'batch-1')
    expect(h.calls[0]).toEqual({ fn, args: { p_batch: 'batch-1', p_dry_run: false } })
  })

  it('undoPromotion passes the dataset as p_dataset to the shared undo RPC', async () => {
    h.state.result = { deleted: 3 }
    const res = await undoPromotion('change', 'batch-9')
    expect(h.calls[0]).toEqual({ fn: 'promote_erp_undo', args: { p_dataset: 'change', p_batch: 'batch-9' } })
    expect(res.deleted).toBe(3)
  })
})

describe('guards + degradation', () => {
  it('refuses a batch with no id', async () => {
    await expect(previewPromotion('asset', '')).rejects.toThrow()
    await expect(applyPromotion('asset', null)).rejects.toThrow()
    await expect(undoPromotion('asset', undefined)).rejects.toThrow()
    expect(h.calls).toHaveLength(0)
  })

  it('refuses a dataset that cannot be promoted from here (production)', async () => {
    await expect(previewPromotion('production', 'b')).rejects.toThrow()
    expect(h.calls).toHaveLength(0)
  })

  it('throws a clean message when the RPC errors', async () => {
    h.state.error = { message: 'permission denied for relation vehicle_fleet', code: '42501' }
    await expect(applyPromotion('asset', 'b')).rejects.toThrow()
    // the raw DB text must not leak through
    await expect(applyPromotion('asset', 'b')).rejects.not.toThrow(/relation vehicle_fleet/)
  })

  it('promotionStatus returns a safe not-promoted shape on error or bad dataset', async () => {
    h.state.error = { message: 'boom' }
    const s = await promotionStatus('asset', 'b')
    expect(s).toEqual({ inserted: 0, updated: 0, exact_duplicates: 0, existing: 0, total: 0, promoted: false, promoted_at: null })

    // production has no promotion RPC -> never calls the server
    h.state.error = null
    h.calls.length = 0
    const p = await promotionStatus('production', 'b')
    expect(p.promoted).toBe(false)
    expect(h.calls).toHaveLength(0)
  })

  it('promotionStatus merges the server payload over the fallback', async () => {
    h.state.result = { inserted: 5, existing: 2, total: 7, promoted: true, promoted_at: '2026-07-28' }
    const s = await promotionStatus('change', 'b')
    expect(s).toEqual({ inserted: 5, updated: 0, exact_duplicates: 0, existing: 2, total: 7, promoted: true, promoted_at: '2026-07-28' })
  })
})
