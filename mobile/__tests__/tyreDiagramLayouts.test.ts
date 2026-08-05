/**
 * The diagram decides how many tyres an inspector is asked to record. Getting
 * it wrong is not cosmetic: too few and real tyres go uninspected, too many and
 * the inspector is asked for wheels that do not exist.
 *
 * Every case below is a REAL vehicle_type value from vehicle_fleet, with the
 * asset count that was live when it was written. Keep it that way - a fixture
 * invented in a test file proves nothing about this fleet.
 */
import { resolveVehicleType, isTyrelessEquipment, LAYOUTS } from '../lib/tyreDiagramLayouts'

const tyreCount = (vt: string): number =>
  isTyrelessEquipment(vt) ? 0 : (LAYOUTS as any)[resolveVehicleType(vt)]?.tyres?.length ?? 0

describe('a descriptive type is never read as an asset code', () => {
  // THE BUG THIS LOCKS: the asset-code shortcut matched leading letters alone,
  // so "PLACING BOOM" hit the PL -> Pickup rule and drew 4 tyres for a machine
  // that carries 14. It ran before the keyword rules could see "boom".
  it('PLACING BOOM is a concrete pump, not a PL pickup', () => {
    expect(resolveVehicleType('PLACING BOOM')).toBe('Concrete pump')
    expect(tyreCount('PLACING BOOM')).toBe(14)
  })

  it('still honours a genuine asset code, which is why the shortcut exists', () => {
    expect(resolveVehicleType('TM634')).toBe('Tri-mixer')
    expect(resolveVehicleType('MP083')).toBe('Concrete pump')
    expect(resolveVehicleType('PL12')).toBe('Pickup')
  })

  it('requires a digit, so any future descriptive name is safe', () => {
    // These must fall through to the keyword rules, not the prefix map.
    expect(resolveVehicleType('SLURRY TANKER')).toBe('Truck 6x4')   // not SL -> Skid loader
    expect(resolveVehicleType('WLD WORKSHOP TRUCK')).toBe('Truck 6x4') // not WL -> Wheel loader
  })
})

describe('fixed installations have no wheels', () => {
  it.each(['BUILDINGS', 'WATER TREATMENT PLANT', 'GENERATOR', 'BT-PLANT', 'ICE PLANT', 'CHILLER'])(
    '%s asks for zero tyres', (vt) => {
      expect(isTyrelessEquipment(vt)).toBe(true)
      expect(tyreCount(vt)).toBe(0)
    })
})

describe('the live fleet resolves to the expected tyre count', () => {
  // 10 tyres is CORRECT for a 6x4 chassis - these are not bugs.
  it.each([
    ['SPIDER PUMP', 10], ['LINE PUMP', 10], ['D TANKER', 10],
  ])('%s -> %i tyres (6x4 chassis)', (vt, n) => expect(tyreCount(vt as string)).toBe(n))

  it.each([
    ['TR-MIXER', 12], ['PUMPS', 14], ['BUS', 6],
    ['WHEEL_LOADER', 4], ['SKID LOADER', 4], ['PICKUP', 4],
  ])('%s -> %i tyres', (vt, n) => expect(tyreCount(vt as string)).toBe(n))

  it('an unknown type never invents axles', () => {
    // Deliberate: guessing extra axles asks for tyres that may not exist.
    expect(tyreCount('SOMETHING NOBODY MAPPED')).toBe(4)
    expect(tyreCount('')).toBe(4)
  })
})
