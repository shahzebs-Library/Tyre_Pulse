import { describe, it, expect } from 'vitest'
import { vehiclePhoto, vehicleKind, assetClassOf } from '../lib/vehiclePhoto'

describe('vehiclePhoto (mirror of the Flutter resolver)', () => {
  it('reads the asset class prefix', () => {
    expect(assetClassOf(' tm634 ')).toBe('TM')
    expect(assetClassOf('')).toBeNull()
  })
  it('uses the type before the asset prefix', () => {
    expect(vehicleKind({ asset_no: 'TM1', vehicle_type: 'Generator' })).toBe('generator')
    expect(vehicleKind({ asset_no: 'TM1' })).toBe('mixer')
  })
  it('lets a known model beat a broad imported type', () => {
    expect(vehicleKind({ vehicle_type: 'PICKUP', make: 'Toyota', model: 'Hiace' })).toBe('bus')
    expect(vehiclePhoto({ vehicle_type: 'PICKUP', make: 'Toyota', model: 'Hiace' })).toBe('/vehicle-photos/hiace-fleet.webp')
  })
  it('shows mixers and pumps by class', () => {
    expect(vehiclePhoto({ vehicle_type: 'TR-MIXER' })).toBe('/vehicle-photos/tri-mixer-perspective.webp')
    expect(vehiclePhoto({ asset_no: 'MP093' })).toBe('/vehicle-photos/concrete-pump.webp')
  })
  it('never shows branded art without the brand on record', () => {
    expect(vehiclePhoto({ vehicle_type: 'Generator', make: 'Cummins' })).toBeNull()
    expect(vehiclePhoto({ vehicle_type: 'Generator', make: 'SANY' })).toBe('/vehicle-photos/generator-fleet.webp')
    expect(vehiclePhoto({ vehicle_type: 'Pickup', make: 'Nissan' })).toBeNull()
  })
  it('returns null for unknown classes so an icon is drawn', () => {
    expect(vehiclePhoto({ asset_no: 'ZZ1' })).toBeNull()
    expect(vehiclePhoto({ vehicle_type: 'Trailer' })).toBeNull()
  })
  it('keeps fixed equipment off truck artwork', () => {
    expect(vehicleKind({ vehicle_type: 'STATIONARY PUMP' })).toBe('stationaryPump')
    expect(vehicleKind({ vehicle_type: 'PLACING BOOM' })).toBe('placingBoom')
  })
})
