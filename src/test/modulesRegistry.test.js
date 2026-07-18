import { describe, it, expect, vi, beforeEach } from 'vitest'

// Supabase mock exposing a `from().select()` chain that resolves to a
// configurable { data, error }. Mirrors the sibling api.test mocks.
const h = vi.hoisted(() => {
  const state = { result: { data: [], error: null }, last: null }
  function from(table) {
    const calls = { select: null }
    const b = {
      _table: table, _calls: calls,
      select(c) { calls.select = c; return b },
      order() { return b },
      then(f, r) { return Promise.resolve(state.result).then(f, r) },
    }
    state.last = b
    return b
  }
  return { state, supabase: { from } }
})

vi.mock('../lib/supabase', () => ({ supabase: h.supabase }))

const registry = await import('../lib/api/modulesRegistry')

beforeEach(() => { h.state.result = { data: [], error: null }; h.state.last = null })

describe('modulesRegistry - listModuleStatuses', () => {
  it('projects module_id + status only and returns a { id: status } map', async () => {
    h.state.result = {
      data: [
        { module_id: 'analytics', status: 'live' },
        { module_id: 'reports', status: 'maintenance' },
      ],
      error: null,
    }
    const map = await registry.listModuleStatuses()
    expect(h.state.last._table).toBe('modules')
    expect(h.state.last._calls.select).toBe('module_id,status')
    expect(map).toEqual({ analytics: 'live', reports: 'maintenance' })
  })

  it('degrades to {} when the table is not migrated yet (fail open)', async () => {
    h.state.result = { data: null, error: { message: 'relation "modules" does not exist', code: '42P01' } }
    await expect(registry.listModuleStatuses()).resolves.toEqual({})
  })

  it('degrades to {} on any read error', async () => {
    h.state.result = { data: null, error: { message: 'permission denied', code: '42501' } }
    await expect(registry.listModuleStatuses()).resolves.toEqual({})
  })

  it('ignores rows without a module_id', async () => {
    h.state.result = {
      data: [{ status: 'disabled' }, { module_id: 'stock', status: 'disabled' }],
      error: null,
    }
    const map = await registry.listModuleStatuses()
    expect(map).toEqual({ stock: 'disabled' })
  })
})

// Pure default-open contract mirrored by AuthContext.moduleStatus: an unknown key
// or an empty / unreadable map must resolve to 'live' (availability over lockout).
function moduleStatusOf(map, key) {
  if (!key) return 'live'
  const s = map?.[key]
  return typeof s === 'string' && s ? s : 'live'
}

describe('module status default-open resolution', () => {
  it('returns live for an unknown key', () => {
    expect(moduleStatusOf({ analytics: 'maintenance' }, 'reports')).toBe('live')
  })

  it('returns live for an empty / unreadable map', () => {
    expect(moduleStatusOf({}, 'analytics')).toBe('live')
    expect(moduleStatusOf(undefined, 'analytics')).toBe('live')
  })

  it('returns the stored status when present', () => {
    expect(moduleStatusOf({ analytics: 'maintenance' }, 'analytics')).toBe('maintenance')
    expect(moduleStatusOf({ stock: 'disabled' }, 'stock')).toBe('disabled')
  })
})
