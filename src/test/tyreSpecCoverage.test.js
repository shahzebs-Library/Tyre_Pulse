import { describe, it, expect, vi, beforeEach } from 'vitest'

const rpc = vi.fn()
const pages = vi.fn()
vi.mock('../lib/api/_client', () => ({
  supabase: { rpc: (...a) => rpc(...a), from: () => ({}) },
  fetchAllPages: (...a) => pages(...a),
  applyCountry: (q) => q,
  toServiceError: (e, m) => Object.assign(new Error(m), { cause: e }),
  isMissingRelation: (e) => e?.code === '42P01' || e?.code === 'PGRST202',
  unwrap: (r) => r.data,
}))

import { brandKey, matchSpec, coverageRows, coverageKpis, filterCoverage, EMPTY_COVERAGE_FILTERS } from '../lib/tyreSpecView'
import { listFleetBrandSizeMix, getSpecFor, invalidateSpecCache } from '../lib/api/tyreSpecCatalog'

const catalog = [
  { id: 1, brand: 'DOUBLECOIN', pattern: 'RR202', size: '315/80R22.5', country: 'KSA', approval_status: 'pending' },
  { id: 2, brand: 'Double Coin', pattern: 'RR905', size: '385/65R22.5', country: 'KSA', approval_status: 'approved' },
  { id: 3, brand: 'TRIANGLE', pattern: 'TR688', size: '315/80R22.5', country: 'KSA', approval_status: 'approved' },
  { id: 4, brand: 'TRIANGLE', pattern: 'TR668', size: '315/80R22.5', country: 'KSA', approval_status: 'pending' },
  { id: 5, brand: 'TRIANGLE', pattern: 'TR688', size: '315/80R22.5', country: 'UAE', approval_status: 'pending' },
  { id: 6, brand: 'PIRELLI', pattern: 'FG:01 II', size: '315/80R22.5', country: 'KSA', approval_status: 'not_approved' },
]

describe('brand key and spec matching', () => {
  it('folds brand spelling but not a different word', () => {
    expect(brandKey('Double Coin')).toBe(brandKey('DOUBLECOIN'))
    expect(brandKey('Ling-Long')).toBe('LINGLONG')
    expect(brandKey('ERICLE')).not.toBe(brandKey('ERACLE'))
    expect(brandKey('')).toBe('')
  })
  it('prefers approved, then exact pattern, then own country', () => {
    expect(matchSpec(catalog, { brand: 'triangle', size: '315/80 r22.5' }).id).toBe(3)
    expect(matchSpec(catalog, { brand: 'triangle', size: '315/80R22.5', pattern: 'tr668' }).id).toBe(3)
    expect(matchSpec(catalog.filter((c) => c.id !== 3), { brand: 'TRIANGLE', size: '315/80R22.5', country: 'UAE' }).id).toBe(5)
    expect(matchSpec(catalog, { brand: 'double coin', size: '315/80R22.5' }).id).toBe(1)
  })
  it('returns null when brand or size is missing or nothing matches', () => {
    expect(matchSpec(catalog, { brand: '', size: '315/80R22.5' })).toBeNull()
    expect(matchSpec(catalog, { brand: 'TRIANGLE', size: '' })).toBeNull()
    expect(matchSpec(catalog, { brand: 'SAILUN', size: '315/80R22.5' })).toBeNull()
  })
})

describe('fleet coverage', () => {
  const mix = [
    { country: 'KSA', brand: 'TRIANGLE', size: '315/80R22.5', tyres: 100, active: 40, last_fitted: '2026-07-01' },
    { country: 'KSA', brand: 'DOUBLE COIN', size: '315/80R22.5', tyres: 50, active: null },
    { country: 'KSA', brand: 'PIRELLI', size: '315/80R22.5', tyres: 30 },
    { country: 'KSA', brand: 'SAILUN', size: '315/80R22.5', tyres: 20 },
    { country: 'Egypt', brand: 'TRIANGLE', size: '315/80R22.5', tyres: 0 },
  ]
  it('classifies each combination and ignores another country row', () => {
    const rows = coverageRows(mix, catalog)
    expect(rows.map((r) => r.status)).toEqual(['approved', 'pending', 'rejected', 'none', 'none'])
    expect(rows[0].patterns.sort()).toEqual(['TR668', 'TR688'])
    expect(rows[1].active).toBeNull()
  })
  it('computes KPIs by tyre count and N/A share when there are no tyres', () => {
    const k = coverageKpis(coverageRows(mix, catalog))
    expect(k).toMatchObject({ combos: 5, tyres: 200, approved: 1, pending: 1, rejected: 1, none: 2 })
    expect(k.tyreSharePct).toBe(50)
    expect(coverageKpis([]).tyreSharePct).toBeNull()
  })
  it('filters by status, country and search', () => {
    const rows = coverageRows(mix, catalog)
    expect(filterCoverage(rows, { ...EMPTY_COVERAGE_FILTERS, status: 'none' })).toHaveLength(2)
    expect(filterCoverage(rows, { ...EMPTY_COVERAGE_FILTERS, country: 'Egypt' })).toHaveLength(1)
    expect(filterCoverage(rows, { ...EMPTY_COVERAGE_FILTERS, search: 'tr668' })).toHaveLength(1)
  })
})

describe('shared catalogue service', () => {
  beforeEach(() => { rpc.mockReset(); pages.mockReset(); invalidateSpecCache() })
  it('reads the fleet mix, degrading only for a missing RPC', async () => {
    rpc.mockResolvedValueOnce({ data: [{ brand: 'X' }], error: null })
    expect(await listFleetBrandSizeMix({ country: 'KSA' })).toEqual([{ brand: 'X' }])
    expect(rpc).toHaveBeenCalledWith('get_tyre_brand_size_mix', { p_country: 'KSA' })
    rpc.mockResolvedValueOnce({ data: null, error: { code: 'PGRST202' } })
    expect(await listFleetBrandSizeMix()).toEqual([])
    rpc.mockResolvedValueOnce({ data: null, error: { code: '42501' } })
    await expect(listFleetBrandSizeMix()).rejects.toThrow(/brand and size mix/)
  })
  it('getSpecFor reads the catalogue once and reuses it', async () => {
    pages.mockResolvedValue({ data: catalog, error: null })
    expect((await getSpecFor('Triangle', '315/80R22.5')).id).toBe(3)
    expect((await getSpecFor('Double Coin', '385/65 R22.5')).id).toBe(2)
    expect(await getSpecFor('', '315/80R22.5')).toBeNull()
    expect(pages).toHaveBeenCalledTimes(1)
  })
  it('getSpecFor throws when the catalogue read fails', async () => {
    pages.mockResolvedValue({ data: null, error: { code: '500' } })
    await expect(getSpecFor('Triangle', '315/80R22.5')).rejects.toThrow(/catalogue/)
  })
})
