import { describe, it, expect, vi, beforeEach } from 'vitest'

// Each awaited query resolves to the next scripted result.
const script = []
const rpcCalls = []
function builder() {
  const b = {}
  for (const m of ['select', 'eq', 'order', 'limit', 'in', 'not', 'gte', 'maybeSingle', 'range']) b[m] = () => b
  b.then = (res, rej) => Promise.resolve(script.shift() ?? { data: [], error: null }).then(res, rej)
  return b
}
vi.mock('../lib/api/_client', async () => {
  const actual = await vi.importActual('../lib/api/_client')
  return {
    ...actual,
    supabase: {
      from: () => builder(),
      rpc: (fn, args) => { rpcCalls.push({ fn, args }); return Promise.resolve({ data: { rfq_no: 'RFQ-1' }, error: null }) },
    },
    applyCountry: (q) => q,
  }
})

const { listRfqs, findOpenRfqForRequisition, createRfq, RFQ_BLOCKED_BY_PO } = await import('../lib/api/procurementDepth')

beforeEach(() => { script.length = 0; rpcCalls.length = 0 })

describe('procurement depth reads before the migration', () => {
  it('a missing column reads as not set up, not as an error', async () => {
    script.push({ data: null, error: { code: '42703', message: 'column procurement_rfqs.awarded_po_id does not exist' } })
    expect(await listRfqs({ country: 'KSA' })).toEqual({ status: 'not_provisioned', rows: [] })
    script.push({ data: null, error: { code: 'PGRST204', message: 'Could not find the column' } })
    expect((await listRfqs({ country: 'KSA' })).status).toBe('not_provisioned')
  })

  it('any other error is still reported', async () => {
    script.push({ data: null, error: { code: '42501', message: 'permission denied' } })
    await expect(listRfqs({ country: 'KSA' })).rejects.toThrow()
  })

  it('finds an open quotation request for a requisition, and answers null when not set up', async () => {
    script.push({ data: [{ id: 'r1', rfq_no: 'RFQ-2026-ABC', status: 'open' }], error: null })
    expect((await findOpenRfqForRequisition('req-1')).rfq_no).toBe('RFQ-2026-ABC')
    script.push({ data: null, error: { code: '42P01', message: 'relation does not exist' } })
    expect(await findOpenRfqForRequisition('req-1')).toBeNull()
    expect(await findOpenRfqForRequisition(null)).toBeNull()
  })

  it('refuses a quotation request for a requisition that already has a PO', async () => {
    script.push({ data: { id: 'req-1', status: 'ordered', po_ref: 'PO-1' }, error: null })
    await expect(createRfq({ country: 'KSA', requisitionId: 'req-1', lines: [], supplierIds: ['s'] }, 'k1'))
      .rejects.toThrow(RFQ_BLOCKED_BY_PO)
    expect(rpcCalls).toHaveLength(0)
    script.push({ data: { id: 'req-2', status: 'approved', po_ref: null }, error: null })
    await createRfq({ country: 'KSA', requisitionId: 'req-2', lines: [{ qty: 1 }], supplierIds: ['s'] }, 'k2')
    expect(rpcCalls[0].fn).toBe('inv_rfq_create')
    expect(rpcCalls[0].args.p_payload.idempotency_key).toBe('k2')
  })
})
