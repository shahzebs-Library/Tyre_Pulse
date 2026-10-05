import { describe, it, expect, vi, beforeEach } from 'vitest'

// Site filter (migration 20261005170000): p_site is sent ONLY when a site is
// chosen, so an all-sites call keeps the exact pre-migration argument list.
const h = vi.hoisted(() => {
  const state = { rpc: { data: null, error: null }, lastRpc: null }
  function rpc(name, args) {
    state.lastRpc = { name, args }
    return Promise.resolve(state.rpc)
  }
  return { state, supabase: { rpc, from: () => { throw new Error('from() should not be called') } } }
})

vi.mock('../lib/supabase', () => ({ supabase: h.supabase }))

const { getFleetCpk, withSite, getCpkKmSource, getCpkHoursSource, getCpkUnitAudit, getCpkKmIntelligence } = await import('../lib/api/fleetCpk')
const { getCpkDrivers } = await import('../lib/api/cpkDrivers')
const { getBrandSizeCpk } = await import('../lib/api/brandSizeCpk')

beforeEach(() => {
  h.state.rpc = { data: null, error: null }
  h.state.lastRpc = null
})

describe('withSite', () => {
  it('adds p_site only for a real site', () => {
    expect(withSite({ a: 1 }, 'NHC')).toEqual({ a: 1, p_site: 'NHC' })
    expect(withSite({ a: 1 }, ' JED ')).toEqual({ a: 1, p_site: 'JED' })
    expect(withSite({ a: 1 }, '')).toEqual({ a: 1 })
    expect(withSite({ a: 1 }, 'All')).toEqual({ a: 1 })
    expect(withSite({ a: 1 }, undefined)).toEqual({ a: 1 })
  })
})

describe('services thread the site', () => {
  it('getFleetCpk sends p_site when given and omits it otherwise', async () => {
    h.state.rpc = { data: { per_vehicle: [], by_type: [], fleet: [] }, error: null }
    await getFleetCpk({ country: 'KSA', site: 'NHC' })
    expect(h.state.lastRpc.args).toEqual({ p_country: 'KSA', p_from: null, p_to: null, p_site: 'NHC' })
    await getFleetCpk({ country: 'KSA' })
    expect(h.state.lastRpc.args).toEqual({ p_country: 'KSA', p_from: null, p_to: null })
  })

  it('getFleetCpk strict surfaces a forbidden site instead of an empty page', async () => {
    h.state.rpc = { data: { ok: false, reason: 'forbidden' }, error: null }
    await expect(getFleetCpk({ country: 'KSA', site: 'JED', strict: true })).rejects.toThrow()
    expect(await getFleetCpk({ country: 'KSA', site: 'JED' })).toEqual({ perVehicle: [], byType: [], fleet: [] })
  })

  it('getCpkDrivers and getBrandSizeCpk send p_site', async () => {
    h.state.rpc = { data: { ok: true, windows: null, segments: [] }, error: null }
    await getCpkDrivers({ country: 'KSA', site: 'NHC' })
    expect(h.state.lastRpc.args.p_site).toBe('NHC')
    h.state.rpc = { data: [], error: null }
    await getBrandSizeCpk({ country: 'KSA', site: 'NHC' })
    expect(h.state.lastRpc).toEqual({ name: 'get_brand_size_cpk', args: { p_country: 'KSA', p_from: null, p_to: null, p_site: 'NHC' } })
    await getBrandSizeCpk({ country: 'KSA' })
    expect('p_site' in h.state.lastRpc.args).toBe(false)
  })
})

// Migration 20261005180000: the KM source, Units and Km intelligence tabs.
describe('tab services thread the site', () => {
  it('getCpkKmSource / getCpkHoursSource send p_site with or without an asset', async () => {
    h.state.rpc = { data: { ok: true, by_asset: [] }, error: null }
    await getCpkKmSource({ country: 'KSA', site: 'NHC' })
    expect(h.state.lastRpc).toEqual({ name: 'get_cpk_km_source', args: { p_country: 'KSA', p_from: null, p_to: null, p_asset: null, p_site: 'NHC' } })
    await getCpkKmSource({ country: 'KSA', site: 'NHC', asset: 'TM634' })
    expect(h.state.lastRpc.args).toMatchObject({ p_asset: 'TM634', p_site: 'NHC' })
    await getCpkHoursSource({ country: 'KSA', site: 'NHC' })
    expect(h.state.lastRpc).toEqual({ name: 'get_cpk_hours_source', args: { p_country: 'KSA', p_from: null, p_to: null, p_asset: null, p_site: 'NHC' } })
    await getCpkHoursSource({ country: 'KSA' })
    expect('p_site' in h.state.lastRpc.args).toBe(false)
  })

  it('getCpkUnitAudit / getCpkKmIntelligence send p_site only for a real site', async () => {
    h.state.rpc = { data: { ok: true }, error: null }
    await getCpkUnitAudit({ country: 'KSA', site: 'NHC' })
    expect(h.state.lastRpc).toEqual({ name: 'get_cpk_unit_audit', args: { p_country: 'KSA', p_from: null, p_to: null, p_site: 'NHC' } })
    await getCpkUnitAudit({ country: 'KSA', site: 'All' })
    expect('p_site' in h.state.lastRpc.args).toBe(false)
    await getCpkKmIntelligence({ country: 'KSA', site: 'NHC' })
    expect(h.state.lastRpc).toEqual({ name: 'get_cpk_km_intelligence', args: { p_country: 'KSA', p_from: null, p_to: null, p_site: 'NHC' } })
    await getCpkKmIntelligence({ country: 'KSA' })
    expect('p_site' in h.state.lastRpc.args).toBe(false)
  })

  it('a forbidden site degrades to an honest not-ok result', async () => {
    h.state.rpc = { data: { ok: false, reason: 'forbidden' }, error: null }
    expect((await getCpkKmSource({ country: 'KSA', site: 'JED' })).ok).toBe(false)
    expect((await getCpkUnitAudit({ country: 'KSA', site: 'JED' })).ok).toBe(false)
  })
})
