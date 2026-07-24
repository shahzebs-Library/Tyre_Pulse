import { describe, it, expect, vi, beforeEach } from 'vitest'

// Minimal Supabase mock: rpc (getExpenseBySite/setStoreSiteMap) + a chainable
// from().select().order().eq() for listSites.
const h = vi.hoisted(() => {
  const state = { rpcResult: { data: [], error: null }, rpcCalls: [], fromResult: { data: [], error: null } }
  const builder = () => {
    const b = {
      select: () => b,
      order: () => b,
      eq: () => b,
      then: (resolve) => resolve(state.fromResult),
    }
    return b
  }
  const supabase = {
    rpc: (fn, args) => {
      state.rpcCalls.push([fn, args])
      return Promise.resolve(state.rpcResult)
    },
    from: () => builder(),
  }
  return { state, supabase }
})

vi.mock('../lib/api/_client', () => ({ supabase: h.supabase }))

const { getExpenseBySite, setStoreSiteMap, listSites } = await import('../lib/api/storeSiteExpense')

beforeEach(() => {
  h.state.rpcResult = { data: [], error: null }
  h.state.rpcCalls = []
  h.state.fromResult = { data: [], error: null }
})

describe('getExpenseBySite', () => {
  it('calls get_expense_by_site with mapped args and returns the array payload', async () => {
    const payload = [{ site: 'JED-ST', tyre: 1, spare: 2, oil: 3, total: 6, lines: 10 }]
    h.state.rpcResult = { data: payload, error: null }
    const rows = await getExpenseBySite({ country: 'KSA', from: '2026-01-01', to: '2026-06-30' })
    expect(rows).toEqual(payload)
    expect(h.state.rpcCalls[0][0]).toBe('get_expense_by_site')
    expect(h.state.rpcCalls[0][1]).toEqual({ p_country: 'KSA', p_from: '2026-01-01', p_to: '2026-06-30' })
  })

  it('coerces "All" and blank filters to null', async () => {
    await getExpenseBySite({ country: 'All' })
    expect(h.state.rpcCalls[0][1]).toEqual({ p_country: null, p_from: null, p_to: null })
  })

  it('returns [] on an RPC error', async () => {
    h.state.rpcResult = { data: null, error: { message: 'nope' } }
    expect(await getExpenseBySite({ country: 'KSA' })).toEqual([])
  })

  it('returns [] when the payload is not an array', async () => {
    h.state.rpcResult = { data: { not: 'array' }, error: null }
    expect(await getExpenseBySite()).toEqual([])
  })
})

describe('setStoreSiteMap', () => {
  it('calls set_store_site_map with mapped args', async () => {
    await setStoreSiteMap({ country: 'KSA', store_code: 'NHC-ST', site: 'NHC' })
    expect(h.state.rpcCalls[0][0]).toBe('set_store_site_map')
    expect(h.state.rpcCalls[0][1]).toEqual({ p_country: 'KSA', p_store_code: 'NHC-ST', p_site: 'NHC' })
  })

  it('throws on an RPC error', async () => {
    h.state.rpcResult = { data: null, error: { message: 'denied' } }
    await expect(setStoreSiteMap({ country: 'KSA', store_code: 'X', site: 'Y' })).rejects.toBeTruthy()
  })
})

describe('listSites', () => {
  it('returns site names from the sites table', async () => {
    h.state.fromResult = { data: [{ name: 'NHC' }, { name: 'JED' }, { name: null }], error: null }
    expect(await listSites({ country: 'KSA' })).toEqual(['NHC', 'JED'])
  })

  it('returns [] on error', async () => {
    h.state.fromResult = { data: null, error: { message: 'nope' } }
    expect(await listSites({ country: 'KSA' })).toEqual([])
  })
})
