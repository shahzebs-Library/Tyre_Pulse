import { describe, it, expect, vi, beforeEach } from 'vitest'

// Shared, hoisted Supabase mock: a chainable, thenable query builder that
// records the table queried and the filters/options applied, and resolves to a
// configurable { data, error }. Extends the base harness (src/test/api.test.js)
// with neq/gte/lte/range/upsert to cover the KPI Scorecard reads + upsert.
const h = vi.hoisted(() => {
  const state = { result: { data: [], error: null }, last: null }
  function from(table) {
    const calls = { eq: [], neq: [], gte: [], lte: [], range: [] }
    const b = {
      _table: table,
      _calls: calls,
      select() { return b },
      order() { return b },
      limit() { return b },
      range(a, z) { calls.range.push([a, z]); return b },
      insert(v) { calls.insert = v; return b },
      update(v) { calls.update = v; return b },
      upsert(v, opts) { calls.upsert = v; calls.upsertOpts = opts; return b },
      eq(c, v) { calls.eq.push([c, v]); return b },
      neq(c, v) { calls.neq.push([c, v]); return b },
      gte(c, v) { calls.gte.push([c, v]); return b },
      lte(c, v) { calls.lte.push([c, v]); return b },
      or(e) { (calls.or ||= []).push(e); return b },
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

const kpiTargets = await import('../lib/api/kpiTargets')
const { ServiceError } = await import('../lib/api/_client')

beforeEach(() => {
  h.state.result = { data: [], error: null }
  h.state.last = null
})

describe('service layer — kpiTargets', () => {
  it('lists kpi_targets by year', async () => {
    h.state.result = { data: [{ metric: 'max_monthly_cost', target_value: 150000 }], error: null }
    const res = await kpiTargets.listKpiTargets({ year: 2026 })
    expect(h.state.last._table).toBe('kpi_targets')
    expect(h.state.last._calls.eq).toContainEqual(['year', 2026])
    expect(res.data).toEqual([{ metric: 'max_monthly_cost', target_value: 150000 }])
  })

  it('upsert preserves the exact onConflict target (metric,year,month,site)', async () => {
    const rows = [{ metric: 'max_monthly_cost', target_value: 150000, year: 2026 }]
    await kpiTargets.upsertKpiTargets(rows)
    expect(h.state.last._table).toBe('kpi_targets')
    expect(h.state.last._calls.upsert).toEqual(rows)
    expect(h.state.last._calls.upsertOpts).toEqual({ onConflict: 'metric,year,month,site' })
  })

  it('listOpenCorrectiveActions applies neq(status,Closed) + strict country eq', async () => {
    await kpiTargets.listOpenCorrectiveActions({ country: 'KSA' })
    expect(h.state.last._table).toBe('corrective_actions')
    expect(h.state.last._calls.neq).toContainEqual(['status', 'Closed'])
    expect(h.state.last._calls.eq).toContainEqual(['country', 'KSA'])
  })

  it('listOpenCorrectiveActions applies NO country filter for "All"', async () => {
    await kpiTargets.listOpenCorrectiveActions({ country: 'All' })
    expect(h.state.last._calls.eq).toHaveLength(0)
    expect(h.state.last._calls.neq).toContainEqual(['status', 'Closed'])
  })

  it('listKpiTyreRecords applies strict country eq (matching flt) and pages tyre_records', async () => {
    h.state.result = { data: [{ id: 't1' }], error: null }
    const res = await kpiTargets.listKpiTyreRecords({ country: 'UAE' })
    expect(h.state.last._table).toBe('tyre_records')
    expect(h.state.last._calls.eq).toContainEqual(['country', 'UAE'])
    expect(h.state.last._calls.range.length).toBeGreaterThan(0)
    expect(res.data).toEqual([{ id: 't1' }])
  })

  it('listKpiTyreRecords applies NO country filter for "All"', async () => {
    await kpiTargets.listKpiTyreRecords({ country: 'All' })
    expect(h.state.last._calls.eq).toHaveLength(0)
  })

  it('getKpiTarget throws a ServiceError on a Supabase error', async () => {
    h.state.result = { data: null, error: { message: 'boom', code: '42501' } }
    await expect(kpiTargets.getKpiTarget('k1')).rejects.toBeInstanceOf(ServiceError)
    await expect(kpiTargets.getKpiTarget('k1')).rejects.toMatchObject({ code: '42501' })
  })
})
