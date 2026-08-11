import { describe, it, expect } from 'vitest'
import { inspectionDiagramModel, vehicleTypeIsKnown } from '../lib/inspectionView'

// The real predicate lives on VehicleTyreDiagram; the selector takes it as an
// argument, so the test injects an equivalent one and stays free of React.
const isTyreless = (vt) => /generator|chiller|plant/i.test(String(vt || ''))

const trimixer = (tc, extra = {}) => ({
  id: 'i1', asset_no: 'TM514', vehicle_type: 'Tri-Mixer', tyre_conditions: tc, ...extra,
})

describe('vehicleTypeIsKnown', () => {
  it('accepts a real type and rejects an unclassified one', () => {
    expect(vehicleTypeIsKnown('Tri-Mixer')).toBe(true)
    expect(vehicleTypeIsKnown('Pickup')).toBe(true)
    expect(vehicleTypeIsKnown('TM514')).toBe(true)      // class prefix
    expect(vehicleTypeIsKnown('Widget Machine')).toBe(false)
    expect(vehicleTypeIsKnown('')).toBe(false)
  })
})

describe('inspectionDiagramModel - recorded vs unrecorded', () => {
  it('colours a recorded position and leaves the rest unrecorded', () => {
    const m = inspectionDiagramModel(trimixer({
      LHF1: { condition: 'Good', pressure_psi: 110 },
      RHF1: { condition: 'Wear', pressure_psi: 96 },
    }), { isTyreless })

    expect(m.renderable).toBe(true)
    expect(m.layoutKey).toBe('Tri-mixer')
    expect(m.slots).toHaveLength(12)
    expect(m.tyreData.F1L).toEqual({ risk: 'good', condition: 'Good' })
    expect(m.tyreData.F1R).toEqual({ risk: 'warning', condition: 'Wear' })
    // Ten wheels nobody touched: absent, never "good".
    expect(m.unrecorded).toHaveLength(10)
    expect(m.unrecorded).not.toContain('F1L')
    expect(Object.keys(m.tyreData)).toHaveLength(2)
  })

  it('reads an array of readings keyed by internal slot id too', () => {
    const m = inspectionDiagramModel(trimixer([
      { position: 'R1Lo', condition: 'Good', pressure: 105, treadDepth: 12 },
    ]), { isTyreless })
    expect(m.tyreData.R1Lo.risk).toBe('good')
    expect(m.readings[0].code).toBe('LHCO')   // tri-mixer first rear axle is the centre axle
  })

  it('treats a blank entry as unrecorded, not as a pass', () => {
    const m = inspectionDiagramModel(trimixer({
      LHF1: { condition: '', pressure_psi: null, tread_depth_mm: null },
    }), { isTyreless })
    expect(m.tyreData.F1L).toBeUndefined()
    expect(m.unrecorded).toContain('F1L')
    expect(m.readings).toHaveLength(0)
  })
})

describe('inspectionDiagramModel - condition to band', () => {
  const cases = [
    ['Good', 'good'],
    ['Wear', 'warning'],
    ['Damage', 'critical'],
    ['Puncture', 'critical'],
  ]
  it.each(cases)('%s maps to %s', (condition, risk) => {
    const m = inspectionDiagramModel(trimixer({ LHF1: { condition } }), { isTyreless })
    expect(m.tyreData.F1L.risk).toBe(risk)
  })

  it('agrees with damagedPositions on a word the exact map misses', () => {
    // "Damaged" is not a key in COND_TO_RISK, but damagedPositions flags it and
    // the register shows a defect for it. The wheel must burn red too.
    const m = inspectionDiagramModel(trimixer({ LHF1: { condition: 'Damaged sidewall' } }), { isTyreless })
    expect(m.tyreData.F1L.risk).toBe('critical')
  })
})

describe('inspectionDiagramModel - readings', () => {
  it('prints PSI when recorded and omits a reading that is not', () => {
    const m = inspectionDiagramModel(trimixer({
      LHF1: { condition: 'Good', pressure_psi: 110.4 },
      RHF1: { condition: 'Good' },
      LHF2: { condition: 'Good', tread_depth_mm: 9.5 },
    }), { isTyreless })

    expect(m.subLabels.F1L).toBe('110 PSI')
    expect(m.subLabels.F1R).toBeUndefined()   // no reading, no label - never "0 PSI"
    expect(m.subLabels.F2L).toBe('9.5 mm')
    expect(m.readings.find((r) => r.slot === 'F1R').pressure).toBeNull()
  })

  it('never fabricates a zero reading', () => {
    const m = inspectionDiagramModel(trimixer({ LHF1: { condition: 'Good', pressure_psi: 0 } }), { isTyreless })
    expect(m.subLabels.F1L).toBeUndefined()
    expect(m.readings[0].pressure).toBeNull()
  })

  it('orders readings front to rear', () => {
    const m = inspectionDiagramModel(trimixer({
      LHRO: { condition: 'Good' },
      LHF1: { condition: 'Good' },
    }), { isTyreless })
    expect(m.readings.map((r) => r.slot)).toEqual(['F1L', 'R2Lo'])
  })

  it('reports a position this vehicle does not have instead of dropping it', () => {
    const m = inspectionDiagramModel({
      asset_no: 'PL001', vehicle_type: 'Pickup',
      tyre_conditions: { LHF1: { condition: 'Good' }, LHR3: { condition: 'Wear' } },
    }, { isTyreless })
    expect(Object.keys(m.tyreData)).toEqual(['FL'])
    expect(m.unmatched).toEqual([{ position: 'LHR3', condition: 'Wear' }])
  })
})

describe('inspectionDiagramModel - honest degradation', () => {
  it('draws nothing for equipment with no tyres', () => {
    const m = inspectionDiagramModel({ asset_no: 'GN103', vehicle_type: 'Generator' }, { isTyreless })
    expect(m.renderable).toBe(false)
    expect(m.reason).toMatch(/no tyres/i)
    expect(m.slots).toEqual([])
  })

  it('draws nothing for an unknown vehicle type rather than guessing four wheels', () => {
    const m = inspectionDiagramModel({ asset_no: 'ZZ999', vehicle_type: 'Widget Machine' }, { isTyreless })
    expect(m.renderable).toBe(false)
    expect(m.reason).toMatch(/no wheel layout/i)
    expect(m.tyreData).toEqual({})
  })

  it('says the type is missing when nothing identifies the vehicle', () => {
    const m = inspectionDiagramModel({ id: 'x' }, { isTyreless })
    expect(m.renderable).toBe(false)
    expect(m.reason).toMatch(/not recorded/i)
  })

  it('falls back to the asset class when the vehicle type is blank', () => {
    const m = inspectionDiagramModel({ asset_no: 'TM514', tyre_conditions: { LHF1: { condition: 'Good' } } }, { isTyreless })
    expect(m.renderable).toBe(true)
    expect(m.layoutKey).toBe('Tri-mixer')
  })

  it('returns a reason, not a throw, for no row at all', () => {
    const m = inspectionDiagramModel(null, { isTyreless })
    expect(m.renderable).toBe(false)
    expect(m.reason).toBe('Inspection not loaded.')
  })

  it('survives an unparseable tyre_conditions string', () => {
    const m = inspectionDiagramModel(trimixer('{not json'), { isTyreless })
    expect(m.renderable).toBe(true)
    expect(m.readings).toEqual([])
    expect(m.unrecorded).toHaveLength(12)
  })
})
