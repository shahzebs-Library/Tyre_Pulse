import { describe, it, expect, vi, beforeEach } from 'vitest'

const h = vi.hoisted(() => ({ rpc: vi.fn(), from: vi.fn() }))
vi.mock('../lib/supabase', () => ({ supabase: { rpc: h.rpc, from: h.from } }))

import {
  getClosureReviewConfig, getActionReviewAccess, submitCompletion, reviewAction, requestException, decideException,
  attachAckFaultStates,
  acknowledgeChecklist, listReviewQueue, listSheetActions, isNotProvisioned,
} from '../lib/api/closureReview'

function builder(result) {
  const b = { calls: [] }
  for (const m of ['select', 'eq', 'in', 'order', 'limit']) b[m] = (...a) => { b.calls.push([m, ...a]); return b }
  b.maybeSingle = () => Promise.resolve(result)
  b.then = (ok, bad) => Promise.resolve(result).then(ok, bad)
  return b
}
const missingFn = { code: 'PGRST202', message: 'Could not find the function public.get_closure_review_config' }
const missingCol = { code: '42703', message: 'column corrective_actions.review_status does not exist' }

beforeEach(() => { h.rpc.mockReset(); h.from.mockReset() })

describe('before the drafts are applied', () => {
  it('recognises a missing function, column or table', () => {
    expect(isNotProvisioned(missingFn)).toBe(true)
    expect(isNotProvisioned(missingCol)).toBe(true)
    expect(isNotProvisioned({ code: '42501', message: 'permission denied' })).toBe(false)
  })
  it('config read reports not provisioned with the defaults, without throwing', async () => {
    h.rpc.mockResolvedValue({ data: null, error: missingFn })
    const r = await getClosureReviewConfig()
    expect(r.provisioned).toBe(false)
    expect(r.config.ca_reviewer_roles).toContain('Manager')
  })
  it('access read fails closed', async () => {
    h.rpc.mockResolvedValue({ data: null, error: missingFn })
    const a = await getActionReviewAccess('a1')
    expect(a).toMatchObject({ provisioned: false, canSubmit: false, canReview: false })
  })
  it('the review queue is empty and marked not provisioned', async () => {
    h.from.mockReturnValue(builder({ data: null, error: missingCol }))
    expect(await listReviewQueue({ country: 'KSA' })).toEqual({ provisioned: false, rows: [] })
  })
  it('sheet actions fall back to the columns that exist today', async () => {
    h.from.mockReturnValueOnce(builder({ data: null, error: missingCol }))
      .mockReturnValueOnce(builder({ data: [{ id: 1, status: 'Open', source_detail: 'Brakes' }], error: null }))
    const r = await listSheetActions('s1')
    expect(r.provisioned).toBe(false)
    expect(r.actions).toHaveLength(1)
  })
  it('a write says the feature is not switched on, in plain words', async () => {
    h.rpc.mockResolvedValue({ data: null, error: missingFn })
    await expect(reviewAction('a1', 'approve')).rejects.toThrow('Closure review is not switched on for this system yet.')
  })
})

