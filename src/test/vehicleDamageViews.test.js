import { describe, it, expect } from 'vitest'
import {
  familyForVehicleType, FAMILY_VIEWS, layoutFor, groupMarksByKey, markKey, viewLabel,
} from '../lib/vehicleDamageViews'

describe('familyForVehicleType', () => {
  it('matches bus, concrete pump and pickup by keyword, case-insensitively', () => {
    expect(familyForVehicleType('BUS')).toBe('bus')
    expect(familyForVehicleType('Minibus')).toBe('bus')
    expect(familyForVehicleType('Concrete Pump')).toBe('concrete_pump')
    expect(familyForVehicleType('PLACING BOOM')).toBe('concrete_pump')
    expect(familyForVehicleType('pick-up')).toBe('pickup')
    expect(familyForVehicleType('Pickup Truck')).toBe('pickup')
  })

  it('falls back to generic for an unknown or blank type', () => {
    expect(familyForVehicleType('TR-MIXER')).toBe('generic')
    expect(familyForVehicleType('')).toBe('generic')
    expect(familyForVehicleType(null)).toBe('generic')
    expect(familyForVehicleType(undefined)).toBe('generic')
  })
})

describe('FAMILY_VIEWS / layoutFor', () => {
  it('offers 4 views for on-road families and 1 for the pump family', () => {
    expect(FAMILY_VIEWS.bus).toEqual(['front', 'left', 'right', 'rear'])
    expect(FAMILY_VIEWS.pickup).toEqual(['front', 'left', 'right', 'rear'])
    expect(FAMILY_VIEWS.generic).toEqual(['front', 'left', 'right', 'rear'])
    expect(FAMILY_VIEWS.concrete_pump).toEqual(['overview'])
  })

  it('returns a layout with cols/rows and a non-empty region list for every family+view combo', () => {
    for (const family of Object.keys(FAMILY_VIEWS)) {
      for (const view of FAMILY_VIEWS[family]) {
        const layout = layoutFor(family, view)
        expect(layout.cols).toBeGreaterThan(0)
        expect(layout.rows).toBeGreaterThan(0)
        expect(Array.isArray(layout.regions)).toBe(true)
        expect(layout.regions.length).toBeGreaterThan(0)
      }
    }
  })

  it('every region key is unique within its own layout', () => {
    for (const family of Object.keys(FAMILY_VIEWS)) {
      for (const view of FAMILY_VIEWS[family]) {
        const { regions } = layoutFor(family, view)
        const keys = regions.map((r) => r.key)
        expect(new Set(keys).size).toBe(keys.length)
      }
    }
  })

  it('degrades to the generic layout for an unrecognised family/view rather than throwing', () => {
    const layout = layoutFor('spaceship', 'front')
    expect(layout.regions.length).toBeGreaterThan(0)
    const unknownView = layoutFor('generic', 'underneath')
    expect(unknownView.regions.length).toBeGreaterThan(0)
  })

  it('the pump layout is named components, not body-panel regions', () => {
    const { regions } = layoutFor('concrete_pump', 'overview')
    const keys = regions.map((r) => r.key)
    expect(keys).toContain('boom_section_1')
    expect(keys).toContain('outrigger_front_left')
    expect(keys).not.toContain('windshield')
  })
})

describe('viewLabel', () => {
  it('labels known views and falls back to the raw key otherwise', () => {
    expect(viewLabel('front')).toBe('Front')
    expect(viewLabel('overview')).toBe('Overview')
    expect(viewLabel('mystery')).toBe('mystery')
  })
})

describe('markKey / groupMarksByKey', () => {
  it('builds the same identity key markKey and groupMarksByKey both use', () => {
    expect(markKey('front', 'grille')).toBe('front::grille')
  })

  it('groups marks by view+region_key and ignores malformed entries', () => {
    const areas = [
      { view: 'front', region_key: 'grille', damage_type: 'Dent' },
      { view: 'left', region_key: 'front_door', damage_type: 'Scratch' },
      null,
      { view: 'rear' }, // no region_key - dropped
      { region_key: 'front_bumper' }, // no view - dropped
    ]
    const map = groupMarksByKey(areas)
    expect(map.size).toBe(2)
    expect(map.get('front::grille').damage_type).toBe('Dent')
    expect(map.get('left::front_door').damage_type).toBe('Scratch')
  })

  it('returns an empty map for non-array input', () => {
    expect(groupMarksByKey(null).size).toBe(0)
    expect(groupMarksByKey(undefined).size).toBe(0)
  })
})
