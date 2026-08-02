import { describe, it, expect } from 'vitest'
import {
  normalizeRow,
  groupBySize,
  recommendationFor,
  formatNumber,
  formatCpk,
} from '../lib/brandSizeCpk'

/**
 * Fixtures below are REAL get_brand_size_cpk rows verified against the live DB
 * (KSA, size 315/80 R 22.5, 2026-08). The customer can hand-check them:
 * TECHKING avg 842.07 / 50,014 km -> cpk 0.01684 (median buy 766); DOUBLECOIN
 * avg 2831.94 / 52,841 km -> cpk 0.05359 (median buy 860); TEGRYS 1077.30 /
 * 34,493 km -> 0.03123. This is the user's own example: 766 Techking vs 860
 * "same size" - Techking wins on cost per km.
 */
const KSA_315 = [
  { size: '315/80 R 22.5', brand: 'TECHKING', tyres: 406, avg_price: 842.07, median_price: 766, avg_life_km: 50014, cpk: 0.01684, currency: 'SAR', country: 'KSA' },
  { size: '315/80 R 22.5', brand: 'TRIANGLE', tyres: 1120, avg_price: 956.41, median_price: 900, avg_life_km: 52968, cpk: 0.01806, currency: 'SAR', country: 'KSA' },
  { size: '315/80 R 22.5', brand: 'TEGRYS', tyres: 1395, avg_price: 1077.30, median_price: 900, avg_life_km: 34493, cpk: 0.03123, currency: 'SAR', country: 'KSA' },
  { size: '315/80 R 22.5', brand: 'DOUBLECOIN', tyres: 178, avg_price: 2831.94, median_price: 860, avg_life_km: 52841, cpk: 0.05359, currency: 'SAR', country: 'KSA' },
]

describe('normalizeRow', () => {
  it('coerces numeric fields and trims strings', () => {
    const r = normalizeRow(KSA_315[0])
    expect(r.brand).toBe('TECHKING')
    expect(r.avgPrice).toBe(842.07)
    expect(r.avgLifeKm).toBe(50014)
    expect(r.cpk).toBeCloseTo(0.01684, 5)
    expect(r.currency).toBe('SAR')
  })

  it('recomputes cpk when absent but price and life are present', () => {
    const r = normalizeRow({ ...KSA_315[0], cpk: null })
    expect(r.cpk).toBeCloseTo(842.07 / 50014, 6)
  })

  it('leaves cpk null when there is no life data (never fabricates 0)', () => {
    const r = normalizeRow({ size: 'X', brand: 'B', avg_price: 900, avg_life_km: null, cpk: null })
    expect(r.cpk).toBeNull()
    expect(r.avgLifeKm).toBeNull()
  })
})

describe('groupBySize - ranking and flags', () => {
  const groups = groupBySize(KSA_315)

  it('produces one group for the size', () => {
    expect(groups).toHaveLength(1)
    expect(groups[0].size).toBe('315/80 R 22.5')
    expect(groups[0].currency).toBe('SAR')
  })

  it('ranks brands by real CPK ascending (best value first)', () => {
    const order = groups[0].brands.map((b) => b.brand)
    expect(order).toEqual(['TECHKING', 'TRIANGLE', 'TEGRYS', 'DOUBLECOIN'])
  })

  it('flags the lowest-CPK brand as best value', () => {
    expect(groups[0].bestValueBrand).toBe('TECHKING')
    expect(groups[0].brands.find((b) => b.brand === 'TECHKING').isBestValue).toBe(true)
    expect(groups[0].brands.find((b) => b.brand === 'DOUBLECOIN').isBestValue).toBe(false)
  })

  it('flags the lowest purchase price as cheapest (separate from best value)', () => {
    // TECHKING avg 842.07 is the lowest avg_price here, and also best value.
    expect(groups[0].cheapestBrand).toBe('TECHKING')
  })

  it('computes the CPK gap percentage vs the best value', () => {
    const dc = groups[0].brands.find((b) => b.brand === 'DOUBLECOIN')
    // (0.05359 - 0.01684) / 0.01684 * 100 ~= 218.2 percent worse per km.
    expect(dc.cpkGapPct).toBeGreaterThan(200)
    const tk = groups[0].brands.find((b) => b.brand === 'TECHKING')
    expect(tk.cpkGapPct).toBe(0)
  })
})

