import { describe, it, expect, vi, beforeEach } from 'vitest'

// Chainable, thenable Supabase mock (mirrors src/test/dashboard.api.test.js).
// Records select/order/eq/limit/upsert so we can assert the STRICT (eq) country
// scope this page uses - deliberately NOT the null-safe OR filter.
const h = vi.hoisted(() => {
  const state = { result: { data: [], error: null }, last: null }
  function from(table) {
    const calls = { eq: [], or: [], order: [], limit: null }
    const b = {
      _table: table,
      _calls: calls,
      select(cols) { calls.select = cols; return b },
      order(c, o) { calls.order.push([c, o]); return b },
      eq(c, v) { calls.eq.push([c, v]); return b },
      or(e) { calls.or.push(e); return b },
      limit(n) { calls.limit = n; return b },
      range(f, t) { calls.range = [f, t]; return b },
      upsert(v, o) { calls.upsert = v; calls.upsertOpts = o; return b },
      then(onF, onR) { return Promise.resolve(state.result).then(onF, onR) },
    }
    state.last = b
    return b
  }
  return { state, supabase: { from } }
})

vi.mock('../lib/supabase', () => ({ supabase: h.supabase }))

const exchangeApi = await import('../lib/api/tyreExchange')

beforeEach(() => {
  h.state.result = { data: [], error: null }
  h.state.last = null
})

describe('service layer - tyreExchange', () => {
  it('listTyreStatusMarks reads serial/mark_type from tyre_status_marks', async () => {
    await exchangeApi.listTyreStatusMarks()
    expect(h.state.last._table).toBe('tyre_status_marks')
    expect(h.state.last._calls.select).toBe('serial,mark_type')
  })

  it('listExchangeTyreRecords orders issue_date asc and STRICT-scopes country', async () => {
    await exchangeApi.listExchangeTyreRecords({ country: 'KSA' })
    expect(h.state.last._table).toBe('tyre_records')
    expect(h.state.last._calls.select).toContain('serial_no')
    expect(h.state.last._calls.order).toContainEqual(['issue_date', { ascending: true }])
    // Strict eq - never the null-safe OR filter.
    expect(h.state.last._calls.eq).toContainEqual(['country', 'KSA'])
    expect(h.state.last._calls.or).toHaveLength(0)
  })

  it('listExchangeTyreRecords omits the country filter for "All"', async () => {
    await exchangeApi.listExchangeTyreRecords({ country: 'All' })
    expect(h.state.last._calls.eq).toHaveLength(0)
  })

  it('listStockMovements reads newest-first, capped at 500', async () => {
    await exchangeApi.listStockMovements()
    expect(h.state.last._table).toBe('stock_movements')
    expect(h.state.last._calls.order).toContainEqual(['created_at', { ascending: false }])
    expect(h.state.last._calls.limit).toBe(500)
  })

  it('upsertTyreStatusMark upserts with the (serial,mark_type) conflict target', async () => {
    await exchangeApi.upsertTyreStatusMark('SER1', 'returned')
    expect(h.state.last._table).toBe('tyre_status_marks')
    expect(h.state.last._calls.upsert).toEqual({ serial: 'SER1', mark_type: 'returned' })
    expect(h.state.last._calls.upsertOpts).toEqual({ onConflict: 'serial,mark_type' })
  })

  it('pass-through surfaces the raw { data, error } the page reads', async () => {
    h.state.result = { data: null, error: { message: 'boom' } }
    const res = await exchangeApi.upsertTyreStatusMark('SER1', 'returned')
    expect(res).toEqual({ data: null, error: { message: 'boom' } })
  })
})
