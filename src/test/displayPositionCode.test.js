import { describe, it, expect } from 'vitest'
import { displayPositionCode, inspectionTypeHint } from '../lib/tyreBay'
import { positionLabelMap } from '../lib/inspectionView'
import { defectsForAction } from '../lib/inspectionTyreFlags'
import { flagsFromInspections, mergeFlags, flagsFromDueRows } from '../lib/tyreChangeTracking'

/**
 * The pairing between the mobile capture keys and the ERP codes is NOT a guess.
 * Live inspections store both against the same wheel; this is that table, and it
 * is what every screen is expected to print.
 */
const TRI_MIXER_PAIRS = [
  ['F1L', 'LHF1'], ['F1R', 'RHF1'], ['F2L', 'LHF2'], ['F2R', 'RHF2'],
  ['R1Li', 'LHCI'], ['R1Lo', 'LHCO'], ['R1Ri', 'RHCI'], ['R1Ro', 'RHCO'],
  ['R2Li', 'LHRI'], ['R2Lo', 'LHRO'], ['R2Ri', 'RHRI'], ['R2Ro', 'RHRO'],
]

describe('displayPositionCode names every captured wheel the way the ERP does', () => {
  for (const [stored, canonical] of TRI_MIXER_PAIRS) {
    it(`${stored} reads as ${canonical} on a tri-mixer`, () => {
      expect(displayPositionCode('TR-MIXER', stored)).toBe(canonical)
      // Same answer through the fuzzy spellings the data actually carries.
      expect(displayPositionCode('Tri-mixer', stored)).toBe(canonical)
      expect(displayPositionCode('Transit Mixer', stored)).toBe(canonical)
      // ...and through the asset code, for the rows where nobody filled the type.
      expect(displayPositionCode('TM371', stored)).toBe(canonical)
    })
  }

  it('leaves a code that is already canonical exactly as it is', () => {
    for (const [, canonical] of TRI_MIXER_PAIRS) {
      expect(displayPositionCode('TR-MIXER', canonical)).toBe(canonical)
    }
  })

  it('keeps the stored text when the wheel cannot be placed', () => {
    // No layout is defined for this machine, so there is nothing to convert to.
    expect(displayPositionCode('Widget Machine', 'R2Ri')).toBe('R2Ri')
    expect(displayPositionCode('', 'R2Ri')).toBe('R2Ri')
    // A real layout, but this vehicle has no such wheel.
    expect(displayPositionCode('Pickup', 'R2Ri')).toBe('R2Ri')
    // Free text a mechanic typed is never coerced into a wheel.
    expect(displayPositionCode('TR-MIXER', 'LHBB1')).toBe('LHBB1')
  })

  it('handles blank and nullish input without inventing a wheel', () => {
    expect(displayPositionCode('TR-MIXER', '')).toBe('')
    expect(displayPositionCode('TR-MIXER', null)).toBe('')
    expect(displayPositionCode('TR-MIXER', undefined)).toBe('')
  })

  it('trims stored padding, the way the position columns were cleaned', () => {
    expect(displayPositionCode('TR-MIXER', '  R2Ri  ')).toBe('RHRI')
  })

  it('resolves the layout from the vehicle type first, then the asset code', () => {
    expect(inspectionTypeHint({ vehicle_type: 'TR-MIXER', asset_no: 'TM371' })).toBe('TR-MIXER')
    expect(inspectionTypeHint({ vehicle_type: '', asset_no: 'TM371' })).toBe('TM371')
    expect(inspectionTypeHint(null)).toBe('')
  })
})

describe('every surface names one wheel the same way', () => {
  // The wheel traced end to end against live data: inspection TM371 recorded
  // "Worn" on R2Ri; tyre_records holds that tyre under RHRI.
  const INSPECTION = {
    id: 'insp-1',
    asset_no: 'TM371',
    vehicle_type: 'TR-MIXER',
    country: 'KSA',
    site: 'NHC',
    inspection_date: '2026-07-21',
    tyre_conditions: {
      R2Ri: { position: 'R2Ri', condition: 'Damage', pressure_psi: '115' },
      F1L: { position: 'F1L', condition: 'Puncture', pressure_psi: '120' },
    },
  }

  it('the photo / reading labels print the canonical code', () => {
    expect(positionLabelMap(INSPECTION)).toEqual({ R2Ri: 'RHRI', F1L: 'LHF1' })
  })

  it('the corrective action sentence names the canonical code', () => {
    const defects = defectsForAction(INSPECTION)
    const damage = defects.find((d) => d.position === 'R2Ri')
    expect(damage.positionLabel).toBe('RHRI')
    expect(damage.title).toContain('RHRI')
    expect(damage.description).toContain('position RHRI')
    expect(damage.title).not.toContain('R2Ri')
    // The KEY still carries the stored position: it is already in the database
    // on every action raised so far, and rewriting it would orphan them.
    expect(damage.key).toBe('damage:R2Ri')
  })

  it('the tyre change tracking row names the canonical code', () => {
    const flags = flagsFromInspections([INSPECTION])
    const damage = flags.find((f) => f.positionStored === 'R2Ri')
    expect(damage.position).toBe('RHRI')
    // Verbatim provenance is kept, so nothing recorded is lost by renaming.
    expect(damage.positionStored).toBe('R2Ri')
  })

  it('a flag with no layout to convert keeps its stored position', () => {
    const flags = flagsFromInspections([{
      asset_no: 'ZZ900', vehicle_type: 'Widget Machine', country: 'KSA',
      inspection_date: '2026-07-21',
      tyre_conditions: { R2Ri: { condition: 'Damage' } },
    }])
    expect(flags[0].position).toBe('R2Ri')
  })

  it('an inspection flag and a running-life flag on one wheel merge into one row', () => {
    // This is the pay-off of converting at the source: before it, the inspection
    // said R2Ri and the life feed said RHRI, so the same tyre produced two rows
    // and matched no fitment record at all.
    const due = flagsFromDueRows([{
      asset: 'TM371', country: 'KSA', position: 'RHRI', serial: 'YHM38502',
      vehicleType: 'TR-MIXER', remainingKm: 0, expectedLifeKm: 60000, kmRun: 60000,
    }])
    const insp = flagsFromInspections([{
      ...INSPECTION,
      tyre_conditions: { R2Ri: { position: 'R2Ri', condition: 'Damage' } },
    }])
    // Both name the same wheel now...
    expect(due.every((f) => f.position === 'RHRI')).toBe(true)
    expect(insp[0].position).toBe('RHRI')
    // ...so a merge on the wheel key folds them where they describe one tyre.
    const merged = mergeFlags([insp, due.map((f) => ({ ...f, serial: '' }))])
    expect(merged).toHaveLength(1)
    expect(merged[0].position).toBe('RHRI')
  })
})
