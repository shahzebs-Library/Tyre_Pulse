import { describe, it, expect, vi, beforeEach } from 'vitest'

// Chainable, thenable Supabase mock (mirrors api.test.js) extended with the
// builders the Custom Data service needs: delete, not/is/contains/range, and a
// count-carrying result. Records the table, filters, and mutation payloads.
const h = vi.hoisted(() => {
  const state = { result: { data: [], error: null, count: 0 }, last: null, rpc: { data: null, error: null }, lastRpc: null }
  function rpc(name, args) { state.lastRpc = { name, args }; return Promise.resolve(state.rpc) }
  function from(table) {
    const calls = { eq: [], or: [], not: [], is: [], contains: [], range: [] }
    const b = {
      _table: table,
      _calls: calls,
      select(cols, opts) { calls.select = { cols, opts }; return b },
      order() { return b },
      limit() { return b },
      range(a, z) { calls.range.push([a, z]); return b },
      insert(v) { calls.insert = v; return b },
      update(v) { calls.update = v; return b },
      delete() { calls.delete = true; return b },
      eq(c, v) { calls.eq.push([c, v]); return b },
      or(e) { calls.or.push(e); return b },
      not(c, op, v) { calls.not.push([c, op, v]); return b },
      is(c, v) { calls.is.push([c, v]); return b },
      contains(c, v) { calls.contains.push([c, v]); return b },
      maybeSingle() { return Promise.resolve(state.result) },
      single() { return Promise.resolve(state.result) },
      then(onF, onR) { return Promise.resolve(state.result).then(onF, onR) },
    }
    state.last = b
    return b
  }
  return { state, supabase: { from, rpc } }
})

vi.mock('../lib/supabase', () => ({ supabase: h.supabase }))
// fetchAllPages is re-exported by _client from ../fetchAll; keep the real impl
// (it pages over the mocked builder), so no mock needed here.

const customData = await import('../lib/api/customData')
const { ServiceError } = await import('../lib/api/_client')

beforeEach(() => {
  h.state.result = { data: [], error: null, count: 0 }
  h.state.last = null
  h.state.rpc = { data: null, error: null }
  h.state.lastRpc = null
})

describe('service layer - customData: field_synonyms', () => {
  it('createFieldSynonym inserts into field_synonyms and returns the row', async () => {
    h.state.result = { data: { id: 'fs1', custom_name: 'Reg No' }, error: null, count: 0 }
    const row = await customData.createFieldSynonym({
      custom_name: 'Reg No', maps_to: 'asset_no', table_target: 'tyre_records', use_count: 0,
    })
    expect(h.state.last._table).toBe('field_synonyms')
    expect(h.state.last._calls.insert).toMatchObject({ custom_name: 'Reg No', maps_to: 'asset_no' })
    expect(row).toEqual({ id: 'fs1', custom_name: 'Reg No' })
  })

  it('deleteFieldSynonym deletes by id', async () => {
    await customData.deleteFieldSynonym('fs9')
    expect(h.state.last._table).toBe('field_synonyms')
    expect(h.state.last._calls.delete).toBe(true)
    expect(h.state.last._calls.eq).toContainEqual(['id', 'fs9'])
  })

  it('throws a ServiceError when field_synonyms fails', async () => {
    h.state.result = { data: null, error: { message: 'boom', code: '42501' }, count: 0 }
    await expect(customData.deleteFieldSynonym('fs9')).rejects.toBeInstanceOf(ServiceError)
    await expect(customData.deleteFieldSynonym('fs9')).rejects.toMatchObject({ code: '42501' })
  })
})

describe('service layer - customData: extra field tooling', () => {
  it('getExtraFieldStats calls the get_extra_field_stats RPC with p_country', async () => {
    h.state.rpc = { data: [{ field_key: 'x', record_count: 3, sample_vals: ['a'] }], error: null }
    const stats = await customData.getExtraFieldStats({ country: 'KSA' })
    expect(h.state.lastRpc.name).toBe('get_extra_field_stats')
    expect(h.state.lastRpc.args).toEqual({ p_country: 'KSA' })
    expect(stats).toEqual([{ field_key: 'x', record_count: 3, sample_vals: ['a'] }])
  })

  it('updateTyreRecordFields passes an arbitrary dynamic-key patch through untouched', async () => {
    const col = 'driver_name'
    await customData.updateTyreRecordFields('t1', { [col]: 'Ahmed' })
    expect(h.state.last._table).toBe('tyre_records')
    expect(h.state.last._calls.update).toEqual({ driver_name: 'Ahmed' })
    expect(h.state.last._calls.eq).toContainEqual(['id', 't1'])
  })
})
