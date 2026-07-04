import { describe, it, expect, vi, beforeEach } from 'vitest'

// Hoisted Supabase mock: chainable, thenable query builder recording table,
// select cols, order/eq/limit filters, insert/update payloads and range (for
// the paged reads via the real fetchAllPages).
const h = vi.hoisted(() => {
  const state = { result: { data: [], error: null }, last: null }
  function from(table) {
    const calls = { eq: [], order: [], range: [] }
    const b = {
      _table: table, _calls: calls,
      select(cols, opts) { calls.select = cols; calls.selectOpts = opts; return b },
      order(c, o) { calls.order.push([c, o]); return b },
      limit(n) { calls.limit = n; return b },
      eq(c, v) { calls.eq.push([c, v]); return b },
      insert(v) { calls.insert = v; return b },
      update(v) { calls.update = v; return b },
      range(f, t) { calls.range.push([f, t]); return b },
      then(onF, onR) { return Promise.resolve(state.result).then(onF, onR) },
    }
    state.last = b
    return b
  }
  return { state, supabase: { from } }
})

vi.mock('../lib/supabase', () => ({ supabase: h.supabase }))

const ci = await import('../lib/api/continuousImprovement')

beforeEach(() => {
  h.state.result = { data: [], error: null }
  h.state.last = null
})

describe('service layer - continuousImprovement', () => {
  it('listImprovementTyreRecords pages with STRICT eq country scope, newest first', async () => {
    await ci.listImprovementTyreRecords({ country: 'KSA' })
    expect(h.state.last._table).toBe('tyre_records')
    expect(h.state.last._calls.select).toContain('km_at_fitment')
    expect(h.state.last._calls.eq).toContainEqual(['country', 'KSA'])
    expect(h.state.last._calls.order).toContainEqual(['issue_date', { ascending: false }])
    expect(h.state.last._calls.range.length).toBeGreaterThan(0)
  })

  it('listImprovementTyreRecords applies no country eq for "All"', async () => {
    await ci.listImprovementTyreRecords({ country: 'All' })
    expect(h.state.last._calls.eq).toHaveLength(0)
  })

  it('listImprovementActions selects up to 2000, newest first, country-scoped', async () => {
    await ci.listImprovementActions({ country: 'UAE' })
    expect(h.state.last._table).toBe('corrective_actions')
    expect(h.state.last._calls.limit).toBe(2000)
    expect(h.state.last._calls.order).toContainEqual(['created_at', { ascending: false }])
    expect(h.state.last._calls.eq).toContainEqual(['country', 'UAE'])
  })

  it('listImprovementInspections pages inspections, country-scoped', async () => {
    await ci.listImprovementInspections({ country: 'Oman' })
    expect(h.state.last._table).toBe('inspections')
    expect(h.state.last._calls.order).toContainEqual(['scheduled_date', { ascending: false }])
    expect(h.state.last._calls.eq).toContainEqual(['country', 'Oman'])
    expect(h.state.last._calls.range.length).toBeGreaterThan(0)
  })

  it('listImprovementKpiTargets reads kpi_targets, limit 500', async () => {
    await ci.listImprovementKpiTargets()
    expect(h.state.last._table).toBe('kpi_targets')
    expect(h.state.last._calls.select).toBe('metric,target_value,year,month,site')
    expect(h.state.last._calls.limit).toBe(500)
  })

  it('insertCorrectiveAction inserts into corrective_actions', async () => {
    await ci.insertCorrectiveAction({ title: 'Fix' })
    expect(h.state.last._table).toBe('corrective_actions')
    expect(h.state.last._calls.insert).toEqual({ title: 'Fix' })
  })

  it('listCorrectiveActionsRefresh reads without a country column/filter', async () => {
    await ci.listCorrectiveActionsRefresh()
    expect(h.state.last._table).toBe('corrective_actions')
    expect(h.state.last._calls.select).toBe('id,title,site,status,priority,created_at,resolved_at,description')
    expect(h.state.last._calls.limit).toBe(2000)
    expect(h.state.last._calls.eq).toHaveLength(0)
  })

  it('closeCorrectiveAction updates by id', async () => {
    await ci.closeCorrectiveAction('a1', { status: 'Closed', resolved_at: 'now' })
    expect(h.state.last._calls.update).toEqual({ status: 'Closed', resolved_at: 'now' })
    expect(h.state.last._calls.eq).toContainEqual(['id', 'a1'])
  })
})
