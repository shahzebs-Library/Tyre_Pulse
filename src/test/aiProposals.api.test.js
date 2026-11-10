import { describe, it, expect, vi, beforeEach } from 'vitest'

const rpc = vi.fn()
let listResult = { data: [], error: null }

function builder() {
  const b = {
    select: () => b, eq: () => b, or: () => b, order: () => b, limit: () => Promise.resolve(listResult),
    gte: () => b, is: () => b, range: () => Promise.resolve({ data: [], error: null }),
  }
  return b
}

vi.mock('../lib/supabase', () => ({ supabase: { from: () => builder(), rpc: (...a) => rpc(...a) } }))
vi.mock('../lib/api/fleetCpk', () => ({ getFleetCpk: vi.fn(async () => ({ fleet: [] })) }))
vi.mock('../lib/api/tyreRunningLife', () => ({ getTyreRunningLife: vi.fn(async () => ({ ok: true, rows: [] })) }))

const api = await import('../lib/api/aiProposals')

beforeEach(() => { rpc.mockReset(); listResult = { data: [], error: null } })

describe('aiProposals service', () => {
  it('lists worst first', async () => {
    listResult = { data: [{ id: 'a', severity: 'low' }, { id: 'b', severity: 'critical' }], error: null }
    const res = await api.listAiProposals({ country: 'KSA' })
    expect(res.rows.map((r) => r.id)).toEqual(['b', 'a'])
    expect(res.notProvisioned).toBe(false)
  })

  it('reports an unprovisioned table instead of an empty queue', async () => {
    listResult = { data: null, error: { code: '42P01', message: 'relation does not exist' } }
    const res = await api.listAiProposals({})
    expect(res.notProvisioned).toBe(true)
  })

  it('rejecting needs a reason and never calls the server without one', async () => {
    await expect(api.decideAiProposal('p1', 'rejected', { note: '  ' })).rejects.toThrow(/reason/i)
    expect(rpc).not.toHaveBeenCalled()
  })

  it('accept passes create_action only for accept', async () => {
    rpc.mockResolvedValue({ data: { ok: true, status: 'accepted', corrective_action_id: 'ca1' }, error: null })
    const res = await api.decideAiProposal('p1', 'accepted', { createAction: true, note: 'ok' })
    expect(rpc).toHaveBeenCalledWith('ai_proposal_decide', { p_id: 'p1', p_decision: 'accepted', p_note: 'ok', p_create_action: true })
    expect(res.corrective_action_id).toBe('ca1')
  })

  it('maps a server refusal to a plain sentence', async () => {
    rpc.mockResolvedValue({ data: { ok: false, reason: 'forbidden' }, error: null })
    await expect(api.decideAiProposal('p1', 'accepted')).rejects.toThrow(/Admin, Manager or Director/)
  })

  it('scan with no findings does not call the recorder', async () => {
    const res = await api.scanProposals({ country: 'KSA', now: new Date('2026-11-10T00:00:00Z') })
    expect(res).toMatchObject({ ok: true, detected: 0 })
    expect(rpc).not.toHaveBeenCalled()
    expect(res.sources.inspections.ok).toBe(true)
  })
})
