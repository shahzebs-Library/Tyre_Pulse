import { describe, it, expect, vi, beforeEach } from 'vitest'

// Hoisted Supabase mock (mirrors dataReconciliation.test.js): records the last
// rpc(name, args) and resolves to a configurable { data, error }.
const h = vi.hoisted(() => {
  const state = { rpc: { data: null, error: null }, lastRpc: null }
  function rpc(name, args) {
    state.lastRpc = { name, args }
    return Promise.resolve(state.rpc)
  }
  return { state, supabase: { rpc } }
})

vi.mock('../supabase', () => ({ supabase: h.supabase }))

const db = await import('./dataBrowser')

beforeEach(() => {
  h.state.rpc = { data: null, error: null }
  h.state.lastRpc = null
})

describe('service layer - data browser', () => {
  it('listTables returns [] on error and the array on success', async () => {
    h.state.rpc = { data: null, error: { message: 'boom', code: '42501' } }
    expect(await db.listTables()).toEqual([])
    expect(h.state.lastRpc.name).toBe('admin_db_tables')

    const rows = [{ table_name: 'tyre_records', row_count: 1419 }]
    h.state.rpc = { data: rows, error: null }
    expect(await db.listTables()).toEqual(rows)
  })

  it('listTables degrades to [] when the RPC returns a non-array', async () => {
    h.state.rpc = { data: { not: 'an array' }, error: null }
    expect(await db.listTables()).toEqual([])
  })

  it('listColumns passes p_table and returns [] on error, the array on success', async () => {
    h.state.rpc = { data: null, error: { message: 'boom' } }
    expect(await db.listColumns('accidents')).toEqual([])
    expect(h.state.lastRpc.name).toBe('admin_db_columns')
    expect(h.state.lastRpc.args).toEqual({ p_table: 'accidents' })

    const cols = [{ column_name: 'site', data_type: 'text' }]
    h.state.rpc = { data: cols, error: null }
    expect(await db.listColumns('accidents')).toEqual(cols)
  })

  it('queryTable maps to admin_db_query with the right params', async () => {
    const rows = [{ id: 1, site: 'NHC' }]
    h.state.rpc = { data: rows, error: null }
    const out = await db.queryTable({ table: 'tyre_records', column: 'site', op: 'ilike', value: 'NHC', limit: 50 })
    expect(h.state.lastRpc.name).toBe('admin_db_query')
    expect(h.state.lastRpc.args).toEqual({
      p_table: 'tyre_records',
      p_column: 'site',
      p_op: 'ilike',
      p_value: 'NHC',
      p_limit: 50,
    })
    expect(out).toEqual(rows)
  })

  it('queryTable nulls an absent column/op/value and defaults limit to 100', async () => {
    h.state.rpc = { data: [], error: null }
    await db.queryTable({ table: 'work_orders' })
    expect(h.state.lastRpc.args).toEqual({
      p_table: 'work_orders',
      p_column: null,
      p_op: null,
      p_value: null,
      p_limit: 100,
    })
  })

  it('queryTable returns [] on error', async () => {
    h.state.rpc = { data: null, error: { message: 'denied', code: '42501' } }
    expect(await db.queryTable({ table: 'tyre_records' })).toEqual([])
  })
})
