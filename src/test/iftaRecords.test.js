import { describe, it, expect } from 'vitest'
import { fuelEconomyKmPerL, byJurisdiction, summariseIfta, toFiniteNumber } from '../lib/iftaRecords'

describe('iftaRecords — fuelEconomyKmPerL', () => {
  it('computes distance / fuel', () => {
    expect(fuelEconomyKmPerL({ distance_km: 600, fuel_litres: 200 })).toBe(3)
    expect(fuelEconomyKmPerL({ distance_km: '1,000', fuel_litres: '250' })).toBe(4)
  })

  it('returns null when fuel is zero (divide-by-zero guard)', () => {
    expect(fuelEconomyKmPerL({ distance_km: 500, fuel_litres: 0 })).toBeNull()
  })

  it('returns null when distance or fuel is missing / non-numeric', () => {
    expect(fuelEconomyKmPerL({ distance_km: 500 })).toBeNull()
    expect(fuelEconomyKmPerL({ fuel_litres: 100 })).toBeNull()
    expect(fuelEconomyKmPerL({ distance_km: 'abc', fuel_litres: 10 })).toBeNull()
    expect(fuelEconomyKmPerL(null)).toBeNull()
  })
})

describe('iftaRecords — byJurisdiction', () => {
  it('returns [] for empty / non-array input', () => {
    expect(byJurisdiction([])).toEqual([])
    expect(byJurisdiction()).toEqual([])
    expect(byJurisdiction(null)).toEqual([])
  })

  it('aggregates distance, fuel, cost and taxable per jurisdiction', () => {
    const rows = [
      { jurisdiction: 'TX', distance_km: 300, fuel_litres: 100, fuel_cost: 150, taxable_km: 300 },
      { jurisdiction: 'TX', distance_km: 200, fuel_litres: 50, fuel_cost: 80, taxable_km: 200 },
      { jurisdiction: 'OK', distance_km: 100, fuel_litres: 40, fuel_cost: 60, taxable_km: 90 },
    ]
    const out = byJurisdiction(rows)
    expect(out).toHaveLength(2)
    const tx = out.find((j) => j.jurisdiction === 'TX')
    expect(tx).toMatchObject({ distanceKm: 500, fuelLitres: 150, fuelCost: 230, taxableKm: 500 })
  })

  it('sorts by distanceKm descending', () => {
    const rows = [
      { jurisdiction: 'OK', distance_km: 100 },
      { jurisdiction: 'TX', distance_km: 500 },
      { jurisdiction: 'NM', distance_km: 300 },
    ]
    expect(byJurisdiction(rows).map((j) => j.jurisdiction)).toEqual(['TX', 'NM', 'OK'])
  })

  it('groups blank / missing jurisdiction under "Unspecified"', () => {
    const rows = [
      { jurisdiction: '', distance_km: 50 },
      { distance_km: 70 },
      { jurisdiction: 'TX', distance_km: 500 },
    ]
    const out = byJurisdiction(rows)
    const un = out.find((j) => j.jurisdiction === 'Unspecified')
    expect(un.distanceKm).toBe(120)
  })

  it('coerces string numeric values', () => {
    const rows = [{ jurisdiction: 'TX', distance_km: '1,200', fuel_litres: '300' }]
    expect(byJurisdiction(rows)[0]).toMatchObject({ distanceKm: 1200, fuelLitres: 300 })
  })
})

describe('iftaRecords — summariseIfta', () => {
  it('returns zeroes / null for empty input', () => {
    expect(summariseIfta([])).toEqual({
      totalRecords: 0, totalDistanceKm: 0, totalFuelLitres: 0,
      totalFuelCost: 0, distinctJurisdictions: 0, avgKmPerL: null,
    })
    expect(summariseIfta()).toEqual({
      totalRecords: 0, totalDistanceKm: 0, totalFuelLitres: 0,
      totalFuelCost: 0, distinctJurisdictions: 0, avgKmPerL: null,
    })
  })

  it('totals distance, fuel, cost, distinct jurisdictions and fleet economy', () => {
    const rows = [
      { jurisdiction: 'TX', distance_km: 300, fuel_litres: 100, fuel_cost: 150 },
      { jurisdiction: 'TX', distance_km: 200, fuel_litres: 50, fuel_cost: 80 },
      { jurisdiction: 'OK', distance_km: 100, fuel_litres: 50, fuel_cost: 60 },
    ]
    const s = summariseIfta(rows)
    expect(s.totalRecords).toBe(3)
    expect(s.totalDistanceKm).toBe(600)
    expect(s.totalFuelLitres).toBe(200)
    expect(s.totalFuelCost).toBe(290)
    expect(s.distinctJurisdictions).toBe(2)
    expect(s.avgKmPerL).toBe(3)
  })

  it('avgKmPerL is null when no fuel recorded (divide-by-zero guard)', () => {
    const rows = [{ jurisdiction: 'TX', distance_km: 400, fuel_litres: 0 }]
    expect(summariseIfta(rows).avgKmPerL).toBeNull()
  })

  it('tolerates missing / string numeric fields', () => {
    const rows = [
      { jurisdiction: 'TX', distance_km: '500', fuel_litres: null, fuel_cost: '250' },
      { jurisdiction: 'OK', distance_km: null, fuel_litres: '250' },
    ]
    const s = summariseIfta(rows)
    expect(s.totalDistanceKm).toBe(500)
    expect(s.totalFuelLitres).toBe(250)
    expect(s.totalFuelCost).toBe(250)
    expect(s.avgKmPerL).toBe(2)
  })
})

describe('iftaRecords — toFiniteNumber', () => {
  it('parses numbers, numeric strings, and rejects junk', () => {
    expect(toFiniteNumber(42)).toBe(42)
    expect(toFiniteNumber('1,200')).toBe(1200)
    expect(toFiniteNumber('')).toBeNull()
    expect(toFiniteNumber(null)).toBeNull()
    expect(toFiniteNumber('abc')).toBeNull()
  })
})
