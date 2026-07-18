import { describe, it, expect } from 'vitest'
import { legacyPositionCode } from '../lib/tyrePositions'
import {
  serialOf, groupTyresByPosition, canonicalToSlotId, resolveLayoutKey,
  BUILTIN_LAYOUT_SLOTS, tyreLifeKm, cpk, daysFitted, isCurrentlyFitted, positionKeyOf,
} from '../lib/tyreBay'

describe('serialOf', () => {
  it('reads across the three serial columns, trimmed', () => {
    expect(serialOf({ serial_no: ' AA1 ' })).toBe('AA1')
    expect(serialOf({ serial_number: 'S2' })).toBe('S2')
    expect(serialOf({ tyre_serial: 'T3' })).toBe('T3')
    expect(serialOf({})).toBe('')
    expect(serialOf(null)).toBe('')
  })
})

describe('positionKeyOf / isCurrentlyFitted', () => {
  it('falls back position -> tyre_position -> Unassigned', () => {
    expect(positionKeyOf({ position: 'LHF1' })).toBe('LHF1')
    expect(positionKeyOf({ tyre_position: 'RHR1-O' })).toBe('RHR1-O')
    expect(positionKeyOf({})).toBe('Unassigned')
    expect(positionKeyOf({ position: '  ' })).toBe('Unassigned')
  })
  it('treats a row with no removal signal as currently fitted', () => {
    expect(isCurrentlyFitted({ km_at_fitment: 1000 })).toBe(true)
    expect(isCurrentlyFitted({ km_at_removal: 5000 })).toBe(false)
    expect(isCurrentlyFitted({ removal_date: '2025-01-01' })).toBe(false)
  })
})

describe('groupTyresByPosition', () => {
  const rows = [
    // LHF1: one removed (older), one currently fitted (newer)
    { id: 1, position: 'LHF1', serial_no: 'OLD1', fitment_date: '2023-01-01', removal_date: '2023-12-01', km_at_removal: 40000 },
    { id: 2, position: 'LHF1', serial_no: 'NEW1', fitment_date: '2024-01-01' },
    // RHF1: two removed stints, no current
    { id: 3, position: 'RHF1', serial_no: 'R-A', fitment_date: '2022-01-01', removal_date: '2022-06-01', km_at_removal: 20000 },
    { id: 4, position: 'RHF1', serial_no: 'R-B', fitment_date: '2022-06-02', removal_date: '2023-06-01', km_at_removal: 30000 },
    // Unassigned: blank position, uses tyre_position/dual serial column
    { id: 5, tyre_position: '', serial_number: 'U1', issue_date: '2024-05-01' },
  ]

  it('splits current vs history and sorts history newest-first', () => {
    const g = groupTyresByPosition(rows)

    expect(g.LHF1.current.id).toBe(2)
    expect(g.LHF1.current.serial_no).toBe('NEW1')
    expect(g.LHF1.history.map((r) => r.id)).toEqual([1])

    // No currently-fitted tyre -> current is null, both stints are history newest-first
    expect(g.RHF1.current).toBeNull()
    expect(g.RHF1.history.map((r) => r.id)).toEqual([4, 3])

    // Blank position folds into Unassigned; dual serial column resolves
    expect(g.Unassigned.current.id).toBe(5)
    expect(serialOf(g.Unassigned.current)).toBe('U1')
  })

  it('handles empty / nullish input', () => {
    expect(groupTyresByPosition([])).toEqual({})
    expect(groupTyresByPosition(null)).toEqual({})
  })
})

describe('canonicalToSlotId round-trips legacyPositionCode', () => {
  for (const vt of ['Pickup', 'Tri-mixer', 'Concrete pump', 'Canter']) {
    it(`round-trips every slot for ${vt}`, () => {
      for (const slot of BUILTIN_LAYOUT_SLOTS[vt]) {
        const canon = legacyPositionCode(vt, slot)
        expect(canonicalToSlotId(vt, canon)).toBe(slot)
      }
    })
  }

  it('resolves fuzzy vehicle type spellings to a layout', () => {
    expect(resolveLayoutKey('Tr-Mixer')).toBe('Tri-mixer')
    expect(resolveLayoutKey('Transit Mixer')).toBe('Tri-mixer')
    expect(resolveLayoutKey('Boom Pump')).toBe('Concrete pump')
    expect(resolveLayoutKey('')).toBe('Pickup')
    // A canonical code maps through the fuzzy type just like the diagram relabels
    expect(canonicalToSlotId('Tr-Mixer', 'LHCO')).toBe('R1Lo')
  })

  it('returns null when the position has no slot on that vehicle', () => {
    expect(canonicalToSlotId('Pickup', 'LHR3-O')).toBeNull()
    expect(canonicalToSlotId('Pickup', '')).toBeNull()
    expect(canonicalToSlotId('Pickup', null)).toBeNull()
  })

  it('accepts a raw slot id directly', () => {
    expect(canonicalToSlotId('Pickup', 'FL')).toBe('FL')
  })
})

describe('tyreLifeKm / cpk / daysFitted edge cases', () => {
  it('life km from fitment/removal, else total_km, else null', () => {
    expect(tyreLifeKm({ km_at_fitment: 1000, km_at_removal: 41000 })).toBe(40000)
    expect(tyreLifeKm({ total_km: 25000 })).toBe(25000)
    expect(tyreLifeKm({ km_at_fitment: 5000, km_at_removal: 4000 })).toBeNull() // negative
    expect(tyreLifeKm({ km_at_fitment: 1000, km_at_removal: 1000 })).toBeNull() // zero
    expect(tyreLifeKm({})).toBeNull()
  })

  it('cpk only when cost and km are positive', () => {
    expect(cpk({ cost_per_tyre: 1600, km_at_fitment: 0, km_at_removal: 40000 })).toBeCloseTo(0.04, 4)
    expect(cpk({ cost_per_tyre: 1600, total_km: 0 })).toBeNull()
    expect(cpk({ cost_per_tyre: 0, total_km: 40000 })).toBeNull()
    expect(cpk({ total_km: 40000 })).toBeNull()
  })

  it('days fitted from start to removal or now', () => {
    const now = new Date('2024-01-11T00:00:00Z').getTime()
    expect(daysFitted({ fitment_date: '2024-01-01' }, now)).toBe(10)
    expect(daysFitted({ issue_date: '2024-01-01', removal_date: '2024-01-06' }, now)).toBe(5)
    expect(daysFitted({}, now)).toBeNull()
    expect(daysFitted({ fitment_date: '2024-02-01', removal_date: '2024-01-01' }, now)).toBeNull()
  })
})
