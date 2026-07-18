import { describe, it, expect, vi, beforeEach } from 'vitest'

// Hoisted Supabase mock: a chainable, thenable query builder for from() reads
// plus an rpc() spy. select/order/limit chain and resolve to a configurable
// { data, error }. rpc records the last call and resolves to state.rpcResult.
const h = vi.hoisted(() => {
  const state = {
    result: { data: [], error: null },
    rpcResult: { data: null, error: null },
    last: null,
    rpc: null,
  }
  function from(table) {
    const b = {
      _table: table,
      select() { return b },
      order() { return b },
      limit() { return b },
      then(onF, onR) { return Promise.resolve(state.result).then(onF, onR) },
    }
    state.last = b
    return b
  }
  function rpc(name, args) {
    state.rpc = { name, args }
    return Promise.resolve(state.rpcResult)
  }
  return { state, supabase: { from, rpc } }
})

vi.mock('./_client', async () => {
  const actual = await vi.importActual('./_client')
  return { ...actual, supabase: h.supabase }
})

// adminUpdateProfile (users.js) is the reused lock path; spy on it.
const updateSpy = vi.fn(() => Promise.resolve({ success: true }))
vi.mock('./users', () => ({ adminUpdateProfile: (...a) => updateSpy(...a) }))

const svc = await import('./consoleSessions')

beforeEach(() => {
  h.state.result = { data: [], error: null }
  h.state.rpcResult = { data: null, error: null }
  h.state.last = null
  h.state.rpc = null
  updateSpy.mockClear()
})

describe('service layer - consoleSessions', () => {
  it('listConsoleSessions []-degrades on error', async () => {
    h.state.result = { data: null, error: { message: 'relation "console_sessions" does not exist', code: '42P01' } }
    expect(await svc.listConsoleSessions()).toEqual([])
    expect(h.state.last._table).toBe('console_sessions')
  })

  it('listConsoleSessions returns rows on success', async () => {
    h.state.result = { data: [{ id: 's1', action: 'lock' }], error: null }
    expect(await svc.listConsoleSessions()).toEqual([{ id: 's1', action: 'lock' }])
  })

  it('listUserDevices []-degrades on error', async () => {
    h.state.result = { data: null, error: { message: 'permission denied', code: '42501' } }
    expect(await svc.listUserDevices()).toEqual([])
    expect(h.state.last._table).toBe('profiles')
  })

  it('listUserDevices derives has_device from push_token', async () => {
    h.state.result = {
      data: [
        { id: 'u1', full_name: 'A', push_token: 'ExpoTok', login_count: 3 },
        { id: 'u2', full_name: 'B', push_token: null },
      ],
      error: null,
    }
    const rows = await svc.listUserDevices()
    expect(rows[0].has_device).toBe(true)
    expect(rows[1].has_device).toBe(false)
    // Raw token is never surfaced.
    expect(rows[0]).not.toHaveProperty('push_token')
  })

  it('clearPushToken maps the rpc param', async () => {
    await svc.clearPushToken('user-9')
    expect(h.state.rpc.name).toBe('admin_clear_push_token')
    expect(h.state.rpc.args).toEqual({ p_user_id: 'user-9' })
  })

  it('lockUser calls adminUpdateProfile with p_user_id + p_locked', async () => {
    await svc.lockUser('user-7', true)
    expect(updateSpy).toHaveBeenCalledWith({ p_user_id: 'user-7', p_locked: true })
  })
})
