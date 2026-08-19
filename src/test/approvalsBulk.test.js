import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * The two behaviours behind "checklist approvals do not show" and "let me approve
 * several at once". Both are about telling the truth: a bulk action reports every
 * outcome separately, and an empty queue does not get to imply nothing needed
 * signing.
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

/** A chainable PostgREST stand-in that resolves to `payload` when awaited. */
function builder(payload) {
  const calls = []
  const b = new Proxy({}, {
    get(_t, prop) {
      if (prop === 'then') return (res, rej) => Promise.resolve(payload).then(res, rej)
      if (prop === '__calls') return calls
      return (...args) => { calls.push([prop, ...args]); return b }
    },
  })
  return b
}

const queue = await import('../lib/api/approvalsQueue')

beforeEach(() => { rpc.mockReset(); from.mockReset() })

describe('bulkDecide', () => {
  it('approves each item through its own authorised path', async () => {
    rpc.mockResolvedValue({ data: { ok: true, status: 'approved' }, error: null })
    from.mockImplementation(() => builder({ data: { id: 'x', approval_status: 'approved' }, error: null }))

    const res = await queue.bulkDecide([
      { source: 'accident_closure', id: 'ac-1' },
      { source: 'checklist', id: 'cl-1', raw: { approval_status: 'pending' } },
    ], 'approve', { signature: '<svg/>' })

    expect(res.ok).toHaveLength(2)
    expect(res.failed).toHaveLength(0)
    // Both go through a SECURITY DEFINER RPC, which enforces the role server-side.
    // A client-side role check would not be a boundary. The checklist one also
    // resolves WHICH rung the decision means, which the client must not guess.
    expect(rpc).toHaveBeenCalledWith('approve_accident_closure', { p_accident_id: 'ac-1' })
    expect(rpc).toHaveBeenCalledWith('decide_checklist_approval', expect.objectContaining({
      p_submission_id: 'cl-1', p_decision: 'approved', p_signature: '<svg/>',
    }))
  })

  it('refuses a checklist sign-off that carries no signature', async () => {
    // The server refuses it too. Refusing here means the batch does not report a
    // sign-off that never happened.
    rpc.mockResolvedValue({ data: { ok: true, status: 'approved' }, error: null })
    const res = await queue.bulkDecide([{ source: 'checklist', id: 'cl-1' }], 'approve')
    expect(res.ok).toHaveLength(0)
    expect(res.failed[0].error).toMatch(/signature is required/i)
    expect(rpc).not.toHaveBeenCalledWith('decide_checklist_approval', expect.anything())
  })

  it('keeps going after one item fails, and reports which', async () => {
    // THE CONTRACT. Approvals are individually stateful: one may have been decided
    // by someone else a second ago. Aborting the batch would throw away eleven
    // legitimate decisions because of one; claiming success would be a lie.
    rpc.mockImplementation((name) => (name === 'approve_accident_closure'
      ? Promise.reject(Object.assign(new Error('already decided'), { code: 'P0001' }))
      : Promise.resolve({ data: { ok: true, status: 'approved' }, error: null })))
    from.mockImplementation(() => builder({ data: { id: 'cl-1' }, error: null }))

    const res = await queue.bulkDecide([
      { source: 'accident_closure', id: 'ac-1', title: 'TM704' },
      { source: 'checklist', id: 'cl-1', title: 'Brake check', raw: { approval_status: 'pending' } },
    ], 'approve', { signature: '<svg/>' })

    expect(res.ok.map((i) => i.id)).toEqual(['cl-1'])
    expect(res.failed).toHaveLength(1)
    expect(res.failed[0].item.id).toBe('ac-1')
    expect(res.failed[0].error).toMatch(/already decided/)
  })

  it('refuses to bulk-decide a type it does not know how to decide', async () => {
    // A workflow step may demand a signature, a cost or a named approver. Guessing
    // an approve for it would skip the requirements the engine exists to enforce.
    const res = await queue.bulkDecide([{ source: 'workflow', id: 'wi-1' }], 'approve')
    expect(res.ok).toHaveLength(0)
    expect(res.failed[0].error).toMatch(/cannot be decided in bulk/)
  })

  it('requires a reason before returning a checklist, per item', async () => {
    rpc.mockResolvedValue({ data: { ok: true, status: 'rejected' }, error: null })
    from.mockImplementation(() => builder({ data: null, error: null }))
    const res = await queue.bulkDecide([{ source: 'checklist', id: 'cl-1' }], 'reject')
    expect(res.ok).toHaveLength(0)
    expect(res.failed[0].error).toMatch(/note is required/i)

    const ok = await queue.bulkDecide([{ source: 'checklist', id: 'cl-1' }], 'reject', { reason: 'Photos unreadable' })
    expect(ok.ok).toHaveLength(1)
  })

  it('carries the batch signature into an INSPECTION approval', async () => {
    // The bug: bulk approve of inspections passed no signature, so the RPC
    // (approver_signature = COALESCE(p_signature, ...)) stored an approval with
    // no mark - "saved without signature". The batch signature is the approver's
    // own saved mark applied to each sheet, which is what a batch sign-off is.
    rpc.mockResolvedValue({ data: { ok: true }, error: null })
    from.mockImplementation(() => builder({ data: {}, error: null }))

    await queue.bulkDecide([{ source: 'inspection', id: 'in-1' }], 'approve', { signature: '<svg id="me"/>' })

    expect(rpc).toHaveBeenCalledWith('decide_inspection_approval', expect.objectContaining({
      p_inspection_id: 'in-1', p_decision: 'approved', p_signature: '<svg id="me"/>',
    }))
  })

  it('never sends a signature when REJECTING an inspection', async () => {
    rpc.mockResolvedValue({ data: { ok: true }, error: null })
    from.mockImplementation(() => builder({ data: {}, error: null }))
    await queue.bulkDecide([{ source: 'inspection', id: 'in-2' }], 'reject', { reason: 'redo', signature: '<svg/>' })
    expect(rpc).toHaveBeenCalledWith('decide_inspection_approval', expect.objectContaining({
      p_decision: 'rejected', p_signature: null,
    }))
  })

  it('handles being given nothing', async () => {
    await expect(queue.bulkDecide(null, 'approve')).resolves.toEqual({ ok: [], failed: [] })
    await expect(queue.bulkDecide([], 'approve')).resolves.toEqual({ ok: [], failed: [] })
  })
})

