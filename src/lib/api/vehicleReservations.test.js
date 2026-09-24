import { beforeEach, describe, expect, it, vi } from 'vitest'

import { findConflicts } from '../vehicleReservations'

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

const { listVehicleReservations } = await import('./vehicleReservations')

beforeEach(() => Object.assign(state, { rows: [], errorAt: null, error: null, queries: [] }))

describe('reservation register completeness', () => {
  it('detects a conflicting booking beyond the first server page', async () => {
    state.rows = Array.from({ length: 1002 }, (_, id) => ({
      id, asset_no: `POOL-${id}`, status: 'approved',
      start_at: '2026-09-24T08:00:00Z', end_at: '2026-09-24T12:00:00Z',
    }))
    state.rows[1001].asset_no = 'POOL-0'
    const conflicts = findConflicts(await listVehicleReservations())
    expect(conflicts.map(({ a, b }) => [a.id, b.id])).toEqual([[0, 1001]])
  })
  it('loads beyond both the former 500 cap and the server page size with scope on every page', async () => {
    state.rows = Array.from({ length: 1251 }, (_, id) => ({ id }))
    expect(await listVehicleReservations({ country: 'KSA' })).toEqual(state.rows)
    for (const query of state.queries) {
      expect(query.table).toBe('vehicle_reservations')
      expect(query.scope).toBe('country.eq.KSA,country.is.null')
      expect(query.orders).toEqual(['start_at', 'created_at', 'id'])
    }
  })

  it.each(['42P01', 'PGRST205', '42501'])('preserves backend failure %s instead of reporting an empty register', async (code) => {
    state.errorAt = 0
    state.error = { code, message: 'backend failure' }
    await expect(listVehicleReservations()).rejects.toMatchObject({ code })
  })

  it('rejects a later page failure rather than returning partial totals', async () => {
    state.rows = Array.from({ length: 1000 }, (_, id) => ({ id }))
    state.errorAt = 1000
    state.error = { code: '57014', message: 'timeout' }
    await expect(listVehicleReservations()).rejects.toMatchObject({ code: '57014' })
  })

  it('retains a genuinely empty successful register', async () => {
    expect(await listVehicleReservations()).toEqual([])
  })
})

