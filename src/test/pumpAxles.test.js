import { describe, it, expect, beforeEach } from 'vitest'
import { setAxleCounts, layoutForAsset, layoutSlotsFor, axleCountFor, resolveLayoutKey } from '../lib/vehicleTyreLayout'
import { inspectionDiagramModel } from '../lib/inspectionView'

describe('pump axle builds', () => {
  beforeEach(() => setAxleCounts([
    { asset_no: 'MP049', country: 'KSA', axle_count: 4 },
    { asset_no: 'MP099', country: 'KSA', axle_count: 5 },
  ]))

  it('a 4-axle pump draws 12 wheels, a 5-axle one 14', () => {
    expect(layoutSlotsFor('PUMPS', 'MP049', 'KSA')).toHaveLength(12)
    expect(layoutSlotsFor('PUMPS', 'MP099', 'KSA')).toHaveLength(14)
    expect(layoutSlotsFor('PUMPS', 'MP049', 'KSA')).not.toContain('F3L')
  })

  it('the same code in another country is a different machine', () => {
    expect(axleCountFor('MP049', 'UAE')).toBeNull()
    expect(layoutSlotsFor('PUMPS', 'MP049', 'UAE')).toHaveLength(14)
  })

  it('without a country it resolves when only one country records the asset', () => {
    expect(layoutForAsset(resolveLayoutKey('PUMPS'), 'mp049')).toBe('Concrete pump 4-axle')
  })

  it('only changes types that have a second build', () => {
    expect(layoutForAsset(resolveLayoutKey('TR-MIXER'), 'MP049', 'KSA')).toBe('Tri-mixer')
  })

  it('the inspection report counts 12 positions on a 4-axle pump', () => {
    const m = inspectionDiagramModel({ asset_no: 'MP049', country: 'KSA', vehicle_type: 'PUMPS', tyre_conditions: { F1L: { condition: 'Good' } } })
    expect(m.slots).toHaveLength(12)
  })
})
