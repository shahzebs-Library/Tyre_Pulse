import { describe, it, expect } from 'vitest'
import {
  co2NewTyre, classOfVehicleType, intensityBand, retreadSavingBand,
  computeLifecycleCarbon, CO2_FACTORS, EMISSIONS_FACTOR_KG_PER_KM,
  KG_CO2_PER_TREE_YEAR,
} from '../lib/carbon'

// Today (within any sensible period window) so the roll-up is deterministic.
const TODAY = new Date().toISOString().slice(0, 10)

describe('co2NewTyre', () => {
  it('sums manufacturing(class) + transport + end-of-life', () => {
    expect(co2NewTyre('heavy_truck')).toBe(32 + CO2_FACTORS.transport_to_uae + CO2_FACTORS.end_of_life) // 39.5
    expect(co2NewTyre('trailer')).toBe(35.5)
    expect(co2NewTyre('bus')).toBe(37.5)
    expect(co2NewTyre('van')).toBe(23.5)
    expect(co2NewTyre('pickup')).toBe(21.5)
    expect(co2NewTyre('light_vehicle')).toBe(25.5)
  })
  it('falls back to the default manufacturing factor for unknown classes', () => {
    expect(co2NewTyre('spaceship')).toBe(32.5) // 25 + 2.5 + 5
    expect(co2NewTyre(undefined)).toBe(32.5)
  })
})

describe('classOfVehicleType', () => {
  it('maps free-text vehicle types onto the seven canonical classes', () => {
    expect(classOfVehicleType('Heavy Truck')).toBe('heavy_truck')
    expect(classOfVehicleType('Tipper Truck')).toBe('heavy_truck')
    expect(classOfVehicleType('Prime Mover')).toBe('heavy_truck')
    expect(classOfVehicleType('Semi-Trailer')).toBe('trailer')
    expect(classOfVehicleType('Flatbed Trailer')).toBe('trailer')
    expect(classOfVehicleType('Bus')).toBe('bus')
    expect(classOfVehicleType('Panel Van')).toBe('van')
    expect(classOfVehicleType('Pickup')).toBe('pickup')
    expect(classOfVehicleType('Double Cab')).toBe('pickup')
    expect(classOfVehicleType('Sedan')).toBe('light_vehicle')
    expect(classOfVehicleType('4x4 SUV')).toBe('light_vehicle')
  })
  it('defaults on empty / unknown input', () => {
    expect(classOfVehicleType('')).toBe('default')
    expect(classOfVehicleType(null)).toBe('default')
    expect(classOfVehicleType('mystery machine')).toBe('default')
  })
  it('prefers pickup over the generic truck match', () => {
    expect(classOfVehicleType('Pickup Truck')).toBe('pickup')
  })
})

describe('intensityBand', () => {
  it('bands kg CO2/km per the lifecycle thresholds', () => {
    expect(intensityBand(0.20).band).toBe('compliant')
    expect(intensityBand(0.25).band).toBe('compliant')
    expect(intensityBand(0.30).band).toBe('elevated')
    expect(intensityBand(0.45).band).toBe('elevated')
    expect(intensityBand(0.50).band).toBe('high')
    expect(intensityBand(0.70).band).toBe('high')
    expect(intensityBand(0.90).band).toBe('critical')
  })
  it('returns unknown for null / negative intensity', () => {
    expect(intensityBand(null).band).toBe('unknown')
    expect(intensityBand(-1).band).toBe('unknown')
    expect(intensityBand(null).intensityKgPerKm).toBeNull()
  })
})

describe('retreadSavingBand', () => {
  it('bands retread percentage', () => {
    expect(retreadSavingBand(35).band).toBe('excellent')
    expect(retreadSavingBand(30).band).toBe('excellent')
    expect(retreadSavingBand(20).band).toBe('good')
    expect(retreadSavingBand(8).band).toBe('low')
    expect(retreadSavingBand(2).band).toBe('minimal')
    expect(retreadSavingBand(null).band).toBe('unknown')
  })
})

