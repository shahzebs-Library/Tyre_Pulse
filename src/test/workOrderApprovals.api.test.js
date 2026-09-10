import { beforeEach, expect, it, vi } from 'vitest'
const rpc = vi.hoisted(() => vi.fn())
vi.mock('../lib/api/_client', () => ({ supabase: { rpc }, unwrap: result => { if (result.error) throw result.error; return result.data } }))
import { getWorkOrderApproval, requestWorkOrderApproval } from '../lib/api/workOrderApprovals'
const envelope = { mode: 'enforced', can_submit: true, can_execute: false, request_id: null, review: null, work_order: { id: 'wo1' } }
beforeEach(() => { rpc.mockReset(); rpc.mockResolvedValue({ data: envelope }) })
it('loads the source-specific execution envelope without confusing request IDs', async () => {
  await getWorkOrderApproval('wo1')
  expect(rpc).toHaveBeenCalledWith('work_order_approval_context', { p_work_order_id: 'wo1' })
})
it('rejects a request review for a different request', async () => {
  rpc.mockResolvedValue({ data: { ...envelope, request_id: 'request1', review: { entity_id: 'wo1' } } })
  await expect(getWorkOrderApproval('wo1')).rejects.toThrow(/did not confirm/)
})
it('submits only a source reference, operation ID and reason, never client authority', async () => {
  rpc.mockResolvedValue({ data: { ...envelope, request_id: 'request1', review: { entity_id: 'request1', entity_type: 'work_order' } } })
  await requestWorkOrderApproval('wo1', 'op1', 'Repair')
  expect(rpc).toHaveBeenCalledWith('request_work_order_approval', { p_work_order_id: 'wo1', p_operation_id: 'op1', p_reason: 'Repair' })
})
it('does not confirm a submission when the server returns no request', async () => {
  await expect(requestWorkOrderApproval('wo1', 'op1', 'Repair')).rejects.toThrow(/did not confirm/)
})