describe('groupBySize - the cheaper-but-worse trap', () => {
  // A cheaper tyre that wears out fast is exposed as costing more per km.
  const rows = [
    { size: '11 R 22.5', brand: 'CHEAPFAST', tyres: 20, avg_price: 700, median_price: 700, avg_life_km: 20000, cpk: 0.035, currency: 'SAR', country: 'KSA' },
    { size: '11 R 22.5', brand: 'PRICEYLONG', tyres: 20, avg_price: 900, median_price: 900, avg_life_km: 60000, cpk: 0.015, currency: 'SAR', country: 'KSA' },
  ]
  const g = groupBySize(rows)[0]

  it('the cheapest to buy is not the best value', () => {
    expect(g.cheapestBrand).toBe('CHEAPFAST')
    expect(g.bestValueBrand).toBe('PRICEYLONG')
  })

  it('recommendation calls out the trap in plain English', () => {
    const text = recommendationFor(g)
    expect(text).toContain('CHEAPFAST')
    expect(text).toContain('PRICEYLONG')
    expect(text.toLowerCase()).toContain('per km')
    expect(text).not.toMatch(/[‒-―−]/) // no em/en/figure dashes
  })
})

describe('groupBySize - honest handling of missing life data', () => {
  const rows = [
    { size: '195 R 15', brand: 'HASLIFE', tyres: 5, avg_price: 400, median_price: 400, avg_life_km: 40000, cpk: 0.01, currency: 'SAR', country: 'KSA' },
    { size: '195 R 15', brand: 'NOLIFE', tyres: 3, avg_price: 300, median_price: 300, avg_life_km: null, cpk: null, currency: 'SAR', country: 'KSA' },
  ]
  const g = groupBySize(rows)[0]

  it('a null-cpk brand is ranked last and never best value', () => {
    expect(g.brands[g.brands.length - 1].brand).toBe('NOLIFE')
    expect(g.bestValueBrand).toBe('HASLIFE')
    expect(g.brands.find((b) => b.brand === 'NOLIFE').isBestValue).toBe(false)
  })

  it('marks the size thin when fewer than 2 brands have a measurable cpk', () => {
    expect(g.measurableBrands).toBe(1)
    expect(g.thin).toBe(true)
  })

  it('recommendation says there is nothing to compare against yet', () => {
    expect(recommendationFor(g).toLowerCase()).toContain('nothing to compare')
  })
})

describe('recommendationFor - no life anywhere', () => {
  const g = groupBySize([
    { size: 'Z', brand: 'A', tyres: 2, avg_price: 500, median_price: 500, avg_life_km: null, cpk: null, currency: 'SAR', country: 'KSA' },
  ])[0]
  it('falls back to purchase-price-only guidance', () => {
    const text = recommendationFor(g)
    expect(text.toLowerCase()).toContain('purchase price')
    expect(text.toLowerCase()).toContain('cannot be measured')
  })
})

describe('groupBySize - filters and empties', () => {
  it('drops rows without a size or brand', () => {
    expect(groupBySize([{ size: '', brand: 'X', cpk: 0.01, avg_price: 1, avg_life_km: 100 }])).toHaveLength(0)
    expect(groupBySize([{ size: 'A', brand: '', cpk: 0.01, avg_price: 1, avg_life_km: 100 }])).toHaveLength(0)
  })

  it('returns [] for empty or non-array input', () => {
    expect(groupBySize([])).toEqual([])
    expect(groupBySize(null)).toEqual([])
    expect(groupBySize(undefined)).toEqual([])
  })

  it('honours minTyres', () => {
    const rows = [
      { size: 'A', brand: 'THIN', tyres: 1, avg_price: 900, avg_life_km: 30000, cpk: 0.03, currency: 'SAR' },
      { size: 'A', brand: 'FAT', tyres: 50, avg_price: 900, avg_life_km: 60000, cpk: 0.015, currency: 'SAR' },
    ]
    const g = groupBySize(rows, { minTyres: 10 })[0]
    expect(g.brands.map((b) => b.brand)).toEqual(['FAT'])
  })

  it('sorts sizes so the strongest available value comes first', () => {
    const rows = [
      { size: 'BIG', brand: 'B', tyres: 10, avg_price: 900, avg_life_km: 30000, cpk: 0.03, currency: 'SAR' },
      { size: 'SMALL', brand: 'S', tyres: 10, avg_price: 400, avg_life_km: 40000, cpk: 0.01, currency: 'SAR' },
    ]
    expect(groupBySize(rows).map((g) => g.size)).toEqual(['SMALL', 'BIG'])
  })
})

describe('formatters', () => {
  it('formatNumber adds thousands separators and handles N/A', () => {
    expect(formatNumber(50014)).toBe('50,014')
    expect(formatNumber(null)).toBe('N/A')
  })

  it('formatCpk fixes 3 decimals with a currency prefix', () => {
    expect(formatCpk(0.01684, 'SAR ')).toBe('SAR 0.017')
    expect(formatCpk(null)).toBe('N/A')
  })
})
