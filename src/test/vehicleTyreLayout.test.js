/**
 * The web vehicle tyre diagram used to draw the WRONG MACHINE for the whole
 * pump family: every vehicle_type containing "pump" or "boom" collapsed onto
 * the truck-mounted MP concrete pump (3 steer axles + 2 dual drive axles = 14
 * tyres). Live that hit 54 assets - SPIDER PUMP (20), PLACING BOOM (18),
 * STATIONARY PUMP (11), LINE PUMP (5) - and a stationary pump has no tyres at
 * all while a placing boom is not a truck.
 *
 * These tests pin the mapping for every vehicle_type spelling that exists in
 * the fleet register, so the collapse cannot come back.
 */
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import {
  resolveLayoutKey, layoutSlotsFor, isTyrelessEquipment,
  LAYOUT_SLOTS, LAYOUT_KEYS, NO_TYRE_EQUIPMENT,
} from '../lib/vehicleTyreLayout'
import { canonicalToSlotId, slotDisplayCode } from '../lib/tyreBay'

// The five vehicle_type spellings that carry assets in the live register.
const LIVE_PUMP_FAMILY = [
  { type: 'PUMPS',           layout: 'Concrete pump', tyres: 14 },
  { type: 'SPIDER PUMP',     layout: 'Truck 6x4',     tyres: 10 },
  { type: 'LINE PUMP',       layout: 'Line pump',     tyres: 12 },
  { type: 'PLACING BOOM',    layout: null,            tyres: 0  },
  { type: 'STATIONARY PUMP', layout: null,            tyres: 0  },
]

describe('pump family resolves to its own machine', () => {
  for (const { type, layout, tyres } of LIVE_PUMP_FAMILY) {
    it(`${type} -> ${layout || 'no tyres'} (${tyres} tyres)`, () => {
      expect(layoutSlotsFor(type)).toHaveLength(tyres)
      if (layout) {
        expect(isTyrelessEquipment(type)).toBe(false)
        expect(resolveLayoutKey(type)).toBe(layout)
      } else {
        expect(isTyrelessEquipment(type)).toBe(true)
      }
    })
  }

  it('the four non-MP types no longer share the concrete pump layout', () => {
    const wrong = LIVE_PUMP_FAMILY
      .filter((c) => c.type !== 'PUMPS')
      .filter((c) => !isTyrelessEquipment(c.type) && resolveLayoutKey(c.type) === 'Concrete pump')
    expect(wrong).toEqual([])
  })

  it('the truck-mounted concrete pump still draws its 14 tyres', () => {
    expect(resolveLayoutKey('PUMPS')).toBe('Concrete pump')
    expect(layoutSlotsFor('PUMPS')).toHaveLength(14)
    // MP is the concrete-pump asset class, and a boom pump truck IS that machine.
    expect(resolveLayoutKey('MP083')).toBe('Concrete pump')
    expect(resolveLayoutKey('Boom Pump')).toBe('Concrete pump')
    expect(resolveLayoutKey('Boom Pump Truck')).toBe('Concrete pump')
  })

  it('a stationary pump gets NO wheel slots, not four and not fourteen', () => {
    expect(layoutSlotsFor('STATIONARY PUMP')).toEqual([])
    // Defensive: a caller that skips the tyreless check must still never land
    // on the 14-tyre pump.
    expect(resolveLayoutKey('STATIONARY PUMP')).not.toBe('Concrete pump')
    expect(resolveLayoutKey('PLACING BOOM')).not.toBe('Concrete pump')
  })

  it('case and separator spellings resolve the same way', () => {
    for (const v of ['spider pump', 'Spider-Pump', ' SPIDER  PUMP ']) {
      expect(resolveLayoutKey(v)).toBe('Truck 6x4')
    }
    for (const v of ['line pump', 'Line-Pump', 'LINE_PUMP']) {
      expect(resolveLayoutKey(v)).toBe('Line pump')
    }
    for (const v of ['stationary pump', 'Stationary Pump']) {
      expect(isTyrelessEquipment(v)).toBe(true)
    }
  })
})

describe('non-pump types are untouched', () => {
  const CASES = [
    ['TR-MIXER', 'Tri-mixer', 12],
    ['Transit Mixer', 'Tri-mixer', 12],
    ['WHEEL LOADER', 'Wheel loader', 4],
    ['SKID LOADER', 'Skid loader', 4],
    ['CANTER', 'Canter', 6],
    ['BUS', 'Bus', 6],
    ['TATA', 'Tata', 6],
    ['ASHOK LEYLAND', 'Ashok Leyland', 6],
    ['PICKUP', 'Pickup', 4],
    ['TANKER', 'Tanker', 6],
    ['TRAILER', 'Trailer', 8],
  ]
  for (const [type, layout, tyres] of CASES) {
    it(`${type} -> ${layout} (${tyres})`, () => {
      expect(resolveLayoutKey(type)).toBe(layout)
      expect(layoutSlotsFor(type)).toHaveLength(tyres)
    })
  }

  it('asset-class prefixes still resolve, and a type is never read as one', () => {
    expect(resolveLayoutKey('TM634')).toBe('Tri-mixer')
    expect(resolveLayoutKey('WL012')).toBe('Wheel loader')
    expect(resolveLayoutKey('PL077')).toBe('Pickup')
    // The prefix rule now requires a DIGIT right after the letters, because
    // reading the leading letters of a TYPE as an asset class is what turned
    // "PLACING BOOM" into a PL-prefixed pickup and "SLUDGE TANKER" into a skid
    // loader. A type is a type; only an asset code carries a class prefix.
    expect(resolveLayoutKey('SLUDGE TANKER')).toBe('Tanker')
    expect(isTyrelessEquipment('PLACING BOOM')).toBe(true)
  })

  it('unknown and empty input falls back to Pickup rather than throwing', () => {
    expect(resolveLayoutKey('')).toBe('Pickup')
    expect(resolveLayoutKey(null)).toBe('Pickup')
    expect(resolveLayoutKey(undefined, undefined)).toBe('Pickup')
    expect(resolveLayoutKey('QQQ WIDGET')).toBe('Pickup')
    // The type wins when it resolves; the asset number is only a fallback.
    expect(resolveLayoutKey('TR-MIXER', 'MP083')).toBe('Tri-mixer')
    expect(resolveLayoutKey('', 'MP083')).toBe('Concrete pump')
  })
})