describe('writes go through the database functions only', () => {
  it('submit refuses locally when evidence is missing and never calls the server', async () => {
    await expect(submitCompletion('a1', { note: '' })).rejects.toThrow(/Describe what was done/)
    await expect(submitCompletion('a1', { note: 'Tyre replaced', photos: [] }, { minPhotos: 1 })).rejects.toThrow(/photograph/)
    expect(h.rpc).not.toHaveBeenCalled()
  })
  it('submit sends the note and photographs to the writer', async () => {
    h.rpc.mockResolvedValue({ data: { ok: true }, error: null })
    await submitCompletion('a1', { note: ' Tyre replaced ', photos: ['data:image/jpeg;base64,AA'] })
    expect(h.rpc).toHaveBeenCalledWith('corrective_action_submit_completion',
      { p_id: 'a1', p_note: 'Tyre replaced', p_photos: ['data:image/jpeg;base64,AA'] })
    expect(h.from).not.toHaveBeenCalled()
  })
  it('a return without a comment is refused before the server is asked', async () => {
    await expect(reviewAction('a1', 'return', ' ')).rejects.toThrow(/corrected/)
    expect(h.rpc).not.toHaveBeenCalled()
  })
  it('approve and return call the review writer', async () => {
    h.rpc.mockResolvedValue({ data: { ok: true }, error: null })
    await reviewAction('a1', 'approve')
    expect(h.rpc).toHaveBeenLastCalledWith('corrective_action_review', { p_id: 'a1', p_decision: 'approve', p_comment: null })
    await reviewAction('a1', 'return', 'Photo is blurred')
    expect(h.rpc).toHaveBeenLastCalledWith('corrective_action_review', { p_id: 'a1', p_decision: 'return', p_comment: 'Photo is blurred' })
  })
  it('an exception is requested with a reason, and never closes through the browser', async () => {
    await expect(requestException('a1', 'short')).rejects.toThrow(/10 characters/)
    h.rpc.mockResolvedValue({ data: { ok: true, review_status: 'exception_requested' }, error: null })
    await requestException('a1', 'Vehicle sold on 1 December')
    expect(h.rpc).toHaveBeenCalledWith('corrective_action_request_exception', { p_id: 'a1', p_reason: 'Vehicle sold on 1 December' })
    expect(h.rpc.mock.calls.some((c) => /record_exception/.test(c[0]))).toBe(false)
    expect(h.from).not.toHaveBeenCalled()
  })
  it('an exception decision goes to the decision writer; a refusal needs a reason', async () => {
    await expect(decideException('a1', 'refuse', '')).rejects.toThrow(/why the exception is refused/)
    expect(h.rpc).not.toHaveBeenCalled()
    h.rpc.mockResolvedValue({ data: { ok: true }, error: null })
    await decideException('a1', 'approve')
    expect(h.rpc).toHaveBeenLastCalledWith('corrective_action_decide_exception', { p_id: 'a1', p_decision: 'approve', p_comment: null })
    await decideException('a1', 'refuse', 'Repair it instead')
    expect(h.rpc).toHaveBeenLastCalledWith('corrective_action_decide_exception', { p_id: 'a1', p_decision: 'refuse', p_comment: 'Repair it instead' })
  })
  it('the database refusal of a self-decided exception reaches the person', async () => {
    h.rpc.mockResolvedValue({ data: null, error: { code: '42501', message: 'You asked for this exception, so another authorised person has to decide it.' } })
    await expect(decideException('a1', 'approve')).rejects.toBeTruthy()
  })
  it('a server refusal reaches the user as a safe message, not database text', async () => {
    h.rpc.mockResolvedValue({ data: null, error: { code: '42501', message: 'new row violates row-level security policy for table "corrective_actions"' } })
    const err = await reviewAction('a1', 'approve').catch((e) => e)
    expect(err.message).not.toMatch(/row-level security|corrective_actions/)
  })
  it('acknowledge needs a signature and a confirmed answer', async () => {
    await expect(acknowledgeChecklist('s1', { signature: '' })).rejects.toThrow(/signature is required/)
    h.rpc.mockResolvedValue({ data: { ok: false }, error: null })
    await expect(acknowledgeChecklist('s1', { signature: 'sig' })).rejects.toThrow(/did not confirm/)
    h.rpc.mockResolvedValue({ data: { ok: true, status: 'acknowledged' }, error: null })
    await expect(acknowledgeChecklist('s1', { signature: 'sig', note: ' seen ' })).resolves.toMatchObject({ status: 'acknowledged' })
    expect(h.rpc).toHaveBeenLastCalledWith('acknowledge_checklist_faults', { p_submission_id: 's1', p_note: 'seen', p_signature: 'sig' })
  })
})

describe('acknowledged sheets in a list', () => {
  it('rows with nothing acknowledged are returned untouched and nothing is read', async () => {
    const rows = [{ id: 's1', approval_status: 'approved' }]
    expect(await attachAckFaultStates(rows)).toBe(rows)
    expect(h.from).not.toHaveBeenCalled()
  })
  it('attaches the fault state and who signed to acknowledged rows only', async () => {
    h.from.mockImplementation((table) => builder(table === 'v_checklist_fault_compliance'
      ? { data: [{ submission_id: 's2', fault_state: 'fault_open', open_count: 1 }], error: null }
      : { data: [{ id: 's2', acknowledged_name: 'Test Signer', acknowledged_at: '2026-11-11T08:00:00Z', acknowledgement_note: null }], error: null }))
    const out = await attachAckFaultStates([{ id: 's1', approval_status: 'approved' }, { id: 's2', approval_status: 'acknowledged' }])
    expect(out[0]).toEqual({ id: 's1', approval_status: 'approved' })
    expect(out[1]).toMatchObject({ ack_fault_state: 'fault_open', ack_open_faults: 1, acknowledged_name: 'Test Signer' })
  })
  it('a failed read leaves the state unknown, which every reader shows as action required', async () => {
    h.from.mockReturnValue(builder({ data: null, error: missingCol }))
    const rows = [{ id: 's2', approval_status: 'acknowledged' }]
    const out = await attachAckFaultStates(rows)
    expect(out[0].ack_fault_state).toBeUndefined()
  })
})
