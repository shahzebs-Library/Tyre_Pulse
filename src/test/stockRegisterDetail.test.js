import { describe, it, expect, vi } from 'vitest'
import {
  registerItemCode, buildCatalogIndex, buildUsageIndex, usageFor, buildErpVelocityMap, catalogFor, registerCoverage,
} from '../lib/stockRegisterDetail'
import { reorderSuggestion, enrichStock } from '../lib/stockManagementAnalytics'

const canonical = [
  { id: 'c1', company_sku: '310371-O', description: 'Tyre 385/65R22.5 Double Coin', category: 'Tyre', brand: 'Double Coin' },
  { id: 'c2', company_sku: '050019-o', description: 'Oil filter', category: 'Filter', brand: null, manufacturer: null },
]
const variants = [{ canonical_id: 'c2', brand: 'Fleetguard', part_classification: 'genuine', part_number: 'LF9009', status: 'active' }]
const aliases = [{ canonical_id: 'c2', alias_type: 'oem', value: 'LF9009' }]

describe('stock register detail', () => {
  it('reads the item code from the linked ERP item, then the quick-entry code', () => {
    expect(registerItemCode({ item: { item_code: ' 310371-o ' } })).toBe('310371-O')
    expect(registerItemCode({ custom_data: { stock_item: { code: 'abc' } } })).toBe('ABC')
    expect(registerItemCode({ description: 'loose text' })).toBeNull()
  })

  it('indexes Material Master facts by SKU, brand falling back to variants', () => {
    const idx = buildCatalogIndex(canonical, variants, aliases)
    expect(idx.get('310371-O').brand).toBe('Double Coin')
    const f = idx.get('050019-O')
    expect(f.brand).toBe('Fleetguard')
    expect(f.partType).toBe('genuine')
    expect(f.oem).toContain('LF9009')
    expect(catalogFor({ item: { item_code: '050019-O' } }, idx).name).toBe('Oil filter')
    expect(catalogFor({ item: { item_code: 'NOPE' } }, idx)).toBeNull()
  })

  it('states days of cover only for a site rate', () => {
    const usage = buildUsageIndex([
      { item_code: '310371-O', site: 'NHC', country: 'KSA', qty_n: 12 },
      { item_code: '310371-O', site: 'AMAALA', country: 'KSA', qty_n: 24 },
      { item_code: '310371-O', site: 'NHC', country: 'UAE', qty_n: 240 },
      { item_code: 'X', site: 'NHC', country: 'KSA', qty_n: 'bad' },
    ])
    const nhc = usageFor({ item: { item_code: '310371-O' }, site: 'nhc', country: 'KSA', stock_qty: 3 }, usage, 12)
    expect(nhc).toEqual({ scope: 'site', avgPerMonth: 1, daysRemaining: 90 })
    const other = usageFor({ item: { item_code: '310371-O' }, site: 'JED', country: 'KSA', stock_qty: 3 }, usage, 12)
    expect(other.scope).toBe('country')
    // UAE issues never leak into a KSA row: (12 + 24) / 12 months.
    expect(other.avgPerMonth).toBe(3)
    expect(usageFor({ item: { item_code: '310371-O' }, site: 'NHC', country: 'UAE', stock_qty: 20 }, usage, 12).avgPerMonth).toBe(20)
    expect(other.daysRemaining).toBeNull()
    expect(usageFor({ item: { item_code: 'Z' }, site: 'NHC', country: 'KSA' }, usage).scope).toBe('none')
    expect(usageFor({ description: 'no code' }, usage)).toBeNull()
    expect(buildErpVelocityMap([{ id: 1, description: 'no code' }], usage)).toEqual({})
  })

  it('never suggests reordering zero when no levels are set', () => {
    expect(reorderSuggestion({ stock_qty: 5, min_level: 0 }, { daysRemaining: 10, avgPerMonth: 0.5 })).toBeNull()
    expect(reorderSuggestion({ stock_qty: 1, min_level: 0 }, { daysRemaining: 10, avgPerMonth: 3 })).toBe(5)
    const [row] = enrichStock([{ id: 1, stock_qty: 1, min_level: 0, critical_level: 0 }], { 1: { avgPerMonth: 3, daysRemaining: 10, scope: 'site' } })
    expect(row.usageScope).toBe('site')
  })

  it('counts coverage honestly', () => {
    const idx = buildCatalogIndex(canonical, [], [])
    const usage = buildUsageIndex([{ item_code: '310371-O', site: 'NHC', country: 'KSA', qty_n: 1 }])
    expect(registerCoverage([
      { item: { item_code: '310371-O' }, country: 'KSA' }, { item: { item_code: 'ZZ' }, country: 'KSA' }, { description: 'none' },
    ], idx, usage)).toEqual({ total: 3, noCode: 1, catalogued: 1, withUsage: 1 })
  })
})

describe('consumption read', () => {
  it('refuses a capped read instead of returning partial usage', async () => {
    vi.resetModules()
    vi.doMock('../lib/api/_client', async (orig) => ({ ...(await orig()), fetchAllPages: async () => ({ data: [{ id: 1 }], error: null, truncated: true }) }))
    const { listConsumptionSince } = await import('../lib/api/stock')
    await expect(listConsumptionSince('2025-11-23', { country: 'All' })).rejects.toThrow(/Too many issue lines/)
    vi.doUnmock('../lib/api/_client')
  })
})
