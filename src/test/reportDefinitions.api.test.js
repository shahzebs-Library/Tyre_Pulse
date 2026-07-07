import { describe, it, expect, vi, beforeEach } from 'vitest'

// Chainable, thenable Supabase mock (mirrors businessRules.api.test.js) with
// the filter builders runReport compiles to.
const h = vi.hoisted(() => {
  const state = { result: { data: [], error: null, count: 0 }, last: null }
  function from(table) {
    const calls = {
      eq: [], neq: [], gt: [], gte: [], lt: [], lte: [], ilike: [], is: [],
      not: [], order: [], limit: [],
    }
    const b = {
      _table: table,
      _calls: calls,
      select(cols, opts) { calls.select = { cols, opts }; return b },
      insert(v) { calls.insert = v; return b },
      update(v) { calls.update = v; return b },
      delete() { calls.delete = true; return b },
      eq(c, v) { calls.eq.push([c, v]); return b },
      neq(c, v) { calls.neq.push([c, v]); return b },
      gt(c, v) { calls.gt.push([c, v]); return b },
      gte(c, v) { calls.gte.push([c, v]); return b },
      lt(c, v) { calls.lt.push([c, v]); return b },
      lte(c, v) { calls.lte.push([c, v]); return b },
      ilike(c, v) { calls.ilike.push([c, v]); return b },
      is(c, v) { calls.is.push([c, v]); return b },
      not(c, op, v) { calls.not.push([c, op, v]); return b },
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

const api = await import('../lib/api/reportDefinitions')

beforeEach(() => {
  h.state.result = { data: [], error: null, count: 0 }
  h.state.last = null
})

const definition = (over = {}) => ({
  module: 'tyres',
  columns: ['asset_no', 'brand', 'cost_per_tyre'],
  filters: [],
  sort: null,
  ...over,
})

describe('service layer - reportDefinitions.runReport', () => {
  it('queries the module table with the selected columns and cap', async () => {
    await api.runReport(definition())
    expect(h.state.last._table).toBe('tyre_records')
    expect(h.state.last._calls.select.cols).toBe('asset_no,brand,cost_per_tyre')
    expect(h.state.last._calls.limit).toEqual([1000])
  })

  it('maps every filter operator to the right builder', async () => {
    await api.runReport(definition({
      filters: [
        { field: 'site', operator: 'eq', value: 'RUH' },
        { field: 'brand', operator: 'neq', value: 'X' },
        { field: 'cost_per_tyre', operator: 'gte', value: 100 },
        { field: 'qty', operator: 'lt', value: 5 },
        { field: 'asset_no', operator: 'contains', value: 'TRK' },
        { field: 'serial_no', operator: 'is_null' },
        { field: 'issue_date', operator: 'not_null' },
      ],
    }))
    const c = h.state.last._calls
    expect(c.eq).toContainEqual(['site', 'RUH'])
    expect(c.neq).toContainEqual(['brand', 'X'])
    expect(c.gte).toContainEqual(['cost_per_tyre', 100])
    expect(c.lt).toContainEqual(['qty', 5])
    expect(c.ilike).toContainEqual(['asset_no', '%TRK%'])
    expect(c.is).toContainEqual(['serial_no', null])
    expect(c.not).toContainEqual(['issue_date', 'is', null])
  })

  it('applies sort direction', async () => {
    await api.runReport(definition({ sort: { field: 'cost_per_tyre', dir: 'desc' } }))
    expect(h.state.last._calls.order).toContainEqual(['cost_per_tyre', { ascending: false }])
  })

  it('rejects unknown modules, columns, filter fields and operators', async () => {
    await expect(api.runReport(definition({ module: 'profiles' }))).rejects.toThrow(/module/i)
    await expect(api.runReport(definition({ columns: ['password'] }))).rejects.toThrow(/column/i)
    await expect(api.runReport(definition({
      filters: [{ field: 'user_id', operator: 'eq', value: 'x' }],
    }))).rejects.toThrow(/filter field/i)
    await expect(api.runReport(definition({
      filters: [{ field: 'site', operator: 'like', value: 'x' }],
    }))).rejects.toThrow(/operator/i)
  })

  it('caps the row limit at 1000', async () => {
    await api.runReport(definition(), { limit: 999999 })
    expect(h.state.last._calls.limit).toEqual([1000])
  })
})

describe('service layer - reportDefinitions CRUD', () => {
  it('lists definitions newest-updated first', async () => {
    h.state.result = { data: [{ id: 'r1' }], error: null }
    const rows = await api.listReportDefinitions()
    expect(h.state.last._table).toBe('report_definitions')
    expect(h.state.last._calls.order).toContainEqual(['updated_at', { ascending: false }])
    expect(rows).toEqual([{ id: 'r1' }])
  })

  it('deletes by id', async () => {
    await api.deleteReportDefinition('r9')
    expect(h.state.last._calls.delete).toBe(true)
    expect(h.state.last._calls.eq).toContainEqual(['id', 'r9'])
  })
})
