const rpc = jest.fn()
jest.mock('../lib/supabase', () => ({ supabase: { rpc: (...args: unknown[]) => rpc(...args) } }))
import { ApprovalReview, createApprovalIntent, getApprovalReview, submitApprovalIntent, delegateApproval,
  changeApprovalRoute, listOperationalApprovals, validateApprovalReview, executeStoredApprovalIntent, isDefinitiveApprovalRejection } from '../lib/governedApprovals'

const review = (): ApprovalReview => ({ entity_type: 'checklist', entity_id: 'sheet', mode: 'enforced', revision: 4,
  stage_token: 'workflow:1:2', document: { id: 'sheet', answers: { brakes: 'Pass' } },
  stages: [{ name: 'Supervisor' }, { name: 'Area manager', require_signature: true }], current_stage: 1,
  can_decide: true, can_return: true, history: [], delegations: [] })
beforeEach(() => rpc.mockReset())

test('loads the server snapshot and revision together', async () => {
  rpc.mockResolvedValue({ data: review(), error: null })
  expect(await getApprovalReview('checklist', 'sheet')).toEqual(review())
  expect(rpc).toHaveBeenCalledWith('approval_review_context', { p_entity_type: 'checklist', p_entity_id: 'sheet' })
})
test.each([null, {}, { ...review(), revision: -1 }, { ...review(), document: { id: 'another' } }, { ...review(), stages: [] }])('rejects malformed review %j', data => {
  expect(() => validateApprovalReview(data, 'checklist', 'sheet')).toThrow()
})
test('does not fall back to old decision writers when context fails', async () => {
  rpc.mockResolvedValue({ data: null, error: { code: '42501', message: 'Denied' } })
  await expect(getApprovalReview('checklist', 'sheet')).rejects.toEqual({ code: '42501', message: 'Denied' })
  expect(rpc).toHaveBeenCalledTimes(1)
})
test('binds a decision to exactly the reviewed stage, revision, signature and operation', async () => {
  const intent = createApprovalIntent(review(), 'approved', 'Checked', '<svg/>')
  expect(intent).toMatchObject({ p_expected_revision: 4, p_expected_stage: 'workflow:1:2', p_signature: '<svg/>' })
  rpc.mockRejectedValueOnce(new Error('Timeout')).mockImplementationOnce(async (_name, input) => ({ data: {
    ok: true, operation_id: input.p_operation_id, decision: input.p_decision, status: 'approved', accepted_at: '2026-09-12T00:00:00Z',
  } }))
  await expect(submitApprovalIntent(intent)).rejects.toThrow('Timeout')
  await expect(submitApprovalIntent(intent)).resolves.toMatchObject({ ok: true })
  expect(rpc.mock.calls[0][1]).toBe(rpc.mock.calls[1][1])
})
test('never reports success for mismatched receipts', async () => {
  rpc.mockResolvedValue({ data: { ok: true, operation_id: 'other', decision: 'approved', status: 'approved', accepted_at: 'now' } })
  await expect(submitApprovalIntent(createApprovalIntent(review(), 'approved', '', '<svg/>'))).rejects.toThrow('not confirmed')
})
test('persists before transmitting and retains the original intent through an uncertain failure', async () => {
  const order: string[] = []
  const storage = { setItem: jest.fn(async () => { order.push('persist') }), removeItem: jest.fn(async () => { order.push('remove') }) }
  rpc.mockImplementation(async () => { order.push('send'); throw new Error('Timeout') })
  const intent = createApprovalIntent(review(), 'approved', '', '<svg/>')
  await expect(executeStoredApprovalIntent(storage, 'user-key', intent)).rejects.toThrow('Timeout')
  expect(order).toEqual(['persist', 'send'])
  expect(storage.removeItem).not.toHaveBeenCalled()
  rpc.mockResolvedValue({ data: { ok: true, operation_id: intent.p_operation_id, decision: 'approved', status: 'approved', accepted_at: '2026-09-12' } })
  await executeStoredApprovalIntent(storage, 'user-key', intent)
  expect(storage.setItem.mock.calls[0]).toEqual(storage.setItem.mock.calls[1])
  expect(storage.removeItem).toHaveBeenCalledWith('user-key')
})
test('storage failures never send a decision, and only explicit server refusals can be discarded', async () => {
  const storage = { setItem: jest.fn().mockRejectedValue(new Error('Storage unavailable')), removeItem: jest.fn() }
  await expect(executeStoredApprovalIntent(storage, 'key', createApprovalIntent(review(), 'approved', '', '<svg/>'))).rejects.toThrow('Storage unavailable')
  expect(rpc).not.toHaveBeenCalled()
  expect(isDefinitiveApprovalRejection(new Error('Timeout'))).toBe(false)
  expect(isDefinitiveApprovalRejection({ code: '40001' })).toBe(true)
})
test('a session change while persisting cannot submit as the next account', async () => {
  const storage = { setItem: jest.fn().mockResolvedValue(undefined), removeItem: jest.fn() }
  await expect(executeStoredApprovalIntent(storage, 'old-user', createApprovalIntent(review(), 'approved', '', '<svg/>'), () => false)).rejects.toThrow('account')
  expect(rpc).not.toHaveBeenCalled()
  expect(storage.removeItem).not.toHaveBeenCalled()
})
test('preserves signature, return-note and permission requirements', () => {
  expect(() => createApprovalIntent(review(), 'approved', '', null)).toThrow('signature')
  expect(() => createApprovalIntent(review(), 'returned', '', null)).toThrow('reason')
  expect(() => createApprovalIntent({ ...review(), can_decide: false }, 'approved', '', '<svg/>')).toThrow('not available')
  expect(createApprovalIntent({ ...review(), can_decide: false }, 'returned', 'Repair brakes', null).p_decision).toBe('returned')
})
test('routing mutations preserve the current stage and need a reason', async () => {
  await expect(changeApprovalRoute(review(), 'reassign', '', 'person')).rejects.toThrow()
  rpc.mockResolvedValue({ data: review() })
  await changeApprovalRoute(review(), 'reassign', 'Cover leave', 'person')
  expect(rpc).toHaveBeenCalledWith('approval_reassign_stage', expect.objectContaining({ p_expected_stage: 'workflow:1:2', p_approver_id: 'person' }))
})
test('rejects invalid delegation periods before a request', async () => {
  await expect(delegateApproval(review(), 'person', 'bad', 'bad', 'Leave')).rejects.toThrow()
  expect(rpc).not.toHaveBeenCalled()
})
test('operational queue only offers supported governed documents', async () => {
  rpc.mockResolvedValue({ data: [
    { entity_type: 'work_order', approval_policy_id: 'policy', entity_id: 'job' },
    { entity_type: 'accident', approval_policy_id: 'policy' }, { entity_type: 'tyre_change' },
  ] })
  expect(await listOperationalApprovals()).toEqual([{ entity_type: 'work_order', approval_policy_id: 'policy', entity_id: 'job' }])
})
