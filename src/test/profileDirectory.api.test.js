import { beforeEach, describe, expect, it, vi } from 'vitest'

// The staff directory service: every read goes through the PII-free
// list_profile_directory function, never a select on profiles.
const h = vi.hoisted(() => {
  const state = { calls: [], pages: [], error: null, fromCalls: 0 }
  return {
    state,
    supabase: {
      from: () => { state.fromCalls += 1; throw new Error('the directory must not select from a table') },
      rpc: (name, args) => {
        state.calls.push({ name, args })
        if (state.error) return Promise.resolve({ data: null, error: state.error })
        const page = state.pages.length ? state.pages.shift() : []
        return Promise.resolve({ data: page, error: null })
      },
    },
  }
})
vi.mock('../lib/supabase', () => ({ supabase: h.supabase }))

const dir = await import('../lib/api/profileDirectory')

beforeEach(() => { h.state.calls = []; h.state.pages = []; h.state.error = null; h.state.fromCalls = 0 })

describe('profile directory service', () => {
  it('resolves signers by id through the directory function', async () => {
    h.state.pages = [[{ id: 'a', full_name: 'Ali', employee_id: 'E1' }]]
    const map = await dir.getSignerProfiles(['a', 'a', '', null])
    expect(map.get('a').employee_id).toBe('E1')
    expect(h.state.calls).toEqual([{ name: 'list_profile_directory', args: { p_ids: ['a'], p_limit: 200 } }])
    expect(h.state.fromCalls).toBe(0)
  })

  it('getSignerProfiles never throws and leaves unresolved ids out', async () => {
    h.state.error = { message: 'permission denied', code: '42501' }
    const map = await dir.getSignerProfiles(['a'])
    expect(map.size).toBe(0)
  })

  it('fetchDirectoryByIds throws on a failed read', async () => {
    h.state.error = { message: 'boom' }
    await expect(dir.fetchDirectoryByIds(['a'])).rejects.toBeTruthy()
  })

  it('a bounded picker read sends search, roles and the active filter in one call', async () => {
    h.state.pages = [[{ id: 'a' }]]
    const res = await dir.fetchDirectory({ search: 'ali', roles: ['Tyre Man'], activeOnly: true, limit: 40 })
    expect(res).toEqual({ rows: [{ id: 'a' }], truncated: false })
    expect(h.state.calls[0].args).toEqual({ p_search: 'ali', p_roles: ['Tyre Man'], p_active_only: true, p_limit: 40, p_offset: 0 })
  })

  it('an unbounded listing pages by offset until a short page', async () => {
    const full = Array.from({ length: 1000 }, (_, i) => ({ id: `p${i}` }))
    h.state.pages = [full, [{ id: 'last' }]]
    const res = await dir.fetchDirectory({ activeOnly: true })
    expect(res.rows).toHaveLength(1001)
    expect(res.truncated).toBe(false)
    expect(h.state.calls.map((c) => c.args.p_offset)).toEqual([0, 1000])
  })

  it('reports truncation when the ceiling is reached, and listDirectoryPeople refuses a partial list', async () => {
    const full = () => Array.from({ length: 1000 }, (_, i) => ({ id: `p${i}` }))
    h.state.pages = [full(), full()]
    const res = await dir.fetchDirectory({ max: 2000 })
    expect(res.truncated).toBe(true)
    h.state.pages = Array.from({ length: 50 }, full)
    await expect(dir.listDirectoryPeople()).rejects.toBeTruthy()
  })

  it('directoryName prefers the full name, then the username, else null', () => {
    expect(dir.directoryName({ full_name: ' Ali ', username: 'ali' })).toBe('Ali')
    expect(dir.directoryName({ full_name: ' ', username: 'ali' })).toBe('ali')
    expect(dir.directoryName({})).toBeNull()
  })
})
