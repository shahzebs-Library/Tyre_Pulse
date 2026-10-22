/**
 * Tyre-position labels vs the vehicle map, for EVERY layout the app can draw.
 *
 * The AI inspection screen, its Excel export and the damage report all call
 * displayPositionCode(vehicleTypeHint, storedSlot). If a layout maps two slots to one
 * canonical code, or a canonical code does not round trip back to its slot, a report
 * names the wrong wheel. These tests lock that for every layout key and every slot.
 */
import { describe, it, expect } from 'vitest'
import { LAYOUT_KEYS, LAYOUT_SLOTS, resolveLayoutKey, layoutSlotsFor } from '../lib/vehicleTyreLayout'
import {
  slotDisplayCode, canonicalToSlotId, displayPositionCode, inspectionTypeHint, layoutPositionsFor,
} from '../lib/tyreBay'

const CANONICAL = /^(LH|RH)(F\d|R\d|C|CO|CI|RO|RI|R\d-[IO])$|^(LH|RH)(F\d|R\d(-[IO])?|CO|CI|RO|RI)$/

describe('every layout: slot <-> canonical code round trip', () => {
  it('knows all layouts', () => { expect(LAYOUT_KEYS.length).toBeGreaterThanOrEqual(10) })

  for (const key of LAYOUT_KEYS) {
    describe(key, () => {
      const slots = LAYOUT_SLOTS[key]
      it('resolves to itself', () => { expect(resolveLayoutKey(key)).toBe(key) })
      it('gives every slot a distinct canonical code', () => {
        const codes = slots.map(slot => slotDisplayCode(key, slot))
        expect(new Set(codes).size).toBe(slots.length)
        for (const c of codes) expect(c).toMatch(CANONICAL)
      })
      it('round trips slot -> code -> slot', () => {
        for (const slot of slots) {
          const code = slotDisplayCode(key, slot)
          expect(canonicalToSlotId(key, code)).toBe(slot)
          // already-canonical and stored-slot inputs both display as the canonical code
          expect(displayPositionCode(key, slot)).toBe(code)
          expect(displayPositionCode(key, code)).toBe(code)
          expect(displayPositionCode(key, code.toLowerCase())).toBe(code)
        }
      })
      it('has a left and a right tyre for every code', () => {
        const codes = new Set(slots.map(slot => slotDisplayCode(key, slot)))
        for (const code of codes) {
          const mirror = code.startsWith('LH') ? 'RH' + code.slice(2) : 'LH' + code.slice(2)
          expect(codes.has(mirror)).toBe(true)
        }
      })
      it('matches the move/swap dropdown helper', () => {
        const list = layoutPositionsFor(key)
        expect(list.map(p => p.slot)).toEqual(slots)
        expect(list.map(p => p.code)).toEqual(slots.map(slot => slotDisplayCode(key, slot)))
      })
    })
  }
})

describe('real fleet vehicle types and asset prefixes', () => {
  const cases = [
    ['TR-MIXER', 'TM514', 'Tri-mixer', 12, { F1L: 'LHF1', F2R: 'RHF2', R1Lo: 'LHCO', R1Ri: 'RHCI', R2Lo: 'LHRO', R2Ro: 'RHRO' }],
    ['PUMPS', 'MP093', 'Concrete pump', 14, { F3L: 'LHF3', R1Lo: 'LHR1-O', R2Ri: 'RHR2-I' }],
    ['SPIDER PUMP', 'SP001', 'Truck 6x4', 10, { FL: 'LHF1', FR: 'RHF1', R2Ro: 'RHR2-O' }],
    ['LINE PUMP', 'LP001', 'Line pump', 12, { F2L: 'LHF2' }],
    ['PICKUP', 'PL077', 'Pickup', 4, { FL: 'LHF1', RR: 'RHR1' }],
    ['WHEEL LOADER', 'WL201', 'Wheel loader', 4, { FL: 'LHF1', RL: 'LHR1' }],
  ]
  for (const [vehicleType, asset, layout, count, expected] of cases) {
    it(`${vehicleType} / ${asset} -> ${layout} (${count} tyres)`, () => {
      expect(resolveLayoutKey(vehicleType, asset)).toBe(layout)
      expect(layoutSlotsFor(vehicleType, asset)).toHaveLength(count)
      const hint = inspectionTypeHint({ vehicle_type: vehicleType, asset_no: asset })
      for (const [slot, code] of Object.entries(expected)) expect(displayPositionCode(hint, slot)).toBe(code)
    })
  }

  it('uses the asset code when no vehicle type was recorded', () => {
    expect(inspectionTypeHint({ vehicle_type: '', asset_no: 'TM514' })).toBe('TM514')
    expect(inspectionTypeHint({ vehicle_type: ' TR-MIXER ', asset_no: 'TM514' })).toBe('TR-MIXER')
    expect(displayPositionCode('TM514', 'R1Lo')).toBe('LHCO')
  })

  it('keeps the stored text for a wheel or a vehicle it cannot place', () => {
    expect(displayPositionCode('TR-MIXER', 'ZZ9')).toBe('ZZ9')
    expect(displayPositionCode('', 'F1L')).toBe('F1L')
    expect(displayPositionCode('MYSTERY MACHINE', 'F1L')).toBe('F1L')
    expect(displayPositionCode('TR-MIXER', '')).toBe('')
    expect(displayPositionCode('TR-MIXER', null)).toBe('')
  })

  it('tyreless equipment has no wheel map, so nothing is invented', () => {
    for (const type of ['STATIONARY PUMP', 'PLACING BOOM', 'BT-PLANT']) {
      expect(layoutSlotsFor(type)).toEqual([])
    }
  })

  it('the same slot id means a different wheel on a different vehicle (type aware)', () => {
    expect(displayPositionCode('TR-MIXER', 'R1Lo')).toBe('LHCO')
    expect(displayPositionCode('PUMPS', 'R1Lo')).toBe('LHR1-O')
  })
})
