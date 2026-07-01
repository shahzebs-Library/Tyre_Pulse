import { describe, it, expect, vi, beforeEach } from 'vitest'

// Shared, hoisted Supabase mock (copied from api.test.js): a chainable, thenable
// query builder that records the table queried and the eq/or/update/delete calls
// applied, plus the last rpc(name, args), and resolves to a configurable result.
const h = vi.hoisted(() => {
  const state = { result: { data: [], error: null }, last: null, rpc: { data: null, error: null }, lastRpc: null }
  function rpc(name, args) { state.lastRpc = { name, args }; return Promise.resolve(state.rpc) }
  function from(table) {
    const calls = { eq: [], or: [] }
    const b = {
      _table: table,
      _calls: calls,
      select() { return b },
      order() { return b },
      limit() { return b },
      insert(v) { calls.insert = v; return b },
      update(v) { calls.update = v; return b },
      delete() { calls.delete = true; return b },
      eq(c, v) { calls.eq.push([c, v]); return b },
      or(e) { calls.or.push(e); return b },
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

const users = await import('../lib/api/users')
const { ServiceError } = await import('../lib/api/_client')

beforeEach(() => {
  h.state.result = { data: [], error: null }
  h.state.last = null
  h.state.rpc = { data: null, error: null }
  h.state.lastRpc = null
})

describe('service layer — users', () => {
  it('listProfiles reads from profiles newest-first and returns data', async () => {
    h.state.result = { data: [{ id: 'u1', full_name: 'Ada' }], error: null }
    const rows = await users.listProfiles()
    expect(h.state.last._table).toBe('profiles')
    expect(rows).toEqual([{ id: 'u1', full_name: 'Ada' }])
  })

  it('listAuditLog reads from audit_log', async () => {
    h.state.result = { data: [{ id: 'a1' }], error: null }
    const rows = await users.listAuditLog()
    expect(h.state.last._table).toBe('audit_log')
    expect(rows).toEqual([{ id: 'a1' }])
  })

  it('adminUpdateProfile calls the RPC with the SAME args passed in and returns data', async () => {
    h.state.rpc = { data: { success: true }, error: null }
    const args = { p_user_id: 'u1', p_role: 'Manager', p_approved: true, p_country: ['KSA'] }
    const data = await users.adminUpdateProfile(args)
    expect(h.state.lastRpc.name).toBe('admin_update_profile')
    expect(h.state.lastRpc.args).toBe(args) // exact object, unchanged
    expect(data).toEqual({ success: true })
  })

  it('adminUpdateProfile throws a ServiceError carrying the code on transport error', async () => {
    h.state.rpc = { data: null, error: { message: 'not found', code: 'PGRST202' } }
    await expect(users.adminUpdateProfile({ p_user_id: 'u1' })).rejects.toBeInstanceOf(ServiceError)
    await expect(users.adminUpdateProfile({ p_user_id: 'u1' })).rejects.toMatchObject({ code: 'PGRST202' })
  })

  it('updateProfileById patches profiles by id', async () => {
    await users.updateProfileById('u1', { role: 'Admin', approved: true })
    expect(h.state.last._table).toBe('profiles')
    expect(h.state.last._calls.update).toEqual({ role: 'Admin', approved: true })
    expect(h.state.last._calls.eq).toContainEqual(['id', 'u1'])
  })

  it('deleteProfileById deletes profiles by id', async () => {
    await users.deleteProfileById('u1')
    expect(h.state.last._table).toBe('profiles')
    expect(h.state.last._calls.delete).toBe(true)
    expect(h.state.last._calls.eq).toContainEqual(['id', 'u1'])
  })

  it('throws a ServiceError on a Supabase error (listProfiles)', async () => {
    h.state.result = { data: null, error: { message: 'permission denied', code: '42501' } }
    await expect(users.listProfiles()).rejects.toBeInstanceOf(ServiceError)
    await expect(users.listProfiles()).rejects.toMatchObject({ code: '42501' })
  })
})
