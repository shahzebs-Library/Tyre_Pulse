/**
 * The checklist tab's tyre gate must never get WEAKER.
 *
 * This form has always demanded a pressure on every seeded position. Routing it
 * through the shared tyreCompleteness engine was meant to catch MORE - a wheel
 * the layout says exists but that never reached the seeded array - not to hand
 * the decision over. The engine deliberately declines to judge an unknown
 * vehicle type (it returns ok:true rather than block on a guess), so if the
 * pressure floor were ever dropped in favour of the engine alone, an unknown
 * machine would become submittable with no readings at all.
 *
 * These tests pin the composition, not the prose.
 */
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { tyreCompleteness } from '../lib/tyreCompleteness'

const SRC = fs.readFileSync(path.join(process.cwd(), 'src/pages/Inspections.jsx'), 'utf8')

describe('checklist tyre gate composition', () => {
  it('keeps the pressure floor as an OR term, so the engine can only add', () => {
    const line = SRC.split('\n').find((l) => l.includes('const clTyresIncomplete ='))
    expect(line, 'clTyresIncomplete must exist').toBeTruthy()
    expect(line).toContain('clMissingPressure.length > 0')
    expect(line).toContain('!clCompleteness.ok')
    expect(line).toContain('||')
  })

  it('disables Save and blocks the save handler on the same single value', () => {
    expect(SRC).toContain('disabled={clSaving || !clAsset.trim() || clPositions.length === 0 || clTyresIncomplete}')
    expect(SRC).toContain('if (clTyresIncomplete) {')
  })

  it('asks the engine for pressure evidence on this surface', () => {
    expect(SRC).toContain('{ requirePressure: true }')
  })
})

describe('why the floor is load-bearing', () => {
  it('the engine declines to judge an unknown vehicle type', () => {
    const res = tyreCompleteness('Something Nobody Mapped', 'ZZ999', [
      { position: 'LHF1', condition: 'Good' },
    ])
    // ok:true means "I will not block on a guess" - NOT "this sheet is finished".
    expect(res.ok).toBe(true)
    expect(res.known).toBe(false)
  })

  it('so a sheet with no pressures anywhere is still caught by the floor', () => {
    const positions = [
      { position: 'LHF1', condition: 'Good' },
      { position: 'RHF1', condition: 'Good' },
    ]
    const engineSays = tyreCompleteness('Something Nobody Mapped', 'ZZ999', positions)
    const missingPressure = positions.filter((p) => !p.pressure)
    const blocked = missingPressure.length > 0 || !engineSays.ok
    expect(blocked).toBe(true)
  })
})
