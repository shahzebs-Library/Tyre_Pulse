import { describe, it, expect, vi, beforeEach } from 'vitest'

// Chainable, thenable Supabase mock mirroring src/test/api.test.js: records the
// table queried and the eq/or/insert/update filters applied, resolves to a
// configurable { data, error }.
const h = vi.hoisted(() => {
  const state = { result: { data: [], error: null }, last: null }
  function from(table) {
    const calls = { eq: [], or: [] }
    const b = {
      _table: table,
      _calls: calls,
      select() { return b },
      order() { return b },
      range() { return b },
      insert(v) { calls.insert = v; return b },
      update(v) { calls.update = v; return b },
      delete() { calls.delete = true; return b },
      eq(c, v) { calls.eq.push([c, v]); return b },
      or(e) { calls.or.push(e); return b },
      maybeSingle() { return Promise.resolve(state.result) },
      single() { return Promise.resolve(state.result) },
      then(onF, onR) { return Promise.resolve(state.result).then(onF, onR) },
    }
    state.last = b
    return b
  }
  return { state, supabase: { from } }
})

vi.mock('../lib/supabase', () => ({ supabase: h.supabase }))

const recalls = await import('../lib/api/recalls')
const { ServiceError } = await import('../lib/api/_client')

beforeEach(() => {
  h.state.result = { data: [], error: null }
  h.state.last = null
})

describe('service layer — recalls', () => {
  it('lists from the recalls table, newest first, with no country filter', async () => {
    h.state.result = { data: [{ id: 'r1', recall_number: 'RCL-1' }], error: null }
    const rows = await recalls.listRecalls()
    expect(h.state.last._table).toBe('recalls')
    expect(h.state.last._calls.eq).toHaveLength(0)
    expect(h.state.last._calls.or).toHaveLength(0)
    expect(rows).toEqual([{ id: 'r1', recall_number: 'RCL-1' }])
  })

  it('updateRecall patches by id', async () => {
    await recalls.updateRecall('r1', { status: 'Closed' })
    expect(h.state.last._table).toBe('recalls')
    expect(h.state.last._calls.update).toEqual({ status: 'Closed' })
    expect(h.state.last._calls.eq).toContainEqual(['id', 'r1'])
  })

  it('deleteRecall deletes by id', async () => {
    await recalls.deleteRecall('r1')
    expect(h.state.last._table).toBe('recalls')
    expect(h.state.last._calls.delete).toBe(true)
    expect(h.state.last._calls.eq).toContainEqual(['id', 'r1'])
  })

  it('throws a ServiceError on a Supabase error', async () => {
    h.state.result = { data: null, error: { message: 'boom', code: '42501' } }
    await expect(recalls.listRecalls()).rejects.toBeInstanceOf(ServiceError)
    await expect(recalls.listRecalls()).rejects.toMatchObject({ code: '42501' })
  })
})
