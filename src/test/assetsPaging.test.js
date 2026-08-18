import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * The asset pickers were silently truncating.
 *
 * PostgREST caps EVERY response at its db-max-rows (1,000 here) whatever a
 * `.limit()` says, and that applies to a SET-RETURNING RPC exactly as it does
 * to a table read. Measured live as a real approved KSA-only Manager,
 * `reference_asset_options` returns 1,033 rows and `vehicle_fleet` holds 1,617
 * (KSA 1,030 / UAE 452 / Egypt 135). So the picker was dropping the tail with
 * no error and nothing on screen to show it, and the symptom was the worst
 * kind: a user types a real asset number, the client-side filter finds nothing
 * in the truncated array, and the asset looks like it is missing from the
 * system.
 *
 * These tests use the REAL fetchAllPages, so they exercise the actual paging
 * rather than asserting against a mock of it.
 */

const state = {
  rows: [],        // full dataset the fake server holds
  tableRanges: [], // [from, to] of every table read
  rpcRanges: [],   // [from, to] of every rpc read
  error: null,
  lastOrder: [],
}

function pageOf(from, to) {
  return state.rows.slice(from, to + 1)
}

// A builder that records .range() and resolves like PostgREST would.
function makeBuilder(sink) {
  const b = {
    select: () => b,
    eq: () => b,
    or: () => b,
    order: (col) => { state.lastOrder.push(col); return b },
    range: (from, to) => {
      sink.push([from, to])
      const result = state.error
        ? { data: null, error: state.error }
        : { data: pageOf(from, to), error: null }
      return Promise.resolve(result)
    },
    then: (res) => res({ data: pageOf(0, 999), error: state.error }),
  }
  return b
}

vi.mock('../lib/api/_client', async () => {
  const { fetchAllPages } = await vi.importActual('../lib/fetchAll')
  class ServiceError extends Error {
    constructor(message, code, cause) { super(message); this.code = code; this.cause = cause }
  }
  return {
    ServiceError,
    fetchAllPages,
    unwrap: (r) => { if (r?.error) throw new ServiceError(r.error.message, r.error.code); return r?.data },
    applyCountry: (q) => q,
    supabase: {
      from: () => makeBuilder(state.tableRanges),
      rpc: () => makeBuilder(state.rpcRanges),
    },
  }
})

const { listAssets, listDataAssetOptions, MAX_ASSET_ROWS } = await import('../lib/api/assets')

beforeEach(() => {
  state.rows = []
  state.tableRanges = []
  state.rpcRanges = []
  state.error = null
  state.lastOrder = []
})

describe('listAssets pages past the PostgREST cap', () => {
  it('returns all 1,617 fleet rows, not the first 1,000', () => {
    state.rows = Array.from({ length: 1617 }, (_, i) => ({ id: `id-${i}`, asset_no: `A-${i}` }))
    return listAssets({}).then((rows) => {
      expect(rows).toHaveLength(1617)
      // More than one request: the whole point. A single [0,999] read is the bug.
      expect(state.tableRanges.length).toBeGreaterThan(1)
      expect(state.tableRanges[0]).toEqual([0, 999])
    })
  })

  it('orders by a UNIQUE tiebreak so no row falls between two pages', async () => {
    // created_at is not unique across the fleet. Ordering on it alone lets a row
    // appear in two pages or in neither at a boundary, which is a subtler
    // version of the same "asset is missing" bug.
    state.rows = Array.from({ length: 1200 }, (_, i) => ({ id: `id-${i}` }))
    await listAssets({})
    expect(state.lastOrder).toContain('id')
  })

  it('a small fleet is still a single round trip', async () => {
    state.rows = Array.from({ length: 40 }, (_, i) => ({ id: `id-${i}` }))
    const rows = await listAssets({})
    expect(rows).toHaveLength(40)
    expect(state.tableRanges).toHaveLength(1)
  })

  it('an explicit limit is still honoured as a real ceiling', async () => {
    state.rows = Array.from({ length: 1617 }, (_, i) => ({ id: `id-${i}` }))
    const rows = await listAssets({ limit: 25 })
    expect(rows).toHaveLength(25)
  })

  it('there is no unbounded read: MAX_ASSET_ROWS caps the default', () => {
    // A future 50,000-asset fleet must not be pulled whole into a picker.
    expect(MAX_ASSET_ROWS).toBeGreaterThan(1617)
    expect(Number.isFinite(MAX_ASSET_ROWS)).toBe(true)
  })

  it('still raises a ServiceError rather than returning a short list', async () => {
    // A read that fails must not look like "there are no assets".
    state.error = { message: 'boom', code: '42501' }
    await expect(listAssets({})).rejects.toMatchObject({ code: '42501' })
  })
})

describe('listDataAssetOptions pages the set-returning RPC', () => {
  it('returns all 1,033 asset numbers a KSA manager actually has', async () => {
    state.rows = Array.from({ length: 1033 }, (_, i) => ({ asset_no: `A-${i}` }))
    const opts = await listDataAssetOptions('KSA')
    expect(opts).toHaveLength(1033)
    // The 33 past the cap are the ones the field user could not find.
    expect(opts).toContain('A-1032')
    expect(state.rpcRanges.length).toBeGreaterThan(1)
  })

  it('drops blank asset numbers without dropping real ones', async () => {
    state.rows = [{ asset_no: 'A-1' }, { asset_no: null }, { asset_no: 'A-2' }, {}]
    expect(await listDataAssetOptions(null)).toEqual(['A-1', 'A-2'])
  })
})
