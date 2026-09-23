import { beforeEach, describe, expect, it, vi } from 'vitest'
const h = vi.hoisted(() => ({ rpc: vi.fn() }))
vi.mock('../lib/supabase', () => ({ supabase: { rpc: h.rpc } }))
const { verifyBatchLanding } = await import('../lib/api/imports')
const valid = () => ({ batch_id: 'batch-1', module: 'tyre', target_table: 'tyre_records', status: 'committed', expected_distinct: 3, landed_distinct: 2, dangling: 1, scope_verified: true, verified_at: '2026-09-10T15:00:00Z' })
beforeEach(() => h.rpc.mockReset())
describe('confirmed import destination verification', () => {
  it('preserves a confirmed incomplete landing so the caller can report missing rows', async () => {
    const reply = valid()
    h.rpc.mockResolvedValue({ data: reply, error: null })
    expect(await verifyBatchLanding('batch-1')).toEqual(reply)
    expect(h.rpc).toHaveBeenCalledWith('import_verify_landing', { p_batch_id: 'batch-1' })
  })
  it.each([null, {}, [], { ...valid(), batch_id: 'different' }, { ...valid(), scope_verified: false },
    { ...valid(), expected_distinct: '3' }, { ...valid(), landed_distinct: 4 }, { ...valid(), dangling: 0 },
    { ...valid(), verified_at: 'invalid' }, { ...valid(), target_table: '' }])('rejects unconfirmed or inconsistent reply %#', async data => {
    h.rpc.mockResolvedValue({ data, error: null })
    await expect(verifyBatchLanding('batch-1')).rejects.toMatchObject({ code: 'IMPORT_VERIFICATION_UNCONFIRMED' })
  })
  it('propagates database authorization errors', async () => {
    h.rpc.mockResolvedValue({ data: null, error: { message: 'Denied', code: '42501' } })
    await expect(verifyBatchLanding('batch-1')).rejects.toMatchObject({ code: '42501' })
  })
})
