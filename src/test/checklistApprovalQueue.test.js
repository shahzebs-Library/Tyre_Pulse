import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * The queue side of the two-stage sign-off.
 *
 * The bug this guards is the one that made a signed sheet disappear: V594 added
 * a supervisor rung, so a sheet a supervisor has already signed sits at
 * 'pending_area_manager'. Reading only 'pending' left it in no queue at all,
 * with the work done and the last approval impossible to ask for.
 */

const rpc = vi.fn()
const from = vi.fn()

vi.mock('../lib/api/_client', () => ({
  supabase: { rpc: (...a) => rpc(...a), from: (...a) => from(...a) },
  unwrap: (res) => {
    if (res?.error) { const e = new Error(res.error.message || 'db error'); e.code = res.error.code; throw e }
    return res?.data
  },
  applyCountry: (q) => q,
  isMissingRelation: (err) => err?.code === '42P01',
}))

function builder(payload, calls = []) {
  const b = new Proxy({}, {
    get(_t, prop) {
      if (prop === 'then') return (res, rej) => Promise.resolve(payload).then(res, rej)
      return (...args) => { calls.push([prop, ...args]); return b }
    },
  })
  return b
}

const queue = await import('../lib/api/approvalsQueue')

beforeEach(() => { rpc.mockReset(); from.mockReset() })

describe('listChecklistApprovals', () => {
  it('reads BOTH waiting states, so a supervisor-signed sheet stays visible', async () => {
    const calls = []
    from.mockImplementation((table) => (table === 'checklist_submissions'
      ? builder({ data: [{ id: 'cl-1', template_id: 't1', approval_status: 'pending_area_manager' }], error: null }, calls)
      : builder({ data: [{ id: 't1', name: 'Workshop', require_area_manager: true }], error: null })))

    const rows = await queue.listChecklistApprovals({})
    const statusFilter = calls.find((c) => c[0] === 'in' && c[1] === 'approval_status')
    expect(statusFilter[2]).toEqual(['pending', 'pending_area_manager'])
    expect(rows).toHaveLength(1)
  })

  it('attaches the template rule, so a row can say which rung is holding it', async () => {
    from.mockImplementation((table) => (table === 'checklist_submissions'
      ? builder({ data: [{ id: 'cl-1', template_id: 't1', approval_status: 'pending' }], error: null })
      : builder({ data: [{ id: 't1', name: 'Workshop Daily', require_area_manager: true }], error: null })))

    const [row] = await queue.listChecklistApprovals({})
    expect(row.require_area_manager).toBe(true)
    expect(row.template_name).toBe('Workshop Daily')
  })

  it('leaves the rule false when the template cannot be read, never true', async () => {
    // Guessing "needs a second signature" would describe a single-stage sheet as
    // something it is not. Every template built before V594 is single-stage.
    from.mockImplementation((table) => (table === 'checklist_submissions'
      ? builder({ data: [{ id: 'cl-1', template_id: 't1', approval_status: 'pending' }], error: null })
      : builder({ data: null, error: { message: 'nope' } })))

    const [row] = await queue.listChecklistApprovals({})
    expect(row.require_area_manager).toBeUndefined()
    expect(row.id).toBe('cl-1')
  })
})

describe('decideChecklist', () => {
  it('goes through the guarded RPC, which resolves the rung server-side', async () => {
    rpc.mockResolvedValue({ data: { ok: true, decision: 'approved', status: 'pending_area_manager' }, error: null })
    const res = await queue.decideChecklist('cl-1', {
      approved: true, signature: '<svg/>', currentStatus: 'pending',
    })
    expect(rpc).toHaveBeenCalledWith('decide_checklist_approval', {
      p_submission_id: 'cl-1', p_decision: 'approved', p_note: null, p_signature: '<svg/>',
    })
    // A sign-off is not a close. The caller must read the status it reached.
    expect(res.status).toBe('pending_area_manager')
  })

  it('refuses an approval with no signature before it reaches the server', async () => {
    await expect(queue.decideChecklist('cl-1', { approved: true })).rejects.toThrow(/signature is required/i)
    expect(rpc).not.toHaveBeenCalled()
  })

  it('still requires a reason to send a sheet back', async () => {
    await expect(queue.decideChecklist('cl-1', { approved: false })).rejects.toThrow(/note is required/i)
    expect(rpc).not.toHaveBeenCalled()
  })

  it('enrols a sheet that never asked for a sign-off, then decides it', async () => {
    // The RPC only moves a row that is waiting. A submission recorded
    // 'not_required' never entered the queue, so recording a sign-off now means
    // asking for one and answering it - through the one guarded path.
    const calls = []
    from.mockImplementation(() => builder({ data: { id: 'cl-1' }, error: null }, calls))
    rpc.mockResolvedValue({ data: { ok: true, decision: 'approved', status: 'approved' }, error: null })

    await queue.decideChecklist('cl-1', {
      approved: true, signature: '<svg/>', currentStatus: 'not_required',
    })
    const update = calls.find((c) => c[0] === 'update')
    expect(update[1]).toEqual({ approval_status: 'pending' })
    expect(rpc).toHaveBeenCalledWith('decide_checklist_approval', expect.objectContaining({ p_decision: 'approved' }))
  })

  it('does not re-enrol a sheet that is already waiting', async () => {
    const calls = []
    from.mockImplementation(() => builder({ data: { id: 'cl-1' }, error: null }, calls))
    rpc.mockResolvedValue({ data: { ok: true, status: 'approved' }, error: null })

    await queue.decideChecklist('cl-1', {
      approved: true, signature: '<svg/>', currentStatus: 'pending_area_manager',
    })
    expect(calls.find((c) => c[0] === 'update')).toBeUndefined()
  })
})
