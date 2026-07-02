import { describe, it, expect, vi, beforeEach } from 'vitest'

// Shared, hoisted Supabase mock: a chainable, thenable query builder that
// records the table queried and the eq/or filters + upsert/update calls
// applied, and resolves to a configurable { data, error }. fetchAllPages calls
// through the real module (which imports this same mocked supabase) via range().
const h = vi.hoisted(() => {
  const state = { result: { data: [], error: null }, last: null }
  function from(table) {
    const calls = { eq: [], or: [] }
    const b = {
      _table: table,
      _calls: calls,
      select() { return b },
      order() { return b },
      limit() { return b },
      gte(c, v) { calls.gte = [c, v]; return b },
      lt(c, v) { calls.lt = [c, v]; return b },
      range() { return b },
      insert(v) { calls.insert = v; return b },
      update(v) { calls.update = v; return b },
      upsert(v, opts) { calls.upsert = v; calls.upsertOpts = opts; return b },
      eq(c, v) { calls.eq.push([c, v]); return b },
      or(e) { calls.or.push(e); return b },
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

const budgets = await import('../lib/api/budgets')
const { ServiceError } = await import('../lib/api/_client')

beforeEach(() => {
  h.state.result = { data: [], error: null }
  h.state.last = null
})

describe('service layer - budgets', () => {
  it('listBudgets applies year + strict country eq + site order (month optional)', async () => {
    await budgets.listBudgets({ country: 'KSA', year: 2026, month: 3 })
    expect(h.state.last._table).toBe('budgets')
    expect(h.state.last._calls.eq).toContainEqual(['year', 2026])
    expect(h.state.last._calls.eq).toContainEqual(['month', 3])
    expect(h.state.last._calls.eq).toContainEqual(['country', 'KSA'])
    expect(h.state.last._calls.or).toHaveLength(0)
  })

  it('listBudgets omits month + country filter for "All" / no month', async () => {
    await budgets.listBudgets({ country: 'All', year: 2026 })
    expect(h.state.last._calls.eq).toContainEqual(['year', 2026])
    expect(h.state.last._calls.eq.find(([c]) => c === 'month')).toBeUndefined()
    expect(h.state.last._calls.eq.find(([c]) => c === 'country')).toBeUndefined()
  })

  it('upsertBudget / upsertBudgets pass the exact onConflict target', async () => {
    await budgets.upsertBudget({ site: 'S1' })
    expect(h.state.last._calls.upsert).toEqual({ site: 'S1' })
    expect(h.state.last._calls.upsertOpts).toEqual({ onConflict: 'site,region,year,month' })

    await budgets.upsertBudgets([{ site: 'S1' }, { site: 'S2' }])
    expect(h.state.last._calls.upsert).toEqual([{ site: 'S1' }, { site: 'S2' }])
    expect(h.state.last._calls.upsertOpts).toEqual({ onConflict: 'site,region,year,month' })
  })

  it('updateBudgetStatus patches status by id', async () => {
    await budgets.updateBudgetStatus('b1', 'Approved')
    expect(h.state.last._calls.update).toEqual({ status: 'Approved' })
    expect(h.state.last._calls.eq).toContainEqual(['id', 'b1'])
  })

  it('listBudgetTyreRecords filters tyre_records by date window + strict country', async () => {
    h.state.result = { data: [{ site: 'S1', cost_per_tyre: 100, qty: 4 }], error: null }
    const res = await budgets.listBudgetTyreRecords({ country: 'KSA', start: '2026-03-01', end: '2026-04-01' })
    expect(h.state.last._table).toBe('tyre_records')
    expect(h.state.last._calls.gte).toEqual(['issue_date', '2026-03-01'])
    expect(h.state.last._calls.lt).toEqual(['issue_date', '2026-04-01'])
    expect(h.state.last._calls.eq).toContainEqual(['country', 'KSA'])
    expect(res.data).toEqual([{ site: 'S1', cost_per_tyre: 100, qty: 4 }])
  })

  it('updateBudgetStatus throws a ServiceError on a Supabase error', async () => {
    h.state.result = { data: null, error: { message: 'boom', code: '42501' } }
    await expect(budgets.updateBudgetStatus('b1', 'Approved')).rejects.toBeInstanceOf(ServiceError)
    await expect(budgets.updateBudgetStatus('b1', 'Approved')).rejects.toMatchObject({ code: '42501' })
  })
})
