import { describe, it, expect, vi, beforeEach } from 'vitest'

// Hoisted Supabase mock: a chainable, thenable query builder that records the
// table, insert/update payloads and eq filters, and resolves to a configurable
// { data, error }. Plus a stub auth.getUser() so createAlertRule can stamp
// user_id. Mirrors src/test/alertThresholds.api.test.js.
const h = vi.hoisted(() => {
  const state = {
    result: { data: [], error: null },
    last: null,
    user: { id: 'user-1' },
  }
  function from(table) {
    const calls = { eq: [] }
    const b = {
      _table: table,
      _calls: calls,
      select() { return b },
      order() { return b },
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
  const auth = {
    getUser: () => Promise.resolve({ data: { user: state.user }, error: null }),
  }
  return { state, supabase: { from, auth } }
})

vi.mock('./_client', async () => {
  const actual = await vi.importActual('./_client')
  return { ...actual, supabase: h.supabase }
})

const alertRules = await import('./alertRules')

beforeEach(() => {
  h.state.result = { data: [], error: null }
  h.state.last = null
  h.state.user = { id: 'user-1' }
})

describe('service layer - alertRules', () => {
  it('exposes an honest, small metric and operator vocabulary', () => {
    expect(alertRules.ALERT_METRICS.length).toBeGreaterThan(0)
    expect(alertRules.ALERT_METRICS.length).toBeLessThanOrEqual(8)
    expect(alertRules.ALERT_METRICS.map((m) => m.key)).toContain('high_risk_tyres')
    expect(alertRules.ALERT_OPERATORS.map((o) => o.key)).toEqual([
      'gt', 'gte', 'lt', 'lte', 'eq',
    ])
  })

  it('createAlertRule inserts the mapped row into alert_thresholds', async () => {
    h.state.result = { data: { id: 'r1' }, error: null }
    const row = await alertRules.createAlertRule({
      name: 'Too many high-risk tyres',
      metric: 'high_risk_tyres',
      operator: 'gt',
      threshold: '5',
      siteFilter: 'NHC',
      brandFilter: '',
      notifyEmail: true,
      notifyInApp: true,
      active: true,
    })
    expect(h.state.last._table).toBe('alert_thresholds')
    expect(h.state.last._calls.insert).toMatchObject({
      name: 'Too many high-risk tyres',
      metric: 'high_risk_tyres',
      operator: 'gt',
      threshold: 5,
      site_filter: 'NHC',
      brand_filter: null,
      notify_email: true,
      notify_in_app: true,
      active: true,
      user_id: 'user-1',
    })
    expect(row).toEqual({ id: 'r1' })
  })

  it('listAlertRules returns [] when the relation is missing', async () => {
    h.state.result = { data: null, error: { message: 'relation "alert_thresholds" does not exist', code: '42P01' } }
    expect(await alertRules.listAlertRules()).toEqual([])
    expect(h.state.last._table).toBe('alert_thresholds')
  })

  it('listAlertRules returns the rows on success', async () => {
    h.state.result = { data: [{ id: 'r1', name: 'Low pressure' }], error: null }
    expect(await alertRules.listAlertRules()).toEqual([{ id: 'r1', name: 'Low pressure' }])
  })

  it('toggleAlertRule updates { active } by id', async () => {
    h.state.result = { data: { id: 'r1', active: false }, error: null }
    await alertRules.toggleAlertRule('r1', false)
    expect(h.state.last._calls.update).toEqual({ active: false })
    expect(h.state.last._calls.eq).toContainEqual(['id', 'r1'])
  })

  it('deleteAlertRule deletes by id', async () => {
    await alertRules.deleteAlertRule('r2')
    expect(h.state.last._calls.delete).toBe(true)
    expect(h.state.last._calls.eq).toContainEqual(['id', 'r2'])
  })
})
