import { describe, it, expect, vi, beforeEach } from 'vitest'

// Chainable, thenable Supabase mock (mirrors customData.api.test.js): records
// the table, select cols/opts, eq/or/order/range/limit calls, and resolves to
// a configurable { data, error, count }.
const h = vi.hoisted(() => {
  const state = { result: { data: [], error: null, count: 0 }, last: null }
  function from(table) {
    const calls = { eq: [], or: [], order: [], range: [], limit: [] }
    const b = {
      _table: table,
      _calls: calls,
      select(cols, opts) { calls.select = { cols, opts }; return b },
      order(col, opts) { calls.order.push([col, opts]); return b },
      limit(n) { calls.limit.push(n); return b },
      range(a, z) { calls.range.push([a, z]); return b },
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

const domainEvents = await import('../lib/api/domainEvents')
const { ServiceError } = await import('../lib/api/_client')

beforeEach(() => {
  h.state.result = { data: [], error: null, count: 0 }
  h.state.last = null
})

describe('service layer - domainEvents: listDomainEvents', () => {
  it('lists from domain_events with exact count, newest id first, paged', async () => {
    h.state.result = { data: [{ id: 9, event_type: 'tyre.installed' }], error: null, count: 120 }
    const { rows, count } = await domainEvents.listDomainEvents({ limit: 25, offset: 50 })
    expect(h.state.last._table).toBe('domain_events')
    expect(h.state.last._calls.select.opts).toEqual({ count: 'exact' })
    expect(h.state.last._calls.order).toContainEqual(['id', { ascending: false }])
    expect(h.state.last._calls.range).toContainEqual([50, 74])
    expect(rows).toEqual([{ id: 9, event_type: 'tyre.installed' }])
    expect(count).toBe(120)
  })

  it('applies eventType and status eq filters', async () => {
    await domainEvents.listDomainEvents({ eventType: 'workorder.created', status: 'failed' })
    expect(h.state.last._calls.eq).toContainEqual(['event_type', 'workorder.created'])
    expect(h.state.last._calls.eq).toContainEqual(['status', 'failed'])
  })

  it('searches across event_type, entity_type and entity_id via or(ilike)', async () => {
    await domainEvents.listDomainEvents({ search: 'tyre' })
    expect(h.state.last._calls.or).toContainEqual(
      'event_type.ilike.%tyre%,entity_type.ilike.%tyre%,entity_id.ilike.%tyre%'
    )
  })

  it('sanitizes structural characters out of the search term', async () => {
    await domainEvents.listDomainEvents({ search: 'ty,re(*)' })
    expect(h.state.last._calls.or).toContainEqual(
      'event_type.ilike.%tyre%,entity_type.ilike.%tyre%,entity_id.ilike.%tyre%'
    )
  })

  it('defaults rows/count when Supabase returns null data', async () => {
    h.state.result = { data: null, error: null, count: null }
    const { rows, count } = await domainEvents.listDomainEvents()
    expect(rows).toEqual([])
    expect(count).toBe(0)
  })

  it('throws a ServiceError on a Supabase error', async () => {
    h.state.result = { data: null, error: { message: 'boom', code: '42501' }, count: null }
    await expect(domainEvents.listDomainEvents()).rejects.toBeInstanceOf(ServiceError)
    await expect(domainEvents.listDomainEvents()).rejects.toMatchObject({ code: '42501' })
  })
})

describe('service layer - domainEvents: listEventTypes', () => {
  it('dedupes and sorts event types from the recent 500 events', async () => {
    h.state.result = {
      data: [
        { event_type: 'tyre.installed' },
        { event_type: 'accident.reported' },
        { event_type: 'tyre.installed' },
        { event_type: null },
      ],
      error: null,
      count: 0,
    }
    const types = await domainEvents.listEventTypes()
    expect(h.state.last._table).toBe('domain_events')
    expect(h.state.last._calls.limit).toContainEqual(500)
    expect(types).toEqual(['accident.reported', 'tyre.installed'])
  })
})

describe('service layer - domainEvents: listEventConsumers', () => {
  it('lists from event_consumers alphabetically', async () => {
    h.state.result = { data: [{ consumer: 'consume_event_rules', enabled: true }], error: null, count: 0 }
    const rows = await domainEvents.listEventConsumers()
    expect(h.state.last._table).toBe('event_consumers')
    expect(h.state.last._calls.order).toContainEqual(['consumer', { ascending: true }])
    expect(rows).toEqual([{ consumer: 'consume_event_rules', enabled: true }])
  })
})