describe('computeLifecycleCarbon — net/ESG roll-up', () => {
  const vehicles = [
    { asset_no: 'A1', vehicle_type: 'Heavy Truck', is_active: true, current_km: 100000 },
    { asset_no: 'A2', vehicle_type: 'Trailer', status: 'active', current_km: 50000 },
    { asset_no: 'A3', vehicle_type: 'Van', is_active: false, current_km: 10000 }, // inactive → not counted
  ]
  const tyres = [
    { asset_no: 'A1', qty: 2, status: 'in_service', pressure_reading: 90, issue_date: TODAY },
    { asset_no: 'A2', qty: 0, status: 'in_service', pressure_reading: 80, issue_date: TODAY }, // low pressure
    { asset_no: 'A1', qty: 1, category: 'retread', status: 'in_service', pressure_reading: 100, issue_date: TODAY },
    { asset_no: 'A3', qty: 1, status: 'scrap', issue_date: TODAY }, // scrapped (van class)
    { asset_no: 'UNKNOWN', qty: 1, status: 'in_service', pressure_reading: 70, issue_date: TODAY }, // default class, low pressure
  ]
  const r = computeLifecycleCarbon({ tyres, vehicles, periodDays: 365 })

  it('counts active vehicles and new tyres in period', () => {
    expect(r.fleetStats.totalVehicles).toBe(2)
    expect(r.fleetStats.newTyresPeriod).toBe(6) // 2 + 1(qty0→1) + 1 + 1 + 1
    expect(r.fleetStats.retreadsPeriod).toBe(1)
    expect(r.fleetStats.scrappedPeriod).toBe(1)
    expect(r.fleetStats.lowPressureCurrently).toBe(2) // A2 + UNKNOWN
  })

  it('computes embedded new-tyre CO2 by class', () => {
    // heavy_truck count 3 × 39.5 = 118.5; trailer 1 × 35.5; van 1 × 23.5; default 1 × 32.5
    expect(r.summary.totalCo2NewKg).toBe(210)
    expect(r.tyreBreakdown[0].applicationClass).toBe('heavy_truck')
    expect(r.tyreBreakdown[0].totalCo2Kg).toBe(118.5)
  })

  it('computes retread saving, under-inflation, scrapped and net carbon', () => {
    expect(r.summary.co2SavedRetreadingKg).toBe(20) // 1 × 20
    expect(r.summary.co2FromScrappedKg).toBe(5) // 1 × 5
    // underinflation: 2 low × (2 veh × 400 × 365 / 10000) × 8 = 2 × 29.2 × 8 = 467.2
    expect(r.summary.co2FromUnderinflationKg).toBe(467.2)
    expect(r.summary.totalCo2GrossKg).toBe(682.2) // 210 + 467.2 + 5
    expect(r.summary.totalCo2NetKg).toBe(662.2) // gross − 20
  })

  it('scores ESG and certification readiness', () => {
    expect(r.summary.retreadRatePct).toBe(50) // 1/(1+1)
    expect(r.summary.esgScore).toBe(71.2)
    expect(r.summary.certificationReady).toBe(true)
    expect(r.retreadFromTextOnly).toBe(false) // came from category, not text
  })

  it('derives tree and driving equivalents (22 kg/tree, 0.12 kg/km)', () => {
    expect(KG_CO2_PER_TREE_YEAR).toBe(22)
    expect(r.equivalents.treesSavedRetreading).toBe(1) // round(20/22)
    expect(r.equivalents.treesEmitted).toBe(30) // round(662.2/22)
    expect(r.equivalents.drivingEquivalentKm).toBe(5518) // round(662.2/0.12)
  })

  it('builds the by-class operational emissions view and fleet intensity band', () => {
    const heavy = r.byClassEmissions.find((x) => x.applicationClass === 'heavy_truck')
    expect(heavy.co2Kg).toBe(100000 * EMISSIONS_FACTOR_KG_PER_KM.heavy_truck) // 95000
    // intensity = (95000 + 42500) / (100000 + 50000) = 0.9166… → critical
    expect(r.intensity.fleetIntensityKgPerKm).toBeCloseTo(0.917, 3)
    expect(r.intensity.band.band).toBe('critical')
  })

  it('emits a 12-month trend and honest defaults on empty input', () => {
    expect(r.monthlyTrend).toHaveLength(12)
    const empty = computeLifecycleCarbon({ tyres: [], vehicles: [], periodDays: 365 })
    expect(empty.summary.totalCo2NetKg).toBe(0)
    // no data: retread 0 (×0.4) + pressureCompliance 100 (×0.4) + net-floor 100 (×0.2) = 60
    expect(empty.summary.esgScore).toBe(60)
    expect(empty.tyreBreakdown).toEqual([])
    expect(empty.intensity.band.band).toBe('unknown')
  })

  it('flags retread signal derived only from free-text reasons', () => {
    const textOnly = computeLifecycleCarbon({
      vehicles,
      tyres: [{ asset_no: 'A1', qty: 1, status: 'removed', reason_for_removal: 'Sent for retread' }],
      periodDays: 365,
    })
    expect(textOnly.fleetStats.retreadsPeriod).toBe(1)
    expect(textOnly.retreadFromTextOnly).toBe(true)
  })
})
