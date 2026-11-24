import { describe, it, expect, vi, beforeEach } from 'vitest'

const mocks = vi.hoisted(() => ({
  rpc: vi.fn(),
  inserts: [],
  insertResults: [],
  selectError: null,
  createMaterialIssue: vi.fn(),
  postMaterialIssueSlip: vi.fn(),
  issueSlipPostingAvailable: vi.fn(),
  issueStock: vi.fn(),
}))

vi.mock('../lib/api/_client', () => {
  const builder = (table) => {
    const b = {
      insert(payload) { mocks.inserts.push({ table, payload }); return b },
      select() { return b },
      limit() { return Promise.resolve({ data: [], error: mocks.selectError }) },
      single() { return Promise.resolve(mocks.insertResults.shift() || { data: { id: 'q1' }, error: null }) },
    }
    return b
  }
  return {
    supabase: { from: builder, rpc: mocks.rpc },
    toServiceError: (e, f) => Object.assign(new Error(f || e?.message || 'error'), { cause: e }),
    isNotProvisioned: (e) => ['42883', 'PGRST202', '42P01'].includes(String(e?.code || '')),
    isMissingColumn: (e) => String(e?.code || '') === 'PGRST204',
  }
})
vi.mock('../lib/api/inventory', () => ({
  VIEWS: { balances: 'v_inv_balances', movements: 'v_inv_movements' },
  reserveStock: vi.fn(), issueStock: mocks.issueStock, returnIssuedStock: vi.fn(),
}))
vi.mock('../lib/api/materialIssue', () => ({
  createMaterialIssue: mocks.createMaterialIssue,
  postMaterialIssueSlip: mocks.postMaterialIssueSlip,
  issueSlipPostingAvailable: mocks.issueSlipPostingAvailable,
}))

import { raiseShortageRequisition, issueReservedToJob, confirmInstallation, _resetWorkshopStockProbe } from '../lib/workshopStock/service'

beforeEach(() => {
  mocks.inserts.length = 0
  mocks.insertResults.length = 0
  mocks.selectError = null
  _resetWorkshopStockProbe()
  for (const k of ['rpc', 'createMaterialIssue', 'postMaterialIssueSlip', 'issueSlipPostingAvailable', 'issueStock']) mocks[k].mockReset()
})

const line = { key: 'r:1', stockId: 's1', reservationId: 'r1', qty: 2, itemCode: 'OF-1' }

describe('workshop stock service', () => {
  it('a shortage requisition names the job card and falls back when the column is missing', async () => {
    mocks.insertResults.push({ data: null, error: { code: 'PGRST204', message: "Could not find the 'job_card_no' column" } })
    await raiseShortageRequisition({ jobCard: 'JC-1', qty: 3, itemCode: 'OF-1', site: 'NHC', country: 'KSA' })
    expect(mocks.inserts[0].payload).toMatchObject({ job_card_no: 'JC-1', quantity: 3, status: 'submitted' })
    expect(mocks.inserts[1].payload.job_card_no).toBeUndefined()
    expect(mocks.inserts[1].payload.notes).toMatch(/JC-1/)
  })

  it('issues through one slip carrying the reservation, and re-posts the same slip on retry', async () => {
    mocks.issueSlipPostingAvailable.mockResolvedValue(true)
    mocks.createMaterialIssue.mockResolvedValue({ ok: true, id: 'slip1', issue_number: 'MIS-1' })
    mocks.postMaterialIssueSlip.mockResolvedValueOnce({ ok: false, message: 'network' })
      .mockResolvedValueOnce({ ok: true, posted: 0, already: 1, issueNumber: 'MIS-1' })
    const first = await issueReservedToJob({ jobCard: 'JC-1', lines: [line], issuedTo: 'Ali' })
    expect(first).toMatchObject({ ok: false, slipId: 'slip1' })
    expect(mocks.createMaterialIssue.mock.calls[0][1][0]).toMatchObject({ stock_id: 's1', reservation_id: 'r1', qty: 2 })
    const second = await issueReservedToJob({ jobCard: 'JC-1', lines: [line], issuedTo: 'Ali', retrySlipId: 'slip1' })
    expect(second).toMatchObject({ ok: true, already: 1 })
    expect(mocks.createMaterialIssue).toHaveBeenCalledTimes(1)
  })

  it('falls back to inv_issue against the reservation when slips cannot carry it', async () => {
    mocks.issueSlipPostingAvailable.mockResolvedValue(true)
    mocks.selectError = { code: 'PGRST204' }
    mocks.issueStock.mockResolvedValue({ movement_id: 'm1' })
    const res = await issueReservedToJob({ jobCard: 'JC-1', lines: [line], issuedTo: 'Ali' }, { 'r:1': 'k1' })
    expect(res).toMatchObject({ ok: true, mode: 'direct', posted: 1 })
    expect(mocks.issueStock.mock.calls[0][0]).toMatchObject({ reservationId: 'r1', sourceDocType: 'job_card', sourceDocId: 'JC-1' })
    expect(mocks.issueStock.mock.calls[0][1]).toBe('k1')
  })

  it('refuses to issue without a receiver', async () => {
    const res = await issueReservedToJob({ jobCard: 'JC-1', lines: [line], issuedTo: ' ' })
    expect(res.ok).toBe(false)
    expect(mocks.createMaterialIssue).not.toHaveBeenCalled()
  })

  it('installation passes the server sentence through and the key every time', async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { code: '42501', message: 'The person who issued the parts cannot confirm their installation.' } })
    const res = await confirmInstallation({ movementId: 'm1', qty: 1 }, 'k9')
    expect(res).toMatchObject({ ok: false, message: 'The person who issued the parts cannot confirm their installation.' })
    expect(mocks.rpc.mock.calls[0][1].p_payload).toMatchObject({ idempotency_key: 'k9', movement_id: 'm1', qty: 1 })
  })
})
