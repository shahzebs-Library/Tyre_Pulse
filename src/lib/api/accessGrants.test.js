import { describe, it, expect, vi, beforeEach } from 'vitest'

// Hoisted, chainable Supabase mock (mirrors users.api.test.js): a thenable query
// builder that records the table and eq/order calls, plus the last rpc(name,args),
// resolving to a configurable { data, error } for both from() and rpc().
const h = vi.hoisted(() => {
  const state = { result: { data: [], error: null }, last: null, rpc: { data: null, error: null }, lastRpc: null }
  function rpc(name, args) { state.lastRpc = { name, args }; return Promise.resolve(state.rpc) }
  function from(table) {
    const calls = { eq: [], order: [] }
    const b = {
      _table: table,
      _calls: calls,
      select() { return b },
      order(c, o) { calls.order.push([c, o]); return b },
      eq(c, v) { calls.eq.push([c, v]); return b },
      then(onF, onR) { return Promise.resolve(state.result).then(onF, onR) },
    }
    state.last = b
    return b
  }
  return { state, supabase: { from, rpc } }
})

vi.mock('../supabase', () => ({ supabase: h.supabase }))

const grants = await import('./accessGrants')

beforeEach(() => {
  h.state.result = { data: [], error: null }
  h.state.last = null
  h.state.rpc = { data: null, error: null }
  h.state.lastRpc = null
})

describe('service layer - access grants', () => {
  it('listUserGrants reads user_access_grants scoped by user_id, newest first', async () => {
    h.state.result = { data: [{ id: 'g1', module_key: 'analytics' }], error: null }
    const rows = await grants.listUserGrants('u1')
    expect(h.state.last._table).toBe('user_access_grants')
    expect(h.state.last._calls.eq).toContainEqual(['user_id', 'u1'])
    expect(h.state.last._calls.order).toContainEqual(['created_at', { ascending: false }])
    expect(rows).toEqual([{ id: 'g1', module_key: 'analytics' }])
  })

  it('getMyAccessGrants returns {} on RPC error and the object on success', async () => {
    h.state.rpc = { data: null, error: { message: 'boom', code: '42501' } }
    expect(await grants.getMyAccessGrants()).toEqual({})
    expect(h.state.lastRpc.name).toBe('get_my_access_grants')

    h.state.rpc = { data: { analytics: 'grant', billing: 'revoke' }, error: null }
    expect(await grants.getMyAccessGrants()).toEqual({ analytics: 'grant', billing: 'revoke' })
  })

  it('setUserAccessGrant passes the exact p_* params and returns the new id', async () => {
    h.state.rpc = { data: 'new-id', error: null }
    const id = await grants.setUserAccessGrant({
      userId: 'u9', moduleKey: 'analytics', capability: 'view',
      effect: 'grant', note: 'temp access', expiresAt: '2026-12-31T00:00:00Z',
    })
    expect(h.state.lastRpc.name).toBe('set_user_access_grant')
    expect(h.state.lastRpc.args).toEqual({
      p_user_id: 'u9',
      p_module_key: 'analytics',
      p_capability: 'view',
      p_effect: 'grant',
      p_note: 'temp access',
      p_expires_at: '2026-12-31T00:00:00Z',
    })
    expect(id).toBe('new-id')
  })

  it('setUserAccessGrant applies view/grant defaults and null note/expiry', async () => {
    h.state.rpc = { data: 'id2', error: null }
    await grants.setUserAccessGrant({ userId: 'u2', moduleKey: 'reports' })
    expect(h.state.lastRpc.args).toEqual({
      p_user_id: 'u2',
      p_module_key: 'reports',
      p_capability: 'view',
      p_effect: 'grant',
      p_note: null,
      p_expires_at: null,
    })
  })

  it('revokeUserAccessGrant calls the RPC with p_id', async () => {
    h.state.rpc = { data: null, error: null }
    await grants.revokeUserAccessGrant('g7')
    expect(h.state.lastRpc.name).toBe('revoke_user_access_grant')
    expect(h.state.lastRpc.args).toEqual({ p_id: 'g7' })
  })
})
