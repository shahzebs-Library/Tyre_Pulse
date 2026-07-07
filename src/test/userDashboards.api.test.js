import { describe, it, expect, vi, beforeEach } from 'vitest'

const h = vi.hoisted(() => {
  const state = { result: { data: [], error: null }, last: null }
  function from(table) {
    const calls = { eq: [], order: [], limit: [] }
    const b = {
      _table: table,
      _calls: calls,
      select(cols, opts) { calls.select = { cols, opts }; return b },
      insert(v) { calls.insert = v; return b },
      update(v) { calls.update = v; return b },
      delete() { calls.delete = true; return b },
      eq(c, v) { calls.eq.push([c, v]); return b },
      order(c, opts) { calls.order.push([c, opts]); return b },
      limit(n) { calls.limit.push(n); return b },
      single() { return Promise.resolve(state.result) },
      maybeSingle() { return Promise.resolve(state.result) },
      then(onF, onR) { return Promise.resolve(state.result).then(onF, onR) },
    }
    state.last = b
    return b
  }
  return { state, supabase: { from } }
})

vi.mock('../lib/supabase', () => ({ supabase: h.supabase }))

const api = await import('../lib/api/userDashboards')

beforeEach(() => {
  h.state.result = { data: [], error: null }
  h.state.last = null
})

describe('service layer - userDashboards', () => {
  it('lists dashboards most recently updated first', async () => {
    h.state.result = { data: [{ id: 'd1', name: 'Ops' }], error: null }
    const rows = await api.listDashboards()
    expect(h.state.last._table).toBe('user_dashboards')
    expect(h.state.last._calls.order).toContainEqual(['updated_at', { ascending: false }])
    expect(rows).toEqual([{ id: 'd1', name: 'Ops' }])
  })

  it('creates a dashboard and returns the inserted row', async () => {
    h.state.result = { data: { id: 'd2' }, error: null }
    const row = await api.createDashboard({ name: 'Exec', layout: { widgets: [] } })
    expect(h.state.last._calls.insert).toMatchObject({ name: 'Exec' })
    expect(row).toEqual({ id: 'd2' })
  })

  it('updates by id', async () => {
    await api.updateDashboard('d3', { name: 'Renamed' })
    expect(h.state.last._calls.update).toMatchObject({ name: 'Renamed' })
    expect(h.state.last._calls.eq).toContainEqual(['id', 'd3'])
  })

  it('deletes by id', async () => {
    await api.deleteDashboard('d4')
    expect(h.state.last._calls.delete).toBe(true)
    expect(h.state.last._calls.eq).toContainEqual(['id', 'd4'])
  })
})
