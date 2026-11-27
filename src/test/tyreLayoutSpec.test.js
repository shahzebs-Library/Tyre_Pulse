/**
 * The shared tyre map (docs/document-specs/tyre-layouts.json) read by the web.
 *
 * docs/document-specs/tyre-layout-cases.json holds the cases; the Flutter
 * parity test resolves the SAME cases through its generated copy, so a
 * vehicle type, a pump record code or a condition word gets one answer on the
 * screen, the PDF and the phone.
 */
import { describe, it, expect } from 'vitest'
import cases from '../../docs/document-specs/tyre-layout-cases.json'
import {
  TYRE_LAYOUT_SPEC, LAYOUT_GEOMETRY, slotForStoredPosition, conditionRisk, positionCodeFor,
  riskRgb, riskHex, ALL_POSITION_CODES,
} from '../lib/tyreLayoutSpec'
import { resolveLayoutKeyStrict, layoutSlotsFor, isTyrelessEquipment, LAYOUT_KEYS } from '../lib/vehicleTyreLayout'
import { canonicalToSlotId } from '../lib/tyreBay'
import { riskForCondition } from '../lib/inspectionView'
import { inferVehicleTypeFromAsset } from '../lib/inspectionsAnalytics'

describe('every case resolves the same on every surface', () => {
  for (const [type, asset, key, count] of cases.resolve) {
    it(`${JSON.stringify(type)} / ${JSON.stringify(asset)}`, () => {
      if (count === 0) {
        expect(isTyrelessEquipment(type)).toBe(true)
        expect(layoutSlotsFor(type, asset)).toEqual([])
      } else if (count === -1) {
        expect(resolveLayoutKeyStrict(type, asset)).toBeNull()
      } else {
        expect(resolveLayoutKeyStrict(type, asset)).toBe(key)
        expect(layoutSlotsFor(type, asset)).toHaveLength(count)
      }
    })
  }
})

describe('a concrete pump', () => {
  it('has at most 14 tyres, and every pump layout key resolves to one', () => {
    const pumpKeys = LAYOUT_KEYS.filter((k) => /pump/i.test(k))
    for (const k of pumpKeys) expect(LAYOUT_GEOMETRY[k].tyres.length).toBeLessThanOrEqual(14)
    expect(LAYOUT_GEOMETRY['Concrete pump'].tyres).toHaveLength(14)
  })

  it('places a record on its wheel under every live spelling (dominant, R1-O variant, legacy 12)', () => {
    for (const [code, slot] of Object.entries(cases.pumpPositions)) {
      expect(slotForStoredPosition('Concrete pump', code), code).toBe(slot)
      // The diagram and the tyre bay go through the same placement.
      expect(canonicalToSlotId('PUMPS', code), code).toBe(slot)
    }
  })

  it('is labelled the way its records are, and the ERP scope keeps the SQL-mirrored codes', () => {
    expect(positionCodeFor('Concrete pump', 'F3L')).toBe('LHR1-I')
    expect(positionCodeFor('Concrete pump', 'R1Lo')).toBe('LHRCO')
    expect(positionCodeFor('Concrete pump', 'R2Ro')).toBe('RHRRO')
    expect(positionCodeFor('Concrete pump', 'R1Lo', { scope: 'erp' })).toBe('LHR1-O')
    expect(positionCodeFor('Concrete pump', 'F3L', { scope: 'erp' })).toBe('LHF3')
    expect(positionCodeFor('Tri-mixer', 'R1Lo')).toBe('LHCO')
    expect(positionCodeFor('Line pump', 'R1Lo')).toBe('LHR1-O')
  })
})

describe('one condition rule', () => {
  for (const [word, band] of Object.entries(cases.conditions)) {
    it(`${JSON.stringify(word)} -> ${band}`, () => {
      expect(conditionRisk(word)).toBe(band)
      expect(riskForCondition(word)).toBe(band)
    })
  }
})

describe('one palette', () => {
  it('has light and dark values for every band', () => {
    for (const theme of ['light', 'dark']) {
      for (const band of TYRE_LAYOUT_SPEC.risk.order) {
        expect(riskHex(band, theme)).toMatch(/^#[0-9A-F]{6}$/i)
        expect(riskRgb(band, theme)).toHaveLength(3)
      }
    }
  })
})

describe('no second copy of the lists', () => {
  it('asset prefixes come from the spec (CP, LP, MB, hyphenated codes)', () => {
    expect(inferVehicleTypeFromAsset('CP014')).toBe('Concrete pump')
    expect(inferVehicleTypeFromAsset('PL-090')).toBe('Pickup')
    expect(inferVehicleTypeFromAsset('MB002')).toBe('Bus')
    expect(inferVehicleTypeFromAsset('IP001')).toBeNull()
  })
  it('position suggestions are the spec codes', () => {
    expect(ALL_POSITION_CODES).toEqual(expect.arrayContaining(['LHF1', 'LHCO', 'LHRCO', 'RHR2-O']))
  })
})
