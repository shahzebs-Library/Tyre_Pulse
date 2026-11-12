import { beforeEach, describe, expect, it, vi } from 'vitest'

// Mock the Supabase seam. `from(...).insert(p).select().single()` echoes the
// built payload so we can assert what the service sends; `rpc` is a spy.
const h = vi.hoisted(() => {
  class ServiceError extends Error {
    constructor(message, code, cause) { super(message); this.name = 'ServiceError'; this.code = code; this.cause = cause }
  }
  const state = { lastInsert: null }
  const singleResult = () => Promise.resolve({ data: state.lastInsert, error: null })
  const insert = (p) => { state.lastInsert = p; return { select: () => ({ single: singleResult }) } }
  return {
    ServiceError, state,
    rpc: vi.fn(),
    from: vi.fn(() => ({ insert })),
  }
})

vi.mock('../lib/api/_client', () => ({
  supabase: { from: h.from, rpc: h.rpc },
  unwrap: (result) => { if (result?.error) throw result.error; return result?.data },
  applyCountry: (q) => q,
  ServiceError: h.ServiceError,
}))

import { createHandoverReport, decideHandover } from '../lib/api/handoverReports'

beforeEach(() => {
  h.rpc.mockReset()
  h.from.mockClear()
  h.state.lastInsert = null
})

describe('createHandoverReport photos', () => {
  it('keeps tp-storage refs and safe URLs, drops blanks and non-strings', async () => {
    await createHandoverReport({
      asset_no: 'TM514',
      photos: [
        'tp-storage://tyre-photos/a.jpg', '', '   ', 7, null,
        'https://files.example.com/b.jpg', 'javascript:alert(1)',
      ],
    })
    expect(h.state.lastInsert.photos).toEqual([
      'tp-storage://tyre-photos/a.jpg',
      'https://files.example.com/b.jpg',
    ])
  })

  it('defaults photos to an empty array when none given', async () => {
    await createHandoverReport({ asset_no: 'TM514' })
    expect(h.state.lastInsert.photos).toEqual([])
  })
})

describe('decideHandover', () => {
  it('calls the RPC with the decision and signature, returns the server result', async () => {
    h.rpc.mockResolvedValue({ data: { ok: true, decision: 'approved', status: 'pending_incharge', both_steps: false }, error: null })
    const res = await decideHandover('h1', { approved: true, signature: '<svg></svg>', note: 'ok' })
    expect(h.rpc).toHaveBeenCalledWith('decide_handover_approval', {
      p_id: 'h1', p_approved: true, p_signature: '<svg></svg>', p_note: 'ok',
    })
    expect(res.status).toBe('pending_incharge')
  })

  it('never sends a signature on a rejection and requires an id', async () => {
    h.rpc.mockResolvedValue({ data: { ok: true, decision: 'rejected', status: 'rejected', both_steps: false }, error: null })
    await decideHandover('h1', { approved: false, signature: '<svg></svg>', note: 'wrong meter' })
    expect(h.rpc.mock.calls[0][1]).toMatchObject({ p_approved: false, p_signature: null, p_note: 'wrong meter' })
    await expect(decideHandover('', { approved: true })).rejects.toThrow()
  })

  it('surfaces a clean message when the RPC refuses', async () => {
    h.rpc.mockResolvedValue({ data: null, error: { message: 'permission denied for function decide_handover_approval', code: '42501' } })
    await expect(decideHandover('h1', { approved: true, signature: '<svg></svg>' })).rejects.toBeInstanceOf(h.ServiceError)
  })
})
