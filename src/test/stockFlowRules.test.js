/**
 * WP5: issues, returns and transfers post to the ledger correctly.
 * Pure rules (src/lib/inventory/stockFlowRules.js) + the RPC payloads the new
 * service calls send (release, return to stock, transfer return, receive).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const state = { rpc: { data: null, error: null }, calls: [] }

vi.mock('../lib/supabase', () => ({
  supabase: {
    from: () => ({}),
    rpc: (fn, args) => { state.calls.push(['rpc', fn, args]); return Promise.resolve(state.rpc) },
  },
}))

import {
  positiveQty, issueDocFields, availableQty, issueShortfall, receivableLines, overReceived,
  seesAllSites, crossSiteOutOfScope,
} from '../lib/inventory/stockFlowRules'
import {
  releaseReservation, returnIssuedStock, returnTransferRemaining, receiveTransfer,
} from '../lib/api/inventory'

beforeEach(() => { state.rpc = { data: null, error: null }; state.calls = [] })
const lastRpc = () => state.calls.filter((c) => c[0] === 'rpc').pop()

describe('stockFlowRules', () => {
  it('positiveQty accepts only numbers above zero', () => {
    expect(positiveQty('2')).toBe(2)
    expect(positiveQty(0)).toBeNull()
    expect(positiveQty('')).toBeNull()
    expect(positiveQty(null)).toBeNull()
    expect(positiveQty('-1')).toBeNull()
    expect(positiveQty('abc')).toBeNull()
  })

  it('a job card number becomes the source document, not only a reference', () => {
    expect(issueDocFields(' GCKR/JC/1 ')).toEqual({ sourceDocType: 'job_card', sourceDocId: 'GCKR/JC/1', referenceNo: 'GCKR/JC/1' })
    expect(issueDocFields('')).toEqual({ sourceDocType: null, sourceDocId: null, referenceNo: null })
    expect(issueDocFields(null).sourceDocId).toBeNull()
  })

  it('availableQty is on hand minus reserved, never negative, null when unknown', () => {
    expect(availableQty({ qty_on_hand: 10, qty_reserved: 3 })).toBe(7)
    expect(availableQty({ qty_on_hand: 2, qty_reserved: 5 })).toBe(0)
    expect(availableQty({ qty_on_hand: 4 })).toBe(4)
    expect(availableQty({})).toBeNull()
    expect(availableQty(null)).toBeNull()
  })

  it('issueShortfall warns only when the request exceeds what can be used', () => {
    const stock = { qty_on_hand: 10, qty_reserved: 6 }
    expect(issueShortfall({ stock, qty: 4 })).toBeNull()
    expect(issueShortfall({ stock, qty: 5 })).toEqual({ requested: 5, available: 4 })
    // Consuming my own reservation draws on reserved stock.
    expect(issueShortfall({ stock, qty: 9, reservedForMe: 6 })).toBeNull()
    expect(issueShortfall({ stock, qty: '' })).toBeNull()
    expect(issueShortfall({ stock: {}, qty: 3 })).toBeNull()
  })

  it('receivableLines drops zero and blank lines; overReceived flags excess', () => {
    const lines = [
      { line_id: 'a', received_qty: '2', outstanding: 3 },
      { line_id: 'b', received_qty: '0', outstanding: 1 },
      { line_id: 'c', received_qty: '', outstanding: 1 },
      { line_id: 'd', received_qty: '5', outstanding: 4 },
    ]
    expect(receivableLines(lines).map((l) => l.line_id)).toEqual(['a', 'd'])
    expect(overReceived(lines).map((l) => l.line_id)).toEqual(['d'])
  })

  it('crossSiteOutOfScope mirrors the server: in-transit stock sits at the destination', () => {
    const a = { site: 'DEMO YARD' }
    const b = { site: 'NHC' }
    expect(seesAllSites(['ALL'])).toBe(true)
    expect(seesAllSites([])).toBe(false)
    expect(crossSiteOutOfScope(a, b, { sites: ['DEMO YARD'] })).toBe(true)
    expect(crossSiteOutOfScope(a, b, { sites: ['DEMO YARD', 'nhc'] })).toBe(false)
    expect(crossSiteOutOfScope(a, b, { sites: ['ALL'] })).toBe(false)
    expect(crossSiteOutOfScope(a, b, { sites: ['DEMO YARD'], isAdmin: true })).toBe(false)
    expect(crossSiteOutOfScope(a, { site: 'demo yard' }, { sites: ['DEMO YARD'] })).toBe(false)
    expect(crossSiteOutOfScope(null, b, { sites: [] })).toBe(false)
  })
})

describe('ledger postings send the right payload', () => {
  it('receiveTransfer never sends a zero line (the server refuses zero on any line)', async () => {
    await receiveTransfer({ transferId: 't', lines: [{ line_id: 'l1', received_qty: '2' }, { line_id: 'l2', received_qty: '0' }] }, 'k')
    expect(lastRpc()[1]).toBe('inv_transfer_receive')
    expect(lastRpc()[2].p_payload.lines).toEqual([{ line_id: 'l1', received_qty: 2, condition: 'good', remarks: null }])
    await expect(receiveTransfer({ transferId: 't', lines: [{ line_id: 'l2', received_qty: 0 }] }, 'k')).rejects.toMatchObject({ code: 'INV_NO_LINES' })
  })

  it('releaseReservation posts inv_release; blank qty releases the rest', async () => {
    await releaseReservation({ reservationId: 'r1' }, 'k1')
    expect(lastRpc()[1]).toBe('inv_release')
    expect(lastRpc()[2].p_payload).toEqual({ reservation_id: 'r1', qty: null, idempotency_key: 'k1' })
    await releaseReservation({ reservationId: 'r1', qty: '2' }, 'k2')
    expect(lastRpc()[2].p_payload.qty).toBe(2)
    await expect(releaseReservation({}, 'k')).rejects.toMatchObject({ code: 'INV_NO_RESERVATION' })
    await expect(releaseReservation({ reservationId: 'r', qty: '-1' }, 'k')).rejects.toMatchObject({ code: 'INV_BAD_QTY' })
  })

  it('returnIssuedStock posts an issue_return movement linked to the job card', async () => {
    await returnIssuedStock({ stockId: 's', qty: '3', reason: 'unused', sourceDocType: 'job_card', sourceDocId: 'JC9', referenceNo: 'JC9' }, 'k')
    expect(lastRpc()[1]).toBe('inv_post_movement')
    expect(lastRpc()[2].p_payload).toMatchObject({
      stock_id: 's', movement_type: 'issue_return', qty_change: 3, reason: 'unused',
      source_doc_type: 'job_card', source_doc_id: 'JC9', reference_no: 'JC9', idempotency_key: 'k',
    })
    await expect(returnIssuedStock({ stockId: 's', qty: 1, reason: ' ' }, 'k')).rejects.toMatchObject({ code: 'INV_NO_REASON' })
    await expect(returnIssuedStock({ stockId: 's', qty: 0, reason: 'x' }, 'k')).rejects.toMatchObject({ code: 'INV_BAD_QTY' })
  })

  it('returnTransferRemaining requires a reason and returns everything by default', async () => {
    await returnTransferRemaining({ transferId: 't', reason: ' wrong site ' }, 'k')
    expect(lastRpc()[1]).toBe('inv_transfer_return_remaining')
    expect(lastRpc()[2].p_payload).toEqual({ transfer_id: 't', reason: 'wrong site', idempotency_key: 'k' })
    await returnTransferRemaining({ transferId: 't', reason: 'x', lines: [{ line_id: 'l', qty: '1' }, { line_id: 'm', qty: 0 }] }, 'k2')
    expect(lastRpc()[2].p_payload.lines).toEqual([{ line_id: 'l', qty: 1 }])
    await expect(returnTransferRemaining({ transferId: 't', reason: '' }, 'k')).rejects.toMatchObject({ code: 'INV_NO_REASON' })
  })

  it('a server refusal reaches the screen as written', async () => {
    state.rpc = { data: null, error: { code: '42501', message: 'This stock is outside your country or site scope.' } }
    const err = await returnIssuedStock({ stockId: 's', qty: 1, reason: 'x' }, 'k').catch((e) => e)
    expect(err).toBeTruthy()
    expect(String(err.message)).toMatch(/scope/i)
  })
})
