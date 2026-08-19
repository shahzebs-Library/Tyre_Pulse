import { describe, it, expect, vi, beforeEach } from 'vitest'

const h = vi.hoisted(() => {
  const state = { result: { data: [], error: null }, last: null, uid: 'me-1' }
  function from(table) {
    const calls = { table, eq: [], select: null, upsert: null, delete: false, limit: null }
    const b = {
      _calls: calls,
      select(c) { calls.select = c; return b },
      upsert(v, o) { calls.upsert = [v, o]; return b },
      delete() { calls.delete = true; return b },
      eq(c, v) { calls.eq.push([c, v]); return b },
      limit(n) { calls.limit = n; return b },
      then(f, r) { return Promise.resolve(state.result).then(f, r) },
    }
    state.last = b
    return b
  }
  return {
    state,
    supabase: { from, auth: { getUser: () => Promise.resolve({ data: { user: state.uid ? { id: state.uid } : null } }) } },
  }
})

vi.mock('../lib/supabase', () => ({ supabase: h.supabase }))

const api = await import('../lib/api/userSignature')

const SVG = '<svg xmlns="http://www.w3.org/2000/svg"><path d="M1 1 L9 9"/></svg>'

beforeEach(() => {
  h.state.result = { data: [], error: null }
  h.state.last = null
  h.state.uid = 'me-1'
})

describe('userSignature service', () => {
  it('reads ONLY the caller own row - the user id comes from the session, never from a caller', () => {
    // This is what makes the signature per-user. A caller cannot ask for
    // somebody else's; RLS would refuse it, and the id is never accepted here.
    return api.getMySignature().then(() => {
      expect(h.state.last._calls.table).toBe('user_signatures')
      expect(h.state.last._calls.eq).toEqual([['user_id', 'me-1']])
    })
  })

  it('returns the stored mark', async () => {
    h.state.result = { data: [{ signature: SVG }], error: null }
    await expect(api.getMySignature()).resolves.toBe(SVG)
  })

  it('returns null when the person has never saved one', async () => {
    h.state.result = { data: [], error: null }
    await expect(api.getMySignature()).resolves.toBeNull()
  })

  it('returns null rather than throwing when the table is not migrated yet', async () => {
    h.state.result = { data: null, error: { message: 'relation "user_signatures" does not exist', code: '42P01' } }
    await expect(api.getMySignature()).resolves.toBeNull()
  })

  it('returns null rather than throwing on any other read failure - an approver must still get a pad', async () => {
    h.state.result = { data: null, error: { message: 'boom', code: '42501' } }
    await expect(api.getMySignature()).resolves.toBeNull()
  })

  it('refuses to store junk that would be shown to a reader as a signature', async () => {
    await expect(api.saveMySignature('')).rejects.toThrow()
    await expect(api.saveMySignature('approved by me')).rejects.toThrow()
    expect(h.state.last).toBeNull()
  })

  it('saving replaces the previous mark for THIS user (upsert on user_id)', async () => {
    h.state.result = { data: null, error: null }
    await api.saveMySignature(SVG)
    const [values, opts] = h.state.last._calls.upsert
    expect(values.user_id).toBe('me-1')
    expect(values.signature).toBe(SVG)
    expect(opts).toEqual({ onConflict: 'user_id' })
  })

  it('a save failure is reported, never swallowed - otherwise someone believes it is stored', async () => {
    h.state.result = { data: null, error: { message: 'nope', code: '42501' } }
    await expect(api.saveMySignature(SVG)).rejects.toThrow()
  })

  it('clearing deletes only the caller own row', async () => {
    h.state.result = { data: null, error: null }
    await api.clearMySignature()
    expect(h.state.last._calls.delete).toBe(true)
    expect(h.state.last._calls.eq).toEqual([['user_id', 'me-1']])
  })

  it('does nothing at all when there is no session', async () => {
    h.state.uid = null
    await expect(api.getMySignature()).resolves.toBeNull()
    await api.clearMySignature()
    expect(h.state.last).toBeNull()
    await expect(api.saveMySignature(SVG)).rejects.toThrow()
  })
})
