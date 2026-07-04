import { describe, it, expect, vi, beforeEach } from 'vitest'

// Hoisted Supabase mock: a chainable, thenable query builder that records the
// table, select columns/options, eq/or/gte/lte/limit filters, and resolves to a
// configurable { data, error, count }. rpc() records name + args. Mirrors the
// pass-through style the Dashboard consumes (reads `.data` / `.error`).
const h = vi.hoisted(() => {
  const state = { result: { data: [], error: null }, last: null, rpc: { data: null, error: null }, lastRpc: null }
  function rpc(name, args) { state.lastRpc = { name, args }; return Promise.resolve(state.rpc) }
  function from(table) {
    const calls = { eq: [], or: [], gte: [], lte: [], limit: null, order: [] }
    const b = {
      _table: table,
      _calls: calls,
      select(cols, opts) { calls.select = cols; calls.selectOpts = opts; return b },
      order(c, o) { calls.order.push([c, o]); return b },
      limit(n) { calls.limit = n; return b },
      eq(c, v) { calls.eq.push([c, v]); return b },
      or(e) { calls.or.push(e); return b },
      gte(c, v) { calls.gte.push([c, v]); return b },
      lte(c, v) { calls.lte.push([c, v]); return b },
      then(onF, onR) { return Promise.resolve(state.result).then(onF, onR) },
    }
    state.last = b
    return b
  }
  return { state, supabase: { from, rpc } }
})

vi.mock('../lib/supabase', () => ({ supabase: h.supabase }))

const dashboard = await import('../lib/api/dashboard')

beforeEach(() => {
  h.state.result = { data: [], error: null }
  h.state.last = null
  h.state.rpc = { data: null, error: null }
  h.state.lastRpc = null
})

describe('service layer - dashboard', () => {
  it('listDashboardTyres selects analytics columns, null-safe country scope, date window', async () => {
    await dashboard.listDashboardTyres({ country: 'KSA', from: '2026-01-01', to: '2026-06-30' })
    expect(h.state.last._table).toBe('tyre_records')
    expect(h.state.last._calls.select).toContain('cost_per_tyre')
    expect(h.state.last._calls.select).toContain('asset_no')
    // Null-safe country scope (OR filter), NOT strict eq.
    expect(h.state.last._calls.or).toContainEqual('country.eq.KSA,country.is.null')
    expect(h.state.last._calls.eq).toHaveLength(0)
    expect(h.state.last._calls.gte).toContainEqual(['issue_date', '2026-01-01'])
    expect(h.state.last._calls.lte).toContainEqual(['issue_date', '2026-06-30'])
  })

  it('listDashboardTyres omits country OR for "All" and omits date bounds when blank', async () => {
    await dashboard.listDashboardTyres({ country: 'All', from: '', to: '' })
    expect(h.state.last._calls.or).toHaveLength(0)
    expect(h.state.last._calls.gte).toHaveLength(0)
    expect(h.state.last._calls.lte).toHaveLength(0)
  })

  it('listDashboardStock / listDashboardActions request exact counts, country-scoped', async () => {
    await dashboard.listDashboardStock({ country: 'UAE' })
    expect(h.state.last._table).toBe('stock_records')
    expect(h.state.last._calls.selectOpts).toEqual({ count: 'exact' })
    expect(h.state.last._calls.or).toContainEqual('country.eq.UAE,country.is.null')

    await dashboard.listDashboardActions({ country: 'UAE' })
    expect(h.state.last._table).toBe('corrective_actions')
    expect(h.state.last._calls.selectOpts).toEqual({ count: 'exact' })
  })

  it('listDashboardRecentTyres orders newest-first and limits to 8', async () => {
    await dashboard.listDashboardRecentTyres({ country: 'All' })
    expect(h.state.last._table).toBe('tyre_records')
    expect(h.state.last._calls.order).toContainEqual(['created_at', { ascending: false }])
    expect(h.state.last._calls.limit).toBe(8)
  })

  it('listDashboardOpenActions filters Open, newest-first, limit 8', async () => {
    await dashboard.listDashboardOpenActions({ country: 'All' })
    expect(h.state.last._calls.eq).toContainEqual(['status', 'Open'])
    expect(h.state.last._calls.limit).toBe(8)
  })

  it('reportTyreSummary calls the RPC with country + coerced date bounds', async () => {
    await dashboard.reportTyreSummary({ country: 'KSA', from: '2026-03-01', to: '' })
    expect(h.state.lastRpc.name).toBe('report_tyre_summary')
    expect(h.state.lastRpc.args).toEqual({ p_country: 'KSA', p_from: '2026-03-01', p_to: null })
  })

  it('listOpenActionsForPptx uses brief columns (no id), limit 20', async () => {
    await dashboard.listOpenActionsForPptx()
    expect(h.state.last._table).toBe('corrective_actions')
    expect(h.state.last._calls.select).toBe('title,priority,site,status')
    expect(h.state.last._calls.eq).toContainEqual(['status', 'Open'])
    expect(h.state.last._calls.limit).toBe(20)
  })

  it('listOpenActionsForDaily includes id + assigned_to, limit 20', async () => {
    await dashboard.listOpenActionsForDaily()
    expect(h.state.last._calls.select).toContain('assigned_to')
    expect(h.state.last._calls.select).toContain('id')
    expect(h.state.last._calls.limit).toBe(20)
  })

  it('listRecentInspectionsForDaily reads inspections ordered by scheduled_date, limit 50', async () => {
    await dashboard.listRecentInspectionsForDaily()
    expect(h.state.last._table).toBe('inspections')
    expect(h.state.last._calls.order).toContainEqual(['scheduled_date', { ascending: false }])
    expect(h.state.last._calls.limit).toBe(50)
  })

  it('listCriticalTyresForDaily filters Critical risk, country-scoped, limit 10', async () => {
    await dashboard.listCriticalTyresForDaily({ country: 'Oman' })
    expect(h.state.last._table).toBe('tyre_records')
    expect(h.state.last._calls.select).toBe('asset_no,site')
    expect(h.state.last._calls.or).toContainEqual('country.eq.Oman,country.is.null')
    expect(h.state.last._calls.eq).toContainEqual(['risk_level', 'Critical'])
    expect(h.state.last._calls.limit).toBe(10)
  })

  it('pass-through surfaces the raw { data, error } the page reads', async () => {
    h.state.result = { data: [{ id: 't1' }], error: null, count: 5 }
    const res = await dashboard.listDashboardStock({ country: 'All' })
    expect(res.data).toEqual([{ id: 't1' }])
    expect(res.count).toBe(5)
    expect(res.error).toBeNull()
  })
})
