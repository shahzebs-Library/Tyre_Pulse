import { describe, it, expect, vi, beforeEach } from 'vitest'

// Hoisted Supabase mock (mirrors dataQuality.test.js / reconDupKeys.test.js).
//
// `get_asset_master` is SET-RETURNING, so supabase-js returns a filter builder
// and the service pages it with `.range()`. The mock therefore records every
// rpc(name, args) AND every range window, and serves pages out of a configurable
// row list - which is what lets these tests prove the read is actually paged
// rather than truncated at the server's 1000-row cap.
const h = vi.hoisted(() => {
  const state = { rows: [], error: null, calls: [], ranges: [], ignoreRange: false }
  function rpc(name, args) {
    state.calls.push({ name, args })
    const builder = {
      range(from, to) {
        state.ranges.push([from, to])
        if (state.error) return Promise.resolve({ data: null, error: state.error })
        const rows = Array.isArray(state.rows)
          ? state.rows.slice(state.ignoreRange ? 0 : from, (state.ignoreRange ? 0 : from) + (to - from + 1))
          : state.rows
        return Promise.resolve({ data: rows, error: null })
      },
    }
    return builder
  }
  return { state, supabase: { rpc } }
})

vi.mock('../lib/supabase', () => ({ supabase: h.supabase }))

const { getAssetMaster, COUNTRY_CURRENCY } = await import('../lib/api/assetMaster')

const row = (n) => ({
  asset_no: `A${String(n).padStart(5, '0')}`,
  countries: 'KSA', country_count: 1, make: 'Volvo', model: 'FH',
  vehicle_type: 'TR-MIXER', tyres: 12, work_orders: 30, by_country: [],
})

beforeEach(() => {
  h.state.rows = []
  h.state.error = null
  h.state.calls = []
  h.state.ranges = []
  h.state.ignoreRange = false
})

describe('service layer - getAssetMaster', () => {
  it('calls get_asset_master with p_search and p_limit and returns the rows', async () => {
    h.state.rows = [row(1), row(2)]
    const out = await getAssetMaster({ search: 'volvo', limit: 500 })
    expect(out).toEqual(h.state.rows)
    expect(h.state.calls[0].name).toBe('get_asset_master')
    expect(h.state.calls[0].args).toEqual({ p_search: 'volvo', p_limit: 500 })
  })

  it('trims the search term before passing it', async () => {
    await getAssetMaster({ search: '  A1  ' })
    expect(h.state.calls[0].args.p_search).toBe('A1')
  })

  it('passes null p_search when search is blank', async () => {
    await getAssetMaster({ search: '   ' })
    expect(h.state.calls[0].args.p_search).toBeNull()
  })

  it('passes null p_search when search is undefined (no args)', async () => {
    await getAssetMaster()
    expect(h.state.calls[0].name).toBe('get_asset_master')
    expect(h.state.calls[0].args.p_search).toBeNull()
  })

  it('sends p_limit equal to the row ceiling, so the function LIMIT never cuts a page short', async () => {
    await getAssetMaster({ limit: 4321 })
    expect(h.state.calls[0].args.p_limit).toBe(4321)
  })

  // THE REGRESSION THIS FILE EXISTS FOR. PostgREST caps a set-returning RPC at
  // 1000 rows exactly as it caps a table read, so the old single unpaged call
  // returned 1,000 of the ~1,377 distinct asset codes and the count printed
  // beside the browse table read as a total.
  it('pages past the 1000-row response cap instead of truncating', async () => {
    h.state.rows = Array.from({ length: 1377 }, (_, i) => row(i))
    const out = await getAssetMaster()
    expect(out).toHaveLength(1377)
    expect(h.state.ranges.length).toBeGreaterThan(1)
    expect(h.state.ranges[0]).toEqual([0, 999])
    // No duplicate asset ever reaches the caller.
    expect(new Set(out.map((r) => r.asset_no)).size).toBe(1377)
  })

  it('stops after one wasted page if the server ignores the range (never loops)', async () => {
    // Every page returns the SAME first 1000 rows - the failure mode that would
    // otherwise spin until the ceiling.
    h.state.rows = Array.from({ length: 3000 }, (_, i) => row(i))
    h.state.ignoreRange = true
    const out = await getAssetMaster()
    expect(out).toHaveLength(1000)
    expect(h.state.ranges).toHaveLength(2)
  })

  it('returns [] on an RPC error', async () => {
    h.state.error = { message: 'boom', code: '42501' }
    expect(await getAssetMaster({ search: 'x' })).toEqual([])
  })

  it('returns [] on a null payload', async () => {
    h.state.rows = null
    expect(await getAssetMaster()).toEqual([])
  })

  it('returns [] on a non-array payload', async () => {
    h.state.rows = { not: 'an array' }
    expect(await getAssetMaster()).toEqual([])
  })
})

describe('COUNTRY_CURRENCY map', () => {
  it('maps each country to its own currency', () => {
    expect(COUNTRY_CURRENCY.KSA).toBe('SAR')
    expect(COUNTRY_CURRENCY.UAE).toBe('AED')
    expect(COUNTRY_CURRENCY.Egypt).toBe('EGP')
  })
})
