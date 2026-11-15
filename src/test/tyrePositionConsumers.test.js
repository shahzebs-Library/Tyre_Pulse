/**
 * The existing consumers now resolve through tyrePositionService. These tests
 * prove the swap changed NO displayed result, and stop new code from growing a
 * private position converter beside the shared one.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative, sep } from 'node:path'
import { canonicalToSlotId, slotDisplayCode, displayPositionCode } from '../lib/tyreBay'
import { positionOptionsFor } from '../lib/rotationScheduleView'
import { legacyPositionCode, canonicalCode } from '../lib/tyrePositions'
import { LAYOUT_SLOTS, resolveLayoutKey, layoutSlotsFor, layoutForAsset } from '../lib/vehicleTyreLayout'
import fixture from './fixtures/tyrePositionCases.json'

// The implementation these consumers had before the swap, kept here verbatim as the oracle.
function oldCanonicalToSlotId(vehicleTypeKey, positionCode) {
  if (!positionCode) return null
  const layoutKey = resolveLayoutKey(vehicleTypeKey)
  const slots = LAYOUT_SLOTS[layoutKey] || LAYOUT_SLOTS.Pickup
  const rawU = String(positionCode).trim().toUpperCase()
  const exact = slots.find((slot) => slot.toUpperCase() === rawU)
  if (exact) return exact
  const target = canonicalCode(String(positionCode).trim())
  if (!target) return null
  const targetU = String(target).toUpperCase()
  for (const slot of slots) {
    if (slot.toUpperCase() === targetU) return slot
    const canon = canonicalCode(legacyPositionCode(layoutKey, slot))
    if (canon && String(canon).toUpperCase() === targetU) return slot
  }
  return null
}

const TYPES = [...Object.keys(LAYOUT_SLOTS), 'TR-MIXER', 'PUMPS', 'TRAILER', 'PICKUP', 'WHEEL LOADER', 'GENERATOR',
  'MISC EQUIPMENT', 'TM001', 'MP014', 'PL077', 'ZZ9', '', 'PLACING BOOM', '10 Wheeler', 'LINE PUMP', 'SPIDER PUMP']

describe('consumers repointed to the shared position service', () => {
  it('canonicalToSlotId answers exactly as before for every type and every token', () => {
    let n = 0
    for (const type of TYPES) {
      for (const token of fixture.tokens) {
        expect(canonicalToSlotId(type, token), `${type} / ${JSON.stringify(token)}`).toBe(oldCanonicalToSlotId(type, token))
        n += 1
      }
    }
    expect(n).toBeGreaterThan(2500)
  })

  it('slotDisplayCode and the rotation position list are unchanged', () => {
    for (const key of Object.keys(LAYOUT_SLOTS)) {
      for (const slot of LAYOUT_SLOTS[key]) {
        expect(slotDisplayCode(key, slot)).toBe(canonicalCode(legacyPositionCode(key, slot)) || slot)
      }
    }
    for (const [type, asset] of [['TR-MIXER', 'TM001'], ['PUMPS', 'MP001'], ['PICKUP', 'PL001'], ['', 'TM009'], ['TRAILER', ''], ['GENERATOR', 'GN1'], ['MISC', 'ZZ1']]) {
      const key = layoutForAsset(resolveLayoutKey(type, asset), asset, 'KSA')
      expect(positionOptionsFor(type, asset, 'KSA')).toEqual(layoutSlotsFor(type, asset, 'KSA').map((id) => legacyPositionCode(key, id)))
    }
  })

  it('display names are what they were (inspection flags, PDF labels, AI position labels)', () => {
    expect(displayPositionCode('TR-MIXER', 'R1Ro')).toBe('RHCO')
    expect(displayPositionCode('TM514', 'R2Li')).toBe('LHRI')
    expect(displayPositionCode('TRAILER', 'R1Ro')).toBe('RHR1-O')
    expect(displayPositionCode('PICKUP', 'RR')).toBe('RHR1')
    expect(displayPositionCode('TR-MIXER', 'RHCO')).toBe('RHCO')
    expect(displayPositionCode('MISC EQUIPMENT', 'F1L')).toBe('F1L')   // not placed: stored text kept
    expect(displayPositionCode('TR-MIXER', 'RR')).toBe('RR')
  })
})

// ---------------------------------------------------------------- ratchet
const SRC = join(process.cwd(), 'src')
function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) { if (name !== 'test' && name !== 'locales') walk(p, out) } else if (/\.(js|jsx)$/.test(name) && !/\.test\./.test(name)) out.push(p)
  }
  return out
}
const rel = (p) => relative(process.cwd(), p).split(sep).join('/')

// Files that may hold the slot <-> code tables or call the low level converter.
// The list may only SHRINK. A new file must go through tyrePositionService
// (resolvePosition / comparePositions) or tyreBay's display helpers.
const MAY_USE_LEGACY_CONVERTER = [
  'src/lib/tyrePositions.js',          // the table itself
  'src/lib/tyrePositionService.js',    // the shared service
  'src/components/VehicleTyreDiagram.jsx',            // labels the wheels it draws
  'src/components/tyreExchange/NewExchangePanel.jsx', // lists one asset's positions
  'src/lib/tyreCompleteness.js',       // names missing wheels
  'src/pages/Inspections.jsx',         // labels the checklist's wheel rows
]
// A private slot -> code table: an inspection slot id mapped to a GCC code in an object literal.
const PRIVATE_TABLE = /\b(F[1-3][LR]|R[1-3][LR][io]|R[LR][io]|FL|FR|RL|RR)\b['"]?\s*:\s*['"][LR]H[FCR]/
const MAY_HOLD_TABLE = ['src/lib/tyrePositions.js']

describe('no private position converter', () => {
  const files = walk(SRC)
  it('scans the source tree', () => { expect(files.length).toBeGreaterThan(400) })

  it('only the listed files call legacyPositionCode', () => {
    const users = files.filter((f) => /\blegacyPositionCode\s*\(/.test(readFileSync(f, 'utf8'))).map(rel).sort()
    const extra = users.filter((f) => !MAY_USE_LEGACY_CONVERTER.includes(f))
    expect(extra, 'resolve positions through src/lib/tyrePositionService.js instead').toEqual([])
    const stale = MAY_USE_LEGACY_CONVERTER.filter((f) => !users.includes(f))
    expect(stale, 'remove a file from the list once it stops using the converter').toEqual([])
  })

  it('no file outside tyrePositions holds its own slot to code table', () => {
    const holders = files.filter((f) => PRIVATE_TABLE.test(readFileSync(f, 'utf8'))).map(rel).sort()
    expect(holders.filter((f) => !MAY_HOLD_TABLE.includes(f))).toEqual([])
  })

  it('the ERP matcher never compares raw position text', () => {
    const src = readFileSync(join(SRC, 'lib/erpObservationMatch.js'), 'utf8')
    expect(src).toMatch(/comparePositions\(/)
    expect(src).not.toMatch(/key\(f\.position[^)]*\)\s*===/)
    expect(src).not.toMatch(/\.position\s*===\s*/)
  })
})
