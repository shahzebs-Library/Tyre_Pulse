import { describe, it, expect } from 'vitest'
import { isPoolTyre, isRemovedOrScrapped, summarizePool } from '../lib/tyrePool'

describe('tyrePool.isPoolTyre', () => {
  it('treats unassigned (no asset_no) in-service tyres as pool tyres', () => {
    expect(isPoolTyre({ id: 1, brand: 'X', asset_no: null })).toBe(true)
    expect(isPoolTyre({ id: 2, brand: 'X', asset_no: '' })).toBe(true)
    expect(isPoolTyre({ id: 3, brand: 'X', asset_no: '   ' })).toBe(true)
  })

  it('excludes tyres fitted to a vehicle (asset_no assigned)', () => {
    expect(isPoolTyre({ id: 4, asset_no: 'TRK-01' })).toBe(false)
  })

  it('includes tyres whose status marks them spare/stock/available even if odd', () => {
    expect(isPoolTyre({ id: 5, asset_no: 'TRK-01', status: 'Spare' })).toBe(true)
    expect(isPoolTyre({ id: 6, asset_no: 'TRK-01', status: 'in stock' })).toBe(true)
    expect(isPoolTyre({ id: 7, asset_no: 'TRK-01', status: 'AVAILABLE' })).toBe(true)
  })

  it('excludes removed / scrapped tyres regardless of assignment or status', () => {
    expect(isPoolTyre({ id: 8, asset_no: null, removal_date: '2025-01-01' })).toBe(false)
    expect(isPoolTyre({ id: 9, asset_no: null, km_at_removal: 90000 })).toBe(false)
    expect(isPoolTyre({ id: 10, asset_no: null, category: 'Scrap' })).toBe(false)
    expect(isPoolTyre({ id: 11, asset_no: null, status: 'Scrapped' })).toBe(false)
    // A "spare" status does NOT resurrect a removed tyre.
    expect(isPoolTyre({ id: 12, asset_no: null, status: 'spare', removal_date: '2025-01-01' })).toBe(false)
  })

  it('is null-safe', () => {
    expect(isPoolTyre(null)).toBe(false)
    expect(isPoolTyre(undefined)).toBe(false)
    expect(isRemovedOrScrapped(null)).toBe(false)
  })
})

describe('tyrePool.summarizePool', () => {
  const fixture = [
    // Pool: unassigned, in-service
    { id: 1, brand: 'Michelin', size: '315/80R22.5', site: 'Dubai', asset_no: null, cost_per_tyre: 1000 },
    { id: 2, brand: 'Michelin', size: '315/80R22.5', site: 'Dubai', asset_no: '', cost_per_tyre: 1200 },
    // Pool: explicit spare status even though asset_no set
    { id: 3, brand: 'Bridgestone', size: '295/80R22.5', site: 'Abu Dhabi', asset_no: 'TRK-9', status: 'spare', cost_per_tyre: 800 },
    // Pool: unassigned, no site -> Unassigned bucket, no cost
    { id: 4, brand: 'Michelin', size: '295/80R22.5', site: null, asset_no: null },
    // NOT pool: fitted to a vehicle
    { id: 5, brand: 'Goodyear', size: '315/80R22.5', site: 'Dubai', asset_no: 'TRK-1', cost_per_tyre: 900 },
    // NOT pool: removed
    { id: 6, brand: 'Michelin', size: '315/80R22.5', site: 'Dubai', asset_no: null, removal_date: '2025-06-01', cost_per_tyre: 500 },
    // NOT pool: scrapped by category
    { id: 7, brand: 'Bridgestone', size: '295/80R22.5', site: 'Dubai', asset_no: null, category: 'Scrap', cost_per_tyre: 400 },
  ]

  it('filters to pool tyres and totals count + value', () => {
    const s = summarizePool(fixture)
    expect(s.totalTyres).toBe(4) // ids 1,2,3,4
    expect(s.pool.map((r) => r.id).sort()).toEqual([1, 2, 3, 4])
    // Value sums cost_per_tyre of pool tyres only: 1000 + 1200 + 800 + 0 = 3000
    expect(s.totalValue).toBe(3000)
  })

  it('groups by brand with counts and value, sorted by count desc', () => {
    const s = summarizePool(fixture)
    expect(s.distinctBrands).toBe(2) // Michelin, Bridgestone
    expect(s.byBrand[0]).toMatchObject({ key: 'Michelin', count: 3, value: 2200 })
    const bridgestone = s.byBrand.find((b) => b.key === 'Bridgestone')
    expect(bridgestone).toMatchObject({ count: 1, value: 800 })
  })

  it('groups by size and by site, collapsing blanks into fallbacks', () => {
    const s = summarizePool(fixture)
    expect(s.distinctSizes).toBe(2)
    const bySite = Object.fromEntries(s.bySite.map((g) => [g.key, g.count]))
    expect(bySite.Dubai).toBe(2)      // ids 1, 2
    expect(bySite['Abu Dhabi']).toBe(1) // id 3
    expect(bySite.Unassigned).toBe(1)   // id 4 (null site)
  })

  it('handles empty / non-array input', () => {
    const s = summarizePool([])
    expect(s.totalTyres).toBe(0)
    expect(s.totalValue).toBe(0)
    expect(s.byBrand).toEqual([])
    expect(summarizePool(null).totalTyres).toBe(0)
  })
})
