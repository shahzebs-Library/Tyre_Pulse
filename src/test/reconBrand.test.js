import { describe, it, expect, vi, beforeEach } from 'vitest'

// Chainable, thenable Supabase mock (mirrors src/test/tyreScrap.api.test.js).
// Every builder method returns the same builder so any chain resolves to
// h.state.result. Calls are captured on the last-created builder for assertion.
const h = vi.hoisted(() => {
  const state = { result: { data: [], error: null, count: 0 }, last: null, builders: [] }
  function from(table) {
    const calls = { table, select: null, selectOpts: null, or: null, eqs: [], orders: [], limit: null, update: null }
    const b = {
      _calls: calls,
      select(cols, opts) { calls.select = cols; calls.selectOpts = opts; return b },
      or(f) { calls.or = f; return b },
      eq(col, val) { calls.eqs.push([col, val]); return b },
      order(col, opts) { calls.orders.push([col, opts]); return b },
      limit(n) { calls.limit = n; return b },
      update(v) { calls.update = v; return b },
      then(onF, onR) { return Promise.resolve(state.result).then(onF, onR) },
    }
    state.last = b
    state.builders.push(b)
    return b
  }
  return { state, supabase: { from } }
})

vi.mock('../lib/supabase', () => ({ supabase: h.supabase }))

const {
  listBrandGapSummary,
  listBrandGapTyres,
  setTyreBrand,
  BRAND_GAP_COUNTRIES,
} = await import('../lib/api/reconBrand')

beforeEach(() => {
  h.state.result = { data: [], error: null, count: 0 }
  h.state.last = null
  h.state.builders = []
})

describe('service layer - reconBrand', () => {
  it('listBrandGapSummary returns one { country, missing, total } per country', async () => {
    h.state.result = { data: null, error: null, count: 7 }
    const rows = await listBrandGapSummary()
    expect(rows).toHaveLength(BRAND_GAP_COUNTRIES.length)
    for (const country of BRAND_GAP_COUNTRIES) {
      expect(rows).toContainEqual({ country, missing: 7, total: 7 })
    }
    // Uses head-only exact-count queries and filters blank brand for the missing count.
    expect(h.state.last._calls.selectOpts).toEqual({ count: 'exact', head: true })
    expect(h.state.last._calls.or).toBe('brand.is.null,brand.eq.')
  })

  it('listBrandGapSummary returns [] when the count query errors', async () => {
    h.state.result = { data: null, error: { message: 'boom' }, count: null }
    const rows = await listBrandGapSummary()
    expect(rows).toEqual([])
  })

  it('listBrandGapTyres selects the tyre column set, filters blank brand, orders and limits', async () => {
    const rows = await listBrandGapTyres()
    const calls = h.state.last._calls
    expect(calls.table).toBe('tyre_records')
    expect(calls.select).toBe('id,serial_no,asset_no,size,site,country,issue_date')
    expect(calls.or).toBe('brand.is.null,brand.eq.')
    expect(calls.orders).toContainEqual(['country', { ascending: true }])
    expect(calls.orders).toContainEqual(['issue_date', { ascending: true }])
    expect(calls.limit).toBe(500)
    expect(Array.isArray(rows)).toBe(true)
  })

  it('listBrandGapTyres scopes to a specific country when passed', async () => {
    await listBrandGapTyres({ country: 'UAE', limit: 100 })
    const calls = h.state.last._calls
    expect(calls.eqs).toContainEqual(['country', 'UAE'])
    expect(calls.limit).toBe(100)
  })

  it('listBrandGapTyres does not filter country for "All"', async () => {
    await listBrandGapTyres({ country: 'All' })
    expect(h.state.last._calls.eqs).toEqual([])
  })

  it('listBrandGapTyres returns [] on error', async () => {
    h.state.result = { data: null, error: { message: 'nope' }, count: 0 }
    const rows = await listBrandGapTyres()
    expect(rows).toEqual([])
  })

  it('setTyreBrand updates tyre_records.brand for the id', async () => {
    const res = await setTyreBrand('t1', '  Michelin  ')
    const calls = h.state.last._calls
    expect(calls.table).toBe('tyre_records')
    expect(calls.update).toEqual({ brand: 'Michelin' })
    expect(calls.eqs).toContainEqual(['id', 't1'])
    expect(res).toEqual({ ok: true })
  })

  it('setTyreBrand throws on an empty brand and never touches the DB', async () => {
    await expect(setTyreBrand('t1', '   ')).rejects.toThrow('Brand is required.')
    expect(h.state.last).toBeNull()
  })

  it('setTyreBrand throws on a DB error', async () => {
    h.state.result = { data: null, error: { message: 'denied', code: '42501' }, count: 0 }
    await expect(setTyreBrand('t1', 'Triangle')).rejects.toThrow()
  })
})
