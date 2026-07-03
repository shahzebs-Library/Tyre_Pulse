import { describe, it, expect, vi, beforeEach } from 'vitest'

// Supabase mock exposing rpc() — records the RPC name + params and resolves to
// a configurable { data, error }.
const h = vi.hoisted(() => {
  const state = { result: { data: {}, error: null }, calls: [] }
  const supabase = {
    rpc(name, params) {
      state.calls.push({ name, params })
      return Promise.resolve(state.result)
    },
  }
  return { state, supabase }
})

vi.mock('../lib/supabase', () => ({ supabase: h.supabase }))

const branding = await import('../lib/api/branding')
const { ServiceError } = await import('../lib/api/_client')

beforeEach(() => {
  h.state.result = { data: {}, error: null }
  h.state.calls = []
})

describe('service layer - branding', () => {
  it('getOrgBranding calls get_org_branding with the org id', async () => {
    h.state.result = { data: { org_id: 'o1', name: 'KSA', primary_color: '#0F766E' }, error: null }
    const b = await branding.getOrgBranding('o1')
    expect(h.state.calls[0]).toEqual({ name: 'get_org_branding', params: { p_org_id: 'o1' } })
    expect(b.primary_color).toBe('#0F766E')
  })

  it('getOrgBranding passes null for the caller own org', async () => {
    await branding.getOrgBranding()
    expect(h.state.calls[0]).toEqual({ name: 'get_org_branding', params: { p_org_id: null } })
  })

  it('setOrgBranding whitelists fields, trims strings, drops unknown keys', async () => {
    h.state.result = { data: { legal_name: 'Acme' }, error: null }
    await branding.setOrgBranding('o1', {
      legal_name: '  Acme  ',
      primary_color: '#123456',
      report_theme: 'dark',
      junk: 'nope',        // not in BRANDING_FIELDS → dropped
      logo_url: undefined, // undefined → dropped
    })
    const { name, params } = h.state.calls[0]
    expect(name).toBe('set_org_branding')
    expect(params.p_org_id).toBe('o1')
    expect(params.p_branding.legal_name).toBe('Acme')            // trimmed
    expect(params.p_branding.primary_color).toBe('#123456')
    expect(params.p_branding.report_theme).toBe('dark')
    expect(params.p_branding).not.toHaveProperty('junk')          // whitelisted out
    expect(params.p_branding).not.toHaveProperty('logo_url')      // undefined dropped
  })

  it('withBrandingDefaults fills every field over a partial object', () => {
    const merged = branding.withBrandingDefaults({ primary_color: '#000000' })
    expect(merged.primary_color).toBe('#000000')
    expect(merged.report_theme).toBe('light')          // default preserved
    expect(merged.secondary_color).toBe(branding.DEFAULT_BRANDING.secondary_color)
    expect(merged).toHaveProperty('disclaimer')
  })

  it('throws a ServiceError when the RPC errors', async () => {
    h.state.result = { data: null, error: { message: 'denied', code: '42501' } }
    await expect(branding.setOrgBranding('o1', { legal_name: 'X' })).rejects.toBeInstanceOf(ServiceError)
    await expect(branding.getOrgBranding('o1')).rejects.toMatchObject({ code: '42501' })
  })
})
