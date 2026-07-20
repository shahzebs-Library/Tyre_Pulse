import { describe, it, expect, beforeEach, vi } from 'vitest'

// Mock the Supabase client layer so we can drive insert() outcomes per call and
// verify saveImportRows survives intermittent (mobile-data) transient failures
// without abandoning the whole upload.
const h = vi.hoisted(() => {
  const state = { queue: [] }   // per-insert outcome: 'ok' | 'transient' | 'fatal'
  const inserts = []
  return {
    state, inserts,
    supabase: {
      from: () => ({
        insert: (rows) => {
          inserts.push(rows.length)
          const outcome = state.queue.length ? state.queue.shift() : 'ok'
          if (outcome === 'transient') return Promise.resolve({ data: null, error: { message: 'Failed to fetch' } })
          if (outcome === 'fatal') return Promise.resolve({ data: null, error: { message: 'permission denied', code: '42501' } })
          return Promise.resolve({ data: rows, error: null })
        },
      }),
    },
    unwrap: (res) => { if (res?.error) throw Object.assign(new Error(res.error.message), res.error); return res.data },
    applyCountry: (q) => q,
    fetchAllPages: async () => ({ data: [], error: null }),
  }
})

vi.mock('../lib/api/_client', () => ({
  supabase: h.supabase, unwrap: h.unwrap, applyCountry: h.applyCountry, fetchAllPages: h.fetchAllPages,
}))

const { saveImportRows } = await import('../lib/api/erpImport')

const rows = (n) => Array.from({ length: n }, (_, i) => ({ source_row: i + 1, asset_no: 'A' + i }))

beforeEach(() => { h.state.queue = []; h.inserts.length = 0 })

describe('saveImportRows — mobile-data resilience', () => {
  it('saves every row when all chunks succeed', async () => {
    const res = await saveImportRows('asset', rows(600), 'b1', {})
    expect(res.saved).toBe(600)
    expect(res.requested).toBe(600)
    // 250-row chunks -> 3 inserts (250 + 250 + 100)
    expect(h.inserts).toEqual([250, 250, 100])
  })

  it('recovers a transient chunk failure via the deferred final sweep', async () => {
    // The chunk drops on all 6 inline attempts (transient) -> deferred -> then
    // succeeds in the final sweep. Fake timers make the backoff sleeps instant.
    vi.useFakeTimers()
    try {
      h.state.queue = ['transient', 'transient', 'transient', 'transient', 'transient', 'transient']
      const p = saveImportRows('asset', rows(300), 'b2', {})
      await vi.runAllTimersAsync()
      const res = await p
      expect(res.saved).toBe(300)   // nothing lost: the dropped chunk landed on the sweep
    } finally {
      vi.useRealTimers()
    }
  })

  it('aborts immediately on a non-transient (permission) error', async () => {
    h.state.queue = ['fatal']
    await expect(saveImportRows('asset', rows(300), 'b3', {})).rejects.toThrow(/permission denied/i)
  })
})
