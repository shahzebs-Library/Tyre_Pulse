import { beforeEach, describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({ rows: [], errorAt: null, error: null, queries: [] }))
vi.mock('../supabase', () => ({
  supabase: {
    from: (table) => {
      const query = { table, orders: [], scope: null }
      state.queries.push(query)
      const builder = {
        select: () => builder,
        or: (scope) => { query.scope = scope; return builder },
        order: (key) => { query.orders.push(key); return builder },
        range: async (from, to) => {
          query.range = [from, to]
          return state.errorAt === from
            ? { data: null, error: state.error }
            : { data: state.rows.slice(from, to + 1), error: null }
        },
      }
      return builder
    },
  },
}))

const { listRoutePlans } = await import('./routePlans')

beforeEach(() => Object.assign(state, { rows: [], errorAt: null, error: null, queries: [] }))

describe('route register completeness', () => {
  it('loads beyond both the former 500 cap and the server page size with scope on every page', async () => {
    state.rows = Array.from({ length: 1251 }, (_, id) => ({ id }))
    expect(await listRoutePlans({ country: 'KSA' })).toEqual(state.rows)
    for (const query of state.queries) {
      expect(query.table).toBe('route_plans')
      expect(query.scope).toBe('country.eq.KSA,country.is.null')
      expect(query.orders).toEqual(['plan_date', 'created_at', 'id'])
    }
  })

  it.each(['42P01', 'PGRST205', '42501'])('preserves backend failure %s instead of reporting an empty register', async (code) => {
    state.errorAt = 0
    state.error = { code, message: 'backend failure' }
    await expect(listRoutePlans()).rejects.toMatchObject({ code })
  })

  it('rejects a later page failure rather than returning partial totals', async () => {
    state.rows = Array.from({ length: 1000 }, (_, id) => ({ id }))
    state.errorAt = 1000
    state.error = { code: '57014', message: 'timeout' }
    await expect(listRoutePlans()).rejects.toMatchObject({ code: '57014' })
  })

  it('retains a genuinely empty successful register', async () => {
    expect(await listRoutePlans()).toEqual([])
  })
})
