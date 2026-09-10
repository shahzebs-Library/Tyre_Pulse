import { beforeEach, describe, expect, it, vi } from 'vitest'
const { rpc } = vi.hoisted(() => ({ rpc: vi.fn() }))
vi.mock('../lib/api/_client', () => ({
  supabase: { rpc }, unwrap: result => { if (result?.error) throw result.error; return result?.data },
}))
import { getApprovalReview, createApprovalIntent, submitApprovalIntent, isApprovalReviewUnavailable, recoverApprovalRoute, reassignApprovalStage, listApprovalReviewPeople, delegateApprovalStage, revokeApprovalDelegation } from '../lib/api/approvalDecisions'

const review = () => ({ entity_type: 'checklist', entity_id: 'sheet-1', mode: 'enforced',
  revision: 42, stage_token: 'instance:0', can_decide: true, current_stage: 0,
  stages: [{ name: 'Supervisor', require_signature: true }],
  document: { id: 'sheet-1', answers: { brakes: 'fault' }, checklist_templates: {
    fields: [{ id: 'brakes', label: 'Brakes' }], require_area_manager: true,
  } },
})
beforeEach(() => rpc.mockReset())
describe('authoritative approval contract', () => {
  it('uses the server document and its frozen template, not a second row read', async () => {
    rpc.mockResolvedValue({ data: review() })
    const result = await getApprovalReview('checklist', 'sheet-1')
    expect(result.document.answers.brakes).toBe('fault')
    expect(result.document.template_fields[0].label).toBe('Brakes')
    expect(result.document.template_settings.require_area_manager).toBe(true)
    expect(rpc).toHaveBeenCalledTimes(1)
  })
  it.each([null, {}, { ...review(), entity_id: 'other' }, { ...review(), revision: null }, { ...review(), can_decide: 'true' }, { ...review(), stages: null }, { ...review(), current_stage: 99 }, { ...review(), document: { id: 'other' } }, { ...review(), stage_token: '' }])(
    'rejects missing, mismatched or invalid contexts', async data => {
      rpc.mockResolvedValue({ data })
      await expect(getApprovalReview('checklist', 'sheet-1')).rejects.toThrow(/valid approval review/)
    },
  )
  it('does not treat denied access, relation failure or malformed responses as a legacy capability', () => {
    expect(isApprovalReviewUnavailable({ code: 'PGRST202' })).toBe(true)
    expect(isApprovalReviewUnavailable({ code: '42501' })).toBe(false)
    expect(isApprovalReviewUnavailable({ code: '42P01' })).toBe(false)
    expect(isApprovalReviewUnavailable(new Error('bad response'))).toBe(false)
  })
  it('binds the intent to the reviewed revision, never client supplied identity or target status', () => {
    const intent = createApprovalIntent(review(), { approved: true, signature: 'signature', note: ' checked ' })
    expect(intent).toMatchObject({ p_expected_revision: 42, p_expected_stage: 'instance:0', p_note: 'checked', p_decision: 'approved' })
    expect(intent).not.toHaveProperty('approved_by')
    expect(intent).not.toHaveProperty('target_status')
    expect(Object.isFrozen(intent)).toBe(true)
  })
  it('retries the identical operation after a lost response', async () => {
    const intent = createApprovalIntent(review(), { approved: true, signature: 'signature' })
    rpc.mockRejectedValueOnce(new Error('connection lost')).mockResolvedValueOnce({ data: {
      ok: true, decision: 'approved', status: 'pending_area_manager', operation_id: intent.p_operation_id,
      accepted_at: '2026-09-10T14:00:00Z',
    } })
    await expect(submitApprovalIntent(intent)).rejects.toThrow('connection lost')
    const result = await submitApprovalIntent(intent)
    expect(result.status).toBe('pending_area_manager')
    expect(rpc.mock.calls[0][1]).toEqual(rpc.mock.calls[1][1])
  })
  it('rejects forged or unconfirmed decision receipts', async () => {
    const intent = createApprovalIntent(review(), { approved: false, note: 'Repair brakes' })
    rpc.mockResolvedValue({ data: { ok: true, operation_id: 'wrong', status: 'approved' } })
    await expect(submitApprovalIntent(intent)).rejects.toThrow(/did not confirm/)
  })
  it('requires eligibility and decision evidence before sending', () => {
    expect(() => createApprovalIntent({ ...review(), can_decide: false }, { approved: true })).toThrow(/cannot decide/)
    expect(() => createApprovalIntent(review(), { approved: true })).toThrow(/signature/)
    expect(() => createApprovalIntent(review(), { approved: false })).toThrow(/reason/)
  })
})

it('preserves return as a distinct action when template drift disables approval', () => {
  const context = { ...review(), can_decide: false, can_return: true }
  const intent = createApprovalIntent(context, { decision: 'returned', note: 'Please correct the record' })
  expect(intent).toMatchObject({ p_decision: 'returned', p_signature: null, p_expected_stage: 'instance:0' })
  expect(() => createApprovalIntent(context, { decision: 'approved', signature: 's' })).toThrow(/cannot decide/)
})
it('recovery and reassignment use the reviewed stage and explicit reason', async () => {
  rpc.mockResolvedValue({ data: review() })
  await recoverApprovalRoute(review(), 'Fixed coverage')
  expect(rpc).toHaveBeenLastCalledWith('approval_recover_route', { p_entity_type: 'checklist', p_entity_id: 'sheet-1', p_expected_stage: 'instance:0', p_reason: 'Fixed coverage' })
  await reassignApprovalStage(review(), 'replacement', 'Unavailable')
  expect(rpc).toHaveBeenLastCalledWith('approval_reassign_stage', { p_entity_type: 'checklist', p_entity_id: 'sheet-1', p_expected_stage: 'instance:0', p_reason: 'Unavailable', p_approver_id: 'replacement' })
})
it('does not treat a malformed eligible reviewer response as an empty list', async () => {
  rpc.mockResolvedValue({ data: null })
  await expect(listApprovalReviewPeople('checklist', 'sheet-1')).rejects.toThrow(/could not be verified/)
})

it('binds delegation to the current stage and validates its bounded period', async () => {
  const starts = new Date(Date.now() + 86400000).toISOString()
  const ends = new Date(Date.now() + 3 * 86400000).toISOString()
  rpc.mockResolvedValue({ data: { id: 'd1', delegate_id: 'delegate', active: true } })
  await delegateApprovalStage(review(), 'delegate', starts, ends, 'Leave cover')
  expect(rpc).toHaveBeenLastCalledWith('approval_delegate_stage', expect.objectContaining({ p_expected_stage: 'instance:0', p_delegate_id: 'delegate', p_reason: 'Leave cover', p_starts_at: starts, p_ends_at: ends }))
  await expect(delegateApprovalStage(review(), 'delegate', starts, new Date(Date.now() + 100 * 86400000).toISOString(), 'Leave cover')).rejects.toThrow(/90 days/)
})
it('requires the actual revoked receipt instead of assuming success', async () => {
  rpc.mockResolvedValue({ data: { id: 'd1', active: true } })
  await expect(revokeApprovalDelegation('d1', 'Returned')).rejects.toThrow(/did not confirm/)
  rpc.mockResolvedValue({ data: { id: 'd1', active: false } })
  await expect(revokeApprovalDelegation('d1', 'Returned')).resolves.toMatchObject({ active: false })
})
