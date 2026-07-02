import { describe, it, expect, vi, beforeEach } from 'vitest'

// Shared, hoisted Supabase mock: a chainable, thenable query builder that
// records the table queried and the eq/or filters applied, and resolves to a
// configurable { data, error }. Mirrors src/test/api.test.js.
const h = vi.hoisted(() => {
  const state = { result: { data: [], error: null }, last: null }
  function from(table) {
    const calls = { eq: [], or: [] }
    const b = {
      _table: table,
      _calls: calls,
      select() { return b },
      order() { return b },
      limit() { return b },
      insert(v) { calls.insert = v; return b },
      update(v) { calls.update = v; return b },
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

const rca = await import('../lib/api/rca')
const { ServiceError } = await import('../lib/api/_client')

beforeEach(() => {
  h.state.result = { data: [], error: null }
  h.state.last = null
})

describe('service layer - rca', () => {
  it('lists from rca_records, newest first', async () => {
    h.state.result = { data: [{ id: 'r1', asset_no: 'V-1' }], error: null }
    const rows = await rca.listRcaRecords({ country: 'All' })
    expect(h.state.last._table).toBe('rca_records')
    expect(rows).toEqual([{ id: 'r1', asset_no: 'V-1' }])
  })

  it('applies a STRICT country eq (not null-inclusive) and none for "All"', async () => {
    await rca.listRcaRecords({ country: 'KSA' })
    expect(h.state.last._calls.eq).toContainEqual(['country', 'KSA'])
    expect(h.state.last._calls.or).toHaveLength(0)

    await rca.listRcaRecords({ country: 'All' })
    expect(h.state.last._calls.eq).toHaveLength(0)
  })

  it('updateRcaRecord patches by id', async () => {
    await rca.updateRcaRecord('r1', { corrective_action_id: 'ca1' })
    expect(h.state.last._calls.update).toEqual({ corrective_action_id: 'ca1' })
    expect(h.state.last._calls.eq).toContainEqual(['id', 'r1'])
  })

  it('throws a ServiceError on a Supabase error', async () => {
    h.state.result = { data: null, error: { message: 'boom', code: '42501' } }
    await expect(rca.listRcaRecords()).rejects.toBeInstanceOf(ServiceError)
    await expect(rca.createRcaRecord({})).rejects.toMatchObject({ code: '42501' })
  })
})
