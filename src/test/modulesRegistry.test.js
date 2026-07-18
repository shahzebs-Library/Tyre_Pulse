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
  it('projects id + status + window and returns a { id: {status,until,note} } map', async () => {
    h.state.result = {
      data: [
        { module_id: 'analytics', status: 'live', maintenance_until: null, maintenance_note: null },
        { module_id: 'reports', status: 'maintenance', maintenance_until: '2026-07-20T10:00:00Z', maintenance_note: 'Upgrading' },
      ],
      error: null,
    }
    const map = await registry.listModuleStatuses()
    expect(h.state.last._table).toBe('modules')
    expect(h.state.last._calls.select).toBe('module_id,status,maintenance_until,maintenance_note')
    expect(map).toEqual({
      analytics: { status: 'live', until: null, note: null },
      reports: { status: 'maintenance', until: '2026-07-20T10:00:00Z', note: 'Upgrading' },
    })
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
      data: [{ status: 'disabled' }, { module_id: 'stock', status: 'disabled', maintenance_until: null, maintenance_note: null }],
      error: null,
    }
    const map = await registry.listModuleStatuses()
    expect(map).toEqual({ stock: { status: 'disabled', until: null, note: null } })
  })
})

// Pure default-open contract mirrored by AuthContext.moduleStatus: an unknown key
// or an empty / unreadable map must resolve to 'live' (availability over lockout).
// The stored value is now an object { status, until, note }; a legacy bare string
// is still tolerated.
function moduleStatusOf(map, key) {
  if (!key) return 'live'
  const entry = map?.[key]
  const s = typeof entry === 'string' ? entry : entry?.status
  return typeof s === 'string' && s ? s : 'live'
}

describe('module status default-open resolution', () => {
  it('returns live for an unknown key', () => {
    expect(moduleStatusOf({ analytics: { status: 'maintenance' } }, 'reports')).toBe('live')
  })

  it('returns live for an empty / unreadable map', () => {
    expect(moduleStatusOf({}, 'analytics')).toBe('live')
    expect(moduleStatusOf(undefined, 'analytics')).toBe('live')
  })

  it('returns the stored status when present (object shape)', () => {
    expect(moduleStatusOf({ analytics: { status: 'maintenance' } }, 'analytics')).toBe('maintenance')
    expect(moduleStatusOf({ stock: { status: 'disabled' } }, 'stock')).toBe('disabled')
  })

  it('tolerates a legacy bare-string value', () => {
    expect(moduleStatusOf({ analytics: 'maintenance' }, 'analytics')).toBe('maintenance')
  })
})
