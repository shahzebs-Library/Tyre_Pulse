import { describe, it, expect, vi, beforeEach } from 'vitest'

const state = { result: { data: [], error: null, count: 0 }, rpc: { data: null, error: null }, calls: [] }

function builder(table) {
  const b = {
    _table: table,
    select: (...a) => { state.calls.push(['select', table, ...a]); return b },
    eq: (...a) => { state.calls.push(['eq', ...a]); return b },
    not: (...a) => { state.calls.push(['not', ...a]); return b },
    in: (...a) => { state.calls.push(['in', ...a]); return b },
    or: (...a) => { state.calls.push(['or', ...a]); return b },
    gte: () => b, lte: () => b, is: () => b, limit: () => b,
    order: (...a) => { state.calls.push(['order', ...a]); return b },
    range: (...a) => { state.calls.push(['range', ...a]); return b },
    maybeSingle: () => Promise.resolve(state.result),
    then: (res, rej) => Promise.resolve(state.result).then(res, rej),
  }
  return b
}

vi.mock('../lib/supabase', () => ({
  supabase: {
    from: (t) => builder(t),
    rpc: (fn, args) => { state.calls.push(['rpc', fn, args]); return Promise.resolve(state.rpc) },
  },
}))

import {
  listBalances, listAudits, getCounterView, createAudit, isInventoryNotSetUp, MAX_PAGE_SIZE,
  probeInventorySetup, newIdempotencyKey, submitCount,
} from '../lib/api/inventory'

beforeEach(() => {
  state.result = { data: [], error: null, count: 0 }
  state.rpc = { data: null, error: null }
  state.calls = []
})

describe('inventory service', () => {
  it('pages server side with an exact count and an id tiebreak, clamped below the row cap', async () => {
    state.result = { data: [{ id: 1 }], error: null, count: 41 }
    const r = await listBalances({ page: 2, pageSize: 5000 })
    expect(r).toEqual({ status: 'ok', rows: [{ id: 1 }], total: 41 })
    const range = state.calls.find((c) => c[0] === 'range')
    expect(range).toEqual(['range', 2 * MAX_PAGE_SIZE, 3 * MAX_PAGE_SIZE - 1])
    expect(state.calls.filter((c) => c[0] === 'order').pop()[1]).toBe('id')
    expect(state.calls.find((c) => c[0] === 'select')[3]).toEqual({ count: 'exact' })
  })

  it('degrades a missing table or column to not_provisioned, never fake rows', async () => {
    state.result = { data: null, error: { code: '42P01', message: 'relation does not exist' } }
    expect(await listAudits({})).toEqual({ status: 'not_provisioned', rows: [], total: 0 })
    state.result = { data: null, error: { code: '42703', message: 'column x does not exist' } }
    expect((await listBalances({})).status).toBe('not_provisioned')
  })

  it('throws a sanitised error on permission denial instead of hiding it', async () => {
    state.result = { data: null, error: { code: '42501', message: 'permission denied for relation inventory_audits' } }
    await expect(listAudits({})).rejects.toMatchObject({ name: 'ServiceError' })
    await listAudits({}).catch((e) => expect(e.message).not.toMatch(/inventory_audits/))
  })

  it('maps a missing RPC to INV_NOT_PROVISIONED and requires an idempotency key', async () => {
    state.rpc = { data: null, error: { code: 'PGRST202', message: 'Could not find the function' } }
    const err = await createAudit({ audit_type: 'cycle', site: 'NHC' }, 'k1').catch((e) => e)
    expect(isInventoryNotSetUp(err)).toBe(true)
    await expect(createAudit({}, '')).rejects.toMatchObject({ code: 'INV_NO_IDEMPOTENCY' })
  })

  it('sends the idempotency key inside p_payload', async () => {
    state.rpc = { data: { id: 'a1' }, error: null }
    await submitCount({ auditId: 'a1', lines: [{ item_id: 'i', counted_qty: 3 }] }, 'key-9')
    const call = state.calls.find((c) => c[0] === 'rpc')
    expect(call[1]).toBe('inv_count_submit')
    expect(call[2].p_payload.idempotency_key).toBe('key-9')
    expect(call[2].p_payload.lines[0].client_uuid).toBeTruthy()
  })

  it('strips expected quantities from the counter view even if the server leaked them', async () => {
    state.rpc = { data: { audit: { id: 'a' }, lines: [{ item_code: 'X', expected_qty: 12, book_qty: 12 }] }, error: null }
    const v = await getCounterView('a')
    expect(v.lines[0]).toEqual({ item_code: 'X' })
  })

  it('reports setup per table and generates unique keys', async () => {
    state.result = { data: null, error: { code: 'PGRST205' }, count: null }
    const s = await probeInventorySetup()
    expect(Object.values(s).every((v) => v === false)).toBe(true)
    expect(newIdempotencyKey()).not.toBe(newIdempotencyKey())
  })
})
