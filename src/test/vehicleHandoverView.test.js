import { describe, it, expect } from 'vitest'
import {
  EMPTY_WIZARD, zonesFromDamages, damagesFromZones, latestHandoverFor, previousReadings,
  validateStep, firstInvalidStep, stepState, buildHandoverPayload, readingDeltas,
  driverOptions, matchDriver, num,
} from '../lib/vehicleHandoverView'
import { damageCount } from '../lib/handoverReports'

const form = (patch = {}) => ({ ...EMPTY_WIZARD, asset_no: 'tm514', driver_name: 'Ali', ...patch })

describe('vehicleHandoverView', () => {
  it('num keeps blank as null and zero as zero', () => {
    expect(num('')).toBeNull()
    expect(num(null)).toBeNull()
    expect(num('0')).toBe(0)
    expect(num('1,250')).toBe(1250)
    expect(num('abc')).toBeNull()
  })

  it('stores only zones that are not good, and reads them back', () => {
    const zones = { front: 'good', left: 'minor_scratch', rear: 'damaged', right: 'good' }
    const damages = damagesFromZones(zones)
    expect(damages.map((d) => d.zone)).toEqual(['left', 'rear'])
    expect(damageCount({ damages })).toBe(2)
    expect(zonesFromDamages(damages)).toEqual(zones)
    expect(zonesFromDamages(null)).toEqual({ front: 'good', left: 'good', rear: 'good', right: 'good' })
    expect(zonesFromDamages([{ zone: 'roof', condition: 'damaged' }, 'x']).front).toBe('good')
  })

  it('finds the latest handover for an asset case-insensitively', () => {
    const rows = [
      { id: 1, asset_no: 'TM514', handover_at: '2026-01-01T00:00:00Z', odometer_km: 100 },
      { id: 2, asset_no: 'tm514 ', handover_at: '2026-03-01T00:00:00Z', odometer_km: 300 },
      { id: 3, asset_no: 'TM999', handover_at: '2026-05-01T00:00:00Z' },
      { id: 4, asset_no: 'TM514', handover_at: null },
    ]
    expect(latestHandoverFor(rows, 'TM514').id).toBe(2)
    expect(latestHandoverFor(rows, '')).toBeNull()
  })

  it('previous odometer is the higher of last handover and fleet register', () => {
    const a = previousReadings({ lastHandover: { odometer_km: 500, fuel_level_pct: 60 }, asset: { current_km: 400 } })
    expect(a).toMatchObject({ prevOdometer: 500, odometerSource: 'Last handover', prevFuel: 60 })
    const b = previousReadings({ lastHandover: { odometer_km: 300 }, asset: { current_km: 400 } })
    expect(b).toMatchObject({ prevOdometer: 400, odometerSource: 'Fleet register', prevFuel: null })
    const c = previousReadings({})
    expect(c).toMatchObject({ prevOdometer: null, prevFuel: null, engineHours: null })
    expect(previousReadings({ engineHours: { engine_hours: '1234', reading_date: '2026-09-01' } }).engineHours).toBe(1234)
  })

  it('refuses a current odometer below the previous reading', () => {
    const prev = { prevOdometer: 1000 }
    expect(validateStep(0, form({ odometer_km: '999' }), prev).join(' ')).toMatch(/lower than the previous/)
    expect(validateStep(0, form({ odometer_km: '1000' }), prev)).toEqual([])
    expect(validateStep(0, form({ odometer_km: '' }), prev)).toEqual([])
  })

  it('requires vehicle and driver, and a sane fuel level', () => {
    expect(validateStep(0, form({ asset_no: '' }), {}).length).toBe(1)
    expect(validateStep(0, form({ driver_name: '  ' }), {}).length).toBe(1)
    expect(validateStep(0, form({ fuel_level_pct: '120' }), {}).join(' ')).toMatch(/between 0 and 100/)
    expect(validateStep(2, form({ photo_url: 'javascript:alert(1)' }), {}).length).toBe(1)
    expect(firstInvalidStep(form({ asset_no: '' }), {})).toBe(0)
    expect(firstInvalidStep(form(), {})).toBe(-1)
  })

  it('step states', () => {
    expect([0, 1, 2].map((i) => stepState(i, 1))).toEqual(['done', 'active', 'todo'])
  })

  it('maps the chosen driver by handover type and builds the payload', () => {
    const out = buildHandoverPayload(form({
      other_party: 'Yard', odometer_km: '1200', fuel_level_pct: '', zones: { ...EMPTY_WIZARD.zones, rear: 'dent' }, signature: '<svg></svg>',
    }), { country: 'KSA' })
    expect(out).toMatchObject({
      asset_no: 'TM514', handover_type: 'checkout', to_driver: 'Ali', from_driver: 'Yard',
      odometer_km: 1200, fuel_level_pct: null, damage_count: 1, signature_url: '<svg></svg>', country: 'KSA',
    })
    const back = buildHandoverPayload(form({ handover_type: 'checkin' }), { country: 'All' })
    expect(back).toMatchObject({ from_driver: 'Ali', to_driver: null, damages: null, damage_count: 0, country: null })
  })

  it('reading deltas are null when a side is unknown', () => {
    expect(readingDeltas(form({ odometer_km: '1500', fuel_level_pct: '40' }), { prevOdometer: 1000, prevFuel: 70 }))
      .toEqual({ kmSince: 500, fuelChange: -30 })
    expect(readingDeltas(form(), {})).toEqual({ kmSince: null, fuelChange: null })
  })

  it('driver options sort active first and match by name or id', () => {
    const opts = driverOptions([
      { id: 1, driver_id: 'D2', driver_name: 'Zaid', status: 'active', phone: '050' },
      { id: 2, driver_id: 'D1', driver_name: 'Adel', status: 'inactive' },
      { id: 3, driver_id: 'D3', driver_name: 'Bilal' },
      { id: 4 },
    ])
    expect(opts.map((o) => o.name)).toEqual(['Bilal', 'Zaid', 'Adel'])
    expect(matchDriver(opts, 'zaid').phone).toBe('050')
    expect(matchDriver(opts, 'd3').name).toBe('Bilal')
    expect(matchDriver(opts, 'nobody')).toBeNull()
  })
})
