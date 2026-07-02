import { describe, it, expect, vi, beforeEach } from 'vitest'

// Shared, hoisted Supabase mock: a chainable, thenable query builder that
// records the table queried and the eq filters applied, and resolves to a
// configurable { data, error }. Mirrors src/test/api.test.js, plus delete().
const h = vi.hoisted(() => {
  const state = { result: { data: [], error: null }, last: null }
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
  return { state, supabase: { from } }
})

vi.mock('../lib/supabase', () => ({ supabase: h.supabase }))

const alertThresholds = await import('../lib/api/alertThresholds')
const { ServiceError } = await import('../lib/api/_client')

beforeEach(() => {
  h.state.result = { data: [], error: null }
  h.state.last = null
})

describe('service layer - alertThresholds', () => {
  it('lists from alert_thresholds', async () => {
    h.state.result = { data: [{ id: 't1', name: 'Low tread' }], error: null }
    const rows = await alertThresholds.listAlertThresholds({ userId: 'u1' })
    expect(h.state.last._table).toBe('alert_thresholds')
    expect(rows).toEqual([{ id: 't1', name: 'Low tread' }])
  })

  it('scopes the list by user_id', async () => {
    await alertThresholds.listAlertThresholds({ userId: 'u1' })
    expect(h.state.last._calls.eq).toContainEqual(['user_id', 'u1'])
  })

  it('updates and deletes by id', async () => {
    await alertThresholds.updateAlertThreshold('t1', { active: false })
    expect(h.state.last._calls.update).toEqual({ active: false })
    expect(h.state.last._calls.eq).toContainEqual(['id', 't1'])

    await alertThresholds.deleteAlertThreshold('t2')
    expect(h.state.last._calls.delete).toBe(true)
    expect(h.state.last._calls.eq).toContainEqual(['id', 't2'])
  })

  it('throws a ServiceError on a Supabase error', async () => {
    h.state.result = { data: null, error: { message: 'boom', code: '42501' } }
    await expect(alertThresholds.listAlertThresholds({ userId: 'u1' })).rejects.toBeInstanceOf(ServiceError)
    await expect(alertThresholds.listAlertThresholds({ userId: 'u1' })).rejects.toMatchObject({ code: '42501' })
  })
})
