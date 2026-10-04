import { describe, it, expect, vi, beforeEach } from 'vitest'

const calls = []
let nextId = 'new-1'
let failSet = false
vi.mock('../lib/api/_client', () => ({
  supabase: {
    rpc: vi.fn(async (fn, args) => {
      calls.push([fn, args])
      if (fn === 'set_user_access_grant') {
        if (failSet) return { data: null, error: { message: 'boom', code: '42501' } }
        return { data: nextId, error: null }
      }
      return { data: null, error: null }
    }),
  },
  unwrap: (r) => { if (r.error) throw Object.assign(new Error(r.error.message), { code: r.error.code }); return r.data },
  fetchAllOrThrow: vi.fn(),
}))

import { editUserGrant, deleteUserGrants } from '../lib/api/accessGrants'

beforeEach(() => { calls.length = 0; nextId = 'new-1'; failSet = false })

describe('editUserGrant', () => {
  it('writes the new rule first, then removes the old row', async () => {
    const row = { id: 'old-1', user_id: 'u1', module_key: 'stock', capability: 'view', effect: 'grant', expires_at: null, note: 'x' }
    const ids = await editUserGrant(row, { effect: 'revoke', expiresAt: '2030-01-01T00:00:00Z' })
    expect(ids).toEqual(['new-1'])
    expect(calls.map((c) => c[0])).toEqual(['set_user_access_grant', 'revoke_user_access_grant'])
    expect(calls[0][1]).toMatchObject({ p_user_id: 'u1', p_module_key: 'stock', p_effect: 'revoke', p_expires_at: '2030-01-01T00:00:00Z' })
    expect(calls[1][1]).toEqual({ p_id: 'old-1' })
  })
  it('does not delete when the upsert returned the same row', async () => {
    nextId = 'old-1'
    await editUserGrant({ id: 'old-1', user_id: 'u1', module_key: 'stock', effect: 'grant' }, { note: 'y' })
    expect(calls.map((c) => c[0])).toEqual(['set_user_access_grant'])
  })
  it('keeps the old rule when the new write fails', async () => {
    failSet = true
    await expect(editUserGrant({ id: 'old-1', user_id: 'u1', module_key: 'stock', effect: 'grant' }, {})).rejects.toThrow()
    expect(calls.some((c) => c[0] === 'revoke_user_access_grant')).toBe(false)
  })
  it('moves a web rule to both surfaces', async () => {
    await editUserGrant({ id: 'old-1', user_id: 'u1', module_key: 'stock', effect: 'grant' }, { scope: 'both' })
    const keys = calls.filter((c) => c[0] === 'set_user_access_grant').map((c) => c[1].p_module_key)
    expect(keys).toEqual(['stock', 'mobile:stock'])
  })
})

describe('deleteUserGrants', () => {
  it('reports each removal', async () => {
    const out = await deleteUserGrants(['a', 'b'])
    expect(out.removed).toEqual(['a', 'b'])
    expect(out.failed).toEqual([])
  })
})