describe('tyreless equipment', () => {
  const TYRELESS = [
    'STATIONARY PUMP', 'PLACING BOOM', 'GENERATOR', 'GENSET', 'CHILLER',
    'BT-PLANT', 'ICE PLANT', 'BATCHING PLANT', 'RECLAIMER', 'COMPRESSOR',
    'TOWER LIGHT', 'LIGHT TOWER', 'BUILDING',
  ]
  for (const t of TYRELESS) {
    it(`${t} has no tyres`, () => {
      expect(isTyrelessEquipment(t)).toBe(true)
      expect(layoutSlotsFor(t)).toEqual([])
    })
  }

  it('real vehicles are not swept into the tyreless list', () => {
    for (const t of ['PUMPS', 'SPIDER PUMP', 'LINE PUMP', 'TR-MIXER', 'PICKUP', 'BUS', 'TANKER']) {
      expect(isTyrelessEquipment(t)).toBe(false)
    }
  })

  it('blank input is not equipment', () => {
    expect(isTyrelessEquipment('')).toBe(false)
    expect(isTyrelessEquipment(null)).toBe(false)
  })
})

describe('layout integrity', () => {
  it('every layout key has a non-empty, duplicate-free slot set', () => {
    expect(LAYOUT_KEYS.length).toBeGreaterThanOrEqual(13)
    for (const key of LAYOUT_KEYS) {
      const slots = LAYOUT_SLOTS[key]
      expect(slots.length).toBeGreaterThan(0)
      expect(new Set(slots).size).toBe(slots.length)
    }
  })

  it('every slot round-trips through the canonical GCC position code', () => {
    for (const key of LAYOUT_KEYS) {
      for (const slot of LAYOUT_SLOTS[key]) {
        expect(canonicalToSlotId(key, slotDisplayCode(key, slot))).toBe(slot)
      }
    }
  })

  // The diagram file holds the drawing coordinates; this module holds the slot
  // ids. A layout drawn with wheels the position list does not carry renders
  // unlabelled wheels, so the two are pinned to each other by source scan
  // (importing the component would drag React and framer-motion into a pure test).
  it('the diagram component draws exactly these layouts and slots', () => {
    const src = fs.readFileSync(
      path.join(process.cwd(), 'src/components/VehicleTyreDiagram.jsx'), 'utf8')
    const body = src.slice(src.indexOf('const LAYOUTS = {'))
    expect(body).toBeTruthy()

    const drawn = {}
    let current = null
    for (const line of body.split('\n')) {
      const key = line.match(/^ {2}'?([A-Za-z][A-Za-z0-9 x-]*)'?: \{$/)
      if (key) { current = key[1]; drawn[current] = []; continue }
      const tyre = line.match(/^\s*\{ id: '([A-Za-z0-9]+)'/)
      if (tyre && current) drawn[current].push(tyre[1])
      if (line.startsWith('};')) break
    }

    // The scan must actually have found something, or this test passes vacuously.
    expect(Object.keys(drawn).length).toBe(LAYOUT_KEYS.length)
    for (const key of LAYOUT_KEYS) {
      expect(drawn[key], `diagram is missing the ${key} layout`).toEqual([...LAYOUT_SLOTS[key]])
    }
  })

  // Web and mobile diverging is what produced this bug in the first place.
  it('matches the mobile tyreless list', () => {
    const src = fs.readFileSync(
      path.join(process.cwd(), 'mobile/lib/tyreDiagramLayouts.ts'), 'utf8')
    const block = src.slice(src.indexOf('export const NO_TYRE_EQUIPMENT = ['))
    const arr = block
      .slice(block.indexOf('['), block.indexOf(']') + 1)
      .split('\n')
      // Drop comment lines: an apostrophe inside prose ("the pump's tyres")
      // otherwise parses as a list entry.
      .filter((l) => !l.trim().startsWith('//'))
      .join('\n')
    const mobile = [...arr.matchAll(/'([^']+)'/g)].map((m) => m[1])
    expect(mobile.length).toBeGreaterThanOrEqual(10)
    expect([...NO_TYRE_EQUIPMENT].sort()).toEqual([...mobile].sort())
  })
})
