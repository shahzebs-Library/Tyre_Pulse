import { describe, it, expect } from 'vitest'
import {
  computeCarbon, rowLitres, treesToOffset,
  DIESEL_KG_PER_L, DEFAULT_CONSUMPTION_L_PER_100KM,
} from '../lib/carbon'

describe('rowLitres', () => {
  it('prefers metered litres over distance estimate', () => {
    expect(rowLitres({ litres: 100, distance_km: 5000 })).toBe(100)
  })

  it('estimates litres from distance × consumption when metered litres absent', () => {
    // 1000 km at 35 L/100km = 350 L
    expect(rowLitres({ distance_km: 1000 })).toBeCloseTo(350, 6)
    expect(rowLitres({ distance_km: 1000 }, DEFAULT_CONSUMPTION_L_PER_100KM)).toBeCloseTo(350, 6)
  })

  it('returns 0 when neither litres nor usable distance exist', () => {
    expect(rowLitres({})).toBe(0)
    expect(rowLitres({ distance_km: 0 })).toBe(0)
    expect(rowLitres({ distance_km: -50 })).toBe(0)
  })
})

describe('computeCarbon', () => {
  const fixture = [
    // Two records for TRK-1 at Riyadh (Jan + Feb 2025)
    { vehicle: 'TRK-1', site: 'Riyadh', date: '2025-01-15', distance_km: 1000 }, // 350 L
    { vehicle: 'TRK-1', site: 'Riyadh', date: '2025-02-10', distance_km: 2000 }, // 700 L
    // One record for TRK-2 at Jeddah with metered litres
    { vehicle: 'TRK-2', site: 'Jeddah', date: '2025-01-20', litres: 500 },       // 500 L
    // Unusable row — no distance, no litres — contributes nothing
    { vehicle: 'TRK-3', site: 'Dammam', date: '2025-01-05' },
  ]

  it('totals litres and applies the diesel emission factor', () => {
    const r = computeCarbon(fixture)
    expect(r.totalLitres).toBeCloseTo(1550, 6) // 350 + 700 + 500
    expect(r.totalCo2).toBeCloseTo(1550 * DIESEL_KG_PER_L, 4)
    expect(r.totalDistanceKm).toBeCloseTo(3000, 6)
  })

  it('counts only vehicles that contributed emissions', () => {
    const r = computeCarbon(fixture)
    expect(r.vehicleCount).toBe(2) // TRK-3 excluded (no usable fuel)
  })

  it('aggregates by month chronologically', () => {
    const { byMonth } = computeCarbon(fixture)
    expect(byMonth.map((m) => m.key)).toEqual(['2025-01', '2025-02'])
    // Jan = TRK-1 350 L + TRK-2 500 L = 850 L
    expect(byMonth[0].litres).toBeCloseTo(850, 4)
    expect(byMonth[0].co2).toBeCloseTo(850 * DIESEL_KG_PER_L, 2)
    expect(byMonth[0].label).toBe('Jan 2025')
    // Feb = TRK-1 700 L
    expect(byMonth[1].litres).toBeCloseTo(700, 4)
  })

  it('aggregates by site ranked by CO2 desc with distinct vehicle counts', () => {
    const { bySite } = computeCarbon(fixture)
    expect(bySite[0].site).toBe('Riyadh')  // 1050 L
    expect(bySite[0].vehicles).toBe(1)
    expect(bySite[1].site).toBe('Jeddah')  // 500 L
    expect(bySite.find((s) => s.site === 'Dammam')).toBeUndefined()
  })

  it('aggregates by vehicle ranked by CO2 desc', () => {
    const { byVehicle } = computeCarbon(fixture)
    expect(byVehicle[0].vehicle).toBe('TRK-1') // 1050 L
    expect(byVehicle[0].site).toBe('Riyadh')
    expect(byVehicle[1].vehicle).toBe('TRK-2') // 500 L
  })

  it('supports asset_no / issue_date field aliases from tyre_records', () => {
    const r = computeCarbon([
      { asset_no: 'A1', site: 'S1', issue_date: '2025-03-01', distance_km: 1000 },
    ])
    expect(r.byVehicle[0].vehicle).toBe('A1')
    expect(r.byMonth[0].key).toBe('2025-03')
  })

  it('honours an emission-factor override', () => {
    const r = computeCarbon([{ litres: 100, date: '2025-01-01', site: 'X', vehicle: 'V' }], { emissionFactor: 1 })
    expect(r.totalCo2).toBeCloseTo(100, 6)
  })

  it('returns a safe empty shape for no rows', () => {
    const r = computeCarbon([])
    expect(r).toEqual({
      totalCo2: 0, totalLitres: 0, totalDistanceKm: 0, vehicleCount: 0,
      byMonth: [], bySite: [], byVehicle: [],
    })
    expect(computeCarbon(null).totalCo2).toBe(0)
  })
})

describe('treesToOffset', () => {
  it('converts CO2 kg to trees over a year', () => {
    expect(treesToOffset(1000)).toBe(21) // 1 tonne ≈ 21 trees
    expect(treesToOffset(0)).toBe(0)
  })
})
