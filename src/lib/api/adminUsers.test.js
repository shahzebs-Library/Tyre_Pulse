import { describe, it, expect, vi, beforeEach } from 'vitest'

// Hoisted Supabase mock: records the last rpc(name, args) and the last
// from(table) query chain, resolving to a configurable { data, error }.
const h = vi.hoisted(() => {
  const state = {
    rpc: { data: null, error: null },
    from: { data: null, error: null },
    lastRpc: null,
    lastFrom: null,
  }
  function rpc(name, args) {
    state.lastRpc = { name, args }
    return Promise.resolve(state.rpc)
  }
  function from(table) {
    const chain = { table, ops: {} }
    state.lastFrom = chain
    const builder = {
      select: (cols) => { chain.ops.select = cols; return builder },
      order: (col, opts) => { chain.ops.order = { col, opts }; return builder },
      limit: (n) => { chain.ops.limit = n; return builder },
      or: (expr) => { chain.ops.or = expr; return builder },
      eq: (col, val) => { chain.ops.eq = { col, val }; return builder },
      delete: () => { chain.ops.delete = true; return builder },
      then: (resolve) => resolve(state.from),
    }
    return builder
  }
  return { state, supabase: { rpc, from } }
})

vi.mock('../supabase', () => ({ supabase: h.supabase }))
vi.mock('../fetchAll', () => ({ fetchAllPages: vi.fn() }))

const svc = await import('./adminUsers')

beforeEach(() => {
  h.state.rpc = { data: null, error: null }
  h.state.from = { data: null, error: null }
  h.state.lastRpc = null
  h.state.lastFrom = null
})

describe('service layer - admin users (console admin roles)', () => {
  it('exports the three admin role values', () => {
    expect(svc.ADMIN_ROLE_VALUES).toEqual([
      'super_admin', 'regional_admin', 'viewer',
    ])
  })

  it('setAdminUser maps to rpc(admin_set_admin_user, {...}) and returns the row', async () => {
    const row = { id: 'r1', user_id: 'u1', admin_role: 'regional_admin' }
    h.state.rpc = { data: row, error: null }
    const out = await svc.setAdminUser({
      userId: 'u1',
      role: 'regional_admin',
      regions: ['KSA', 'UAE'],
      note: 'ops lead',
      active: true,
    })
    expect(h.state.lastRpc.name).toBe('admin_set_admin_user')
    expect(h.state.lastRpc.args).toEqual({
      p_user_id: 'u1',
      p_role: 'regional_admin',
      p_regions: ['KSA', 'UAE'],
      p_note: 'ops lead',
      p_active: true,
    })
    expect(out).toEqual(row)
  })

  it('setAdminUser applies defaults for regions/note/active', async () => {
    h.state.rpc = { data: {}, error: null }
    await svc.setAdminUser({ userId: 'u2', role: 'viewer' })
    expect(h.state.lastRpc.args).toEqual({
      p_user_id: 'u2',
      p_role: 'viewer',
      p_regions: [],
      p_note: null,
      p_active: true,
    })
  })

  it('getMyAdminRole returns the role string on success', async () => {
    h.state.rpc = { data: 'super_admin', error: null }
    expect(await svc.getMyAdminRole()).toBe('super_admin')
    expect(h.state.lastRpc.name).toBe('my_admin_role')
  })

  it('getMyAdminRole returns "viewer" on error', async () => {
    h.state.rpc = { data: null, error: { message: 'boom', code: '42501' } }
    expect(await svc.getMyAdminRole()).toBe('viewer')
  })

  it('getMyAdminRole returns "viewer" on a null/empty payload', async () => {
    h.state.rpc = { data: null, error: null }
    expect(await svc.getMyAdminRole()).toBe('viewer')
  })

  it('listAdminUsers []-degrades on a missing relation and returns rows on success', async () => {
    h.state.from = { data: null, error: { code: '42P01', message: 'no relation' } }
    expect(await svc.listAdminUsers()).toEqual([])
    expect(h.state.lastFrom.table).toBe('admin_users')

    const rows = [{ id: 'r1', user_id: 'u1', admin_role: 'viewer', active: true }]
    h.state.from = { data: rows, error: null }
    expect(await svc.listAdminUsers()).toEqual(rows)
  })

  it('listAdminUsers throws a ServiceError on a non-missing-relation error', async () => {
    h.state.from = { data: null, error: { code: '42501', message: 'denied' } }
    await expect(svc.listAdminUsers()).rejects.toThrow('denied')
  })

  it('searchProfiles queries profiles with an ilike or-filter and []-degrades', async () => {
    h.state.from = { data: null, error: { message: 'boom' } }
    expect(await svc.searchProfiles('ann')).toEqual([])
    expect(h.state.lastFrom.table).toBe('profiles')
    expect(h.state.lastFrom.ops.or).toContain('email.ilike.%ann%')
    expect(h.state.lastFrom.ops.limit).toBe(20)

    const rows = [{ id: 'u1', email: 'a@b.com', full_name: 'Ann' }]
    h.state.from = { data: rows, error: null }
    expect(await svc.searchProfiles('ann')).toEqual(rows)
  })

  it('removeAdminUser deletes by id and returns the unwrapped payload', async () => {
    h.state.from = { data: [{ id: 'r1' }], error: null }
    const out = await svc.removeAdminUser('r1')
    expect(h.state.lastFrom.table).toBe('admin_users')
    expect(h.state.lastFrom.ops.delete).toBe(true)
    expect(h.state.lastFrom.ops.eq).toEqual({ col: 'id', val: 'r1' })
    expect(out).toEqual([{ id: 'r1' }])
  })
})
