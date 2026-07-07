import { describe, it, expect, vi, beforeEach } from 'vitest'

// Chainable, thenable Supabase mock (mirrors customData.api.test.js) with an
// rpc recorder for create_api_key / revoke_api_key.
const h = vi.hoisted(() => {
  const state = {
    result: { data: [], error: null, count: 0 },
    last: null,
    rpc: { data: null, error: null },
    lastRpc: null,
  }
  function rpc(name, args) { state.lastRpc = { name, args }; return Promise.resolve(state.rpc) }
  function from(table) {
    const calls = { eq: [], order: [], range: [] }
    const b = {
      _table: table,
      _calls: calls,
      select(cols, opts) { calls.select = { cols, opts }; return b },
      order(col, opts) { calls.order.push([col, opts]); return b },
      range(a, z) { calls.range.push([a, z]); return b },
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
  return { state, supabase: { from, rpc } }
})

vi.mock('../lib/supabase', () => ({ supabase: h.supabase }))

const integrations = await import('../lib/api/integrations')
const { ServiceError } = await import('../lib/api/_client')

beforeEach(() => {
  h.state.result = { data: [], error: null, count: 0 }
  h.state.last = null
  h.state.rpc = { data: null, error: null }
  h.state.lastRpc = null
})

describe('service layer - integrations: api keys', () => {
  it('lists api_keys newest first and never selects key_hash', async () => {
    h.state.result = { data: [{ id: 'k1', key_prefix: 'tp_abc1234' }], error: null, count: 0 }
    const rows = await integrations.listApiKeys()
    expect(h.state.last._table).toBe('api_keys')
    expect(h.state.last._calls.select.cols).not.toContain('key_hash')
    expect(h.state.last._calls.select.cols).toContain('key_prefix')
    expect(h.state.last._calls.order).toContainEqual(['created_at', { ascending: false }])
    expect(rows).toEqual([{ id: 'k1', key_prefix: 'tp_abc1234' }])
  })

  it('createApiKey calls the create_api_key RPC and returns the one-time key', async () => {
    h.state.rpc = { data: { id: 'k2', key: 'tp_secret', prefix: 'tp_secret'.slice(0, 10) }, error: null }
    const res = await integrations.createApiKey({ name: 'ERP sync', scopes: ['read'], expiresAt: '2027-01-01T00:00:00Z' })
    expect(h.state.lastRpc.name).toBe('create_api_key')
    expect(h.state.lastRpc.args).toEqual({
      p_name: 'ERP sync',
      p_scopes: ['read'],
      p_expires_at: '2027-01-01T00:00:00Z',
    })
    expect(res).toMatchObject({ id: 'k2', key: 'tp_secret' })
  })

  it('createApiKey defaults scopes to [read] and expiry to null', async () => {
    await integrations.createApiKey({ name: 'Reporting' })
    expect(h.state.lastRpc.args).toEqual({ p_name: 'Reporting', p_scopes: ['read'], p_expires_at: null })
  })

  it('revokeApiKey calls the revoke_api_key RPC with p_id', async () => {
    await integrations.revokeApiKey('k1')
    expect(h.state.lastRpc.name).toBe('revoke_api_key')
    expect(h.state.lastRpc.args).toEqual({ p_id: 'k1' })
  })

  it('surfaces RPC errors as ServiceError', async () => {
    h.state.rpc = { data: null, error: { message: 'not authorised', code: 'P0001' } }
    await expect(integrations.createApiKey({ name: 'x' })).rejects.toBeInstanceOf(ServiceError)
    await expect(integrations.revokeApiKey('k1')).rejects.toMatchObject({ code: 'P0001' })
  })
})

describe('service layer - integrations: webhooks', () => {
  it('lists webhook_subscriptions newest first', async () => {
    h.state.result = { data: [{ id: 'w1', name: 'ERP' }], error: null, count: 0 }
    const rows = await integrations.listWebhooks()
    expect(h.state.last._table).toBe('webhook_subscriptions')
    expect(h.state.last._calls.order).toContainEqual(['created_at', { ascending: false }])
    expect(rows).toEqual([{ id: 'w1', name: 'ERP' }])
  })

  it('creates a webhook and returns the inserted row', async () => {
    h.state.result = { data: { id: 'w2', secret: 'abc' }, error: null, count: 0 }
    const values = { name: 'ERP', url: 'https://erp.example.com/hook', event_types: ['tyre.installed'] }
    const row = await integrations.createWebhook(values)
    expect(h.state.last._table).toBe('webhook_subscriptions')
    expect(h.state.last._calls.insert).toEqual(values)
    expect(row).toEqual({ id: 'w2', secret: 'abc' })
  })

  it('updates and deletes webhooks by id', async () => {
    await integrations.updateWebhook('w1', { active: true, consecutive_failures: 0, disabled_reason: null })
    expect(h.state.last._calls.update).toEqual({ active: true, consecutive_failures: 0, disabled_reason: null })
    expect(h.state.last._calls.eq).toContainEqual(['id', 'w1'])

    await integrations.deleteWebhook('w9')
    expect(h.state.last._calls.delete).toBe(true)
    expect(h.state.last._calls.eq).toContainEqual(['id', 'w9'])
  })

  it('throws a ServiceError when the table write fails', async () => {
    h.state.result = { data: null, error: { message: 'boom', code: '42501' }, count: 0 }
    await expect(integrations.deleteWebhook('w1')).rejects.toBeInstanceOf(ServiceError)
  })
})

describe('service layer - integrations: webhook deliveries', () => {
  it('lists deliveries with exact count, newest first, paged', async () => {
    h.state.result = { data: [{ id: 3, status: 'delivered' }], error: null, count: 42 }
    const { rows, count } = await integrations.listWebhookDeliveries({ limit: 20, offset: 40 })
    expect(h.state.last._table).toBe('webhook_deliveries')
    expect(h.state.last._calls.select.opts).toEqual({ count: 'exact' })
    expect(h.state.last._calls.order).toContainEqual(['id', { ascending: false }])
    expect(h.state.last._calls.range).toContainEqual([40, 59])
    expect(rows).toEqual([{ id: 3, status: 'delivered' }])
    expect(count).toBe(42)
  })

  it('scopes deliveries to a subscription when subscriptionId is given', async () => {
    await integrations.listWebhookDeliveries({ subscriptionId: 'w1' })
    expect(h.state.last._calls.eq).toContainEqual(['subscription_id', 'w1'])
  })

  it('applies no subscription filter by default', async () => {
    await integrations.listWebhookDeliveries()
    expect(h.state.last._calls.eq).toEqual([])
  })
})
