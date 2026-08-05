/**
 * The diagram decides how many tyres an inspector is asked to record. Getting
 * it wrong is not cosmetic: too few and real tyres go uninspected, too many and
 * the inspector is asked for wheels that do not exist.
 *
 * Every case below is a REAL vehicle_type value from vehicle_fleet, with the
 * asset count that was live when it was written. Keep it that way - a fixture
 * invented in a test file proves nothing about this fleet.
 */
import {
  resolveVehicleType, isTyrelessEquipment, LAYOUTS, diagramPositions,
} from '../lib/tyreDiagramLayouts'

const tyreCount = (vt: string): number =>
  isTyrelessEquipment(vt) ? 0 : (LAYOUTS as any)[resolveVehicleType(vt)]?.tyres?.length ?? 0

describe('a descriptive type is never read as an asset code', () => {
  // The asset-code shortcut matched leading letters alone, so any type starting
  // with PL/SL/WL/TM/MP was silently routed by prefix before the keyword rules
  // could read the words. It now requires letters followed by a digit.
  it('a descriptive name starting with a prefix code is not routed by it', () => {
    expect(resolveVehicleType('PLACING BOOM')).not.toBe('Pickup')
    expect(resolveVehicleType('SLURRY TANKER')).not.toBe('Skid loader')
  })

  it('still honours a genuine asset code, which is why the shortcut exists', () => {
    expect(resolveVehicleType('TM634')).toBe('Tri-mixer')
    expect(resolveVehicleType('MP083')).toBe('Concrete pump')
    expect(resolveVehicleType('PL12')).toBe('Pickup')
  })

  it('requires a digit, so any future descriptive name is safe', () => {
    // These must fall through to the keyword rules, not the prefix map.
    expect(resolveVehicleType('SLURRY TANKER')).toBe('Tanker')         // not SL -> Skid loader
    expect(resolveVehicleType('WLD WORKSHOP TRUCK')).toBe('Truck 6x4') // not WL -> Wheel loader
  })
})

describe('equipment with no wheels asks for no tyres', () => {
  // Every plant spelling in the register, plus the placing boom, which is
  // mast-mounted concrete gear and NOT the truck-mounted pump it used to
  // borrow 14 tyres from.
  it.each([
    'PLACING BOOM', 'BT-PLANT', 'ICE PLANT', 'WATER TREATMENT PLANT',
    'BATCHING PLANT', 'BUILDINGS', 'GENERATOR', 'CHILLER', 'RECLAIMER',
  ])('%s asks for zero tyres', (vt) => {
    expect(isTyrelessEquipment(vt)).toBe(true)
    expect(tyreCount(vt)).toBe(0)
    // The inspection form must agree with the diagram, or it would still list
    // positions for a machine the diagram refuses to draw.
    expect(diagramPositions(vt)).toEqual([])
  })

  it('does not swallow a real wheeled machine', () => {
    expect(isTyrelessEquipment('TR-MIXER')).toBe(false)
    expect(isTyrelessEquipment('LINE PUMP')).toBe(false)
    expect(isTyrelessEquipment('PUMPS')).toBe(false)
  })
})

describe('counts corrected by the fleet owner', () => {
  // Both of these used to resolve to the 10-tyre 6x4 layout. The owner
  // confirmed the real chassis, so an inspector is now asked for the tyres
  // the vehicle actually carries.
  it('LINE PUMP carries 12 and reads as a pump, not a 10-tyre truck', () => {
    expect(resolveVehicleType('LINE PUMP')).toBe('Line pump')
    expect(tyreCount('LINE PUMP')).toBe(12)
    // "shown as a pump" was the explicit ask: it must keep the pump body art.
    expect((LAYOUTS as any)['Line pump'].bodyKey).toBe('concretePump')
  })

  it('a tanker is a 6-tyre 2-axle rigid, not a 10-tyre 6x4', () => {
    expect(tyreCount('D TANKER')).toBe(6)
    expect(tyreCount('DIESEL TANKER')).toBe(6)
    expect(tyreCount('WATER TANKER')).toBe(6)
  })

  it('spider pump is untouched and still a 6x4', () => {
    expect(tyreCount('SPIDER PUMP')).toBe(10)
  })

  it('a trailer is 2 dual axles, 8 tyres, no steer axle', () => {
    expect(resolveVehicleType('TRAILER')).toBe('Trailer')
    expect(tyreCount('TRAILER')).toBe(8)
    const ids = diagramPositions('TRAILER')
    expect(ids).toHaveLength(8)
    expect(ids.some(id => id.startsWith('F'))).toBe(false) // no steer axle
  })

  it('a forklift keeps its 4', () => {
    expect(tyreCount('FORKLIFT')).toBe(4)
  })
})

// The register uses "HEAVY EQP" as a catch-all: it currently covers four wheel
// loaders, a skid loader and an ice plant. In those rows the asset number is
// the only thing that says what the machine is.
describe('a junk catch-all type falls back to the asset number', () => {
  it.each([
    ['WL003', 'Wheel loader'], ['WL006', 'Wheel loader'],
    ['WL011', 'Wheel loader'], ['WL018', 'Wheel loader'],
    ['SL001', 'Skid loader'],
  ])('HEAVY EQP / %s -> %s', (asset, expected) => {
    expect(resolveVehicleType('HEAVY EQP', asset)).toBe(expected)
  })

  it('a real type is never overridden by the asset number', () => {
    // TR-MIXER wins even though DT001 would resolve to something else.
    expect(resolveVehicleType('TR-MIXER', 'DT001')).toBe('Tri-mixer')
    expect(resolveVehicleType('PICKUP', 'WL003')).toBe('Pickup')
  })

  it('still falls back to a pickup when neither says anything', () => {
    expect(resolveVehicleType('HEAVY EQP', 'ZZ999')).toBe('Pickup')
    expect(resolveVehicleType('HEAVY EQP')).toBe('Pickup')
  })

  it('the truck-mounted concrete pump still carries 14', () => {
    expect(tyreCount('PUMPS')).toBe(14)
  })

  // A placing boom is NOT a truck-mounted pump. It briefly borrowed that
  // pump's 14 tyres; it has none of its own.
  it('a placing boom carries no tyres at all', () => {
    expect(tyreCount('PLACING BOOM')).toBe(0)
  })
})

describe('the live fleet resolves to the expected tyre count', () => {

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
