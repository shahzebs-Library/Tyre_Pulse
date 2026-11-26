import { describe, it, expect, vi, beforeEach } from 'vitest'

const rpc = vi.fn()
let readResult = { data: [], error: null }
vi.mock('../lib/api/_client', async () => {
  const actual = await vi.importActual('../lib/api/_client')
  const b = {
    select() { return b }, eq() { return b }, order() { return b }, limit() { return b }, or() { return b },
    then(res, rej) { return Promise.resolve(readResult).then(res, rej) },
  }
  return { ...actual, supabase: { from: () => b, rpc: (...a) => rpc(...a) }, applyCountry: (q) => q }
})

const { listPendingStoreReceipts, decideStoreReceipt } = await import('../lib/api/procurementChain')

describe('store keeper phone receipts service', () => {
  beforeEach(() => { rpc.mockReset(); readResult = { data: [], error: null } })

  it('lists pending receipts, and degrades to [] before the migration is applied', async () => {
    readResult = { data: [{ id: 'r1' }], error: null }
    expect(await listPendingStoreReceipts({ country: 'KSA' })).toEqual([{ id: 'r1' }])
    readResult = { data: null, error: { code: '42P01', message: 'relation does not exist' } }
    expect(await listPendingStoreReceipts()).toEqual([])
  })

  it('a rejection needs a reason before anything is sent', async () => {
    await expect(decideStoreReceipt('r1', 'reject', '  ')).rejects.toThrow(/Say why/)
    expect(rpc).not.toHaveBeenCalled()
  })

  it('approve sends only the id and decision; no price', async () => {
    rpc.mockResolvedValue({ data: { status: 'approved' }, error: null })
    await decideStoreReceipt('r1', 'approve')
    expect(rpc).toHaveBeenCalledWith('inv_store_receipt_decide', { p_payload: { request_id: 'r1', decision: 'approve', note: null } })
  })
})
