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
  it('listTables THROWS on error (never an empty list) and returns the array on success', async () => {
    h.state.rpc = { data: null, error: { message: 'permission denied for function admin_db_tables', code: '42501' } }
    await expect(db.listTables()).rejects.toBeTruthy()
    expect(h.state.lastRpc.name).toBe('admin_db_tables')

    const rows = [{ table_name: 'tyre_records', row_count: 1419 }]
    h.state.rpc = { data: rows, error: null }
    expect(await db.listTables()).toEqual(rows)
  })

  it('listTables degrades to [] when the RPC returns a non-array', async () => {
    h.state.rpc = { data: { not: 'an array' }, error: null }
    expect(await db.listTables()).toEqual([])
  })

  it('listColumns passes p_table, THROWS on error, returns the array on success', async () => {
    h.state.rpc = { data: null, error: { message: 'boom' } }
    await expect(db.listColumns('accidents')).rejects.toBeTruthy()
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

  it('queryTable THROWS on error so the page shows an error, not "no rows"', async () => {
    h.state.rpc = { data: null, error: { message: 'denied', code: '42501' } }
    const err = await db.queryTable({ table: 'tyre_records' }).catch((e) => e)
    expect(err).toBeInstanceOf(Error)
    // The sanitised message never leaks the raw database text.
    expect(String(err.message)).not.toMatch(/42501/)
  })
})
