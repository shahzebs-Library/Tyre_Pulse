import { describe, it, expect, vi, beforeEach } from 'vitest'

// Chainable, thenable Supabase mock (mirrors src/test/dashboard.api.test.js).
// Records select/eq/gte/lte/range so we can assert the STRICT (eq) country scope
// this page uses - deliberately NOT the null-safe OR filter.
const h = vi.hoisted(() => {
  const state = { result: { data: [], error: null }, last: null }
  function from(table) {
    const calls = { eq: [], or: [], gte: [], lte: [], range: null }
    const b = {
      _table: table,
      _calls: calls,
      select(cols) { calls.select = cols; return b },
      eq(c, v) { calls.eq.push([c, v]); return b },
      or(e) { calls.or.push(e); return b },
      gte(c, v) { calls.gte.push([c, v]); return b },
      lte(c, v) { calls.lte.push([c, v]); return b },
      range(f, t) { calls.range = [f, t]; return b },
      then(onF, onR) { return Promise.resolve(state.result).then(onF, onR) },
    }
    state.last = b
    return b
  }
  return { state, supabase: { from } }
})

vi.mock('../lib/supabase', () => ({ supabase: h.supabase }))

const engKpiApi = await import('../lib/api/engineeringKpi')

beforeEach(() => {
  h.state.result = { data: [], error: null }
  h.state.last = null
})

describe('service layer - engineeringKpi', () => {
  it('listKpiTyreRecords applies STRICT eq country, date window, and paged range', async () => {
    await engKpiApi.listKpiTyreRecords({ country: 'KSA', dateFrom: '2026-01-01', dateTo: '2026-06-30', from: 0, to: 999 })
    expect(h.state.last._table).toBe('tyre_records')
    expect(h.state.last._calls.select).toContain('remarks')
    // Strict eq - never the null-safe OR filter.
    expect(h.state.last._calls.eq).toContainEqual(['country', 'KSA'])
    expect(h.state.last._calls.or).toHaveLength(0)
    expect(h.state.last._calls.gte).toContainEqual(['issue_date', '2026-01-01'])
    expect(h.state.last._calls.lte).toContainEqual(['issue_date', '2026-06-30'])
    expect(h.state.last._calls.range).toEqual([0, 999])
  })

  it('listKpiTyreRecords omits country eq + date bounds when null/blank', async () => {
    await engKpiApi.listKpiTyreRecords({ country: null, dateFrom: '', dateTo: '', from: 0, to: 999 })
    expect(h.state.last._calls.eq).toHaveLength(0)
    expect(h.state.last._calls.gte).toHaveLength(0)
    expect(h.state.last._calls.lte).toHaveLength(0)
    expect(h.state.last._calls.range).toEqual([0, 999])
  })

  it('listKpiInspections strict-scopes and paginates, no date filter', async () => {
    await engKpiApi.listKpiInspections({ country: 'UAE', from: 0, to: 999 })
    expect(h.state.last._table).toBe('inspections')
    expect(h.state.last._calls.eq).toContainEqual(['country', 'UAE'])
    expect(h.state.last._calls.gte).toHaveLength(0)
    expect(h.state.last._calls.range).toEqual([0, 999])
  })

  it('listKpiCorrectiveActions strict-scopes corrective_actions (no range)', async () => {
    await engKpiApi.listKpiCorrectiveActions({ country: 'Oman' })
    expect(h.state.last._table).toBe('corrective_actions')
    expect(h.state.last._calls.eq).toContainEqual(['country', 'Oman'])
    expect(h.state.last._calls.range).toBeNull()
  })

  it('listKpiFleet reads id/asset_no from vehicle_fleet', async () => {
    await engKpiApi.listKpiFleet()
    expect(h.state.last._table).toBe('vehicle_fleet')
    expect(h.state.last._calls.select).toBe('id,asset_no')
  })

  it('pass-through surfaces the raw { data, error } the page reads', async () => {
    h.state.result = { data: null, error: { message: 'boom' } }
    const res = await engKpiApi.listKpiFleet()
    expect(res).toEqual({ data: null, error: { message: 'boom' } })
  })
})