describe('listChecklistSignoffGaps', () => {
  it('finds submissions that skipped a sign-off their template required', async () => {
    // Two live submissions look exactly like this: template require_approval is
    // true, submission approval_status is not_required, so the pending queue is
    // empty and reads as "nobody needed to sign anything".
    const seq = [
      builder({ data: [{ id: 't-1', name: 'Predictive Maintenance Checklist' }], error: null }),
      builder({ data: [{ id: 's-1', template_id: 't-1', asset_no: 'TM527', approval_status: 'not_required' }], error: null }),
    ]
    from.mockImplementation(() => seq.shift())

    const rows = await queue.listChecklistSignoffGaps({})
    expect(rows).toHaveLength(1)
    // The template name is filled in from the template lookup, so the row can say
    // WHICH template was supposed to require a signature.
    expect(rows[0].template_name).toBe('Predictive Maintenance Checklist')
  })

  it('does not query submissions at all when no template requires sign-off', async () => {
    from.mockImplementation(() => builder({ data: [], error: null }))
    const rows = await queue.listChecklistSignoffGaps({})
    expect(rows).toEqual([])
    expect(from).toHaveBeenCalledTimes(1)   // templates only, never submissions
  })

  it('degrades to empty before the tables exist rather than breaking the page', async () => {
    from.mockImplementation(() => builder({ data: null, error: { code: '42P01', message: 'does not exist' } }))
    await expect(queue.listChecklistSignoffGaps({})).resolves.toEqual([])
  })
})

/**
 * Source-scan for the page guard (Approvals.jsx has no exported seam for the
 * bulk-run path). These pin the decisions that would each silently store an
 * unsigned inspection approval.
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const pageSrc = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), '..', 'pages', 'Approvals.jsx'), 'utf8')

describe('Approvals bulk-run guard (source)', () => {
  it('loads the approver saved signature before a bulk approve', () => {
    expect(pageSrc).toMatch(/signature = await getMySignature\(\)/)
  })

  it('refuses to bulk-approve inspections with no usable signature', () => {
    // Without this the batch would store approvals nobody signed - the exact
    // defect. The refusal points at where to save one.
    const run = pageSrc.slice(pageSrc.indexOf('async function runBulk'), pageSrc.indexOf('function openRow'))
    expect(run).toMatch(/pickedInspections\.length > 0/)
    expect(run).toMatch(/isUsableSignature\(signature\)/)
    expect(run).toMatch(/return\b/)
  })

  it('passes the loaded signature through to bulkDecide', () => {
    expect(pageSrc).toMatch(/queue\.bulkDecide\(pickedItems, action, \{ reason, signature \}\)/)
  })

  it('checks the signature only when approving, not when returning', () => {
    const run = pageSrc.slice(pageSrc.indexOf('async function runBulk'), pageSrc.indexOf('function openRow'))
    expect(run).toMatch(/action === 'approve' && pickedInspections\.length > 0/)
  })
})
