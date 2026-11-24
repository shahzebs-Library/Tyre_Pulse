/**
 * WP5 (migration 20261124091000): posting a material issue slip to stock.
 * The client detects whether inv_issue_slip exists, posts through it, and keeps
 * a business refusal (shortage, scope) distinct from "not available yet".
 */
import { beforeEach, describe, it, expect, vi } from 'vitest'

const h = vi.hoisted(() => ({ rpc: vi.fn(), from: vi.fn(), queries: [], result: { data: [], error: null } }))
vi.mock('../lib/supabase', () => ({ supabase: { rpc: h.rpc, from: h.from } }))

import {
  issueSlipPostingAvailable, resetIssueSlipPostingProbe, postMaterialIssueSlip, listSlipStockLines,
} from '../lib/api/materialIssue'

beforeEach(() => {
  resetIssueSlipPostingProbe()
  h.rpc.mockReset()
  h.queries = []
  h.result = { data: [], error: null }
  h.from.mockReset().mockImplementation((table) => {
    const q = { table, steps: [], then: (res, rej) => Promise.resolve(h.result).then(res, rej) }
    for (const name of ['select', 'eq', 'order', 'limit']) q[name] = (...a) => { q.steps.push([name, ...a]); return q }
    h.queries.push(q)
    return q
  })
})

describe('issueSlipPostingAvailable', () => {
  it('is false only when the function is missing, and asks once', async () => {
    h.rpc.mockResolvedValue({ data: null, error: { code: 'PGRST202', message: 'Could not find the function' } })
    expect(await issueSlipPostingAvailable()).toBe(false)
    expect(await issueSlipPostingAvailable()).toBe(false)
    expect(h.rpc).toHaveBeenCalledTimes(1)
  })

  it('a refusal from the function itself proves it exists', async () => {
    h.rpc.mockResolvedValue({ data: null, error: { code: '22023', message: 'issue_id is required.' } })
    expect(await issueSlipPostingAvailable()).toBe(true)
    resetIssueSlipPostingProbe()
    h.rpc.mockResolvedValue({ data: null, error: { code: '42501', message: 'Stock permission "issue" is required.' } })
    expect(await issueSlipPostingAvailable()).toBe(true)
  })
})

describe('postMaterialIssueSlip', () => {
  it('sends only the slip id and reports posted lines', async () => {
    h.rpc.mockResolvedValue({ data: { posted_lines: 2, already_posted: 0, lines: [{ movement_id: 'm1' }], issue_number: 'GC/MIS/1' }, error: null })
    const r = await postMaterialIssueSlip('slip-1')
    expect(h.rpc).toHaveBeenCalledWith('inv_issue_slip', { p_payload: { issue_id: 'slip-1' } })
    expect(r).toMatchObject({ ok: true, posted: 2, already: 0, issueNumber: 'GC/MIS/1' })
  })

  it('a shortage keeps the server sentence (line and quantities) and is not thrown', async () => {
    h.rpc.mockResolvedValue({ data: null, error: { code: '23514', message: 'Line 1: not enough stock (7 available, 50 asked).' } })
    const r = await postMaterialIssueSlip('slip-1')
    expect(r).toMatchObject({ ok: false, reason: 'shortage', message: 'Line 1: not enough stock (7 available, 50 asked).' })
  })

  it('a scope refusal is reported as forbidden; database internals never pass through', async () => {
    h.rpc.mockResolvedValue({ data: null, error: { code: '42501', message: 'This slip belongs to a site outside your scope.' } })
    expect(await postMaterialIssueSlip('s')).toMatchObject({ ok: false, reason: 'forbidden', message: 'This slip belongs to a site outside your scope.' })
    h.rpc.mockResolvedValue({ data: null, error: { code: 'XX000', message: 'relation "public.stock_movements" violates something' } })
    const r = await postMaterialIssueSlip('s')
    expect(r.ok).toBe(false)
    expect(r.message).not.toMatch(/stock_movements|relation/)
  })

  it('missing function -> not_available (the slip stays a document)', async () => {
    h.rpc.mockResolvedValue({ data: null, error: { code: '42883', message: 'function does not exist' } })
    expect(await postMaterialIssueSlip('s')).toEqual({ ok: false, reason: 'not_available' })
    expect(await issueSlipPostingAvailable()).toBe(false)
  })

  it('no id -> no call', async () => {
    expect(await postMaterialIssueSlip('')).toMatchObject({ ok: false, reason: 'no_id' })
    expect(h.rpc).not.toHaveBeenCalled()
  })
})

describe('listSlipStockLines', () => {
  it('reads the item at the slip site and country, bounded', async () => {
    h.result = { data: [{ id: 'b1' }], error: null }
    const rows = await listSlipStockLines({ country: 'KSA', site: 'nhc-st', itemCode: ' 210086-O ' })
    expect(rows).toEqual([{ id: 'b1' }])
    const q = h.queries[0]
    expect(q.table).toBe('v_inv_balances')
    expect(q.steps).toContainEqual(['eq', 'item_code', '210086-O'])
    expect(q.steps).toContainEqual(['eq', 'country', 'KSA'])
    expect(q.steps).toContainEqual(['eq', 'site', 'NHC-ST'])
    expect(q.steps.find((s) => s[0] === 'limit')[1]).toBeLessThan(1000)
  })

  it('no item code -> no read; an unreadable read throws instead of looking empty', async () => {
    expect(await listSlipStockLines({ country: 'KSA', itemCode: '' })).toEqual([])
    expect(h.from).not.toHaveBeenCalled()
    h.result = { data: null, error: { code: '42501', message: 'permission denied' } }
    await expect(listSlipStockLines({ country: 'KSA', itemCode: 'X' })).rejects.toBeTruthy()
  })
})
