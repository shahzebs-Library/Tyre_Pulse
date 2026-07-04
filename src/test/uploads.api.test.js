import { describe, it, expect, vi, beforeEach } from 'vitest'

// Hoisted Supabase mock: a chainable, thenable query builder recording table,
// select cols, eq/in filters and insert/update/upsert payloads, resolving to a
// configurable { data, error }. Also mocks functions.invoke (edge function).
const h = vi.hoisted(() => {
  const state = { result: { data: [], error: null }, last: null, fn: { data: null, error: null }, lastFn: null }
  function invoke(name, opts) { state.lastFn = { name, opts }; return Promise.resolve(state.fn) }
  function from(table) {
    const calls = { eq: [], in: [] }
    const b = {
      _table: table,
      _calls: calls,
      select(cols) { calls.select = cols; return b },
      eq(c, v) { calls.eq.push([c, v]); return b },
      in(c, v) { calls.in.push([c, v]); return b },
      insert(v) { calls.insert = v; return b },
      update(v) { calls.update = v; return b },
      upsert(v, opts) { calls.upsert = v; calls.upsertOpts = opts; return b },
      maybeSingle() { return Promise.resolve(state.result) },
      then(onF, onR) { return Promise.resolve(state.result).then(onF, onR) },
    }
    state.last = b
    return b
  }
  return { state, supabase: { from, functions: { invoke } } }
})

vi.mock('../lib/supabase', () => ({ supabase: h.supabase }))

const uploads = await import('../lib/api/uploads')

beforeEach(() => {
  h.state.result = { data: [], error: null }
  h.state.last = null
  h.state.fn = { data: null, error: null }
  h.state.lastFn = null
})

describe('service layer - uploads', () => {
  it('listFieldSynonyms reads tyre_records synonyms', async () => {
    await uploads.listFieldSynonyms()
    expect(h.state.last._table).toBe('field_synonyms')
    expect(h.state.last._calls.select).toBe('custom_name, maps_to')
    expect(h.state.last._calls.eq).toContainEqual(['table_target', 'tyre_records'])
  })

  it('getColumnMapping looks up by fingerprint via maybeSingle', async () => {
    h.state.result = { data: { id: 'm1', mapping: {} }, error: null }
    const { data } = await uploads.getColumnMapping('fp-123')
    expect(h.state.last._table).toBe('column_mappings')
    expect(h.state.last._calls.select).toBe('id, mapping')
    expect(h.state.last._calls.eq).toContainEqual(['fingerprint', 'fp-123'])
    expect(data).toEqual({ id: 'm1', mapping: {} })
  })

  it('listExistingSerials filters tyre_records by serial batch', async () => {
    await uploads.listExistingSerials(['S1', 'S2'])
    expect(h.state.last._table).toBe('tyre_records')
    expect(h.state.last._calls.select).toBe('serial_no, asset_no, issue_date, id')
    expect(h.state.last._calls.in).toContainEqual(['serial_no', ['S1', 'S2']])
  })

  it('invokeChatAI calls the chat-ai edge function with the body', async () => {
    h.state.fn = { data: { content: '[]' }, error: null }
    const body = { system: 's', user: 'u', model: 'claude-haiku-4-5-20251001', max_tokens: 1024 }
    const { data } = await uploads.invokeChatAI(body)
    expect(h.state.lastFn.name).toBe('chat-ai')
    expect(h.state.lastFn.opts).toEqual({ body })
    expect(data).toEqual({ content: '[]' })
  })

  it('updateColumnMapping patches by id', async () => {
    await uploads.updateColumnMapping('m1', { mapping: { a: 'b' } })
    expect(h.state.last._table).toBe('column_mappings')
    expect(h.state.last._calls.update).toEqual({ mapping: { a: 'b' } })
    expect(h.state.last._calls.eq).toContainEqual(['id', 'm1'])
  })

  it('upsertColumnMapping upserts on fingerprint conflict', async () => {
    await uploads.upsertColumnMapping({ fingerprint: 'fp', mapping: {} })
    expect(h.state.last._calls.upsert).toEqual({ fingerprint: 'fp', mapping: {} })
    expect(h.state.last._calls.upsertOpts).toEqual({ onConflict: 'fingerprint' })
  })

  it('updateFieldSynonym patches by custom_name + table_target', async () => {
    await uploads.updateFieldSynonym('Serial No', { use_count: 2 })
    expect(h.state.last._table).toBe('field_synonyms')
    expect(h.state.last._calls.update).toEqual({ use_count: 2 })
    expect(h.state.last._calls.eq).toContainEqual(['custom_name', 'Serial No'])
    expect(h.state.last._calls.eq).toContainEqual(['table_target', 'tyre_records'])
  })

  it('insertPendingUpload / insertStockRecords / insertCleaningLog / insertUploadHistory insert into the right tables', async () => {
    await uploads.insertPendingUpload({ batch_id: 'b1' })
    expect(h.state.last._table).toBe('pending_uploads')
    expect(h.state.last._calls.insert).toEqual({ batch_id: 'b1' })

    await uploads.insertStockRecords([{ item_code: 'X' }])
    expect(h.state.last._table).toBe('stock_records')
    expect(h.state.last._calls.insert).toEqual([{ item_code: 'X' }])

    await uploads.insertCleaningLog([{ tyre_record_id: 't1' }])
    expect(h.state.last._table).toBe('cleaning_log')

    await uploads.insertUploadHistory({ file_names: ['f.xlsx'] })
    expect(h.state.last._table).toBe('upload_history')
    expect(h.state.last._calls.insert).toEqual({ file_names: ['f.xlsx'] })
  })

  it('insertTyreRecords inserts and selects the new ids', async () => {
    h.state.result = { data: [{ id: 'n1' }], error: null }
    const { data } = await uploads.insertTyreRecords([{ serial_no: 'S1' }])
    expect(h.state.last._table).toBe('tyre_records')
    expect(h.state.last._calls.insert).toEqual([{ serial_no: 'S1' }])
    expect(h.state.last._calls.select).toBe('id')
    expect(data).toEqual([{ id: 'n1' }])
  })

  it('write pass-throughs surface { error } for the page to inspect', async () => {
    h.state.result = { data: null, error: { message: 'boom', code: '42501' } }
    const { error } = await uploads.insertStockRecords([{ item_code: 'Y' }])
    expect(error).toMatchObject({ code: '42501' })
  })
})
