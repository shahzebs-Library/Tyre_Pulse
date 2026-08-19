import { describe, it, expect, vi, beforeEach } from 'vitest'

const h = vi.hoisted(() => {
  const state = { rpc: [], result: { data: { ok: true }, error: null } }
  return {
    state,
    supabase: {
      from: () => ({ select: () => ({ eq: () => ({ then: (f) => Promise.resolve(state.result).then(f) }) }) }),
      rpc: (name, args) => { state.rpc.push([name, args]); return Promise.resolve(state.result) },
    },
  }
})

vi.mock('../lib/supabase', () => ({ supabase: h.supabase }))

const queue = await import('../lib/api/approvalsQueue')

const SIG = 'data:image/png;base64,iVBORw0KGgo='

beforeEach(() => { h.state.rpc = []; h.state.result = { data: { ok: true }, error: null } })

describe('decideInspection carries the approver signature', () => {
  it('SENDS the signature to the RPC - it used to be dropped, so the same inspection was signed or unsigned depending on which screen decided it', async () => {
    await queue.decideInspection('i1', { approved: true, signature: SIG })
    const [name, args] = h.state.rpc[0]
    expect(name).toBe('decide_inspection_approval')
    expect(args.p_signature).toBe(SIG)
    expect(args.p_decision).toBe('approved')
  })

  it('never attaches a signature to a rejection - a returned record was not signed off', async () => {
    await queue.decideInspection('i1', { approved: false, reviewNote: 'redo', signature: SIG })
    expect(h.state.rpc[0][1].p_signature).toBeNull()
    expect(h.state.rpc[0][1].p_decision).toBe('rejected')
  })

  it('sends null rather than an empty string when nothing was drawn', async () => {
    await queue.decideInspection('i1', { approved: true })
    expect(h.state.rpc[0][1].p_signature).toBeNull()
  })
})
