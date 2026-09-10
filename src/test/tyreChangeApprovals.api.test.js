import { beforeEach, describe, expect, it, vi } from 'vitest'
const { rpc } = vi.hoisted(() => ({ rpc: vi.fn() }))
vi.mock('../lib/api/_client', () => ({ supabase: { rpc }, unwrap: result => { if (result.error) throw result.error; return result.data } }))
import { getTyreChangeApprovalContext, executeApprovedTyreChange, tyreChangePayload } from '../lib/api/tyreChangeApprovals'
beforeEach(() => rpc.mockReset())
describe('tyre execution boundary', () => {
  it('rejects a mismatched vehicle scope', async () => {
    rpc.mockResolvedValue({ data: { mode: 'enforced', can_submit: true, requests: [], vehicle: { id: 'other' } } })
    await expect(getTyreChangeApprovalContext('vehicle')).rejects.toThrow(/authority/)
  })
  it('requires a matching committed execution receipt', async () => {
    const intent = { p_request_id: 'request', p_operation_id: 'operation' }
    rpc.mockResolvedValue({ data: { ok: true, request_id: 'request', operation_id: 'different', status: 'executed', executed_at: '2026-09-10' } })
    await expect(executeApprovedTyreChange(intent)).rejects.toThrow(/did not confirm/)
    rpc.mockResolvedValue({ data: { ok: true, request_id: 'request', operation_id: 'operation', status: 'executed', executed_at: '2026-09-10' } })
    expect(await executeApprovedTyreChange(intent)).toMatchObject({ status: 'executed' })
  })
  it('rejects invalid meters and preserves the selected tyre position identifier', () => {
    const form = { action: 'install', position: 'R2Ri', serial: 'NEW', reason: 'Worn', km: '500', cost: '', date: '2026-09-10' }
    expect(tyreChangePayload(form)).toMatchObject({ position: 'R2Ri', km_at_fitment: 500, cost_per_tyre: null })
    expect(() => tyreChangePayload({ ...form, km: '-1' })).toThrow(/non-negative/)
    expect(() => tyreChangePayload({ ...form, km: 'abc' })).toThrow(/non-negative/)
  })
})
