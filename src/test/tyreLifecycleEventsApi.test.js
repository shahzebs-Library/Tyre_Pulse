import { describe, it, expect, vi, beforeEach } from 'vitest'

const rpc = vi.fn()
vi.mock('../lib/api/_client', () => ({ supabase: { rpc: (...a) => rpc(...a) } }))

const { getTyreLifecycleEvents, getTyreLifecycleEventCounts, getAssetSiteAt } = await import('../lib/api/tyreLifecycleEvents')

describe('tyre lifecycle / site history service', () => {
  beforeEach(() => rpc.mockReset())

  it('passes serial and country, and degrades on error without leaking text', async () => {
    rpc.mockResolvedValueOnce({ data: [{ event_seq: 1, event_type: 'FIT' }], error: null })
    const ok = await getTyreLifecycleEvents(' YMA55310 ', { country: 'KSA' })
    expect(rpc).toHaveBeenCalledWith('get_tyre_lifecycle_events', { p_serial: 'YMA55310', p_country: 'KSA' })
    expect(ok.rows).toHaveLength(1)
    rpc.mockResolvedValueOnce({ data: null, error: { message: 'relation "x" does not exist', code: '42P01' } })
    const bad = await getTyreLifecycleEvents('YMA55310')
    expect(bad.ok).toBe(false)
    expect(bad.error).not.toMatch(/relation/)
  })

  it('shapes counts and the site at a date', async () => {
    rpc.mockResolvedValueOnce({ data: [{ country: 'UAE', by_type: { FIT: 2 }, ambiguous: {} }], error: null })
    const c = await getTyreLifecycleEventCounts()
    expect(c.countries[0]).toEqual({ country: 'UAE', byType: { FIT: 2 }, ambiguous: {} })
    rpc.mockResolvedValueOnce({ data: [{ site: 'NHC', provisional: false, evidence: 'job_cards' }], error: null })
    expect(await getAssetSiteAt('TM1', '2025-02-15T08:00:00Z', { country: 'KSA' }))
      .toEqual({ ok: true, site: 'NHC', provisional: false, evidence: 'job_cards' })
    expect(rpc).toHaveBeenLastCalledWith('asset_site_at', { p_asset: 'TM1', p_country: 'KSA', p_date: '2025-02-15' })
    rpc.mockResolvedValueOnce({ data: [], error: null })
    expect((await getAssetSiteAt('TM9', '2025-01-01')).site).toBeNull()
  })
})
