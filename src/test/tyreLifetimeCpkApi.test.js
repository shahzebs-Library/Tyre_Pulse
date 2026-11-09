import { describe, it, expect, vi } from 'vitest'

const rpc = vi.fn()
vi.mock('../lib/api/_client', () => ({ supabase: { rpc: (...a) => rpc(...a) } }))

const { getTyreLifetimeCpk, shapeLifetimeCpk, estimatedShare } = await import('../lib/api/tyreLifetimeCpk')

const payload = {
  definition: { kpi: 'physical_tyre_lifetime_cpk' },
  countries: [{
    country: 'KSA',
    final: { tyres: 5230, measurable: 2504, purchase_cost: 2526846.62, full_cost: 2526846.62, km: 98930704, cpk_purchase: 0.025542, cpk_full: 0.025542,
      estimated_cost_in_cpk: 925973, km_coverage: { complete: 4013, partial: 160, none: 1057 }, cost_status: { ACTUAL: 2026, ESTIMATED: 1332, MISSING: 1872 } },
    provisional: null,
    by_brand: [{ key: 'TRIANGLE', tyres: 10, km: 500000, cpk_purchase: 0.02, cpk_full: 0.02 }],
    unlinked_repair_lines: { lines: 18, amount: 7200 },
  }],
}

describe('tyreLifetimeCpk service', () => {
  it('passes null for All and shapes the payload', async () => {
    rpc.mockResolvedValueOnce({ data: payload, error: null })
    const res = await getTyreLifetimeCpk({ country: 'All', from: '2026-01-01' })
    expect(rpc).toHaveBeenCalledWith('get_tyre_lifetime_cpk', { p_country: null, p_from: '2026-01-01', p_to: null, p_site: null })
    expect(res.ok).toBe(true)
    const k = res.countries[0]
    expect(k.final.cpkPurchase).toBeCloseTo(0.025542)
    expect(k.final.costStatus.DISPUTED).toBe(0)
    expect(k.provisional).toBeNull()
    expect(k.byBrand[0].key).toBe('TRIANGLE')
    expect(k.bySize).toEqual([])
    expect(k.unlinkedRepairLines).toEqual({ lines: 18, amount: 7200 })
    expect(estimatedShare(k.final)).toBeCloseTo(925973 / 2526846.62, 6)
  })
  it('never fabricates a zero CPK', () => {
    const r = shapeLifetimeCpk({ countries: [{ country: 'UAE', final: { tyres: 3, measurable: 0, km: null, cpk_purchase: null } }] })
    expect(r.countries[0].final.cpkPurchase).toBeNull()
    expect(r.countries[0].final.km).toBeNull()
    expect(estimatedShare(r.countries[0].final)).toBeNull()
  })
  it('degrades to ok:false with a clean message', async () => {
    rpc.mockResolvedValueOnce({ data: null, error: { code: '42501', message: 'permission denied for function get_tyre_lifetime_cpk' } })
    const res = await getTyreLifetimeCpk({ country: 'KSA' })
    expect(res.ok).toBe(false)
    expect(res.error).not.toMatch(/get_tyre_lifetime_cpk/)
  })
})
