import { describe, it, expect } from 'vitest'
import {
  sizeKey, parseSize, composeSize, sizeDimensions, tyreTypeOf, positionForTyreType,
  distinctBrands, distinctSizes, specUsage, usageStatus, specKpis, filterSpecs, filterScope,
  filterOptions, specCard, loadLabel, speedLabel, historyFor, clampPage, pageSlice, EMPTY_FILTERS,
} from '../lib/tyreSpecView'

const specs = [
  { id: 'a', vehicle_type: 'Mixer', position: 'Steer', approved_sizes: ['315/80R22.5'], approved_brands: ['Double Coin', 'Triangle'], min_load_index: 156, min_speed_index: 'L', ply_rating: '18PR' },
  { id: 'b', vehicle_type: 'Mixer', position: 'Drive', approved_sizes: ['315/80 r22.5', '12.00R24'], approved_brands: ['double coin'], min_load_index: '', min_speed_index: '' },
  { id: 'c', vehicle_type: 'Wheel Loader', position: 'Front (OTR)', approved_sizes: ['23.5R25'], approved_brands: ['Techking'] },
]

describe('size helpers', () => {
  it('folds spacing and case', () => {
    expect(sizeKey(' 315/80 r22.5 ')).toBe('315/80R22.5')
  })
  it('parses metric codes and refuses OTR codes', () => {
    expect(parseSize('315/80R22.5')).toEqual({ width: 315, aspect: 80, rim: 22.5 })
    expect(parseSize('23.5R25')).toBeNull()
    expect(parseSize('')).toBeNull()
  })
  it('composes only complete, plausible sizes', () => {
    expect(composeSize('385', '65', '22.5')).toBe('385/65R22.5')
    expect(composeSize('385', '', '22.5')).toBeNull()
    expect(composeSize('3', '65', '22.5')).toBeNull()
  })
  it('derives nominal geometry from the size code', () => {
    const d = sizeDimensions('315/80R22.5')
    expect(d.sectionWidth).toBe(315)
    expect(d.sidewall).toBe(252)
    expect(d.rimDiameter).toBe(572)
    expect(d.overallDiameter).toBe(1076)
    expect(sizeDimensions('12.00R24')).toBeNull()
  })
})

describe('tyre type', () => {
  it('maps positions to the mockup groups', () => {
    expect(tyreTypeOf('Steer')).toBe('Steer')
    expect(tyreTypeOf('Rear (OTR)')).toBe('Off-Road')
    expect(tyreTypeOf('Tag Axle')).toBe('Other')
  })
  it('keeps a compatible position when a segment is re-picked', () => {
    expect(positionForTyreType('Off-Road', 'Rear (OTR)')).toBe('Rear (OTR)')
    expect(positionForTyreType('Off-Road', 'Steer')).toBe('Front (OTR)')
    expect(positionForTyreType('Other', 'Tag Axle')).toBe('Tag Axle')
    expect(positionForTyreType('Drive', 'Tag Axle')).toBe('Drive')
  })
})

describe('register figures', () => {
  it('counts distinct brands and sizes case-insensitively', () => {
    expect(distinctBrands(specs)).toEqual(['Double Coin', 'Techking', 'Triangle'])
    expect(distinctSizes(specs)).toHaveLength(3)
  })
  it('never invents a pattern count and leaves fitted figures null without data', () => {
    const k = specKpis(specs, null)
    expect(k).toMatchObject({ total: 3, brands: 3, sizes: 3, patterns: null, approvedFitted: null })
    expect(specKpis(specs, { total: 5, approved: 3, nonConforming: 1 }).notApprovedFitted).toBe(1)
  })
})

describe('usage', () => {
  const rows = [
    { matchingSpec: { id: 'a' }, specStatus: 'Approved' },
    { matchingSpec: { id: 'a' }, specStatus: 'Non-Approved Brand' },
    { matchingSpec: { id: 'b' }, specStatus: 'Approved' },
    { specStatus: 'No Spec Defined' },
  ]
  const usage = specUsage(rows)
  it('groups fitted tyres by rule', () => {
    expect(usage.get('a')).toEqual({ fitted: 2, conforming: 1, nonConforming: 1 })
    expect(usageStatus(usage.get('a')).key).toBe('issues')
    expect(usageStatus(usage.get('b')).key).toBe('conforming')
    expect(usageStatus(usage.get('c')).key).toBe('unused')
  })
  it('filters by brand, size, type, application, status and search', () => {
    const f = (x) => filterSpecs(specs, { ...EMPTY_FILTERS, ...x }, usage).map((s) => s.id)
    expect(f({ brand: 'DOUBLE COIN' })).toEqual(['a', 'b'])
    expect(f({ size: '315/80R22.5' })).toEqual(['a', 'b'])
    expect(f({ tyreType: 'Off-Road' })).toEqual(['c'])
    expect(f({ vehicleType: 'Wheel Loader' })).toEqual(['c'])
    expect(f({ status: 'unused' })).toEqual(['c'])
    expect(f({ search: 'techk' })).toEqual(['c'])
    expect(filterScope({ ...EMPTY_FILTERS, brand: 'Triangle', status: 'issues' })).toBe('brand: Triangle, status: Out of spec fitments')
    expect(filterScope(EMPTY_FILTERS)).toBe('')
  })
  it('offers only options present on screen', () => {
    expect(filterOptions(specs).tyreTypes).toEqual(['Steer', 'Drive', 'Off-Road'])
  })
})

describe('card model', () => {
  it('labels load and speed from the ISO tables, N/A when blank', () => {
    const a = specCard(specs[0])
    expect(loadLabel(a)).toMatch(/^156 \(4,000 kg\)$/)
    expect(speedLabel(a)).toBe('L (120 km/h)')
    const b = specCard(specs[1])
    expect(loadLabel(b)).toBe('N/A')
    expect(speedLabel(b)).toBe('N/A')
  })
  it('matches history rows to a rule, newest first', () => {
    const h = [
      { id: 1, vehicle_type: 'Mixer', position: 'Steer' },
      { id: 2, vehicle_type: 'Mixer', position: 'Drive' },
      { id: 3, vehicle_type: 'Mixer', position: 'Steer' },
    ]
    expect(historyFor(specs[0], h).map((x) => x.id)).toEqual([3, 1])
    expect(historyFor(null, h)).toEqual([])
  })
  it('pages safely when the list shrinks', () => {
    expect(clampPage(5, 10, 4)).toBe(2)
    expect(pageSlice([1, 2, 3, 4, 5], 9, 2)).toEqual([5])
  })
})
