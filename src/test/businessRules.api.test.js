import { describe, it, expect, vi, beforeEach } from 'vitest'

// Chainable, thenable Supabase mock (mirrors customData.api.test.js) covering
// the builders the Business Rules service needs.
const h = vi.hoisted(() => {
  const state = { result: { data: [], error: null, count: 0 }, last: null }
  function from(table) {
    const calls = { eq: [], order: [], limit: [] }
    const b = {
      _table: table,
      _calls: calls,
      select(cols, opts) { calls.select = { cols, opts }; return b },
      order(col, opts) { calls.order.push([col, opts]); return b },
      limit(n) { calls.limit.push(n); return b },
      insert(v) { calls.insert = v; return b },
      update(v) { calls.update = v; return b },
      delete() { calls.delete = true; return b },
      eq(c, v) { calls.eq.push([c, v]); return b },
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

const businessRules = await import('../lib/api/businessRules')
const { ServiceError } = await import('../lib/api/_client')

beforeEach(() => {
  h.state.result = { data: [], error: null, count: 0 }
  h.state.last = null
})

describe('service layer - businessRules: rules CRUD', () => {
  it('lists business_rules newest first', async () => {
    h.state.result = { data: [{ id: 'r1', name: 'Low tread alert' }], error: null, count: 0 }
    const rows = await businessRules.listBusinessRules()
    expect(h.state.last._table).toBe('business_rules')
    expect(h.state.last._calls.order).toContainEqual(['created_at', { ascending: false }])
    expect(rows).toEqual([{ id: 'r1', name: 'Low tread alert' }])
  })

  it('creates a rule and returns the inserted row', async () => {
    h.state.result = { data: { id: 'r2', name: 'Severe accident' }, error: null, count: 0 }
    const values = {
      name: 'Severe accident',
      event_types: ['accident.reported'],
      conditions: [{ field: 'severity', operator: 'eq', value: 'high' }],
      actions: [{ type: 'notify_role', role: 'manager', title: 'Severe accident reported' }],
      cooldown_minutes: 60,
    }
    const row = await businessRules.createBusinessRule(values)
    expect(h.state.last._table).toBe('business_rules')
    expect(h.state.last._calls.insert).toEqual(values)
    expect(row).toEqual({ id: 'r2', name: 'Severe accident' })
  })

  it('updates and deletes rules by id', async () => {
    await businessRules.updateBusinessRule('r1', { active: false })
    expect(h.state.last._calls.update).toEqual({ active: false })
    expect(h.state.last._calls.eq).toContainEqual(['id', 'r1'])

    await businessRules.deleteBusinessRule('r9')
    expect(h.state.last._calls.delete).toBe(true)
    expect(h.state.last._calls.eq).toContainEqual(['id', 'r9'])
  })

  it('throws a ServiceError on a Supabase error', async () => {
    h.state.result = { data: null, error: { message: 'boom', code: '42501' }, count: 0 }
    await expect(businessRules.listBusinessRules()).rejects.toBeInstanceOf(ServiceError)
    await expect(businessRules.listBusinessRules()).rejects.toMatchObject({ code: '42501' })
  })
})

describe('service layer - businessRules: executions', () => {
  it('lists rule_executions newest first with the default limit', async () => {
    h.state.result = { data: [{ id: 5, status: 'actioned' }], error: null, count: 0 }
    const rows = await businessRules.listRuleExecutions()
    expect(h.state.last._table).toBe('rule_executions')
    expect(h.state.last._calls.order).toContainEqual(['id', { ascending: false }])
    expect(h.state.last._calls.limit).toContainEqual(50)
    expect(h.state.last._calls.eq).toEqual([])
    expect(rows).toEqual([{ id: 5, status: 'actioned' }])
  })

  it('scopes executions to one rule and honours a custom limit', async () => {
    await businessRules.listRuleExecutions({ ruleId: 'r1', limit: 10 })
    expect(h.state.last._calls.eq).toContainEqual(['rule_id', 'r1'])
    expect(h.state.last._calls.limit).toContainEqual(10)
  })
})
